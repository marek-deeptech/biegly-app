"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useMemo, useRef, useState } from "react";

import { Button, ProgressBar } from "@/components/ui";
import { classify } from "@/lib/intake/classify";
import { wykryjWarstwe } from "@/lib/intake/warstwa";
import { AUTHORS } from "@/lib/intake/taxonomy";
// Katalog typów zależy od DZIEDZINY: sprawa bankowa ma własne czternaście typów.
// Wcześniej lista plików sięgała po sam rdzeń, przez co dokumenty bankowe wyświetlały
// się jako surowe kody („SPRAWOZDANIE_BANK") zamiast etykiet.
import { docTypesDla } from "@/lib/intake/classify";
import { rdzenDokumentu } from "@/lib/intake/completeness";
import { cmpMainUtp, isMainUtp, utpVariantLabel } from "@/lib/intake/utp";
import { createClient } from "@/lib/supabase/client";
import { storageKey, uploadResumable } from "@/lib/upload";
import OpinionView from "./opinion-view";
import CompletenessPanel from "./completeness-panel";
import { packDla } from "@/lib/domain";
import AnalizaEfPanel from "./analiza-ef-panel";
import AnalizaIVPanel from "./analiza-iv-panel";
import WskaznikiBankPanel from "./wskazniki-bank-panel";
import WarsztatBankPanel from "./warsztat-bank-panel";
import PytaniaPanel from "./pytania-panel";
import RosterPanel from "./roster-panel";
import WarsztatView from "./warsztat-view";
import Albin from "./albin";

// `typ` nie jest opcjonalny: po nim rozgałęziają się kroki procesu, builder opinii
// i eksport. Opcjonalność sprawiała, że pominięcie pola nie było błędem kompilacji —
// i tak właśnie trzy trasy eksportu cicho budowały opinię bankową wg szkieletu GPW.
type CaseRow = { id: string; name: string; signature: string | null; typ: string | null; tryb: string | null; rola: string | null;
  organ: string | null; data_powolania: string | null };
type Doc = {
  id: string;
  rel_path: string;
  size_bytes: number | null;
  doc_type: string;
  source: string | null;
  provenance: string | null;
  storage_path: string | null;
  accepted?: boolean | null;
  wytworca?: string | null; // kod z AUTHORS (kto sporządził/podpisał)
  karta_start?: number | null; // nr karty akt — początek
  karta_end?: number | null; // nr karty akt — koniec
  opis?: string | null; // czym dokument JEST — jedno zdanie z klasyfikacji z treści
  warstwa_tekstu?: string | null; // 'jest' | 'ocr' | 'brak' — czy treść jest czytelna maszynowo
  // Pozycja wydzielona ze skanu: własny zakres stron i wskazanie pliku-rodzica.
  // Jeden skan mieści zwykle kilka odrębnych dokumentów akt (migracja 0017).
  strona_od?: number | null;
  strona_do?: number | null;
  plik_zrodlowy?: string | null;
};
type Check = {
  label: string;
  present: boolean;
  /** Czym jest dokument, który ten wymóg zamyka — z klasyfikacji z treści. */
  dokument?: string;
  /** Numer karty akt, pod którym leży — biegły cytuje go w opinii. */
  karta?: number;
  kartaDo?: number;
};
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
  data:
    | {
        table?: unknown;
        findings?: string[];
        legalRefs?: string[];
        metrics?: Metric[]; // sekcja wskaźników per instrument (subanalizy trem_*)
        label?: string;
        isin?: string;
        transactions?: number;
      }
    | null;
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
  // Domyślnie JEDEN WIERSZ NA DOKUMENT. Ten sam dokument leży w magazynie jako skan
  // i jako plik po OCR — to dwa pliki, ale jedna karta akt. Lista złożona z obu
  // wariantów miała 68 pozycji przy 35 dokumentach i czytało się ją jak katalog
  // plików, a nie jak spis akt.
  const [pokazWarianty, setPokazWarianty] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeMsg, setAnalyzeMsg] = useState("");
  const [selectedUtp, setSelectedUtp] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(caseRow.name);
  const [sigVal, setSigVal] = useState(caseRow.signature ?? "");
  // Organ powołujący i data postanowienia — wchodzą do formuły wstępnej opinii.
  // Nazwa organu jest w treści postanowienia, a nie w metadanych, więc musi ją
  // podać biegły; aplikacja jej nie zgaduje.
  const [organVal, setOrganVal] = useState(caseRow.organ ?? "");
  const [dataVal, setDataVal] = useState(caseRow.data_powolania ?? "");
  const [confirmDelCase, setConfirmDelCase] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<{ name: string; reason: string }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulkDel, setConfirmBulkDel] = useState(false);
  const [tab, setTab] = useState<"overview" | "files" | "analysis" | "ekonomia" | "warsztat" | "opinion">("overview");
  const [docTypeFilter, setDocTypeFilter] = useState("");
  const [authorFilter, setAuthorFilter] = useState("");
  const [provFilter, setProvFilter] = useState("");
  const [docSort, setDocSort] = useState<"name" | "size" | "type" | "status" | "karta">("name");

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
    // DOKUMENTY, nie pliki. Skan i jego warianty po OCR (także podzielone na części)
    // to jeden dokument w aktach — licznik plików pokazywał w sprawie SK Banku 68
    // przy 33 dokumentach i zawyżał obraz materiału dwukrotnie.
    // Pozycja akt = dokument wydzielony ze skanu ALBO skan, z którego nic nie wydzielono.
    const zawierajace = new Set(documents.map((d) => d.plik_zrodlowy).filter(Boolean) as string[]);
    const rdzenieZawierajace = new Set(
      documents.filter((d) => zawierajace.has(d.id)).map((d) => rdzenDokumentu(d.rel_path)),
    );
    const dokumentow = new Set(
      documents
        .filter((d) => d.plik_zrodlowy || !rdzenieZawierajace.has(rdzenDokumentu(d.rel_path)))
        .map((d) => (d.plik_zrodlowy ? d.id : rdzenDokumentu(d.rel_path))),
    ).size;
    return { wej, wyj, dokumentow };
  }, [documents]);

  const checklistOk = checklist.every((c) => c.present);
  // Kroki procesu = główna nawigacja (stepper): Sprawa → Pliki → Analiza → Opinia.
  // Kroki pochodzą z PAKIETU DZIEDZINOWEGO, nie są zaszyte tutaj. Warunki ukończenia
  // różnią się co do istoty: w manipulacjach krok 4 wymaga subanaliz `techniki`
  // i `powiazania_dane`, w sprawach bankowych — `procedury` i `limity`. Zaszycie
  // ich w komponencie oznaczało, że sprawa bankowa nigdy nie mogła ukończyć kroku 4.
  const pakiet = packDla(caseRow.typ);
  const steps = pakiet.kroki.map((k) => ({
    key: k.klucz,
    label: k.klucz === "files" ? `${k.label} · ${documents.length}` : k.label,
    opis: k.opis,
    done: k.gotowy({
      dokumentow: stats.dokumentow,
      metryk: metrics.length,
      subanalizy: subanalyses.map((s) => s.kind),
      zatwierdzone: subanalyses.filter((s) => s.status === "zatwierdzona").length,
      checklistOk,
    }),
  }));
  const dziedzinaBankowa = pakiet.id === "ryzyko_bankowe";
  const KATALOG_TYPOW = docTypesDla(caseRow.typ);
  // Do listy wyboru: bez UNKNOWN (nie klasyfikuje się „na nieznany"), posortowane
  // po etykiecie, żeby biegły szukał wzrokiem nazwy, a nie kodu.
  const TYPY_DO_WYBORU = Object.entries(KATALOG_TYPOW)
    .filter(([k]) => k !== "UNKNOWN")
    .sort((a, b) => a[1].label.localeCompare(b[1].label, "pl"));

  const utpDocs = useMemo(
    () =>
      documents
        .filter((d) => d.doc_type === "DANE_UTP" && d.storage_path && isMainUtp(d.rel_path))
        // Najnowszy wariant (wersja w nazwie) NAJPIERW; przy równej wersji — największy (najpełniejszy).
        .sort(cmpMainUtp),
    [documents],
  );
  const otherUtpCount = useMemo(
    () => documents.filter((d) => d.doc_type === "DANE_UTP" && d.storage_path && !isMainUtp(d.rel_path)).length,
    [documents],
  );
  const activeUtp = selectedUtp || utpDocs[0]?.storage_path || "";
  // „Policz z TREM (łącznie)" liczy z WSZYSTKICH sparowanych plików per instrument
  // (UTP TREM CSY/RSY, IAD_C_TREM) — backend sam je złączy w jeden przebieg. Surowe pliki
  // MiFIR per osoba (…_Uproszczony) i strumienie tu nie liczymy.
  const tremDocs = useMemo(
    () =>
      documents.filter(
        (d) =>
          /\.xls[mx]$/i.test(d.rel_path) &&
          d.storage_path &&
          /utp[\s_-]*trem|iad[\s_-]*c/i.test(basename(d.rel_path)),
      ),
    [documents],
  );

  const typeCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of documents) c[d.doc_type] = (c[d.doc_type] ?? 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [documents]);

  // Rozkład wg wytwórcy (drugi wymiar klasyfikacji) — do filtra.
  const authorCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of documents) if (d.wytworca) c[d.wytworca] = (c[d.wytworca] ?? 0) + 1;
    return Object.entries(c).sort((a, b) => (AUTHORS[a[0]]?.order ?? 99) - (AUTHORS[b[0]]?.order ?? 99));
  }, [documents]);

  const visibleDocs = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qn = /^\d+$/.test(q) ? parseInt(q, 10) : null; // wyszukiwanie po numerze karty akt
    let list = documents;
    if (q)
      list = list.filter(
        (d) =>
          d.rel_path.toLowerCase().includes(q) ||
          // Szukamy też po OPISIE — od kiedy lista pokazuje dokumenty, a nie nazwy
          // skanów, biegły wpisuje „harmonogram" albo „uchwała", a nie „SKM_C451i…".
          (d.opis ?? "").toLowerCase().includes(q) ||
          (qn != null && d.karta_start != null && qn >= d.karta_start && qn <= (d.karta_end ?? d.karta_start)),
      );
    if (!pokazWarianty) {
      // SKAN, KTÓRY COŚ ZAWIERA, PRZESTAJE BYĆ POZYCJĄ — staje się pojemnikiem.
      // Pokazanie i skanu, i wydzielonych z niego dokumentów liczyłoby te same
      // strony dwa razy; biegły ma widzieć pozycje akt, nie opakowania.
      const zawierajace = new Set(documents.map((d) => d.plik_zrodlowy).filter(Boolean) as string[]);
      const rdzen = (rp: string) => basename(rp).replace(/\.ocr(\.cz\d+)?\.pdf$/i, ".pdf");
      // Rodzicem jest wiersz oryginału; jego warianty po OCR też schodzą z listy.
      const rdzenieZawierajace = new Set(
        documents.filter((d) => zawierajace.has(d.id)).map((d) => rdzen(d.rel_path)),
      );
      list = list.filter((d) => d.plik_zrodlowy || !rdzenieZawierajace.has(rdzen(d.rel_path)));

      const grupy = new Map<string, Doc[]>();
      for (const d of list) grupy.set(rdzen(d.rel_path), [...(grupy.get(rdzen(d.rel_path)) ?? []), d]);
      list = [...grupy.values()].flatMap((g) => {
        if (g.length === 1) return g;
        const zTekstem = g.filter((x) => x.warstwa_tekstu !== "brak");
        return zTekstem.length ? zTekstem : [g[0]];
      });
    }
    if (docTypeFilter) list = list.filter((d) => d.doc_type === docTypeFilter);
    if (authorFilter) list = list.filter((d) => (d.wytworca ?? "") === authorFilter);
    if (provFilter === "magazyn") list = list.filter((d) => !d.storage_path);
    else if (provFilter) list = list.filter((d) => d.provenance === provFilter);
    const by: Record<typeof docSort, (a: Doc, b: Doc) => number> = {
      name: (a, b) => a.rel_path.localeCompare(b.rel_path, "pl"),
      size: (a, b) => (b.size_bytes ?? 0) - (a.size_bytes ?? 0),
      type: (a, b) => a.doc_type.localeCompare(b.doc_type, "pl") || a.rel_path.localeCompare(b.rel_path, "pl"),
      status: (a, b) =>
        (a.provenance ?? "").localeCompare(b.provenance ?? "") || a.rel_path.localeCompare(b.rel_path, "pl"),
      karta: (a, b) => (a.karta_start ?? 1e9) - (b.karta_start ?? 1e9) || a.rel_path.localeCompare(b.rel_path, "pl"),
    };
    return [...list].sort(by[docSort]);
  }, [documents, search, docTypeFilter, authorFilter, provFilter, docSort, pokazWarianty]);

  // Sekcje wskaźników PER INSTRUMENT (subanalizy trem_csy / trem_rsy zapisane przez api/trem
  // w trybie rozdzielonym). Gdy są — „Wskaźniki" pokazuje osobny blok dla każdego z nich.
  const tremInstr = useMemo(
    () =>
      subanalyses
        .filter((s) => /^trem_/.test(s.kind) && Array.isArray(s.data?.metrics) && (s.data?.metrics?.length ?? 0) > 0)
        .sort((a, b) => (a.title || a.kind).localeCompare(b.title || b.kind, "pl")),
    [subanalyses],
  );

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
      warstwa_tekstu: string;
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
      // Klasyfikacja MUSI znać dziedzinę — bez tego akta bankowe byłyby czytane
      // regułami GPW i metodyka limitów trafiałaby do UNKNOWN.
      const { code, source, provenance } = classify(rel, caseRow.typ);
      // WYKRYCIE WARSTWY TEKSTOWEJ przy wgrywaniu, nie przy analizie. Skan bez
      // warstwy jest dla analizy plikiem pustym; sprawdzenie tutaj sprawia, że
      // biegły widzi to od razu, a nie po kilku krokach pracy nad sprawą.
      const warstwa = await wykryjWarstwe(rel, f);
      rows.push({
        case_id: caseRow.id,
        rel_path: rel,
        size_bytes: f.size,
        doc_type: code,
        source,
        provenance,
        storage_path: uploaded ? storagePath : null,
        warstwa_tekstu: warstwa,
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

  /** Ręczna zmiana klasyfikacji pliku — dla nierozpoznanych i dla poprawek automatu. */
  async function setDocType(doc: Doc, code: string) {
    if (code === doc.doc_type) return;
    const supabase = createClient();
    // `provenance` idzie razem z typem: to on decyduje, czy plik jest dowodem, czy
    // wytworem biegłego, a rozjazd tych dwóch pól wpuszczał wytwory biegłego do
    // materiału dowodowego. Typ bez znanej proweniencji jej nie zmienia.
    const prov = KATALOG_TYPOW[code]?.provenance;
    await supabase
      .from("documents")
      .update({ doc_type: code, ...(prov === "wejście" || prov === "wyjście" ? { provenance: prov } : {}) })
      .eq("id", doc.id);
    notify(`Zaklasyfikowano jako: ${KATALOG_TYPOW[code]?.label ?? code}`);
    router.refresh();
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
      .update({
        name: nameVal.trim() || caseRow.name,
        signature: sigVal.trim() || null,
        organ: organVal.trim() || null,
        data_powolania: dataVal.trim() || null,
      })
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
    if (tremDocs.length === 0) return;
    setAnalyzing(true);
    setAnalyzeMsg("");
    try {
      const res = await fetch("/api/trem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: caseRow.id }), // backend sam łączy wszystkie sparowane pliki
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      notify(
        data.instruments?.length >= 2
          ? `Policzono TREM osobno dla: ${data.instruments
              .map((i: { label: string; transactions: number }) => `${i.label} (${i.transactions} tr.)`)
              .join(", ")} — ${data.transactions ?? "?"} transakcji łącznie`
          : `Policzono z TREM${data.files?.length ? ` (${data.files.join(", ")})` : ""}: ` +
            `${data.metrics} wskaźników z ${data.transactions ?? "?"} transakcji`,
      );
      router.refresh();
    } catch (e) {
      setAnalyzeMsg(`Błąd analizy TREM: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-[1600px] px-6 py-10">
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
            <input
              value={organVal}
              onChange={(e) => setOrganVal(e.target.value)}
              placeholder="organ powołujący (np. Sąd Okręgowy w Warszawie)"
              title="Wchodzi do formuły wstępnej opinii"
              className="w-80 rounded-lg border border-ink/30 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            />
            <input
              type="date"
              value={dataVal}
              onChange={(e) => setDataVal(e.target.value)}
              title="Data postanowienia o powołaniu biegłego"
              className="w-44 rounded-lg border border-ink/30 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            />
            <button onClick={saveName} className={BTN_PRIMARY}>
              Zapisz
            </button>
            <button
              onClick={() => {
                setEditingName(false);
                setNameVal(caseRow.name);
                setSigVal(caseRow.signature ?? "");
                setOrganVal(caseRow.organ ?? "");
                setDataVal(caseRow.data_powolania ?? "");
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
              {caseRow.organ && <p className="text-xs text-inksoft">{caseRow.organ}</p>}
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

      <div className="mb-8 flex flex-wrap items-center gap-y-2 border-b border-ink/20 pb-5">
        {steps.map((s, i) => {
          const active = tab === s.key;
          return (
            <Fragment key={s.key}>
              {i > 0 && <span className="mx-2 hidden h-px min-w-6 flex-1 bg-ink/20 sm:block" />}
              <button
                onClick={() => setTab(s.key)}
                className="group flex items-center gap-2 pr-3 focus-visible:outline-none sm:pr-0"
                aria-current={active ? "step" : undefined}
                title={s.opis}
              >
                <span
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium transition-colors ${
                    active
                      ? "bg-ink text-paper"
                      : s.done
                        ? "bg-emerald-100 text-emerald-700"
                        : "border border-ink/30 text-inksoft group-hover:border-ink"
                  }`}
                >
                  {s.done && !active ? "✓" : i + 1}
                </span>
                <span
                  className={`text-sm transition-colors ${
                    active ? "font-semibold text-ink" : s.done ? "text-ink/80" : "text-inksoft group-hover:text-ink"
                  }`}
                >
                  {s.label}
                </span>
              </button>
            </Fragment>
          );
        })}
      </div>

      {tab === "overview" && (
        <>
      <section className="mb-8 grid grid-cols-3 gap-3">
        <Stat n={documents.length} label="dokumentów" />
        <Stat n={stats.wej} label="wejście (dowody)" color="text-emerald-700" />
        <Stat n={stats.wyj} label="wyjście (biegły)" color="text-amber-700" />
      </section>

      <section className="mb-8 border border-ink/60 bg-card p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em]">Pliki wg klasyfikacji</h2>
        <div className="grid gap-x-6 sm:grid-cols-2">
          {typeCounts.map(([dt, n]) => (
            <button
              key={dt}
              onClick={() => {
                setDocTypeFilter(dt);
                setTab("files");
              }}
              className="flex items-center justify-between border-b border-line py-1.5 text-left text-sm transition-colors last:border-0 hover:text-ink"
            >
              <span className="truncate">{KATALOG_TYPOW[dt]?.label ?? dt}</span>
              <span className="ml-2 shrink-0 rounded-full bg-ink/10 px-2 py-0.5 text-xs">{n}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-inksoft">Kliknij kategorię, aby zobaczyć jej pliki w zakładce Pliki.</p>
      </section>
        </>
      )}

      {tab === "files" && (
      <section className="mb-8 border border-ink/60 bg-card p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em]">Wgraj akta sprawy</h2>
        <p className="mb-3 text-xs text-inksoft">
          Wskaż cały katalog albo dograj pojedyncze pliki. Ponowne wgranie tego samego pliku
          aktualizuje wpis — bez duplikatów.
        </p>
        <div className="flex items-center gap-2">
          <Button variant="primary" size="md" disabled={busy} onClick={() => folderRef.current?.click()}>
            Wybierz katalog
          </Button>
          <Button variant="outline" size="md" disabled={busy} onClick={() => filesRef.current?.click()}>
            Dodaj pliki
          </Button>
        </div>
        {busy && <div className="mt-3"><ProgressBar label="Wgrywam pliki do magazynu…" /></div>}
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
      )}

      {tab === "overview" && (
        <>
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
          <div>{checklist.map((c) => <Row key={c.label} {...c} strongMissing />)}</div>
          <div>
            <p className="mb-1 text-xs font-medium text-inksoft">Zalecane</p>
            {recommended.map((c) => <Row key={c.label} {...c} />)}
          </div>
        </div>
      </section>

      {authorCounts.length > 0 && (
        <section className="mb-8 border border-ink/60 bg-card p-4">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-[0.12em]">Dokumenty wg wytwórcy</h2>
          <p className="mb-3 text-[11px] text-inksoft">
            Drugi wymiar klasyfikacji — kto sporządził/podpisał dokument. Kliknij, aby zawęzić listę w zakładce Pliki.
          </p>
          <div className="flex flex-wrap gap-2">
            {authorCounts.map(([a, n]) => (
              <button
                key={a}
                onClick={() => { setAuthorFilter(a); setTab("files"); }}
                className="flex items-center gap-2 rounded-lg border border-line bg-paper px-3 py-1.5 text-xs transition-colors hover:border-ink"
              >
                <span className="font-medium">{AUTHORS[a]?.label ?? a}</span>
                <span className="rounded-full bg-ink/10 px-1.5 py-0.5 text-[11px] text-inksoft">{n}</span>
              </button>
            ))}
          </div>
        </section>
      )}
        </>
      )}

      {tab === "files" && (
      <section className="mb-8 border border-ink/60 bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <h2 className="mr-auto text-xs font-semibold uppercase tracking-[0.12em]">
            Dokumenty ({visibleDocs.length}/{documents.length})
          </h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="szukaj: nazwa lub nr karty…"
            aria-label="Szukaj w nazwach plików lub po numerze karty akt"
            className="w-44 rounded-lg border border-ink/30 px-3 py-1.5 text-sm outline-none focus:border-neutral-500"
          />
          <select
            value={docTypeFilter}
            onChange={(e) => setDocTypeFilter(e.target.value)}
            aria-label="Filtruj po klasyfikacji"
            className="max-w-[190px] rounded-lg border border-ink/30 px-2 py-1.5 text-xs"
          >
            <option value="">typ: wszystkie</option>
            {typeCounts.map(([dt, n]) => (
              <option key={dt} value={dt}>
                {(KATALOG_TYPOW[dt]?.label ?? dt).slice(0, 34)} ({n})
              </option>
            ))}
          </select>
          {authorCounts.length > 0 && (
            <select
              value={authorFilter}
              onChange={(e) => setAuthorFilter(e.target.value)}
              aria-label="Filtruj po wytwórcy"
              className="max-w-[190px] rounded-lg border border-ink/30 px-2 py-1.5 text-xs"
            >
              <option value="">wytwórca: wszyscy</option>
              {authorCounts.map(([a, n]) => (
                <option key={a} value={a}>
                  {AUTHORS[a]?.label ?? a} ({n})
                </option>
              ))}
            </select>
          )}
          <select
            value={provFilter}
            onChange={(e) => setProvFilter(e.target.value)}
            aria-label="Filtruj po statusie"
            className="rounded-lg border border-ink/30 px-2 py-1.5 text-xs"
          >
            <option value="">status: wszystkie</option>
            <option value="wejście">wejście (dowody)</option>
            <option value="wyjście">wyjście (biegły)</option>
            <option value="magazyn">nie w magazynie</option>
          </select>
          <select
            value={docSort}
            onChange={(e) => setDocSort(e.target.value as typeof docSort)}
            aria-label="Sortowanie"
            className="rounded-lg border border-ink/30 px-2 py-1.5 text-xs"
          >
            <option value="name">sortuj: nazwa</option>
            <option value="size">sortuj: rozmiar ↓</option>
            <option value="type">sortuj: typ</option>
            <option value="status">sortuj: status</option>
            <option value="karta">sortuj: nr karty akt</option>
          </select>
          {/* Skan i jego plik po OCR to jeden dokument w aktach. Domyślnie wiersz
              opisuje dokument; przełącznik pokazuje warianty plików, gdy trzeba
              sięgnąć do konkretnego pliku w magazynie. */}
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-inksoft">
            <input
              type="checkbox"
              checked={pokazWarianty}
              onChange={(e) => setPokazWarianty(e.target.checked)}
            />
            warianty plików (skan + OCR)
          </label>
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
                {/* WIERSZ OPISUJE DOKUMENT, NIE PLIK. Skan jest formą przechowywania —
                    „SKM_C451i26080211470.pdf" nie mówi biegłemu nic, a lista akt
                    złożona z takich napisów jest nie do przeczytania. W pierwszej
                    linii stoi więc to, CZYM dokument jest (opis z klasyfikacji
                    z treści); nazwa pliku schodzi do drugiej linii, bo dalej jest
                    potrzebna do odnalezienia go w magazynie. Dokument bez opisu
                    (np. skan przed klasyfikacją) pokazuje nazwę pliku — brak opisu
                    ma być widoczny, a nie zamaskowany pustym wierszem. */}
                <div className="min-w-0 flex-1">
                  <div className={`truncate text-sm ${isSuspect(d) ? "text-red-700" : ""}`}>
                    {d.opis?.trim() || basename(d.rel_path)}
                  </div>
                  <div className="truncate text-xs text-inksoft">
                    {d.karta_start != null && (
                      <span
                        className="mr-1.5 rounded bg-ink/10 px-1.5 py-0.5 font-medium text-ink"
                        title="Numer karty akt sprawy — po nim biegły powołuje dokument w opinii"
                      >
                        k. {d.karta_start}{d.karta_end && d.karta_end !== d.karta_start ? `–${d.karta_end}` : ""}
                      </span>
                    )}
                    {KATALOG_TYPOW[d.doc_type]?.label ?? d.doc_type}
                    {d.strona_od != null && (
                      <span className="ml-2 text-ink/60" title="Zakres stron w pliku skanu">
                        · str. {d.strona_od}
                        {d.strona_do && d.strona_do !== d.strona_od ? `–${d.strona_do}` : ""}
                      </span>
                    )}
                    {d.warstwa_tekstu === "brak" && (
                      <span className="ml-2 text-amber-600" title="Skan bez warstwy tekstowej — treść niedostępna dla analizy">
                        · bez OCR
                      </span>
                    )}
                    {d.wytworca && AUTHORS[d.wytworca] && (
                      <span className="ml-2 text-ink/70">· {AUTHORS[d.wytworca].label}</span>
                    )}
                    {isSuspect(d) && (
                      <span className="ml-2 font-medium text-red-600">· wytwór biegłego — czy na pewno do akt?</span>
                    )}
                    {d.provenance === "wyjście" && d.accepted && (
                      <span className="ml-2 text-emerald-600">· zaakceptowany</span>
                    )}
                    {!d.storage_path && <span className="ml-2 text-amber-600">· nie w magazynie</span>}
                    {d.opis?.trim() && (
                      <span className="ml-2 font-mono text-ink/40" title="Plik w magazynie — forma przechowywania dokumentu">
                        {/* Pozycja wydzielona ze skanu nosi w ścieżce sufiks „#strN-M";
                            do wyświetlenia zostaje sama nazwa pliku, bo zakres stron
                            stoi już wyżej jako osobny znacznik. */}
                        {basename(d.rel_path).split("#")[0]}
                      </span>
                    )}
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
                  <span className="flex shrink-0 items-center gap-3 text-xs">
                    {/* Ręczna klasyfikacja — obok pozostałych akcji wiersza. Automat
                        rozpoznaje po nazwie pliku i na części akt się myli albo milczy;
                        bez tej listy jedynym wyjściem było przemianowanie pliku na dysku
                        i wgranie go ponownie. Plik nierozpoznany dostaje wyróżnienie,
                        bo to on wypada z analizy. */}
                    <select
                      value={d.doc_type}
                      onChange={(e) => setDocType(d, e.target.value)}
                      aria-label={`Klasyfikacja: ${basename(d.rel_path)}`}
                      title={KATALOG_TYPOW[d.doc_type]?.label ?? d.doc_type}
                      className={`max-w-[11rem] cursor-pointer rounded-lg border px-1.5 py-1 text-xs ${
                        d.doc_type === "UNKNOWN"
                          ? "border-amber-400 bg-amber-50 font-medium text-amber-800"
                          : "border-ink/20 text-inksoft hover:border-ink/40"
                      }`}
                    >
                      {d.doc_type === "UNKNOWN" && <option value="UNKNOWN">— zaklasyfikuj —</option>}
                      {TYPY_DO_WYBORU.map(([kod, t]) => (
                        <option key={kod} value={kod}>
                          {t.label}
                        </option>
                      ))}
                    </select>
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

      {tab === "overview" && (
        <CompletenessPanel
          documents={documents}
          caseName={caseRow.name}
          signature={caseRow.signature}
          typ={caseRow.typ}
          tryb={caseRow.tryb}
          rola={caseRow.rola}
        />
      )}
      {tab === "overview" && <PytaniaPanel caseId={caseRow.id} />}
      {tab === "overview" && <RosterPanel caseId={caseRow.id} />}

      {/* Kroki 3 i 4 mają WŁASNE panele per dziedzina. Panele GPW operują arkuszem
          zleceń UTP i technikami MAR — w sprawie bankowej nie są renderowane w ogóle,
          bo pokazanie przycisku „Policz wskaźniki manipulacji" sugerowałoby, że jest
          co liczyć. */}
      {tab === "analysis" && dziedzinaBankowa && (
        <>
          <WskaznikiBankPanel
            caseId={caseRow.id}
            documents={documents}
            subanalyses={subanalyses}
            onDone={() => router.refresh()}
          />
          {/* Rubryka banku zrzeszającego — liczona z tych samych pozycji, ale
              odpowiadająca na inne pytanie: nie „jak zmieniał się współczynnik",
              tylko „jak wypadłby bank w metodyce, którą miał być oceniany". */}
          <div className="mt-4">
            <AnalizaEfPanel subanalyses={subanalyses} />
          </div>
        </>
      )}
      {tab === "warsztat" && dziedzinaBankowa && (
        <WarsztatBankPanel caseId={caseRow.id} subanalyses={subanalyses} onDone={() => router.refresh()} />
      )}

      {/* KROK 4 GPW — rozdział IV opinii w siedmiu pod-zakładkach (wzorzec: finał
          HubTech; wymóg klienta ze sprawy ZASTAL). Krok istnieje TYLKO w pakiecie
          manipulacyjnym; w sprawie bankowej stepper go nie pokazuje. */}
      {tab === "ekonomia" && !dziedzinaBankowa && (
        <AnalizaIVPanel
          caseId={caseRow.id}
          subanalyses={subanalyses}
          metrics={metrics}
          onDone={() => router.refresh()}
        />
      )}

      {tab === "analysis" && !dziedzinaBankowa && (
      <section className="border border-ink/60 bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em]">Wskaźniki (silnik faktów)</h2>
          <div className="flex items-center gap-2">
            {utpDocs.length > 0 && (
              <select
                value={activeUtp}
                onChange={(e) => setSelectedUtp(e.target.value)}
                className="max-w-[220px] rounded-lg border border-ink/30 px-2 py-1.5 text-xs"
              >
                {utpDocs.map((d, i) => {
                  const tag = utpVariantLabel(d.rel_path);
                  return (
                    <option key={d.id} value={d.storage_path ?? ""}>
                      {basename(d.rel_path)}
                      {tag ? ` — ${tag}` : ""} ({fmtSize(d.size_bytes)}){i === 0 ? " — najnowszy" : ""}
                    </option>
                  );
                })}
              </select>
            )}
            <Button variant="primary" size="md" onClick={runAnalysis} disabled={!activeUtp} loading={analyzing} loadingLabel="Liczę…">
              {metrics.length > 0 ? "Przelicz wskaźniki" : "Policz wskaźniki"}
            </Button>
            {tremDocs.length > 0 && (
              <Button
                variant="outline"
                size="md"
                onClick={runTrem}
                loading={analyzing}
                loadingLabel="Liczę…"
                title={`Złączy sparowane pliki TREM: ${tremDocs.map((d) => basename(d.rel_path)).join(", ")}`}
              >
                Policz z TREM
              </Button>
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

        {tremInstr.length > 0 ? (
          // Tryb ROZDZIELONY (np. ZASTAL: CSY i RSY) — osobny blok wskaźników na instrument.
          <>
            <p className="mb-3 text-xs text-inksoft">
              Wskaźniki liczone osobno dla każdego instrumentu ({tremInstr.map((s) => s.data?.label ?? s.title).join(", ")}).
            </p>
            {tremInstr.map((s) => (
              <MetricsBlock
                key={s.kind}
                title={`${s.title}${s.data?.transactions ? ` — ${s.data.transactions.toLocaleString("pl-PL")} transakcji` : ""}`}
                metrics={(s.data?.metrics ?? []) as Metric[]}
              />
            ))}
          </>
        ) : (
          metrics.length > 0 && <MetricsBlock metrics={metrics} />
        )}
      </section>
      )}

      {tab === "warsztat" && !dziedzinaBankowa && (
        <WarsztatView
          caseId={caseRow.id}
          metrics={metrics}
          documents={documents}
          subanalyses={subanalyses}
          utpDocs={utpDocs}
          activeUtp={activeUtp}
          onSelectUtp={setSelectedUtp}
        />
      )}

      {tab === "opinion" && (
        <OpinionView
          caseId={caseRow.id}
          caseRow={caseRow}
          metrics={metrics}
          documents={documents}
          subanalyses={subanalyses}
          onOpenFiles={(dt) => {
            setDocTypeFilter(dt);
            setTab("files");
          }}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-lg bg-ink px-4 py-2 text-sm text-paper shadow-lg">
          {toast}
        </div>
      )}

      <Albin caseId={caseRow.id} />
    </main>
  );
}

function basename(p: string): string {
  return p.split("/").pop() || p;
}
// Główny plik UTP (łączony: arkusze Transakcje + Zlecenia BO), a NIE źródłowe
// pliki per-dzień ("…zrodlo…", arkusze "Mikro-…"), których silnik nie liczy.
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

// Grupowanie wskaźników niedziennych w sensowne sekcje (zamiast jednej długiej listy).
type EntActivity = { entity: string; sellShare: Metric | null; sellVal: Metric | null; sellVol: Metric | null; buyVal: Metric | null };
// Blok wskaźników dla JEDNEGO zestawu metryk (łącznych albo per instrument CSY/RSY).
// Wydzielony, by „Wskaźniki" mogła pokazać osobną sekcję dla każdego instrumentu.
function MetricsBlock({ metrics, title }: { metrics: Metric[]; title?: string | null }) {
  if (!metrics.length) return null;
  const find = (k: string) => metrics.find((m) => m.key === k) ?? null;
  const peak = (prefix: string) =>
    metrics
      .filter((m) => m.key.startsWith(prefix))
      .reduce<Metric | null>((a, b) => ((b.value ?? -1) > (a?.value ?? -1) ? b : a), null);
  const computedAt = metrics.map((m) => m.computed_at).filter((v): v is string => !!v).sort().pop() ?? null;
  const groupShare = find("group_turnover_share");
  const washPeak = peak("wash_");
  const cancelPeak = peak("cancel_");
  const S = analysisSections(metrics);
  const days = [...new Set(metrics.filter((m) => m.session_day).map((m) => m.session_day as string))].sort();
  return (
    <div className="mb-6 border-t border-line pt-4 first:mt-0 first:border-t-0 first:pt-0">
      {title && (
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink">{title}</h3>
      )}
      {computedAt && (
        <p className="mb-3 text-xs text-inksoft">Policzono: {new Date(computedAt).toLocaleString("pl-PL")}</p>
      )}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <MetricCard label="Udział Grupy w obrocie" value={groupShare ? fmt(groupShare) : "—"} />
        <MetricCard label="Wash-trades — szczyt" value={washPeak ? fmt(washPeak) : "—"} sub={washPeak?.session_day ?? undefined} />
        <MetricCard label="Anulacje — szczyt" value={cancelPeak ? fmt(cancelPeak) : "—"} sub={cancelPeak?.session_day ?? undefined} />
      </div>
      <MetricSection title="Obrót ogółem" rows={S.totals} />
      {S.entities.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-inksoft">
            Aktywność podmiotów (per podmiot)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-inksoft">
                  <th className="py-1 text-left">Podmiot</th>
                  <th className="py-1 text-right">Udział sprzedaży</th>
                  <th className="py-1 text-right">Wartość sprzedaży</th>
                  <th className="py-1 text-right">Wolumen sprzedaży</th>
                  <th className="py-1 text-right">Wartość kupna</th>
                </tr>
              </thead>
              <tbody>
                {S.entities.map((e) => (
                  <tr key={e.entity} className="border-b border-line last:border-0">
                    <td className="py-1.5">{capW(e.entity)}</td>
                    <td className="py-1.5 text-right tabular-nums">{e.sellShare ? fmt(e.sellShare) : "—"}</td>
                    <td className="py-1.5 text-right tabular-nums">{e.sellVal ? fmt(e.sellVal) : "—"}</td>
                    <td className="py-1.5 text-right tabular-nums">{e.sellVol ? fmt(e.sellVol) : "—"}</td>
                    <td className="py-1.5 text-right tabular-nums">{e.buyVal ? fmt(e.buyVal) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <MetricSection title="Dopasowane zlecenia (matched orders)" rows={S.imo} />
      <MetricSection title="Dopasowania — pary podmiotów" rows={S.imoPairs} limit={12} />
      <MetricSection title="Pary wewnątrzgrupowe (wash)" rows={S.washPairs} limit={12} />
      <MetricSection title="Fazy kursu (pump/dump)" rows={S.phases} />
      <MetricSection title="Pozostałe wskaźniki" rows={S.rest} />
      {days.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-inksoft">Per sesja</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-inksoft">
                  <th className="py-1 text-left">Sesja</th>
                  <th className="py-1 text-right">Kurs zamk.</th>
                  <th className="py-1 text-right">Zmiana</th>
                  <th className="py-1 text-right">Wash</th>
                  <th className="py-1 text-right">Anulacje kupna</th>
                  <th className="py-1 text-right">Fixing zamk.</th>
                </tr>
              </thead>
              <tbody>
                {days.map((day) => {
                  const at = (k: string, exact = false) =>
                    metrics.find((m) => m.session_day === day && (exact ? m.key === k : m.key.startsWith(k))) ?? null;
                  const close = at("day_close", true);
                  const chg = at("day_change_pct", true);
                  const wash = at("wash_");
                  const cancel = at("cancel_");
                  const fix = at("fix_close_share", true);
                  return (
                    <tr key={day} className="border-b border-line last:border-0">
                      <td className="py-1.5">{day}</td>
                      <td className="py-1.5 text-right tabular-nums">{close ? fmt(close) : "—"}</td>
                      <td className="py-1.5 text-right tabular-nums">{chg ? fmt(chg) : "—"}</td>
                      <td className="py-1.5 text-right tabular-nums">{wash ? fmt(wash) : "—"}</td>
                      <td className="py-1.5 text-right tabular-nums">{cancel ? fmt(cancel) : "—"}</td>
                      <td className="py-1.5 text-right tabular-nums">{fix ? fmt(fix) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function analysisSections(metrics: Metric[]) {
  const nd = metrics.filter((m) => !m.session_day);
  const pick = (re: RegExp) => nd.filter((m) => re.test(m.key));
  const ent = (k: string) => k.split("::")[1];
  const em = new Map<string, EntActivity>();
  const getE = (e: string): EntActivity => em.get(e) ?? { entity: e, sellShare: null, sellVal: null, sellVol: null, buyVal: null };
  for (const m of nd) {
    if (m.key.startsWith("ent_sell_share::")) em.set(ent(m.key), { ...getE(ent(m.key)), sellShare: m });
    else if (m.key.startsWith("ent_sell_val::")) em.set(ent(m.key), { ...getE(ent(m.key)), sellVal: m });
    else if (m.key.startsWith("ent_sell_vol::")) em.set(ent(m.key), { ...getE(ent(m.key)), sellVol: m });
    else if (m.key.startsWith("ent_buy_val::")) em.set(ent(m.key), { ...getE(ent(m.key)), buyVal: m });
  }
  const entities = [...em.values()].sort((a, b) => (b.sellVal?.value ?? 0) - (a.sellVal?.value ?? 0));
  // „known" obejmuje też prefiksy dzienne (day_/ede_/lay_/rev_/conc_/fix_/imo_day_) —
  // te są prezentowane w tabeli sesji; osierocone (bez daty, np. transakcje bez sesji)
  // nie zaśmiecają sekcji „Pozostałe".
  const known =
    /^(totals_|group_turnover_|ent_sell_|ent_buy_|imo_|pair_intra::|phase_|day_|ede_|lay_|rev_|conc_|fix_|wash_|cancel_)/;
  return {
    totals: pick(/^(totals_|group_turnover_)/),
    entities,
    imo: pick(/^imo_(count|value|volume|thr_)/),
    imoPairs: pick(/^imo_pair::/),
    washPairs: pick(/^pair_intra::/),
    phases: metrics.filter((m) => m.key.startsWith("phase_")), // mają datę, więc z całości
    rest: nd.filter((m) => !known.test(m.key)),
  };
}
const capW = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function MetricSection({ title, rows, limit }: { title: string; rows: Metric[]; limit?: number }) {
  if (!rows.length) return null;
  const shown = limit ? rows.slice(0, limit) : rows;
  return (
    <div className="mt-4">
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-inksoft">{title}</h3>
      <ul className="space-y-1">
        {shown.map((m) => (
          <li key={m.key} className="flex justify-between border-b border-line py-1.5 text-sm last:border-0">
            <span>{m.label}</span>
            <span className="font-medium tabular-nums">{fmt(m)}</span>
          </li>
        ))}
        {limit && rows.length > limit && (
          <li className="py-1 text-[11px] text-inksoft">… i {rows.length - limit} więcej (pełny wykaz w rozdziałach opinii)</li>
        )}
      </ul>
    </div>
  );
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

function Row({
  label,
  present,
  strongMissing = false,
  dokument,
  karta,
  kartaDo,
}: Check & { strongMissing?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line py-1.5 last:border-0">
      {/* „Obecny" bez wskazania KTÓREGO dokumentu i pod jaką kartą zmuszało biegłego
          do szukania po całej liście akt. Numer karty jest adresem dowodu w opinii. */}
      <span className="min-w-0 text-sm">
        {label}
        {dokument && (
          <span className="block truncate text-xs text-inksoft">
            {karta != null && (
              <span className="mr-1.5 rounded bg-ink/10 px-1.5 py-0.5 font-medium text-ink">
                k. {karta}{kartaDo && kartaDo !== karta ? `–${kartaDo}` : ""}
              </span>
            )}
            {dokument}
          </span>
        )}
      </span>
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
