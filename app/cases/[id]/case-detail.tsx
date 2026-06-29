"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { classify } from "@/lib/intake/classify";
import { DOC_TYPES } from "@/lib/intake/taxonomy";
import { createClient } from "@/lib/supabase/client";
import { uploadResumable } from "@/lib/upload";

type CaseRow = { id: string; name: string; signature: string | null };
type Doc = {
  id: string;
  rel_path: string;
  size_bytes: number | null;
  doc_type: string;
  source: string | null;
  provenance: string | null;
  storage_path: string | null;
};
type Check = { label: string; present: boolean };
type Metric = { key: string; label: string; value: number | null; unit: string | null; session_day: string | null };

const BTN_PRIMARY =
  "rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-40";
const BTN_SECONDARY =
  "rounded-lg border border-neutral-300 px-3 py-2 text-sm transition-colors hover:bg-neutral-100 disabled:opacity-40";

export default function CaseDetail({
  caseRow,
  documents,
  checklist,
  recommended,
  metrics,
}: {
  caseRow: CaseRow;
  documents: Doc[];
  checklist: Check[];
  recommended: Check[];
  metrics: Metric[];
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
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(caseRow.name);
  const [sigVal, setSigVal] = useState(caseRow.signature ?? "");
  const [confirmDelCase, setConfirmDelCase] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const folderRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<Doc | null>(null);

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
        .filter((d) => d.doc_type === "DANE_UTP" && d.storage_path)
        .sort((a, b) => (b.size_bytes ?? 0) - (a.size_bytes ?? 0)),
    [documents],
  );
  const activeUtp = selectedUtp || utpDocs[0]?.storage_path || "";

  const visibleDocs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? documents.filter((d) => d.rel_path.toLowerCase().includes(q)) : documents;
  }, [documents, search]);

  async function authToken() {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }

  async function uploadFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    const totalBytes = files.reduce((s, f) => s + f.size, 0) || 1;
    setError("");
    setBusy(true);
    setUp({ done: 0, total: files.length, pct: 0 });
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

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      const storagePath = `${caseRow.id}/${rel}`;
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
            setUp({ done: i, total: files.length, pct: Math.min(100, Math.round(((sentBase + s) / totalBytes) * 100)) }),
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
      setUp({ done: i + 1, total: files.length, pct: Math.round((sentBase / totalBytes) * 100) });
    }

    const { error: insErr } = await supabase
      .from("documents")
      .upsert(rows, { onConflict: "case_id,rel_path" });
    if (insErr) setError(insErr.message);
    else notify(`Wgrano ${files.length} plików`);
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
    const storagePath = doc.storage_path || `${caseRow.id}/${doc.rel_path}`;
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

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-3 flex items-center justify-between">
        <Link href="/" className="text-sm text-neutral-500 transition-colors hover:text-neutral-900">
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
            <button onClick={() => setConfirmDelCase(false)} className="text-neutral-500 hover:underline">
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
              className="rounded-lg border border-neutral-300 px-3 py-2 text-lg outline-none focus:border-neutral-500"
            />
            <input
              value={sigVal}
              onChange={(e) => setSigVal(e.target.value)}
              placeholder="sygnatura"
              className="w-56 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
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
              {caseRow.signature && <p className="mt-1 text-sm text-neutral-500">{caseRow.signature}</p>}
            </div>
            <button
              onClick={() => setEditingName(true)}
              className="text-xs text-neutral-500 transition-colors hover:text-neutral-900"
            >
              Zmień nazwę
            </button>
          </div>
        )}
      </header>

      <section className="mb-8">
        <ol className="flex flex-wrap gap-2">
          {phases.map((p, i) => (
            <li
              key={p.t}
              className={`rounded-lg border px-3 py-2 text-xs ${
                p.done
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-neutral-200 bg-white text-neutral-400"
              }`}
            >
              {i + 1}. {p.t}
              {p.done ? " ✓" : ""}
            </li>
          ))}
        </ol>
      </section>

      <section className="mb-8 rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-bold">Wgraj akta sprawy</h2>
        <p className="mb-3 text-xs text-neutral-500">
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
            <div className="mb-1 flex justify-between text-xs text-neutral-600">
              <span>
                Wgrywanie… {up.done}/{up.total} plików
              </span>
              <span className="font-medium text-neutral-900">{up.pct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
              <div className="h-full bg-emerald-600 transition-all" style={{ width: `${up.pct}%` }} />
            </div>
          </div>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </section>

      <section className="mb-8 grid grid-cols-3 gap-3">
        <Stat n={documents.length} label="dokumentów" />
        <Stat n={stats.wej} label="wejście (dowody)" color="text-emerald-700" />
        <Stat n={stats.wyj} label="wyjście (biegły)" color="text-amber-700" />
      </section>

      <section className="mb-8 rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-bold">
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
            <p className="mb-1 text-xs font-medium text-neutral-500">Zalecane</p>
            {recommended.map((c) => <Row key={c.label} label={c.label} present={c.present} />)}
          </div>
        </div>
      </section>

      <section className="mb-8 rounded-xl border border-neutral-200 bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-100 p-3">
          <h2 className="text-sm font-bold">Dokumenty ({documents.length})</h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="szukaj w nazwach…"
            className="w-48 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm outline-none focus:border-neutral-500"
          />
        </div>
        {visibleDocs.length === 0 ? (
          <p className="p-6 text-center text-sm text-neutral-400">
            {documents.length === 0 ? "Brak dokumentów — wgraj akta powyżej." : "Brak wyników wyszukiwania."}
          </p>
        ) : (
          <ul className="max-h-96 overflow-auto">
            {visibleDocs.map((d) => (
              <li key={d.id} className="flex items-center gap-3 border-b border-neutral-100 px-3 py-2 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{basename(d.rel_path)}</div>
                  <div className="truncate text-xs text-neutral-400">
                    {DOC_TYPES[d.doc_type]?.label ?? d.doc_type}
                    {!d.storage_path && <span className="ml-2 text-amber-600">· nie w magazynie</span>}
                  </div>
                </div>
                <span className="w-14 text-right text-xs text-neutral-400">{fmtSize(d.size_bytes)}</span>
                {confirmId === d.id ? (
                  <span className="flex shrink-0 gap-2 text-xs">
                    <button onClick={() => deleteDoc(d)} className="font-medium text-red-600 hover:underline">
                      Tak, usuń
                    </button>
                    <button onClick={() => setConfirmId(null)} className="text-neutral-500 hover:underline">
                      Anuluj
                    </button>
                  </span>
                ) : (
                  <span className="flex shrink-0 gap-3 text-xs">
                    <button onClick={() => startReplace(d)} className="text-neutral-600 transition-colors hover:text-neutral-900">
                      Podmień
                    </button>
                    <button onClick={() => setConfirmId(d.id)} className="text-red-600 transition-colors hover:text-red-800">
                      Usuń
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold">Analiza liczbowa (silnik faktów)</h2>
          <div className="flex items-center gap-2">
            {utpDocs.length > 0 && (
              <select
                value={activeUtp}
                onChange={(e) => setSelectedUtp(e.target.value)}
                className="max-w-[220px] rounded-lg border border-neutral-300 px-2 py-1.5 text-xs"
              >
                {utpDocs.map((d) => (
                  <option key={d.id} value={d.storage_path ?? ""}>
                    {basename(d.rel_path)}
                  </option>
                ))}
              </select>
            )}
            <button onClick={runAnalysis} disabled={!activeUtp || analyzing} className={BTN_PRIMARY}>
              {analyzing ? "Liczę…" : "Policz wskaźniki"}
            </button>
          </div>
        </div>
        {!activeUtp && (
          <p className="text-xs text-neutral-500">
            Wgraj plik danych UTP (transakcje i zlecenia), aby policzyć wskaźniki.
          </p>
        )}
        {analyzeMsg && <p className="mb-3 text-sm text-red-600">{analyzeMsg}</p>}

        {metrics.length > 0 && (
          <>
            <ul className="mb-3 space-y-1">
              {metrics
                .filter((m) => !m.session_day)
                .map((m) => (
                  <li key={m.key} className="flex justify-between border-b border-neutral-100 py-1.5 text-sm">
                    <span>{m.label}</span>
                    <span className="font-medium tabular-nums">{fmt(m)}</span>
                  </li>
                ))}
            </ul>
            {metrics.some((m) => m.session_day) && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-neutral-500">
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
                      <tr key={day} className="border-b border-neutral-100 last:border-0">
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

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </main>
  );
}

function basename(p: string): string {
  return p.split("/").pop() || p;
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

function Stat({ n, label, color = "" }: { n: number; label: string; color?: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
      <div className={`text-2xl font-semibold ${color}`}>{n}</div>
      <div className="text-xs text-neutral-500">{label}</div>
    </div>
  );
}

function Row({ label, present, strongMissing = false }: { label: string; present: boolean; strongMissing?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-neutral-100 py-1.5 last:border-0">
      <span className="text-sm">{label}</span>
      <span
        className={`rounded-full px-2 py-0.5 text-xs ${
          present
            ? "bg-emerald-100 text-emerald-800"
            : strongMissing
              ? "bg-red-100 text-red-800"
              : "bg-neutral-100 text-neutral-500"
        }`}
      >
        {present ? "obecny" : "brak"}
      </span>
    </div>
  );
}
