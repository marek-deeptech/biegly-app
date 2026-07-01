"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { classify } from "@/lib/intake/classify";
import { DOC_TYPES } from "@/lib/intake/taxonomy";
import { createClient } from "@/lib/supabase/client";
import { storageKey, uploadResumable } from "@/lib/upload";
import OpinionView from "./opinion-view";
import RosterPanel from "./roster-panel";
import Zenek from "./zenek";

type CaseRow = { id: string; name: string; signature: string | null };
type Doc = {
  id: string;
  rel_path: string;
  size_bytes: number | null;
  doc_type: string;
  source: string | null;
  provenance: string | null;
  storage_path: string | null;
  accepted?: boolean | null;
};
type Check = { label: string; present: boolean };
type Metric = {
  key: string;
  label: string;
  value: number | null;
  unit: string | null;
  session_day: string | null;
  computed_at?: string | null;
};
type SubRow = {
  id: string;
  kind: string;
  chapter_no: string;
  title: string;
  status: string;
  body_md: string;
  data: { table?: unknown; findings?: string[]; legalRefs?: string[] } | null;
  updated_at?: string | null;
};

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30";
const BTN_PRIMARY =
  `inline-flex items-center justify-center gap-1.5 bg-ink px-4 py-2 text-xs uppercase tracking-wider text-paper transition-opacity hover:opacity-90 disabled:opacity-40 ${FOCUS}`;
const BTN_SECONDARY =
  `inline-flex items-center justify-center gap-1.5 border border-ink px-3 py-2 text-xs uppercase tracking-wider transition-colors hover:bg-ink hover:text-paper disabled:opacity-40 ${FOCUS}`;

export default function CaseDetail({
  caseRow,
  documents,
  checklist,
  recommended,
  metrics,
  subanalyses,
}: {
  caseRow: CaseRow;
  documents: Doc[];
  checklist: Check[];
  recommended: Check[];
  metrics: Metric[];
  subanalyses: SubRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [up, setUp] = useState<{ done: number; total: number; pct: number } | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeMsg, setAnalyzeMsg] = useState("");
  const [selectedUtp, setSelectedUtp] = useState("");
  const [selectedTrem, setSelectedTrem] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(caseRow.name);
  const [sigVal, setSigVal] = useState(caseRow.signature ?? "");
  const [confirmDelCase, setConfirmDelCase] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<{ name: string; reason: string }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulkDel, setConfirmBulkDel] = useState(false);
  const [tab, setTab] = useState<"overview" | "files" | "opinion">("overview");

  const folderRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<Doc | null>(null);
  const bulkReplaceRef = useRef<HTMLInputElement>(null);

  const isSuspect = (d: Doc) => d.provenance === "wyjście" && !d.accepted;
  const suspectCount = documents.filter(isSuspect).length;
  const suspectIds = documents.filter(isSuspect).map((d) => d.id);
  const allSuspectSelected = suspectIds.length > 0 && suspectIds.every((id) => selected.has(id));

  function toggleAllSuspect() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSuspectSelected) suspectIds.forEach((id) => next.delete(id));
      else suspectIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function notify(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3000);
  }

  const stats = useMemo(() => {
    const wej = documents.filter((d) => d.provenance === "wejście").length;
    const wyj = documents.filter((d) => d.provenance === "wyjście").length;
    return { wej, wyj };
  }, [documents]);

  const checklistOk = checklist.every((c) => c.present);
  const phases = [
    { t: "Dokumenty", done: documents.length > 0 },
    { t: "Kompletność", done: documents.length > 0 && checklistOk },
    { t: "Analiza liczbowa", done: metrics.length > 0 },
    { t: "Opinia", done: false },
  ];

  const utpDocs = useMemo(
    () =>
      documents
        .filter((d) => d.doc_type === "DANE_UTP" && d.storage_path && isMainUtp(d.rel_path))
        .sort((a, b) => (b.size_bytes ?? 0) - (a.size_bytes ?? 0)),
    [documents],
  );
  const otherUtpCount = useMemo(
    () => documents.filter((d) => d.doc_type === "DANE_UTP" && d.storage_path && !isMainUtp(d.rel_path)).length,
    [documents],
  );
  const activeUtp = selectedUtp || utpDocs[0]?.storage_path || "";
  const tremDocs = useMemo(
    () => documents.filter((d) => /trem/i.test(d.rel_path) && d.storage_path && /\.xls[mx]$/i.test(d.rel_path)),
    [documents],
  );
  const activeTrem = selectedTrem || tremDocs[0]?.storage_path || "";

  const visibleDocs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? documents.filter((d) => d.rel_path.toLowerCase().includes(q)) : documents;
  }, [documents, search]);

  const analysis = useMemo(() => {
    if (!metrics.length) return null;
    const find = (k: string) => metrics.find((m) => m.key === k) ?? null;
    const peak = (prefix: string) =>
      metrics
        .filter((m) => m.key.startsWith(prefix))
        .reduce<Metric | null>((a, b) => ((b.value ?? -1) > (a?.value ?? -1) ? b : a), null);
    const computedAt = metrics
      .map((m) => m.computed_at)
      .filter((v): v is string => !!v)
      .sort()
      .pop();
    return {
      groupShare: find("group_turnover_share"),
      washPeak: peak("wash_"),
      cancelPeak: peak("cancel_"),
      computedAt: computedAt ?? null,
    };
  }, [metrics]);

  async function authToken() {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }

  function relOf(f: File) {
    return (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
  }

  async function uploadFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const all = Array.from(fileList);

    // Pliki już obecne w repozytorium sprawy (po ścieżce + faktycznie w magazynie)
    // — nie nadpisujemy, sygnalizujemy. Aktualizacja świadoma = przycisk „Podmień".
    const inStorage = new Map(documents.filter((d) => d.storage_path).map((d) => [d.rel_path, d] as const));
    const toUpload: File[] = [];
    const skip: { name: string; reason: string }[] = [];
    for (const f of all) {
      const rel = relOf(f);
      const ex = inStorage.get(rel);
      if (ex) {
        skip.push({
          name: rel,
          reason: ex.size_bytes === f.size ? "już w repozytorium" : "ta sama nazwa, inna zawartość — użyj „Podmień”",
        });
      } else {
        toUpload.push(f);
      }
    }
    setSkipped(skip);
    setError("");
    if (toUpload.length === 0) {
      notify(skip.length ? `${skip.length} plików już w repozytorium` : "Brak plików do wgrania");
      return;
    }

    const totalBytes = toUpload.reduce((s, f) => s + f.size, 0) || 1;
    setBusy(true);
    setUp({ done: 0, total: toUpload.length, pct: 0 });
    const supabase = createClient();
    const token = await authToken();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const rows: Array<{
      case_id: string;
      rel_path: string;
      size_bytes: number;
      doc_type: string;
      source: string | null;
      provenance: string;
      storage_path: string | null;
    }> = [];
    let sentBase = 0;

    for (let i = 0; i < toUpload.length; i++) {
      const f = toUpload[i];
      const rel = relOf(f);
      const storagePath = storageKey(`${caseRow.id}/${rel}`);
      let uploaded = true;
      try {
        if (!token) throw new Error("brak sesji");
        await uploadResumable({
          supabaseUrl,
          token,
          bucket: "case-files",
          path: storagePath,
          file: f,
          onProgress: (s) =>
            setUp({ done: i, total: toUpload.length, pct: Math.min(100, Math.round(((sentBase + s) / totalBytes) * 100)) }),
        });
      } catch {
        uploaded = false;
      }
      sentBase += f.size;
      const { code, source, provenance } = classify(rel);
      rows.push({
        case_id: caseRow.id,
        rel_path: rel,
        size_bytes: f.size,
        doc_type: code,
        source,
        provenance,
        storage_path: uploaded ? storagePath : null,
      });
      setUp({ done: i + 1, total: toUpload.length, pct: Math.round((sentBase / totalBytes) * 100) });
    }

    const { error: insErr } = await supabase
      .from("documents")
      .upsert(rows, { onConflict: "case_id,rel_path" });
    if (insErr) setError(insErr.message);
    else notify(`Wgrano ${toUpload.length}${skip.length ? ` · ${skip.length} już w repozytorium` : ""}`);
    setBusy(false);
    setUp(null);
    router.refresh();
  }

  function startReplace(doc: Doc) {
    replaceTarget.current = doc;
    replaceRef.current?.click();
  }

  async function handleReplace(fileList: FileList | null) {
    const f = fileList?.[0];
    const doc = replaceTarget.current;
    if (!f || !doc) return;
    setBusy(true);
    setError("");
    setUp({ done: 0, total: 1, pct: 0 });
    const supabase = createClient();
    const token = await authToken();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const storagePath = doc.storage_path || storageKey(`${caseRow.id}/${doc.rel_path}`);
    let uploaded = true;
    try {
      if (!token) throw new Error("brak sesji");
      await uploadResumable({
        supabaseUrl,
        token,
        bucket: "case-files",
        path: storagePath,
        file: f,
        onProgress: (s, t) => setUp({ done: 0, total: 1, pct: Math.round((s / (t || 1)) * 100) }),
      });
    } catch {
      uploaded = false;
    }
    await supabase
      .from("documents")
      .update({ size_bytes: f.size, storage_path: uploaded ? storagePath : doc.storage_path })
      .eq("id", doc.id);
    replaceTarget.current = null;
    setBusy(false);
    setUp(null);
    notify("Podmieniono plik");
    router.refresh();
  }

  async function deleteDoc(doc: Doc) {
    const supabase = createClient();
    if (doc.storage_path) await supabase.storage.from("case-files").remove([doc.storage_path]);
    await supabase.from("documents").delete().eq("id", doc.id);
    setConfirmId(null);
    notify("Usunięto plik");
    router.refresh();
  }

  async function downloadDoc(doc: Doc) {
    if (!doc.storage_path) return;
    const supabase = createClient();
    const { data } = await supabase.storage.from("case-files").createSignedUrl(doc.storage_path, 120);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

  async function acceptDoc(doc: Doc) {
    const supabase = createClient();
    await supabase.from("documents").update({ accepted: true }).eq("id", doc.id);
    notify("Zaakceptowano dokument");
    router.refresh();
  }

  async function acceptSelected() {
    const ids = [...selected];
    if (!ids.length) return;
    const supabase = createClient();
    await supabase.from("documents").update({ accepted: true }).in("id", ids);
    setSelected(new Set());
    notify(`Zaakceptowano ${ids.length}`);
    router.refresh();
  }

  async function deleteSelected() {
    const ids = [...selected];
    if (!ids.length) return;
    const supabase = createClient();
    const paths = documents
      .filter((d) => ids.includes(d.id) && d.storage_path)
      .map((d) => d.storage_path as string);
    if (paths.length) await supabase.storage.from("case-files").remove(paths);
    await supabase.from("documents").delete().in("id", ids);
    setSelected(new Set());
    setConfirmBulkDel(false);
    notify(`Usunięto ${ids.length}`);
    router.refresh();
  }

  async function handleBulkReplace(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const targets = documents.filter((d) => selected.has(d.id));
    const byBase = new Map(targets.map((d) => [basename(d.rel_path), d] as const));
    const matched = Array.from(fileList).filter((f) => byBase.has(f.name));
    if (matched.length === 0) {
      notify("Żaden plik nie pasował nazwą do zaznaczonych");
      return;
    }
    setBusy(true);
    setError("");
    setUp({ done: 0, total: matched.length, pct: 0 });
    const supabase = createClient();
    const token = await authToken();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    for (let i = 0; i < matched.length; i++) {
      const f = matched[i];
      const doc = byBase.get(f.name)!;
      const storagePath = doc.storage_path || storageKey(`${caseRow.id}/${doc.rel_path}`);
      let ok = true;
      try {
        if (!token) throw new Error("brak sesji");
        await uploadResumable({
          supabaseUrl,
          token,
          bucket: "case-files",
          path: storagePath,
          file: f,
          onProgress: (s, t) => setUp({ done: i, total: matched.length, pct: Math.round((s / (t || 1)) * 100) }),
        });
      } catch {
        ok = false;
      }
      await supabase
        .from("documents")
        .update({ size_bytes: f.size, storage_path: ok ? storagePath : doc.storage_path })
        .eq("id", doc.id);
      setUp({ done: i + 1, total: matched.length, pct: 100 });
    }
    setBusy(false);
    setUp(null);
    setSelected(new Set());
    notify(`Podmieniono ${matched.length} (dopasowano po nazwie)`);
    router.refresh();
  }

  async function saveName() {
    const supabase = createClient();
    await supabase
      .from("cases")
      .update({ name: nameVal.trim() || caseRow.name, signature: sigVal.trim() || null })
      .eq("id", caseRow.id);
    setEditingName(false);
    notify("Zapisano nazwę sprawy");
    router.refresh();
  }

  async function deleteCase() {
    const supabase = createClient();
    const paths = documents.map((d) => d.storage_path).filter((p): p is string => !!p);
    if (paths.length) await supabase.storage.from("case-files").remove(paths);
    await supabase.from("cases").delete().eq("id", caseRow.id);
    router.push("/");
  }

  async function runAnalysis() {
    if (!activeUtp) return;
    setAnalyzing(true);
    setAnalyzeMsg("");
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: caseRow.id, storagePath: activeUtp }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      notify(`Policzono ${data.metrics} wskaźników`);
      router.refresh();
    } catch (e) {
      setAnalyzeMsg(`Błąd analizy: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAnalyzing(false);
    }
  }

  async function runTrem() {
    if (!activeTrem) return;
    setAnalyzing(true);
    setAnalyzeMsg("");
    try {
      const res = await fetch("/api/trem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: caseRow.id, storagePath: activeTrem }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      notify(`Policzono z TREM: ${data.metrics} wskaźników`);
      router.refresh();
    } catch (e) {
      setAnalyzeMsg(`Błąd analizy TREM: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-3 flex items-center justify-between">
        <Link href="/" className="text-sm text-inksoft transition-colors hover:text-ink">
          ← Sprawy
        </Link>
        {!editingName && !confirmDelCase && (
          <button
            onClick={() => setConfirmDelCase(true)}
            className="text-xs text-red-600 transition-colors hover:text-red-800"
          >
            Usuń sprawę
          </button>
        )}
      </div>

      {confirmDelCase && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm">
          <span className="text-red-800">Usunąć sprawę i wszystkie jej dokumenty? Tej operacji nie można cofnąć.</span>
          <span className="flex gap-3">
            <button onClick={deleteCase} className="font-medium text-red-700 hover:underline">
              Usuń sprawę
            </button>
            <button onClick={() => setConfirmDelCase(false)} className="text-inksoft hover:underline">
              Anuluj
            </button>
          </span>
        </div>
      )}

      <header className="mb-6">
        {editingName ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={nameVal}
              onChange={(e) => setNameVal(e.target.value)}
              className="rounded-lg border border-ink/30 px-3 py-2 text-lg outline-none focus:border-neutral-500"
            />
            <input
              value={sigVal}
              onChange={(e) => setSigVal(e.target.value)}
              placeholder="sygnatura"
              className="w-56 rounded-lg border border-ink/30 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            />
            <button onClick={saveName} className={BTN_PRIMARY}>
              Zapisz
            </button>
            <button
              onClick={() => {
                setEditingName(false);
                setNameVal(caseRow.name);
                setSigVal(caseRow.signature ?? "");
              }}
              className={BTN_SECONDARY}
            >
              Anuluj
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{caseRow.name}</h1>
              {caseRow.signature && <p className="mt-1 text-sm text-inksoft">{caseRow.signature}</p>}
            </div>
            <button
              onClick={() => setEditingName(true)}
              className="text-xs text-inksoft transition-colors hover:text-ink"
            >
              Zmień nazwę
            </button>
          </div>
        )}
      </header>

      <div className="mb-6 flex gap-1 border-b border-ink/20">
        {(["overview", "files", "opinion"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-xs uppercase tracking-wider transition-colors ${
              tab === t
                ? "border-ink font-semibold text-ink"
                : "border-transparent text-inksoft hover:text-ink"
            }`}
          >
            {t === "overview" ? "Sprawa" : t === "files" ? `Pliki (${documents.length})` : "Opinia"}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <>
      <section className="mb-8">
        <ol className="flex flex-wrap gap-2">
          {phases.map((p, i) => (
            <li
              key={p.t}
              className={`rounded-lg border px-3 py-2 text-xs ${
                p.done
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-ink/20 bg-card text-inksoft"
              }`}
            >
              {i + 1}. {p.t}
              {p.done ? " ✓" : ""}
            </li>
          ))}
        </ol>
      </section>

      <section className="mb-8 border border-ink/60 bg-card p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em]">Wgraj akta sprawy</h2>
        <p className="mb-3 text-xs text-inksoft">
          Wskaż cały katalog albo dograj pojedyncze pliki. Ponowne wgranie tego samego pliku
          aktualizuje wpis — bez duplikatów.
        </p>
        <div className="flex gap-2">
          <button className={BTN_PRIMARY} disabled={busy} onClick={() => folderRef.current?.click()}>
            Wybierz katalog
          </button>
          <button className={BTN_SECONDARY} disabled={busy} onClick={() => filesRef.current?.click()}>
            Dodaj pliki
          </button>
        </div>
        <input
          ref={folderRef}
          type="file"
          multiple
          {...({ webkitdirectory: "" } as Record<string, string>)}
          className="hidden"
          onChange={(e) => uploadFiles(e.target.files)}
        />
        <input ref={filesRef} type="file" multiple className="hidden" onChange={(e) => uploadFiles(e.target.files)} />
        <input ref={replaceRef} type="file" className="hidden" onChange={(e) => handleReplace(e.target.files)} />

        {up && (
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-xs text-ink/80">
              <span>
                Wgrywanie… {up.done}/{up.total} plików
              </span>
              <span className="font-medium text-ink">{up.pct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-ink/10">
              <div className="h-full bg-ink transition-all" style={{ width: `${up.pct}%` }} />
            </div>
          </div>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        {skipped.length > 0 && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-medium text-amber-800">
                {skipped.length}{" "}
                {skipped.length === 1 ? "plik już" : "plików już"} w Repozytorium Dokumentów Sprawy — nie nadpisano
              </span>
              <button onClick={() => setSkipped([])} className="text-xs text-amber-700 hover:underline">
                Ukryj
              </button>
            </div>
            <ul className="max-h-40 overflow-auto text-xs text-amber-800">
              {skipped.map((s, i) => (
                <li key={i} className="truncate py-0.5">
                  · {basename(s.name)} — {s.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="mb-8 grid grid-cols-3 gap-3">
        <Stat n={documents.length} label="dokumentów" />
        <Stat n={stats.wej} label="wejście (dowody)" color="text-emerald-700" />
        <Stat n={stats.wyj} label="wyjście (biegły)" color="text-amber-700" />
      </section>

      <section className="mb-8 border border-ink/60 bg-card p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em]">
          Dokumenty wymagane{" "}
          <span
            className={`ml-1 rounded-full px-2 py-0.5 text-xs font-normal ${
              checklistOk ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
            }`}
          >
            {checklistOk ? "komplet" : "braki"}
          </span>
        </h2>
        <div className="grid gap-x-6 sm:grid-cols-2">
          <div>{checklist.map((c) => <Row key={c.label} label={c.label} present={c.present} strongMissing />)}</div>
          <div>
            <p className="mb-1 text-xs font-medium text-inksoft">Zalecane</p>
            {recommended.map((c) => <Row key={c.label} label={c.label} present={c.present} />)}
          </div>
        </div>
      </section>
        </>
      )}

      {tab === "files" && (
      <section className="mb-8 border border-ink/60 bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-line p-3">
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em]">Dokumenty ({documents.length})</h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="szukaj w nazwach…"
            aria-label="Szukaj w nazwach plików"
            className="w-48 rounded-lg border border-ink/30 px-3 py-1.5 text-sm outline-none focus:border-neutral-500"
          />
        </div>
        {suspectCount > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            <span>
              Wykryto {suspectCount} {suspectCount === 1 ? "pozycję" : "pozycji"} oznaczoną jako wytwór biegłego
              (wyjście) — na czerwono. Sprawdź, usuń albo zaakceptuj.
            </span>
            <label className="flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap font-medium">
              <input type="checkbox" checked={allSuspectSelected} onChange={toggleAllSuspect} />
              Zaznacz wszystkie podejrzane
            </label>
          </div>
        )}
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-ink/20 bg-card px-3 py-2 text-sm">
            <span className="font-medium">Zaznaczono {selected.size}</span>
            <button onClick={() => bulkReplaceRef.current?.click()} disabled={busy} className={BTN_SECONDARY}>
              Podmień
            </button>
            <button onClick={acceptSelected} className={BTN_SECONDARY}>
              Zaakceptuj
            </button>
            {confirmBulkDel ? (
              <>
                <button
                  onClick={deleteSelected}
                  className={`rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 ${FOCUS}`}
                >
                  Tak, usuń {selected.size}
                </button>
                <button onClick={() => setConfirmBulkDel(false)} className={BTN_SECONDARY}>
                  Anuluj
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmBulkDel(true)}
                className={`rounded-lg border border-red-300 px-3 py-2 text-sm text-red-700 transition-colors hover:bg-red-50 ${FOCUS}`}
              >
                Usuń
              </button>
            )}
            <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-inksoft hover:underline">
              Wyczyść zaznaczenie
            </button>
            <input
              ref={bulkReplaceRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => handleBulkReplace(e.target.files)}
            />
          </div>
        )}
        {visibleDocs.length === 0 ? (
          <p className="p-6 text-center text-sm text-inksoft">
            {documents.length === 0 ? "Brak dokumentów — wgraj akta powyżej." : "Brak wyników wyszukiwania."}
          </p>
        ) : (
          <ul className="max-h-96 overflow-auto">
            {visibleDocs.map((d) => (
              <li
                key={d.id}
                className={`flex items-center gap-3 border-b border-line px-3 py-2 last:border-0 ${
                  isSuspect(d) ? "bg-red-50" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(d.id)}
                  onChange={() => toggleSelect(d.id)}
                  aria-label={`Zaznacz ${basename(d.rel_path)}`}
                  className="shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className={`truncate text-sm ${isSuspect(d) ? "text-red-700" : ""}`}>{basename(d.rel_path)}</div>
                  <div className="truncate text-xs text-inksoft">
                    {DOC_TYPES[d.doc_type]?.label ?? d.doc_type}
                    {isSuspect(d) && (
                      <span className="ml-2 font-medium text-red-600">· wytwór biegłego — czy na pewno do akt?</span>
                    )}
                    {d.provenance === "wyjście" && d.accepted && (
                      <span className="ml-2 text-emerald-600">· zaakceptowany</span>
                    )}
                    {!d.storage_path && <span className="ml-2 text-amber-600">· nie w magazynie</span>}
                  </div>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${statusBadge(d.provenance).cls}`}>
                  {statusBadge(d.provenance).label}
                </span>
                <span className="w-14 text-right text-xs text-inksoft">{fmtSize(d.size_bytes)}</span>
                {confirmId === d.id ? (
                  <span className="flex shrink-0 gap-2 text-xs">
                    <button onClick={() => deleteDoc(d)} className="font-medium text-red-600 hover:underline">
                      Tak, usuń
                    </button>
                    <button onClick={() => setConfirmId(null)} className="text-inksoft hover:underline">
                      Anuluj
                    </button>
                  </span>
                ) : (
                  <span className="flex shrink-0 gap-3 text-xs">
                    <button onClick={() => startReplace(d)} className="text-ink/80 transition-colors hover:text-ink">
                      Podmień
                    </button>
                    {isSuspect(d) && (
                      <button onClick={() => acceptDoc(d)} className="text-emerald-700 transition-colors hover:text-emerald-900">
                        Zaakceptuj
                      </button>
                    )}
                    <button onClick={() => setConfirmId(d.id)} className="text-red-600 transition-colors hover:text-red-800">
                      Usuń
                    </button>
                    {d.storage_path && (
                      <button
                        onClick={() => downloadDoc(d)}
                        className="text-ink/80 transition-colors hover:text-ink"
                      >
                        Pobierz
                      </button>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      )}

      {tab === "overview" && <RosterPanel caseId={caseRow.id} />}

      {tab === "overview" && (
      <section className="border border-ink/60 bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em]">Analiza liczbowa (silnik faktów)</h2>
          <div className="flex items-center gap-2">
            {utpDocs.length > 0 && (
              <select
                value={activeUtp}
                onChange={(e) => setSelectedUtp(e.target.value)}
                className="max-w-[220px] rounded-lg border border-ink/30 px-2 py-1.5 text-xs"
              >
                {utpDocs.map((d) => (
                  <option key={d.id} value={d.storage_path ?? ""}>
                    {basename(d.rel_path)}
                  </option>
                ))}
              </select>
            )}
            <button onClick={runAnalysis} disabled={!activeUtp || analyzing} className={BTN_PRIMARY}>
              {analyzing ? "Liczę…" : metrics.length > 0 ? "Przelicz wskaźniki" : "Policz wskaźniki"}
            </button>
            {tremDocs.length > 0 && (
              <>
                <select
                  value={activeTrem}
                  onChange={(e) => setSelectedTrem(e.target.value)}
                  className="max-w-[200px] rounded-lg border border-ink/30 px-2 py-1.5 text-xs"
                >
                  {tremDocs.map((d) => (
                    <option key={d.id} value={d.storage_path ?? ""}>
                      {basename(d.rel_path)}
                    </option>
                  ))}
                </select>
                <button onClick={runTrem} disabled={!activeTrem || analyzing} className={BTN_SECONDARY}>
                  {analyzing ? "Liczę…" : "Policz z TREM"}
                </button>
              </>
            )}
          </div>
        </div>
        {!activeUtp && tremDocs.length === 0 && (
          <p className="text-xs text-inksoft">
            {otherUtpCount > 0
              ? "Wgrane pliki UTP to dane źródłowe per-dzień — silnik liczy z głównego pliku łączonego. Wgraj „Transakcje_i_Zlecenia … prok.xlsx”, aby policzyć wskaźniki."
              : "Wgraj główny plik UTP („Transakcje_i_Zlecenia … prok.xlsx”), aby policzyć wskaźniki."}
          </p>
        )}
        {analyzeMsg && <p className="mb-3 text-sm text-red-600">{analyzeMsg}</p>}

        {metrics.length > 0 && analysis && (
          <>
            {analysis.computedAt && (
              <p className="mb-3 text-xs text-inksoft">
                Policzono: {new Date(analysis.computedAt).toLocaleString("pl-PL")}
              </p>
            )}
            <div className="mb-4 grid grid-cols-3 gap-3">
              <MetricCard label="Udział Grupy w obrocie" value={analysis.groupShare ? fmt(analysis.groupShare) : "—"} />
              <MetricCard
                label="Wash-trades — szczyt"
                value={analysis.washPeak ? fmt(analysis.washPeak) : "—"}
                sub={analysis.washPeak?.session_day ?? undefined}
              />
              <MetricCard
                label="Anulacje — szczyt"
                value={analysis.cancelPeak ? fmt(analysis.cancelPeak) : "—"}
                sub={analysis.cancelPeak?.session_day ?? undefined}
              />
            </div>
            <ul className="mb-3 space-y-1">
              {metrics
                .filter((m) => !m.session_day)
                .map((m) => (
                  <li key={m.key} className="flex justify-between border-b border-line py-1.5 text-sm">
                    <span>{m.label}</span>
                    <span className="font-medium tabular-nums">{fmt(m)}</span>
                  </li>
                ))}
            </ul>
            {metrics.some((m) => m.session_day) && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-inksoft">
                    <th className="py-1 text-left">Sesja</th>
                    <th className="py-1 text-right">Wash-trades</th>
                    <th className="py-1 text-right">Anulacje kupna</th>
                  </tr>
                </thead>
                <tbody>
                  {[...new Set(metrics.filter((m) => m.session_day).map((m) => m.session_day))].map((day) => {
                    const wash = metrics.find((m) => m.session_day === day && m.key.startsWith("wash_"));
                    const cancel = metrics.find((m) => m.session_day === day && m.key.startsWith("cancel_"));
                    return (
                      <tr key={day} className="border-b border-line last:border-0">
                        <td className="py-1.5">{day}</td>
                        <td className="py-1.5 text-right tabular-nums">{wash ? fmt(wash) : "—"}</td>
                        <td className="py-1.5 text-right tabular-nums">{cancel ? fmt(cancel) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>
      )}

      {tab === "opinion" && (
        <OpinionView
          caseId={caseRow.id}
          caseRow={caseRow}
          metrics={metrics}
          documents={documents}
          subanalyses={subanalyses}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-lg bg-ink px-4 py-2 text-sm text-paper shadow-lg">
          {toast}
        </div>
      )}

      <Zenek documents={documents} checklist={checklist} />
    </main>
  );
}

function basename(p: string): string {
  return p.split("/").pop() || p;
}
// Główny plik UTP (łączony: arkusze Transakcje + Zlecenia BO), a NIE źródłowe
// pliki per-dzień ("…zrodlo…", arkusze "Mikro-…"), których silnik nie liczy.
function isMainUtp(relPath: string): boolean {
  const b = basename(relPath).toLowerCase();
  if (b.includes("zrodlo") || b.includes("źródło")) return false;
  return b.includes("transakcje_i_zlecenia") || (b.includes("transakcje") && b.includes("zlecenia"));
}
function statusBadge(prov: string | null | undefined): { cls: string; label: string } {
  if (prov === "wejście") return { cls: "bg-emerald-100 text-emerald-800", label: "wej" };
  if (prov === "wyjście") return { cls: "bg-red-100 text-red-800", label: "wyj" };
  return { cls: "bg-ink/10 text-inksoft", label: "?" };
}
function fmtSize(n: number | null): string {
  if (!n) return "—";
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}
function fmt(m: Metric): string {
  if (m.value == null) return "—";
  if (m.unit === "%") return `${m.value}%`;
  const n = m.value.toLocaleString("pl-PL");
  return m.unit ? `${n} ${m.unit}` : n;
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-card px-4 py-3">
      <div className="text-xs text-inksoft">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-inksoft">{sub}</div>}
    </div>
  );
}

function Stat({ n, label, color = "" }: { n: number; label: string; color?: string }) {
  return (
    <div className="border border-ink/60 bg-card px-4 py-3">
      <div className={`text-2xl font-semibold ${color}`}>{n}</div>
      <div className="text-xs text-inksoft">{label}</div>
    </div>
  );
}

function Row({ label, present, strongMissing = false }: { label: string; present: boolean; strongMissing?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-line py-1.5 last:border-0">
      <span className="text-sm">{label}</span>
      <span
        className={`rounded-full px-2 py-0.5 text-xs ${
          present
            ? "bg-emerald-100 text-emerald-800"
            : strongMissing
              ? "bg-red-100 text-red-800"
              : "bg-ink/10 text-inksoft"
        }`}
      >
        {present ? "obecny" : "brak"}
      </span>
    </div>
  );
}
