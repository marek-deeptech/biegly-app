// Agent OSINT — pełen proces analizy per sprawa, ETAPOWY i wznawialny (odporny na
// limity czasu funkcji). Stan trzymany w subanalizie `osint_run` (data.run); panel
// woła endpoint w pętli, każde wywołanie wykonuje JEDEN krótki krok:
//   gather (roster+akta+GLEIF) → search (Brave) → synth (model→JSON) →
//   review×(2–3: recenzent adwersaryjny + doszukanie braków + dopracowanie) → finalize.
// Evidence-only: buduje z materiału (akta/rejestry/web), każda relacja z cytowanym
// źródłem; pozycje niepewne oznaczone „(do potwierdzenia)". Finalny wynik jako
// subanaliza `osint_analysis` (data.content = OsintContent) — renderowana do PDF.
import Anthropic from "@anthropic-ai/sdk";

import { pdfText } from "@/lib/intake/pdf";

import { braveSearch, gleifByLei, gleifByName, extractLeis, type GleifRecord, type WebHit } from "./collect";
import type { OsintContent, Block, Run } from "./content";
import type { GraphData, GEdge, GNode } from "./graph-generic";

type Entity = { name: string; fragment?: string; kind?: "podmiot" | "osoba" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = any;

const MAX_ROUNDS = 3; // pętla recenzenta: do 3 iteracji (z wcześniejszym stopem przy zbieżności)
const cleanName = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, "").trim();

// ── Ustrukturyzowany wynik analizy (model wypełnia z materiału) ──
type ARelation = { from: string; to: string; type: string; note: string; source: string; direct?: boolean; cluster?: string };
type ACluster = { name: string; summary: string };
type AChain = { person: string; ident?: string; steps: string[] };
type AEntityDetail = { name: string; rows: [string, string][]; note?: string; source?: string };
type AnalysisJSON = {
  emitterName: string; emitterIdent: string; subject: string; infoIntro: string;
  roster: { name: string; account: string }[];
  clustersIntro: string; clusters: ACluster[]; relations: ARelation[];
  chronology: { date: string; who: string; event: string; effect: string }[];
  chains: AChain[]; entities: AEntityDetail[]; conclusions: string[]; caveats: string[];
};
type Critique = { gaps: string[]; unsupported: string[]; queries: string[]; converged: boolean };
type Evidence = { caseName: string; sig: string; rosterText: string; gleifText: string; aktaText: string; webText: string; queries: string[] };
export type RunStage = "gather" | "search" | "synth" | "review" | "finalize" | "done";
type RunState = { stage: RunStage; round: number; evidence: Evidence; analysis: AnalysisJSON | null; notes: string[] };
export type AdvanceResult = { stage: RunStage; round: number; done: boolean; note: string; stats?: Record<string, number> };

// ── Anthropic: jedno wywołanie → JSON ──
async function modelJson<T>(system: string, user: string, maxTokens = 8000): Promise<T> {
  const client = new Anthropic();
  const msg = await client.messages.create({ model: "claude-opus-4-8", max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] });
  const raw = msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").replace(/```json|```/g, "").trim();
  const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
  if (s < 0 || e <= s) throw new Error("Model nie zwrócił JSON.");
  return JSON.parse(raw.slice(s, e + 1)) as T;
}

const SCHEMA =
  '{"emitterName":"","emitterIdent":"KRS/LEI/ISIN","subject":"rynek i instrument","infoIntro":"1-2 zdania",' +
  '"roster":[{"name":"","account":"podmiot/rachunek za materiałem"}],' +
  '"clustersIntro":"1-2 zdania","clusters":[{"name":"Klaster … — opis","summary":"2-4 zdania"}],' +
  '"relations":[{"from":"","to":"","type":"funkcja/kapitał/adres/obrót","note":"","source":"","direct":true,"cluster":"nazwa klastra"}],' +
  '"chronology":[{"date":"YYYY-MM-DD","who":"","event":"","effect":""}],' +
  '"chains":[{"person":"IMIĘ NAZWISKO","ident":"PESEL/rola","steps":["ORGAN / okres / → PODMIOT (KRS)"]}],' +
  '"entities":[{"name":"","rows":[["Cecha","Ustalenie"]],"note":"akapit","source":""}],' +
  '"conclusions":["zdanie wniosku"],"caveats":["zastrzeżenie metodyczne/źródłowe"]}';
const SYSTEM =
  "Jesteś analitykiem OSINT wspierającym biegłego sądowego w sprawie manipulacji instrumentem finansowym. " +
  "Na podstawie DOSTARCZONEGO MATERIAŁU (akta: postanowienie, odpisy KRS, załączniki; rekordy GLEIF; wyniki web) " +
  "ustal powiązania osobowe, kapitałowe i organizacyjne między podmiotami i osobami. ZASADY (bezwzględne): " +
  "(1) Buduj WYŁĄCZNIE na materiale — nie zmyślaj nazwisk, dat, numerów KRS/LEI, adresów. (2) KAŻDA relacja/ustalenie " +
  "MUSI mieć źródło w 'source' (URL z web, 'akta: <dokument>' albo 'GLEIF <LEI>'); czego materiał nie potwierdza — pomiń " +
  "albo dopisz w 'note' '(do potwierdzenia)'. (3) Grupuj w klastry (wspólny adres, zarząd, dom maklerski, rodzina). " +
  "(4) Ton rzeczowy, bezstronny; ustalenia faktyczne, bez przesądzania o winie. Po polsku. " +
  "Zwróć WYŁĄCZNIE JSON zgodny ze schematem: " + SCHEMA;
const REVIEW_SYSTEM =
  "Jesteś ADWERSARYJNYM recenzentem analizy OSINT dla biegłego sądowego. Dostajesz materiał źródłowy oraz roboczą " +
  "analizę (JSON). Twoim zadaniem jest wskazać LUKI i słabe punkty, aby analiza była kompletna i ugruntowana. Sprawdź: " +
  "(a) kompletność vs materiał — które podmioty/osoby z rostera NIE są przypisane do klastra ani relacji; brak chronologii, " +
  "łańcuchów KRS, opisu kluczowych podmiotów; (b) twierdzenia bez źródła ('source' pusty lub ogólnikowy); (c) klastry/relacje " +
  "słabo uzasadnione. Zaproponuj do 6 KONKRETNYCH zapytań wyszukiwania, które pomogą domknąć luki (nazwiska, spółki, pary). " +
  "Nie pisz analizy — tylko krytykę. 'converged'=true gdy analiza jest kompletna i dobrze uźródłowiona (brak istotnych luk). " +
  "Zwróć WYŁĄCZNIE JSON: " +
  '{"gaps":["konkretna luka"],"unsupported":["twierdzenie bez źródła"],"queries":["zapytanie do wyszukania"],"converged":false}';

// ── formatowanie materiału do promptu ──
function fmtGleif(g: GleifRecord[]): string {
  return g.map((x) => `- ${x.name} | LEI ${x.lei} | ${x.status} | ${x.jurisdiction} | ${x.address}${x.registeredAs ? ` | rej. ${x.registeredAs}` : ""}`).join("\n");
}
function fmtWeb(w: { q: string; hits: WebHit[] }[]): string {
  return w.map((x) => `# ${x.q}\n` + x.hits.map((h) => `  · ${h.title} — ${h.url}\n    ${h.description}`).join("\n")).join("\n");
}
function normJson(j: Partial<AnalysisJSON>, ev: Evidence): AnalysisJSON {
  return {
    emitterName: j.emitterName || ev.caseName || "Emitent",
    emitterIdent: j.emitterIdent || "",
    subject: j.subject || "rynek regulowany / NewConnect (GPW)",
    infoIntro: j.infoIntro || "",
    roster: Array.isArray(j.roster) ? j.roster : [],
    clustersIntro: j.clustersIntro || "",
    clusters: Array.isArray(j.clusters) ? j.clusters : [],
    relations: Array.isArray(j.relations) ? j.relations : [],
    chronology: Array.isArray(j.chronology) ? j.chronology : [],
    chains: Array.isArray(j.chains) ? j.chains : [],
    entities: Array.isArray(j.entities) ? j.entities : [],
    conclusions: Array.isArray(j.conclusions) ? j.conclusions : [],
    caveats: Array.isArray(j.caveats) ? j.caveats : [],
  };
}
function evidenceBlock(ev: Evidence): string {
  return [
    `SPRAWA: ${ev.caseName}  (sygn. ${ev.sig})`, "",
    "ROSTER (podmioty i osoby z akt):", ev.rosterText || "(brak)", "",
    "REKORDY GLEIF:", ev.gleifText || "(brak)", "",
    "WYNIKI WYSZUKIWAŃ WEB:", ev.webText || "(brak)", "",
    "FRAGMENTY AKT (postanowienie / KRS / załączniki):", ev.aktaText || "(brak)",
  ].join("\n");
}

// ═════════════════════ KROKI ═════════════════════

// 1) gather — roster + akta (PDF) + GLEIF; zbuduj listę zapytań web.
async function stepGather(supabase: Supa, caseId: string): Promise<Evidence> {
  const { data: caseRow } = await supabase.from("cases").select("name,signature,group_roster").eq("id", caseId).single();
  const roster: Entity[] = (caseRow?.group_roster?.entities ?? []) as Entity[];
  const podmioty = roster.filter((e) => e.kind !== "osoba").slice(0, 14);
  const osoby = roster.filter((e) => e.kind === "osoba").slice(0, 16);

  const { data: docs } = await supabase
    .from("documents").select("rel_path,storage_path,doc_type").eq("case_id", caseId)
    .in("doc_type", ["POSTANOWIENIE", "KRS_REJESTR", "ZALACZNIK_OSOBOWY", "ZAWIAD_STAN_POSIADANIA", "ANALIZA_OSINT"]).limit(30);
  const picked = (docs ?? []).filter((d: { rel_path: string; storage_path?: string }) => d.storage_path && /\.pdf$/i.test(d.rel_path)).slice(0, 6);
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

  const gleif: GleifRecord[] = [];
  for (const lei of [...leiSet].slice(0, 10)) { const g = await gleifByLei(lei); if (g) gleif.push(g); }
  const have = new Set(gleif.map((g) => g.name.toLowerCase()));
  for (const p of podmioty.slice(0, 6)) {
    const nm = cleanName(p.name);
    if (have.has(nm.toLowerCase())) continue;
    const g = await gleifByName(nm); if (g) { gleif.push(g); have.add(g.name.toLowerCase()); }
  }

  const queries: string[] = [];
  for (const p of podmioty.slice(0, 8)) queries.push(`${cleanName(p.name)} KRS zarząd powiązania`);
  const people = osoby.slice(0, 4).map((e) => cleanName(e.name));
  for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) if (queries.length < 14) queries.push(`"${people[i]}" "${people[j]}"`);

  return {
    caseName: caseRow?.name ?? "",
    sig: caseRow?.signature ?? "—",
    rosterText: [...podmioty, ...osoby].map((e) => `- ${e.name} [${e.kind ?? "podmiot"}]`).join("\n"),
    gleifText: fmtGleif(gleif),
    aktaText: akta.join("\n\n").slice(0, 42000),
    webText: "",
    queries,
  };
}

// 2) search — Brave po zapytaniach z gather; dołóż webText.
async function stepSearch(ev: Evidence): Promise<Evidence> {
  const web: { q: string; hits: WebHit[] }[] = [];
  for (const q of ev.queries.slice(0, 14)) { const hits = await braveSearch(q); if (hits.length) web.push({ q, hits }); }
  return { ...ev, webText: fmtWeb(web) };
}

// 3) synth — pierwsza wersja analizy.
async function stepSynth(ev: Evidence): Promise<AnalysisJSON> {
  const j = await modelJson<Partial<AnalysisJSON>>(SYSTEM, evidenceBlock(ev) + "\n\nZbuduj analizę OSINT zgodnie ze schematem. Każda relacja z 'source'.");
  return normJson(j, ev);
}

// 4) review — jedna runda: krytyka → doszukanie braków (Brave) → dopracowanie.
async function stepReview(ev: Evidence, analysis: AnalysisJSON): Promise<{ analysis: AnalysisJSON; note: string; converged: boolean; ev: Evidence }> {
  const critique = await modelJson<Partial<Critique>>(
    REVIEW_SYSTEM,
    evidenceBlock(ev) + "\n\nROBOCZA ANALIZA (JSON):\n" + JSON.stringify(analysis).slice(0, 30000) + "\n\nWskaż luki i zapytania.",
    2000,
  );
  const gaps = critique.gaps ?? [], queries = (critique.queries ?? []).slice(0, 6), converged = !!critique.converged;

  // doszukanie braków — celowane wyszukiwania
  let ev2 = ev;
  if (queries.length) {
    const web: { q: string; hits: WebHit[] }[] = [];
    for (const q of queries) { const hits = await braveSearch(q); if (hits.length) web.push({ q, hits }); }
    if (web.length) ev2 = { ...ev, webText: (ev.webText + "\n" + fmtWeb(web)).slice(0, 24000) };
  }
  if (converged && !gaps.length) return { analysis, note: "recenzent: brak istotnych luk", converged: true, ev: ev2 };

  // dopracowanie — model poprawia analizę wg krytyki i nowego materiału
  const refined = await modelJson<Partial<AnalysisJSON>>(
    SYSTEM,
    evidenceBlock(ev2) +
      "\n\nPOPRZEDNIA ANALIZA (JSON) do POPRAWY i UZUPEŁNIENIA:\n" + JSON.stringify(analysis).slice(0, 26000) +
      "\n\nUWAGI RECENZENTA — domknij te luki:\n- " + [...gaps, ...(critique.unsupported ?? [])].slice(0, 20).join("\n- ") +
      "\n\nZwróć PEŁNĄ, poprawioną analizę zgodną ze schematem (zachowaj trafne ustalenia, dodaj brakujące, uzupełnij źródła).",
  );
  return { analysis: normJson(refined, ev2), note: `recenzent: ${gaps.length} luk, ${queries.length} zapytań`, converged, ev: ev2 };
}

// ═════════════════════ ASEMBLER: AnalysisJSON → OsintContent ═════════════════════
function assemble(a: AnalysisJSON, sygn: string): OsintContent {
  const R = (s: string): Run[] => [s];
  const srcBlock = (label: string): Block => ({ t: "src", label: label || "materiał akt sprawy / źródła jawne", url: "https://www.knf.gov.pl" });

  const wnioski: Block[] = [{ t: "p", runs: R(a.clustersIntro || "Zebrany materiał pozwala pogrupować wskazane podmioty i osoby w powiązane klastry.") }];
  for (const c of a.clusters) {
    const rels = a.relations.filter((r) => (r.cluster ?? "").toLowerCase() === c.name.toLowerCase());
    wnioski.push({ t: "p", runs: [{ b: c.name + ". " }, ...R(c.summary)] });
    if (rels.length)
      wnioski.push({ t: "rel", title: c.name, rows: rels.map((r): [string, Run[]] => [`${r.from} ↔ ${r.to}`, [`${r.type ? r.type + ": " : ""}${r.note}`, ...(r.source ? [{ i: `  [źródło: ${r.source}]` } as Run] : [])]]) });
  }
  const orphan = a.relations.filter((r) => !a.clusters.some((c) => c.name.toLowerCase() === (r.cluster ?? "").toLowerCase()));
  if (orphan.length)
    wnioski.push({ t: "rel", title: "Pozostałe ustalone powiązania", rows: orphan.map((r): [string, Run[]] => [`${r.from} ↔ ${r.to}`, [`${r.type ? r.type + ": " : ""}${r.note}`, ...(r.source ? [{ i: `  [źródło: ${r.source}]` } as Run] : [])]]) });
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
      ...a.chains.flatMap((ch): Block[] => [{ t: "h3", text: `${ch.person}${ch.ident ? ` (${ch.ident})` : ""}` }, ...ch.steps.map((s): Block => ({ t: "arrow", runs: R(s) }))]),
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
      sygn, dotyczy: a.emitterName, przedmiot: a.subject,
      podtytul: "Ustalenie powiązań osobowych, kapitałowych i organizacyjnych pomiędzy podmiotami i osobami wskazanymi w aktach sprawy",
      zrodla: "Źródła jawne: KRS · GLEIF · rejestry zagraniczne · media · akta sprawy",
      nazwa: a.emitterName,
    },
    sections,
    graphData: buildGraphData(a),
  };
}
function buildGraphData(a: AnalysisJSON): GraphData {
  const nodeOf = (name: string): GNode => ({ id: name, label: name });
  const inCluster = (name: string) => a.relations.find((r) => r.from === name || r.to === name)?.cluster ?? "";
  const names = new Set<string>();
  a.relations.forEach((r) => { names.add(r.from); names.add(r.to); });
  names.delete(a.emitterName);
  const clusters = (a.clusters.length ? a.clusters.map((c) => c.name) : ["Powiązania"]).map((cn) => ({ name: cn, nodes: [...names].filter((n) => inCluster(n) === cn).map(nodeOf) }));
  const placed = new Set(clusters.flatMap((c) => c.nodes.map((n) => n.id)));
  const rest = [...names].filter((n) => !placed.has(n)).map(nodeOf);
  if (rest.length) (clusters[0] ??= { name: "Powiązania", nodes: [] }).nodes.push(...rest);
  const edges: GEdge[] = a.relations.map((r) => ({ a: r.from, b: r.to, label: r.type, dashed: r.direct === false }));
  return { title: `Graf powiązań — ${a.emitterName}`, center: { id: a.emitterName, label: a.emitterName, sub: "emitent" }, clusters: clusters.filter((c) => c.nodes.length), edges };
}

// ═════════════════════ ORKIESTRACJA (jeden krok na wywołanie) ═════════════════════
async function loadRun(supabase: Supa, caseId: string): Promise<RunState | null> {
  const { data } = await supabase.from("subanalyses").select("data").eq("case_id", caseId).eq("kind", "osint_run").maybeSingle();
  return (data?.data as { run?: RunState } | null)?.run ?? null;
}
async function saveRun(supabase: Supa, caseId: string, run: RunState) {
  await supabase.from("subanalyses").upsert(
    { case_id: caseId, kind: "osint_run", chapter_no: "IV", title: "Analiza OSINT — przebieg (stan)", body_md: `Etap: ${run.stage}, runda ${run.round}.`, data: { run }, status: "szkic" },
    { onConflict: "case_id,kind" },
  );
}
async function saveAnalysis(supabase: Supa, caseId: string, content: OsintContent, stats: Record<string, number>) {
  await supabase.from("subanalyses").upsert(
    {
      case_id: caseId, kind: "osint_analysis", chapter_no: "IV", title: "Analiza OSINT (agent)",
      body_md: `Analiza OSINT (agent, ${stats.rounds} rund recenzenta): ${stats.relations} powiązań w ${stats.clusters} klastrach, ${content.sections.length} rozdziałów. Każde powiązanie z cytowanym źródłem; niepewne oznaczone „(do potwierdzenia)”.`,
      data: { content }, status: "szkic",
    },
    { onConflict: "case_id,kind" },
  );
}

// Wykonuje JEDEN krok bieżącego przebiegu; `restart` wymusza start od nowa.
export async function advanceRun(supabase: Supa, caseId: string, restart = false): Promise<AdvanceResult> {
  let run = restart ? null : await loadRun(supabase, caseId);

  if (!run || run.stage === "done") {
    const evidence = await stepGather(supabase, caseId);
    run = { stage: "search", round: 0, evidence, analysis: null, notes: [] };
    await saveRun(supabase, caseId, run);
    return { stage: "search", round: 0, done: false, note: `Zebrano materiał: ${(evidence.aktaText.match(/### /g) ?? []).length} dok. akt, ${(evidence.gleifText.match(/\n/g) ?? []).length + (evidence.gleifText ? 1 : 0)} GLEIF, ${evidence.queries.length} zapytań do web.` };
  }

  switch (run.stage) {
    case "search": {
      run.evidence = await stepSearch(run.evidence);
      run.stage = "synth";
      await saveRun(supabase, caseId, run);
      return { stage: "synth", round: 0, done: false, note: `Wyszukiwania web: ${(run.evidence.webText.match(/^# /gm) ?? []).length} zapytań z wynikami.` };
    }
    case "synth": {
      run.analysis = await stepSynth(run.evidence);
      run.stage = "review"; run.round = 0;
      await saveRun(supabase, caseId, run);
      return { stage: "review", round: 0, done: false, note: `Synteza: ${run.analysis.relations.length} powiązań, ${run.analysis.clusters.length} klastrów.` };
    }
    case "review": {
      const res = await stepReview(run.evidence, run.analysis!);
      run.analysis = res.analysis; run.evidence = res.ev; run.round += 1; run.notes.push(res.note);
      const stop = res.converged || run.round >= MAX_ROUNDS;
      run.stage = stop ? "finalize" : "review";
      await saveRun(supabase, caseId, run);
      return { stage: run.stage, round: run.round, done: false, note: `${res.note} (runda ${run.round}/${MAX_ROUNDS})` };
    }
    case "finalize": {
      const a = run.analysis!;
      const content = assemble(a, run.evidence.sig);
      const stats = { relations: a.relations.length, clusters: a.clusters.length, rounds: run.round };
      await saveAnalysis(supabase, caseId, content, stats);
      run.stage = "done";
      await saveRun(supabase, caseId, run);
      return { stage: "done", round: run.round, done: true, note: `Gotowe: ${a.relations.length} powiązań w ${a.clusters.length} klastrach, ${run.round} rund recenzenta.`, stats };
    }
    default:
      return { stage: "done", round: run.round, done: true, note: "Zakończono." };
  }
}
