"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

// A4 OSINT — dwie sekcje:
//  A. Informacje o podmiotach i osobach podejrzanych (profil per podmiot z rostera).
//  B. Powiązania — silnik wyszukiwania (wolne pole + zapytania podpowiadane przez
//     model z akt) ORAZ kolejki par: spółki (sygnały silnika: IP/wash) i osoby
//     kluczowe (pary z rostera). Evidence-only: wyszukiwarka zwraca realne wyniki,
//     biegły dodaje trafne z URL-em jako źródłem; kategoryzacja po domenie (nie model).

type Metric = { key: string; value: number | null; session_day: string | null };
type Entity = { name: string; fragment: string; kind?: "podmiot" | "osoba" };
type WebResult = { title: string; url: string; description: string };
type Hit = { entity: string; category: string; title: string; url: string };
type Link = { typ: string; podmioty: string; opis: string; zrodlo: string; data: string };
type OsintData = { links?: Link[]; profiles?: Hit[] };
type SubRow = { kind: string; data: { table?: unknown; osint?: OsintData } | null };
type SuggItem = { value: string; source?: string; why?: string };
type Sugg = { krs: SuggItem[]; persons: SuggItem[]; entities: SuggItem[]; queries: SuggItem[] };

const LINK_TYPES = [
  "umowa cywilnoprawna",
  "wspólny zarząd / rada",
  "udziały / wspólne inwestycje",
  "wspólne przedsięwzięcie biznesowe",
  "event / konferencja",
  "wspólna wzmianka prasowa",
  "doniesienie prokuratury / sądu",
  "wspólny wywiad",
  "powiązania prywatne",
  "media społecznościowe",
  "powiązania właścicielskie",
  "inne",
];

const SOCIAL = ["linkedin.", "x.com", "twitter.", "facebook.", "instagram.", "youtube.", "tiktok.", "goldenline"];
const REGISTRY = ["ms.gov.pl", "rejestr.io", "aleo.com", "krs-online", "opencorporates", "ec.europa.eu", "ekrs", "imsig", "gov.pl"];
const PRESS = ["wyborcza", "rp.pl", "parkiet", "bankier", "money.pl", "forbes", "businessinsider", "onet", "wp.pl",
  "interia", "tvn", "gazetaprawna", "pb.pl", "stockwatch", "strefainwestorow", "gpwinfostrefa", "wnp.pl", "spidersweb",
  "polsatnews", "rmf", "radiozet", "biznesalert", "cyberdefence"];

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}
function categorize(r: WebResult, frag: string): string {
  const h = host(r.url);
  const t = (r.title + " " + r.description).toLowerCase();
  if (SOCIAL.some((s) => h.includes(s))) return "social";
  if (REGISTRY.some((s) => h.includes(s))) return "rejestry";
  if (PRESS.some((s) => h.includes(s))) return /wywiad|rozmowa z/.test(t) ? "wywiady" : "prasa";
  if (frag && h.includes(frag.replace(/[^a-z0-9]/g, ""))) return "www";
  return "wzmianki";
}
const CAT_LABEL: Record<string, string> = {
  rejestry: "Rejestry (KRS / OpenCorporates)",
  social: "Media społecznościowe",
  www: "Strony własne",
  prasa: "Artykuły prasowe",
  wywiady: "Wywiady",
  wzmianki: "Inne wzmianki",
};
const CAT_ORDER = ["rejestry", "social", "www", "prasa", "wywiady", "wzmianki"];

// Nazwa do wyszukiwania: usuwa końcowy nawias (kraj/spółka), np.
// „Joyfix Ltd (Cypr)" → „Joyfix Ltd"; „Trevor Morel (Lausewleo)" → „Trevor Morel".
const cleanName = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, "").trim();
const capFrag = (f: string) => (f ? f[0].toUpperCase() + f.slice(1) : f);

export default function OsintPanel({
  caseId,
  metrics,
  stored,
}: {
  caseId: string;
  metrics: Metric[];
  stored: SubRow[];
}) {
  const router = useRouter();
  const existing = stored.find((s) => s.kind === "powiazania_osint");
  const hasAnalysis = stored.some((s) => s.kind === "osint_analysis");
  const init = (existing?.data as { osint?: OsintData } | null)?.osint ?? {};
  const [section, setSection] = useState<"A" | "B" | "C">("A");
  const [roster, setRoster] = useState<Entity[]>([]);
  const [links, setLinks] = useState<Link[]>(init.links ?? []);
  const [profiles, setProfiles] = useState<Hit[]>(init.profiles ?? []);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [ctx, setCtx] = useState<{ label: string; frag: string; add: "profile" | "link" } | null>(null);
  const [results, setResults] = useState<WebResult[]>([]);
  // Silnik wyszukiwania powiązań (sekcja B): wolne pole + zapytania z modelu.
  const [q, setQ] = useState("");
  const [social, setSocial] = useState(false);
  const [sugg, setSugg] = useState<Sugg | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.from("cases").select("group_roster").eq("id", caseId).single();
      const r = (data?.group_roster as { entities?: Entity[] } | null)?.entities ?? [];
      if (alive) setRoster(r);
    })();
    return () => {
      alive = false;
    };
  }, [caseId]);

  // Kolejka par SPÓŁEK z sygnałów silnika: wspólne IP (A3) + wash-pary (pair_intra::).
  // Fragmenty z silnika (np. „joyfix") mapujemy na pełne nazwy z rostera do zapytań.
  const ipTable = stored.find((s) => s.kind === "powiazania_dane")?.data?.table as
    | { rows?: string[][] }
    | undefined;
  const pairs = useMemo(() => {
    const nameOf = (frag: string) => {
      const e = roster.find((x) => (x.fragment || "").toLowerCase() === frag.toLowerCase());
      return e ? cleanName(e.name) : capFrag(frag);
    };
    const out: { a: string; b: string; signal: string }[] = [];
    for (const row of ipTable?.rows ?? []) {
      if (row[0] && row[1]) out.push({ a: nameOf(row[0]), b: nameOf(row[1]), signal: `${row[2]} wspólnych IP` });
    }
    for (const m of metrics) {
      if (!m.key.startsWith("pair_intra::")) continue;
      const [a, b] = m.key.slice("pair_intra::".length).split("|");
      if (a && b) out.push({ a: nameOf(a), b: nameOf(b), signal: `wash ${(m.value ?? 0).toLocaleString("pl-PL")} zł` });
    }
    return out.slice(0, 60);
  }, [ipTable, metrics, roster]);

  // Kolejka par OSÓB — top-10 osób z rostera, wszystkie pary (powiązania osobowe).
  const personPairs = useMemo(() => {
    const people = roster.filter((e) => e.kind === "osoba").slice(0, 10).map((e) => cleanName(e.name));
    const out: { a: string; b: string }[] = [];
    for (let i = 0; i < people.length; i++)
      for (let j = i + 1; j < people.length; j++) out.push({ a: people[i], b: people[j] });
    return out;
  }, [roster]);

  async function webSearch(query: string, soc = false): Promise<WebResult[]> {
    const r = await fetch(`/cases/${caseId}/osint/web?q=${encodeURIComponent(query)}&social=${soc ? "1" : "0"}`);
    const j = await r.json();
    if (!j.ok) throw new Error(j.reason || `HTTP ${r.status}`);
    return (j.results ?? []) as WebResult[];
  }

  async function run(key: string, query: string, label: string, frag: string, add: "profile" | "link", soc = false) {
    setBusy(key);
    setMsg("");
    setResults([]);
    setCtx({ label, frag, add });
    try {
      const res = await webSearch(query, soc);
      setResults(res);
      if (!res.length) setMsg("Brak wyników — spróbuj innego zapytania lub zawężenia.");
    } catch (err) {
      setMsg(`Web: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  }

  const searchEntity = (e: Entity) =>
    run("A:" + e.name, cleanName(e.name), e.name, e.fragment, "profile");
  const searchPair = (a: string, b: string, suffix: string, label: string) =>
    run(`B:${a}|${b}|${label}`, `"${a}" "${b}"${suffix ? " " + suffix : ""}`, `${a} ↔ ${b} · ${label}`, "", "link");
  const searchFree = (query?: string) => {
    const term = (query ?? q).trim();
    if (!term) return;
    if (query) setQ(query);
    return run("Bq", term, term, "", "link", social);
  };

  async function fetchSuggestions() {
    setBusy("sugg");
    setMsg("");
    try {
      const r = await fetch(`/cases/${caseId}/osint/suggest`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.reason || `HTTP ${r.status}`);
      const s = j.suggestions as Sugg;
      setSugg(s);
      if (!s.queries.length) setMsg("Model nie wytypował zapytań z dostępnych danych.");
    } catch (e) {
      setMsg(`Podpowiedzi: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  function addProfile(entity: string, category: string, r: WebResult) {
    setProfiles((p) => [...p, { entity, category, title: r.title || r.url, url: r.url }]);
  }
  function addLinkFromWeb(r: WebResult, typ: string, podmioty: string) {
    setLinks((l) => [
      ...l,
      { typ, podmioty, opis: r.title || r.description, zrodlo: r.url, data: new Date().toISOString().slice(0, 10) },
    ]);
  }
  function addManual() {
    setLinks((l) => [...l, { typ: LINK_TYPES[0], podmioty: "", opis: "", zrodlo: "", data: "" }]);
  }
  function updLink(i: number, patch: Partial<Link>) {
    setLinks((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }
  function delLink(i: number) {
    setLinks((l) => l.filter((_, j) => j !== i));
  }
  function delProfile(i: number) {
    setProfiles((p) => p.filter((_, j) => j !== i));
  }

  async function save() {
    setBusy("save");
    setMsg("");
    const cleanLinks = links
      .map((l) => ({ ...l, podmioty: l.podmioty.trim(), zrodlo: l.zrodlo.trim() }))
      .filter((l) => l.podmioty && l.zrodlo);
    const table = {
      caption: "Tabela. Powiązania OSINT (każde z cytowanym źródłem)",
      head: ["Typ", "Podmioty", "Opis", "Źródło", "Data"],
      rows: cleanLinks.map((l) => [l.typ, l.podmioty, l.opis, l.zrodlo, l.data]),
    };
    const supabase = createClient();
    const { error } = await supabase.from("subanalyses").upsert(
      {
        case_id: caseId,
        kind: "powiazania_osint",
        chapter_no: "IV",
        title: "Powiązania — OSINT (Krok 5)",
        body_md: cleanLinks.length
          ? `Ustalono ${cleanLinks.length} powiązań OSINT (każde z cytowanym źródłem); zebrano ${profiles.length} materiałów profilowych.`
          : `Zebrano ${profiles.length} materiałów profilowych; brak potwierdzonych powiązań.`,
        data: {
          osint: { links: cleanLinks, profiles },
          table,
          findings: cleanLinks.map((l) => `${l.podmioty}: ${l.typ} (${l.zrodlo})`),
          legalRefs: ["art. 12 ust. 2 MAR"],
        },
        status: "szkic",
      },
      { onConflict: "case_id,kind" },
    );
    setBusy(null);
    if (error) {
      setMsg(/subanalyses|schema cache|relation/i.test(error.message) ? "Uruchom migrację 0004_subanalyses.sql." : error.message);
      return;
    }
    setLinks(cleanLinks);
    setMsg(`Zapisano: ${cleanLinks.length} powiązań, ${profiles.length} materiałów.`);
    router.refresh();
  }

  // C · Przeprowadź analizę OSINT — uruchamia agenta (akta + GLEIF + Brave → synteza
  // modelu), zapisuje wynik jako `osint_analysis`. To pełen proces per sprawa.
  async function runAnalysis() {
    setBusy("analyze");
    setMsg("Analiza w toku (akta, GLEIF, wyszukiwania, synteza) — to może potrwać kilka minut…");
    try {
      const r = await fetch(`/cases/${caseId}/osint/analyze`, { method: "POST" });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.reason || `HTTP ${r.status}`);
      const s = j.stats;
      setMsg(`Analiza gotowa: ${s.relations} powiązań w ${s.clusters} klastrach · źródła: ${s.pdfs} dok. akt, ${s.gleif} GLEIF, ${s.web} wyszukiwań. Możesz pobrać PDF.`);
      router.refresh();
    } catch (e) {
      setMsg(`Analiza: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  // C · Generuj PDF — pobiera analizę przeprowadzoną dla sprawy (hybrydowo + powiązania
  // z panelu). Gdy analizy jeszcze nie ma (409), komunikat prowadzi do „Przeprowadź analizę".
  async function generateOsintPdf() {
    setBusy("pdf");
    setMsg("");
    try {
      const r = await fetch(`/cases/${caseId}/osint/pdf`);
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        throw new Error(j?.reason || `HTTP ${r.status}`);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "Analiza_OSINT.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMsg("Wygenerowano PDF — sprawdź pobrane pliki.");
    } catch (e) {
      setMsg(`PDF: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  const grouped = useMemo(() => {
    const g: Record<string, WebResult[]> = {};
    if (ctx) for (const r of results) (g[categorize(r, ctx.frag)] ??= []).push(r);
    return g;
  }, [results, ctx]);

  // Wspólny render wyników (grupowanie po źródle) — sekcja A dodaje do profilu,
  // sekcja B dodaje do rejestru powiązań.
  const resultsBlock = ctx && (
    <div className="rounded-lg border border-line bg-paper p-3">
      <p className="mb-2 text-xs font-medium">Wyniki dla: {ctx.label}</p>
      {msg && <p className="mb-2 text-xs text-inksoft">{msg}</p>}
      <div className="mb-3 flex flex-wrap gap-2 text-[11px]">
        <span className="text-inksoft">Rejestry:</span>
        <a href={`https://opencorporates.com/companies?q=${encodeURIComponent(cleanName(ctx.label))}`} target="_blank" rel="noopener noreferrer" className="text-emerald-700 hover:underline">OpenCorporates</a>
        <a href={`https://rejestr.io/szukaj?text=${encodeURIComponent(cleanName(ctx.label))}`} target="_blank" rel="noopener noreferrer" className="text-emerald-700 hover:underline">rejestr.io (KRS)</a>
        <a href={`https://wyszukiwarka-krs.ms.gov.pl/`} target="_blank" rel="noopener noreferrer" className="text-emerald-700 hover:underline">wyszukiwarka KRS</a>
      </div>
      {CAT_ORDER.filter((c) => grouped[c]?.length).map((c) => (
        <div key={c} className="mb-2">
          <p className="text-[11px] font-medium text-inksoft">{CAT_LABEL[c]}</p>
          {grouped[c].map((r, j) => (
            <ResultRow
              key={j}
              r={r}
              addLabel={ctx.add === "link" ? "Dodaj do rejestru" : "Dodaj do profilu"}
              onAdd={() =>
                ctx.add === "link"
                  ? addLinkFromWeb(r, c === "social" ? "media społecznościowe" : "inne", ctx.label.split(" · ")[0])
                  : addProfile(ctx.label, c, r)
              }
            />
          ))}
        </div>
      ))}
    </div>
  );

  return (
    <section className="border border-ink/60 bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-xs font-semibold uppercase tracking-[0.12em]">Powiązania — OSINT (Krok 5)</h2>
        <div className="flex gap-1 rounded-lg border border-ink/20 p-0.5">
          {(["A", "B", "C"] as const).map((s) => (
            <button
              key={s}
              onClick={() => {
                setSection(s);
                setResults([]);
                setCtx(null);
              }}
              className={`rounded px-3 py-1 text-xs transition-colors ${
                section === s ? "bg-ink text-paper" : "text-inksoft hover:text-ink"
              }`}
            >
              {s === "A" ? "A · Informacje" : s === "B" ? "B · Powiązania" : "C · Analiza OSINT"}
            </button>
          ))}
        </div>
      </div>

      {roster.length === 0 && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Lista podmiotów/osób pochodzi z rostera — uzupełnij „Podmioty i osoby podejrzane” w zakładce Sprawa (Krok 2).
        </p>
      )}

      {/* ── Sekcja A — informacje o podmiotach/osobach ── */}
      {section === "A" && (
        <div>
          <p className="mb-3 text-[11px] leading-relaxed text-inksoft">
            Kompleksowe wyszukiwanie informacji o każdym podmiocie/osobie. Wyniki grupowane po źródle (rejestry, media
            społecznościowe, strony własne, prasa, wywiady, wzmianki). Dodawaj trafne do profilu — URL trafia jako źródło.
          </p>
          <div className="mb-3 space-y-1">
            {roster.map((e, i) => (
              <div key={i} className="flex items-center justify-between gap-2 border border-line bg-paper p-2 text-xs">
                <div className="min-w-0">
                  <span className="font-medium">{e.name}</span>
                  <span className="ml-2 text-inksoft">{e.kind === "osoba" ? "osoba" : "podmiot"}</span>
                </div>
                <button
                  onClick={() => searchEntity(e)}
                  disabled={busy !== null}
                  className="shrink-0 border border-ink px-3 py-1 text-xs uppercase tracking-wider transition-colors hover:bg-ink hover:text-paper disabled:opacity-40"
                >
                  {busy === "A:" + e.name ? "Szukam…" : "Przeszukaj"}
                </button>
              </div>
            ))}
          </div>
          {resultsBlock}
        </div>
      )}

      {/* ── Sekcja B — powiązania: silnik wyszukiwania + kolejki par ── */}
      {section === "B" && (
        <div>
          <p className="mb-3 text-[11px] leading-relaxed text-inksoft">
            Badanie <strong>wszelkich powiązań</strong> między podmiotami i osobami: wspólne zarządy, umowy, udziały,
            wspólne inwestycje/eventy, wzmianki prasowe, doniesienia prokuratury/sądu, powiązania prywatne i w mediach
            społecznościowych. Silnik zwraca realne wyniki — trafne dodajesz do rejestru z URL-em jako źródłem.
          </p>

          {/* Silnik: wolne pole + zapytania podpowiadane przez model z akt */}
          <div className="mb-3 rounded-lg border border-line bg-paper p-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && searchFree()}
                placeholder='Wpisz zapytanie, np. „Joyfix Texolla powiązania" albo dwa nazwiska'
                className="min-w-0 flex-1 rounded-lg border border-ink/30 px-3 py-1.5 text-sm outline-none focus:border-neutral-500"
              />
              <label className="flex items-center gap-1 text-[11px] text-inksoft">
                <input type="checkbox" checked={social} onChange={(e) => setSocial(e.target.checked)} /> social
              </label>
              <button
                onClick={() => searchFree()}
                disabled={busy !== null || !q.trim()}
                className="border border-ink px-3 py-1.5 text-xs uppercase tracking-wider transition-colors hover:bg-ink hover:text-paper disabled:opacity-40"
              >
                {busy === "Bq" ? "Szukam…" : "Szukaj"}
              </button>
              <button
                onClick={fetchSuggestions}
                disabled={busy !== null}
                className="border border-emerald-600 px-3 py-1.5 text-xs uppercase tracking-wider text-emerald-700 transition-colors hover:bg-emerald-600 hover:text-white disabled:opacity-40"
              >
                {busy === "sugg" ? "Typuję…" : "Podpowiedz zapytania (model)"}
              </button>
            </div>
            {sugg && sugg.queries.length > 0 && (
              <div className="mt-2 border-t border-line pt-2">
                <p className="mb-1 text-[11px] font-medium text-inksoft">
                  Zapytania wytypowane z akt (kliknij, aby wyszukać):
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {sugg.queries.map((qi, i) => (
                    <button
                      key={i}
                      onClick={() => searchFree(qi.value)}
                      disabled={busy !== null}
                      title={qi.why || qi.source || ""}
                      className="rounded-full border border-ink/20 px-2.5 py-1 text-[11px] text-ink transition-colors hover:bg-ink hover:text-paper disabled:opacity-40"
                    >
                      {qi.value}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Kolejka par SPÓŁEK — z sygnałów silnika (IP / wash) */}
          <div className="mb-2 flex items-baseline justify-between">
            <p className="text-xs font-medium">Pary spółek — sygnały silnika ({pairs.length})</p>
            <span className="text-[11px] text-inksoft">wspólne IP · wash-pary</span>
          </div>
          {pairs.length === 0 ? (
            <p className="mb-3 text-xs text-inksoft">
              Brak sygnałów — policz wskaźniki (Analiza liczbowa) i wykonaj analizę IP (zakładka Powiązania (dane)).
            </p>
          ) : (
            <div className="mb-4 max-h-64 space-y-1 overflow-auto">
              {pairs.map((p, i) => (
                <PairRow key={i} a={p.a} b={p.b} signal={p.signal} busy={busy} onSearch={searchPair} />
              ))}
            </div>
          )}

          {/* Kolejka par OSÓB — top-10 osób z rostera */}
          <div className="mb-2 flex items-baseline justify-between">
            <p className="text-xs font-medium">Pary osób kluczowych ({personPairs.length})</p>
            <span className="text-[11px] text-inksoft">powiązania osobowe — top-10 z rostera</span>
          </div>
          {personPairs.length === 0 ? (
            <p className="mb-3 text-xs text-inksoft">
              Brak osób w rosterze — dodaj osoby podejrzane w zakładce Sprawa (Krok 2).
            </p>
          ) : (
            <div className="mb-3 max-h-64 space-y-1 overflow-auto">
              {personPairs.map((p, i) => (
                <PairRow key={i} a={p.a} b={p.b} busy={busy} onSearch={searchPair} />
              ))}
            </div>
          )}

          {resultsBlock}
        </div>
      )}

      {/* ── Sekcja C — pełna analiza OSINT + PDF ── */}
      {section === "C" && (
        <div>
          <p className="mb-3 text-[11px] leading-relaxed text-inksoft">
            Pełen proces analityka OSINT dla tej sprawy: <strong>Krok 1</strong> — agent zbiera materiał (roster + akta:
            postanowienie/KRS/załączniki, rekordy GLEIF po LEI, wyszukiwania web per podmiot/osoba) i syntetyzuje
            ustaloną strukturę powiązań (evidence-only: każde powiązanie z cytowanym źródłem, pozycje niepewne
            oznaczone „(do potwierdzenia)”). <strong>Krok 2</strong> — pobierasz gotowy PDF w dopracowanej formie
            (strona tytułowa, spis treści, klastry, chronologia, łańcuchy KRS, podmioty, wnioski, graf).
          </p>

          {/* Krok 1 — przeprowadź analizę */}
          <div className="mb-3 rounded-lg border border-line bg-paper p-4">
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={runAnalysis}
                disabled={busy !== null}
                className="border border-ink bg-ink px-4 py-2 text-xs uppercase tracking-wider text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {busy === "analyze" ? "Analizuję…" : hasAnalysis ? "Przeprowadź ponownie" : "Przeprowadź analizę OSINT"}
              </button>
              <span className="text-[11px] text-inksoft">
                {hasAnalysis ? "✓ analiza zapisana dla tej sprawy" : "analiza jeszcze nieprzeprowadzona"}
              </span>
            </div>
            <p className="mt-2 text-[11px] text-inksoft">
              Wymaga rostera (Sprawa → Krok 2) oraz akt w Storage. Przebieg trwa kilka minut (wyszukiwania + synteza modelu).
            </p>
          </div>

          {/* Krok 2 — pobierz PDF */}
          <div className="rounded-lg border border-line bg-paper p-4">
            <button
              onClick={generateOsintPdf}
              disabled={busy !== null}
              className="border border-emerald-600 bg-emerald-600 px-4 py-2 text-xs uppercase tracking-wider text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {busy === "pdf" ? "Generuję PDF…" : "Generuj Analizę OSINT (PDF)"}
            </button>
            <p className="mt-2 text-[11px] text-inksoft">
              Renderuje analizę przeprowadzoną w Kroku 1 + dołączone powiązania z panelu A/B:{" "}
              {links.filter((l) => l.podmioty.trim() && l.zrodlo.trim()).length}. „Zapisz OSINT” przed pobraniem, by uwzględnić najnowsze.
            </p>
          </div>
        </div>
      )}

      {/* ── Rejestr powiązań (wspólny) ── */}
      <div className="mt-4 border-t border-line pt-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium">Rejestr powiązań ({links.length}) — każde z cytowanym źródłem</p>
          <button onClick={addManual} className="text-xs text-inksoft underline-offset-2 hover:underline">+ dodaj ręcznie</button>
        </div>
        <div className="space-y-2">
          {links.map((l, i) => (
            <div key={i} className="border border-line bg-paper p-2">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <select value={l.typ} onChange={(e) => updLink(i, { typ: e.target.value })} className="rounded-lg border border-ink/30 px-2 py-1 text-xs">
                  {LINK_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <input value={l.podmioty} onChange={(e) => updLink(i, { podmioty: e.target.value })} placeholder="podmioty/osoby" className="min-w-0 flex-1 rounded-lg border border-ink/30 px-2 py-1 text-sm outline-none focus:border-neutral-500" />
                <button onClick={() => delLink(i)} className="text-xs text-red-600 hover:text-red-800">Usuń</button>
              </div>
              <input value={l.opis} onChange={(e) => updLink(i, { opis: e.target.value })} placeholder="opis" className="mb-1 w-full rounded-lg border border-ink/30 px-2 py-1 text-sm outline-none focus:border-neutral-500" />
              <div className="flex flex-wrap items-center gap-2">
                <input value={l.zrodlo} onChange={(e) => updLink(i, { zrodlo: e.target.value })} placeholder="źródło (URL) — wymagane" className={`min-w-0 flex-1 rounded-lg border px-2 py-1 text-sm outline-none focus:border-neutral-500 ${l.zrodlo.trim() ? "border-ink/30" : "border-red-300"}`} />
                <input value={l.data} onChange={(e) => updLink(i, { data: e.target.value })} placeholder="data" className="w-28 rounded-lg border border-ink/30 px-2 py-1 text-sm outline-none focus:border-neutral-500" />
              </div>
            </div>
          ))}
        </div>
        {profiles.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-xs font-medium">Materiały profilowe ({profiles.length})</p>
            <div className="space-y-1">
              {profiles.map((h, i) => (
                <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                  <a href={h.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-ink underline-offset-2 hover:underline">
                    [{h.entity} · {CAT_LABEL[h.category] ?? h.category}] {h.title}
                  </a>
                  <button onClick={() => delProfile(i)} className="shrink-0 text-red-600 hover:text-red-800">×</button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="mt-3 flex items-center gap-2">
          <button onClick={save} disabled={busy !== null} className="border border-emerald-600 bg-emerald-600 px-3 py-1.5 text-xs uppercase tracking-wider text-white transition-opacity hover:opacity-90 disabled:opacity-40">
            {busy === "save" ? "Zapisuję…" : "Zapisz OSINT"}
          </button>
          {msg && <span className="text-xs text-inksoft">{msg}</span>}
        </div>
      </div>
    </section>
  );
}

// Wiersz pary (spółka↔spółka lub osoba↔osoba): przycisk główny + zawężenia po typie.
function PairRow({
  a,
  b,
  signal,
  busy,
  onSearch,
}: {
  a: string;
  b: string;
  signal?: string;
  busy: string | null;
  onSearch: (a: string, b: string, suffix: string, label: string) => void;
}) {
  return (
    <div className="border border-line bg-paper p-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 font-medium">{a} ↔ {b}</span>
        <div className="flex shrink-0 items-center gap-2">
          {signal && <span className="rounded-full bg-ink/10 px-2 py-0.5 text-[11px] text-inksoft">{signal}</span>}
          <button
            onClick={() => onSearch(a, b, "", "powiązania")}
            disabled={busy !== null}
            className="border border-ink px-2 py-1 text-[11px] uppercase tracking-wider transition-colors hover:bg-ink hover:text-paper disabled:opacity-40"
          >
            {busy === `B:${a}|${b}|powiązania` ? "Szukam…" : "Szukaj powiązań"}
          </button>
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-inksoft">
        <span>zawęź:</span>
        {([
          ["umowa", "umowa"],
          ["zarząd rada", "zarząd"],
          ["udziały inwestycja", "inwestycje"],
          ["konferencja event", "event"],
          ["wywiad", "wywiad"],
          ["prokuratura sąd zarzuty", "sąd/prok."],
        ] as const).map(([suffix, label]) => (
          <button
            key={label}
            onClick={() => onSearch(a, b, suffix, label)}
            disabled={busy !== null}
            className="text-ink/80 underline-offset-2 hover:underline disabled:opacity-40"
          >
            {busy === `B:${a}|${b}|${label}` ? "…" : label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ResultRow({ r, onAdd, addLabel = "Dodaj do profilu" }: { r: WebResult; onAdd: () => void; addLabel?: string }) {
  return (
    <div className="flex items-start justify-between gap-2 border-b border-line py-1.5 last:border-0 text-xs">
      <div className="min-w-0 flex-1">
        <a href={r.url} target="_blank" rel="noopener noreferrer" className="block truncate font-medium text-ink underline-offset-2 hover:underline">
          {r.title || r.url}
        </a>
        <div className="truncate text-[11px] text-inksoft">{r.url}</div>
      </div>
      <button onClick={onAdd} className="shrink-0 text-emerald-700 hover:underline">{addLabel}</button>
    </div>
  );
}
