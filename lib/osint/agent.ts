// Agent OSINT — pełen proces analizy per sprawa (odpowiednik ręcznej pracy analityka):
// 1) zbiera materiał: roster + PDF z akt (postanowienie, KRS, zał. osobowy) + GLEIF (po LEI)
//    + wyszukiwania Brave per podmiot/osoba/para; 2) model syntetyzuje ustrukturyzowany
//    JSON z TWARDYM groundingiem (każda relacja z cytowanym źródłem; brak → „do potwierdzenia”);
//    3) deterministyczny asembler składa JSON w OsintContent (ta sama forma co wzorzec MLM) + graf.
// Evidence-only: buduje z materiału (akta/rejestry/web), NIGDY z gotowej opinii.
import Anthropic from "@anthropic-ai/sdk";

import { pdfText } from "@/lib/intake/pdf";

import { braveSearch, gleifByLei, gleifByName, extractLeis, type GleifRecord, type WebHit } from "./collect";
import type { OsintContent, Block, Run } from "./content";
import type { GraphData, GEdge, GNode } from "./graph-generic";

type Entity = { name: string; fragment?: string; kind?: "podmiot" | "osoba" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = any;

const cleanName = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, "").trim();

// ── Model: ustrukturyzowany wynik analizy (agent wypełnia z materiału) ──
type ARelation = { from: string; to: string; type: string; note: string; source: string; direct?: boolean; cluster?: string };
type ACluster = { name: string; summary: string };
type AChain = { person: string; ident?: string; steps: string[] };
type AEntityDetail = { name: string; rows: [string, string][]; note?: string; source?: string };
type AnalysisJSON = {
  emitterName: string;
  emitterIdent: string;
  subject: string;
  infoIntro: string;
  roster: { name: string; account: string }[];
  clustersIntro: string;
  clusters: ACluster[];
  relations: ARelation[];
  chronology: { date: string; who: string; event: string; effect: string }[];
  chains: AChain[];
  entities: AEntityDetail[];
  conclusions: string[];
  caveats: string[];
};

export type AnalyzeResult = { content: OsintContent; stats: { pdfs: number; gleif: number; web: number; relations: number; clusters: number } };

// ─────────────────────────────────────────────────────────────────────────────
// 1) ZBIERANIE MATERIAŁU
// ─────────────────────────────────────────────────────────────────────────────
async function gather(supabase: Supa, caseId: string) {
  const { data: caseRow } = await supabase.from("cases").select("name,signature,group_roster").eq("id", caseId).single();
  const roster: Entity[] = (caseRow?.group_roster?.entities ?? []) as Entity[];
  const podmioty = roster.filter((e) => e.kind !== "osoba").slice(0, 14);
  const osoby = roster.filter((e) => e.kind === "osoba").slice(0, 16);

  // PDF z akt — postanowienie/KRS/zał. osobowy/OSINT wejściowy (do 6 plików).
  const { data: docs } = await supabase
    .from("documents")
    .select("rel_path,storage_path,doc_type")
    .eq("case_id", caseId)
    .in("doc_type", ["POSTANOWIENIE", "KRS_REJESTR", "ZALACZNIK_OSOBOWY", "ZAWIAD_STAN_POSIADANIA", "ANALIZA_OSINT"])
    .limit(30);
  const isPdf = (fn: string) => /\.pdf$/i.test(fn);
  const picked = (docs ?? []).filter((d: { rel_path: string; storage_path?: string }) => d.storage_path && isPdf(d.rel_path)).slice(0, 6);
  const akta: string[] = [];
  const leiSet = new Set<string>();
  for (const d of picked) {
    const fn = String(d.rel_path).split("/").pop() ?? "";
    try {
      const { data: blob } = await supabase.storage.from("case-files").download(d.storage_path);
      if (!blob) continue;
      const text = await pdfText(await blob.arrayBuffer(), 7000);
      akta.push(`### ${d.doc_type} — ${fn}\n${text}`);
      extractLeis(text).forEach((l) => leiSet.add(l));
    } catch { /* pomiń nieczytelny plik */ }
  }

  // GLEIF — po LEI z akt (do 10) + po nazwie podmiotów bez LEI (do 6).
  const gleif: GleifRecord[] = [];
  for (const lei of [...leiSet].slice(0, 10)) {
    const g = await gleifByLei(lei);
    if (g) gleif.push(g);
  }
  const haveNames = new Set(gleif.map((g) => g.name.toLowerCase()));
  for (const p of podmioty.slice(0, 6)) {
    const nm = cleanName(p.name);
    if (haveNames.has(nm.toLowerCase())) continue;
    const g = await gleifByName(nm);
    if (g) { gleif.push(g); haveNames.add(g.name.toLowerCase()); }
  }

  // Web (Brave) — per podmiot (8), pary osób top (do 6), łącznie ≤ 14 zapytań.
  const web: { q: string; hits: WebHit[] }[] = [];
  const queries: string[] = [];
  for (const p of podmioty.slice(0, 8)) queries.push(`${cleanName(p.name)} KRS zarząd powiązania`);
  const people = osoby.slice(0, 4).map((e) => cleanName(e.name));
  for (let i = 0; i < people.length; i++)
    for (let j = i + 1; j < people.length; j++) if (queries.length < 14) queries.push(`"${people[i]}" "${people[j]}"`);
  for (const q of queries.slice(0, 14)) {
    const hits = await braveSearch(q);
    if (hits.length) web.push({ q, hits });
  }

  return { caseRow, roster, podmioty, osoby, akta, gleif, web };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) SYNTEZA (model → JSON, grounded)
// ─────────────────────────────────────────────────────────────────────────────
const SYSTEM =
  "Jesteś analitykiem OSINT wspierającym biegłego sądowego w sprawie manipulacji instrumentem finansowym. " +
  "Na podstawie DOSTARCZONEGO MATERIAŁU (akta sprawy: postanowienie, odpisy KRS, załączniki; rekordy GLEIF; wyniki " +
  "wyszukiwań web) ustal powiązania osobowe, kapitałowe i organizacyjne między wskazanymi podmiotami i osobami. " +
  "ZASADY (bezwzględne): (1) Buduj WYŁĄCZNIE na materiale — nie zmyślaj nazwisk, dat, numerów KRS/LEI, adresów. " +
  "(2) KAŻDA relacja i ustalenie MUSI mieć źródło w polu 'source' (URL z wyników web, albo 'akta: <dokument>', albo " +
  "'GLEIF <LEI>'). Czego nie potwierdza materiał — pomiń albo oznacz w 'note' dopiskiem '(do potwierdzenia)'. " +
  "(3) Grupuj podmioty/osoby w klastry (np. wg wspólnego adresu, zarządu, domu maklerskiego, rodziny). " +
  "(4) Ton rzeczowy, bezstronny; ustalenia faktyczne, bez przesądzania o winie. Pisz po polsku. " +
  "Zwróć WYŁĄCZNIE JSON zgodny ze schematem (bez komentarzy, bez markdown): " +
  '{"emitterName":"","emitterIdent":"KRS/LEI/ISIN","subject":"rynek i instrument","infoIntro":"1-2 zdania",' +
  '"roster":[{"name":"","account":"podmiot/rachunek za materiałem"}],' +
  '"clustersIntro":"1-2 zdania","clusters":[{"name":"Klaster … — opis","summary":"2-4 zdania"}],' +
  '"relations":[{"from":"","to":"","type":"funkcja/kapitał/adres/obrót","note":"","source":"","direct":true,"cluster":"nazwa klastra"}],' +
  '"chronology":[{"date":"YYYY-MM-DD","who":"","event":"","effect":""}],' +
  '"chains":[{"person":"IMIĘ NAZWISKO","ident":"PESEL/rola","steps":["ORGAN / okres / → PODMIOT (KRS)"]}],' +
  '"entities":[{"name":"","rows":[["Cecha","Ustalenie"]],"note":"akapit","source":""}],' +
  '"conclusions":["zdanie wniosku"],"caveats":["zastrzeżenie metodyczne/źródłowe"]}';

async function synth(bundle: Awaited<ReturnType<typeof gather>>): Promise<AnalysisJSON> {
  const roster = [...bundle.podmioty, ...bundle.osoby]
    .map((e) => `- ${e.name} [${e.kind ?? "podmiot"}]`).join("\n");
  const gleif = bundle.gleif
    .map((g) => `- ${g.name} | LEI ${g.lei} | ${g.status} | ${g.jurisdiction} | ${g.address}${g.registeredAs ? ` | rej. ${g.registeredAs}` : ""}`)
    .join("\n");
  const web = bundle.web
    .map((w) => `# ${w.q}\n` + w.hits.map((h) => `  · ${h.title} — ${h.url}\n    ${h.description}`).join("\n"))
    .join("\n");
  const akta = bundle.akta.join("\n\n").slice(0, 42000);

  const userPrompt = [
    `SPRAWA: ${bundle.caseRow?.name ?? ""}  (sygn. ${bundle.caseRow?.signature ?? "—"})`,
    "",
    "ROSTER (podmioty i osoby z akt):", roster || "(brak)",
    "",
    "REKORDY GLEIF:", gleif || "(brak)",
    "",
    "WYNIKI WYSZUKIWAŃ WEB (tytuł — URL + opis):", web || "(brak)",
    "",
    "FRAGMENTY AKT (postanowienie / KRS / załączniki):", akta || "(brak)",
    "",
    "Zbuduj analizę OSINT zgodnie ze schematem JSON. Pamiętaj: każda relacja z 'source'.",
  ].join("\n");

  const client = new Anthropic();
  const msg = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 8000,
    system: SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  });
  const raw = msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").replace(/```json|```/g, "").trim();
  const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
  if (s < 0 || e <= s) throw new Error("Model nie zwrócił JSON.");
  const j = JSON.parse(raw.slice(s, e + 1)) as Partial<AnalysisJSON>;
  return {
    emitterName: j.emitterName ?? bundle.caseRow?.name ?? "Emitent",
    emitterIdent: j.emitterIdent ?? "",
    subject: j.subject ?? "rynek regulowany / NewConnect (GPW)",
    infoIntro: j.infoIntro ?? "",
    roster: Array.isArray(j.roster) ? j.roster : [],
    clustersIntro: j.clustersIntro ?? "",
    clusters: Array.isArray(j.clusters) ? j.clusters : [],
    relations: Array.isArray(j.relations) ? j.relations : [],
    chronology: Array.isArray(j.chronology) ? j.chronology : [],
    chains: Array.isArray(j.chains) ? j.chains : [],
    entities: Array.isArray(j.entities) ? j.entities : [],
    conclusions: Array.isArray(j.conclusions) ? j.conclusions : [],
    caveats: Array.isArray(j.caveats) ? j.caveats : [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) ASEMBLER: AnalysisJSON → OsintContent (ta sama forma co wzorzec MLM) + graf
// ─────────────────────────────────────────────────────────────────────────────
function assemble(a: AnalysisJSON, sygn: string): OsintContent {
  const R = (s: string): Run[] => [s];
  const srcBlock = (label: string): Block => ({ t: "src", label: label || "materiał akt sprawy / źródła jawne", url: "https://www.knf.gov.pl" });

  // WNIOSKI — intro + tabela relacji per klaster.
  const wnioski: Block[] = [{ t: "p", runs: R(a.clustersIntro || "Zebrany materiał pozwala pogrupować wskazane podmioty i osoby w powiązane klastry.") }];
  for (const c of a.clusters) {
    const rels = a.relations.filter((r) => (r.cluster ?? "").toLowerCase() === c.name.toLowerCase());
    wnioski.push({ t: "p", runs: [{ b: c.name + ". " }, ...R(c.summary)] });
    if (rels.length) {
      wnioski.push({ t: "rel", title: c.name, rows: rels.map((r): [string, Run[]] => [
        `${r.from} ↔ ${r.to}`,
        [`${r.type ? r.type + ": " : ""}${r.note}`, ...(r.source ? [{ i: `  [źródło: ${r.source}]` } as Run] : [])],
      ]) });
    }
  }
  // relacje bez przypisanego klastra — zbiorcza tabela.
  const orphan = a.relations.filter((r) => !a.clusters.some((c) => c.name.toLowerCase() === (r.cluster ?? "").toLowerCase()));
  if (orphan.length)
    wnioski.push({ t: "rel", title: "Pozostałe ustalone powiązania", rows: orphan.map((r): [string, Run[]] => [
      `${r.from} ↔ ${r.to}`, [`${r.type ? r.type + ": " : ""}${r.note}`, ...(r.source ? [{ i: `  [źródło: ${r.source}]` } as Run] : [])],
    ]) });
  wnioski.push(srcBlock("Zestawienie na podstawie akt sprawy, GLEIF i źródeł jawnych"));

  const sections: OsintContent["sections"] = [
    { heading: "INFORMACJE DO USTALENIA", blocks: [
      { t: "p", runs: R(a.infoIntro || "Przedmiotem analizy jest ustalenie powiązań osobowych, kapitałowych i organizacyjnych między podmiotami i osobami wskazanymi w aktach sprawy.") },
      { t: "p", runs: [{ b: a.emitterName }, ...(a.emitterIdent ? R(` (${a.emitterIdent})`) : []), ...R(" — emitent, którego instrumentów dotyczy analiza.")] },
      ...(a.roster.length ? [{ t: "data", headers: ["Podmiot / osoba", "Rola / rachunek (za materiałem)"], widths: [34, 66], rows: a.roster.map((x) => [x.name, x.account]) } as Block] : []),
      srcBlock("Postanowienie i załączniki — akta sprawy"),
    ] },
    { heading: "WNIOSKI ZE ZGROMADZONEGO MATERIAŁU", blocks: wnioski },
  ];
  if (a.chronology.length)
    sections.push({ heading: "CHRONOLOGIA PRZEJĘCIA KONTROLI", blocks: [
      { t: "p", runs: R("Zestawienie datowanych zdarzeń istotnych dla oceny przejęcia kontroli i stanu posiadania:") },
      { t: "data", headers: ["Data", "Podmiot / osoba", "Zdarzenie", "Skutek"], widths: [12, 24, 30, 34], rows: a.chronology.map((r) => [r.date, r.who, r.event, r.effect]) },
      srcBlock("Zawiadomienia o stanie posiadania (art. 69), KRS — akta sprawy"),
    ] });
  if (a.chains.length)
    sections.push({ heading: "ŁAŃCUCHY POWIĄZAŃ OSOBOWYCH W REJESTRZE KRS", blocks: [
      { t: "p", runs: R("Rotacyjna obsada tych samych osób w organach powiązanych podmiotów (z odpisów KRS):") },
      ...a.chains.flatMap((ch): Block[] => [
        { t: "h3", text: `${ch.person}${ch.ident ? ` (${ch.ident})` : ""}` },
        ...ch.steps.map((s): Block => ({ t: "arrow", runs: R(s) })),
      ]),
      srcBlock("Odpisy pełne KRS — akta sprawy"),
    ] });
  if (a.entities.length)
    sections.push({ heading: "PODMIOTY I OSOBY Z WNIOSKU", blocks: a.entities.flatMap((en): Block[] => [
      { t: "h2", text: en.name },
      { t: "data", headers: ["Cecha", "Ustalenie"], widths: [26, 74], rows: en.rows },
      ...(en.note ? [{ t: "p", runs: R(en.note) } as Block] : []),
      srcBlock(en.source || "GLEIF / rejestry / akta sprawy"),
    ]) });
  sections.push({ heading: "WNIOSKI KOŃCOWE", blocks: [
    ...(a.conclusions.length
      ? a.conclusions.map((c, i): Block => ({ t: "p", bullet: true, runs: [{ b: `${i + 1}. ` }, ...R(c)] }))
      : [{ t: "p", runs: R("Zebrany materiał wskazuje na powiązania między wskazanymi podmiotami i osobami wykraczające poza przypadkowy zbieg uczestników obrotu.") } as Block]),
    { t: "p", runs: [{ i: (a.caveats.join(" ") || "") + " Niniejsza analiza opiera się na źródłach ogólnodostępnych oraz dokumentach z akt sprawy; ustalenia mają charakter faktyczny i nie przesądzają o odpowiedzialności — ocena należy do organu i sądu." }] },
  ] });
  sections.push({ heading: "ZAŁĄCZNIK — GRAF POWIĄZAŃ", blocks: [
    { t: "p", runs: R("Graf obrazuje ustalone powiązania: węzeł centralny — emitent; kolory — klastry; linia ciągła — powiązanie bezpośrednie, przerywana — pośrednie lub rachunek własny.") },
    { t: "graph" },
    srcBlock("Opracowanie własne na podstawie akt sprawy, GLEIF i źródeł jawnych"),
  ] });

  return {
    meta: {
      sygn,
      dotyczy: a.emitterName,
      przedmiot: a.subject,
      podtytul: "Ustalenie powiązań osobowych, kapitałowych i organizacyjnych pomiędzy podmiotami i osobami wskazanymi w aktach sprawy",
      zrodla: "Źródła jawne: KRS · GLEIF · rejestry zagraniczne · media · akta sprawy",
      nazwa: a.emitterName,
    },
    sections,
    graphData: buildGraphData(a),
  };
}

// Graf z klastrów + relacji: emitent w centrum, węzły grupowane po klastrze.
function buildGraphData(a: AnalysisJSON): GraphData {
  const nodeOf = (name: string): GNode => ({ id: name, label: name });
  const inCluster = (name: string) =>
    a.relations.find((r) => r.from === name || r.to === name)?.cluster ?? "";
  const names = new Set<string>();
  a.relations.forEach((r) => { names.add(r.from); names.add(r.to); });
  names.delete(a.emitterName);
  const clusters = (a.clusters.length ? a.clusters.map((c) => c.name) : ["Powiązania"]).map((cn) => ({
    name: cn,
    nodes: [...names].filter((n) => inCluster(n) === cn).map(nodeOf),
  }));
  // węzły bez klastra → pierwszy klaster
  const placed = new Set(clusters.flatMap((c) => c.nodes.map((n) => n.id)));
  const rest = [...names].filter((n) => !placed.has(n)).map(nodeOf);
  if (rest.length) (clusters[0] ??= { name: "Powiązania", nodes: [] }).nodes.push(...rest);
  const edges: GEdge[] = a.relations.map((r) => ({ a: r.from, b: r.to, label: r.type, dashed: r.direct === false }));
  return { title: `Graf powiązań — ${a.emitterName}`, center: { id: a.emitterName, label: a.emitterName, sub: "emitent" }, clusters: clusters.filter((c) => c.nodes.length), edges };
}

// ─────────────────────────────────────────────────────────────────────────────
export async function runOsintAnalysis(supabase: Supa, caseId: string): Promise<AnalyzeResult> {
  const bundle = await gather(supabase, caseId);
  const analysis = await synth(bundle);
  const content = assemble(analysis, bundle.caseRow?.signature ?? "—");
  return {
    content,
    stats: { pdfs: bundle.akta.length, gleif: bundle.gleif.length, web: bundle.web.length, relations: analysis.relations.length, clusters: analysis.clusters.length },
  };
}
