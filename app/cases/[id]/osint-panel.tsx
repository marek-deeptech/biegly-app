"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

// A4 OSINT — dwie sekcje:
//  A. Informacje o podmiotach i osobach podejrzanych (profil per podmiot z rostera).
//  B. Powiązania między nimi — kolejka par z SYGNAŁÓW silnika (wspólne IP, wash-pary).
// Evidence-only: wyszukiwarka zwraca realne wyniki, biegły dodaje trafne z URL-em
// jako źródłem. Kategoryzacja linków deterministyczna (po domenie), nie z modelu.

type Metric = { key: string; value: number | null; session_day: string | null };
type Entity = { name: string; fragment: string; kind?: "podmiot" | "osoba" };
type WebResult = { title: string; url: string; description: string };
type Hit = { entity: string; category: string; title: string; url: string };
type Link = { typ: string; podmioty: string; opis: string; zrodlo: string; data: string };
type OsintData = { links?: Link[]; profiles?: Hit[] };
type SubRow = { kind: string; data: { table?: unknown; osint?: OsintData } | null };

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
  const init = (existing?.data as { osint?: OsintData } | null)?.osint ?? {};
  const [section, setSection] = useState<"A" | "B">("A");
  const [roster, setRoster] = useState<Entity[]>([]);
  const [links, setLinks] = useState<Link[]>(init.links ?? []);
  const [profiles, setProfiles] = useState<Hit[]>(init.profiles ?? []);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [ctx, setCtx] = useState<{ label: string; frag: string } | null>(null);
  const [results, setResults] = useState<WebResult[]>([]);

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

  // Kolejka par z sygnałów silnika: wspólne IP (A3) + wash-pary (pair_intra::).
  const ipTable = stored.find((s) => s.kind === "powiazania_dane")?.data?.table as
    | { rows?: string[][] }
    | undefined;
  const pairs = useMemo(() => {
    const out: { a: string; b: string; signal: string }[] = [];
    for (const row of ipTable?.rows ?? []) {
      if (row[0] && row[1]) out.push({ a: row[0], b: row[1], signal: `${row[2]} wspólnych IP` });
    }
    for (const m of metrics) {
      if (!m.key.startsWith("pair_intra::")) continue;
      const [a, b] = m.key.slice("pair_intra::".length).split("|");
      if (a && b) out.push({ a, b, signal: `wash ${(m.value ?? 0).toLocaleString("pl-PL")} zł` });
    }
    return out.slice(0, 60);
  }, [ipTable, metrics]);

  async function webSearch(query: string, social = false): Promise<WebResult[]> {
    const r = await fetch(`/cases/${caseId}/osint/web?q=${encodeURIComponent(query)}&social=${social ? "1" : "0"}`);
    const j = await r.json();
    if (!j.ok) throw new Error(j.reason || `HTTP ${r.status}`);
    return (j.results ?? []) as WebResult[];
  }

  async function searchEntity(e: Entity) {
    setBusy("A:" + e.name);
    setMsg("");
    setResults([]);
    setCtx({ label: e.name, frag: e.fragment });
    try {
      const res = await webSearch(e.name);
      setResults(res);
      if (!res.length) setMsg("Brak wyników web (rejestry poniżej działają bez wyszukiwarki).");
    } catch (err) {
      setMsg(`Web: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  }

  async function searchPair(a: string, b: string, suffix: string, label: string) {
    setBusy(`B:${a}|${b}|${label}`);
    setMsg("");
    setResults([]);
    setCtx({ label: `${a} ↔ ${b} · ${label}`, frag: "" });
    try {
      const res = await webSearch(`"${a}" "${b}"${suffix ? " " + suffix : ""}`);
      setResults(res);
      if (!res.length) setMsg("Brak wyników dla tej pary/typu.");
    } catch (err) {
      setMsg(`Web: ${err instanceof Error ? err.message : String(err)}`);
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

  const grouped = useMemo(() => {
    const g: Record<string, WebResult[]> = {};
    if (ctx) for (const r of results) (g[categorize(r, ctx.frag)] ??= []).push(r);
    return g;
  }, [results, ctx]);

  return (
    <section className="border border-ink/60 bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-xs font-semibold uppercase tracking-[0.12em]">Powiązania — OSINT (Krok 5)</h2>
        <div className="flex gap-1 rounded-lg border border-ink/20 p-0.5">
          {(["A", "B"] as const).map((s) => (
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
              {s === "A" ? "A · Informacje" : "B · Powiązania"}
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

          {ctx && (
            <div className="rounded-lg border border-line bg-paper p-3">
              <p className="mb-2 text-xs font-medium">Wyniki dla: {ctx.label}</p>
              {msg && <p className="mb-2 text-xs text-inksoft">{msg}</p>}
              <div className="mb-3 flex flex-wrap gap-2 text-[11px]">
                <span className="text-inksoft">Rejestry:</span>
                <a href={`https://opencorporates.com/companies?q=${encodeURIComponent(ctx.label)}`} target="_blank" rel="noopener noreferrer" className="text-emerald-700 hover:underline">OpenCorporates</a>
                <a href={`https://rejestr.io/szukaj?text=${encodeURIComponent(ctx.label)}`} target="_blank" rel="noopener noreferrer" className="text-emerald-700 hover:underline">rejestr.io (KRS)</a>
                <a href={`https://wyszukiwarka-krs.ms.gov.pl/`} target="_blank" rel="noopener noreferrer" className="text-emerald-700 hover:underline">wyszukiwarka KRS</a>
              </div>
              {CAT_ORDER.filter((c) => grouped[c]?.length).map((c) => (
                <div key={c} className="mb-2">
                  <p className="text-[11px] font-medium text-inksoft">{CAT_LABEL[c]}</p>
                  {grouped[c].map((r, j) => (
                    <ResultRow key={j} r={r} onAdd={() => addProfile(ctx.label, c, r)} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Sekcja B — powiązania między podmiotami (kolejka z sygnałów) ── */}
      {section === "B" && (
        <div>
          <p className="mb-3 text-[11px] leading-relaxed text-inksoft">
            Kolejka par uszeregowana <strong>sygnałami z silnika</strong>: wspólne adresy IP (z „Powiązania — dane”) oraz
            pary handlujące wewnątrz Grupy (wash). Dla wybranej pary uruchamiasz zapytania per typ powiązania; trafne
            wyniki dodajesz do rejestru z URL-em jako źródłem.
          </p>
          {pairs.length === 0 ? (
            <p className="mb-3 text-xs text-inksoft">
              Brak sygnałów — policz wskaźniki (zakładka Analiza liczbowa) i wykonaj analizę IP (zakładka Powiązania).
            </p>
          ) : (
            <div className="mb-3 max-h-72 space-y-1 overflow-auto">
              {pairs.map((p, i) => (
                <div key={i} className="border border-line bg-paper p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 font-medium">{p.a} ↔ {p.b}</span>
                    <span className="shrink-0 rounded-full bg-ink/10 px-2 py-0.5 text-[11px] text-inksoft">{p.signal}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                    {([
                      ["", "ogólne"],
                      ["umowa", "umowa"],
                      ["zarząd rada", "zarząd"],
                      ["udziały inwestycja", "inwestycje"],
                      ["konferencja event", "event"],
                      ["wywiad", "wywiad"],
                      ["prokuratura sąd", "sąd/prok."],
                    ] as const).map(([suffix, label]) => (
                      <button
                        key={label}
                        onClick={() => searchPair(p.a, p.b, suffix, label)}
                        disabled={busy !== null}
                        className="text-ink/80 underline-offset-2 hover:underline disabled:opacity-40"
                      >
                        {busy === `B:${p.a}|${p.b}|${label}` ? "…" : label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {ctx && (
            <div className="rounded-lg border border-line bg-paper p-3">
              <p className="mb-2 text-xs font-medium">Wyniki: {ctx.label}</p>
              {msg && <p className="mb-2 text-xs text-inksoft">{msg}</p>}
              {results.map((r, j) => (
                <ResultRow
                  key={j}
                  r={r}
                  addLabel="Dodaj do rejestru"
                  onAdd={() => addLinkFromWeb(r, "inne", ctx.label.split(" · ")[0])}
                />
              ))}
            </div>
          )}
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
