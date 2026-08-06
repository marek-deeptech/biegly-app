// Plan rozdziału IV (ANALIZA) per sprawa — konfigurowalny zestaw i kolejność.
//
// WZORZEC-MATKA (zweryfikowany na OBU finalnych opiniach KM — HUBTECH i MLM,
// identyczna powłoka co do słowa):
//   I.  Przedmiot i podstawa prawna opinii      [stałe]
//   II. Wnioski                                 [stałe]
//   III.Wstęp — ujęcie teoretyczne              [stałe]
//   IV. Analiza:
//        1. ekonomiczno-finansowa, 2. ESPI/EBI  [zawsze, w tej kolejności]
//        3..N. moduły z katalogu per sprawa     [dowody decydują — dobór w A2]
//        + relacje (wcześnie lub jako synteza — patrz buildPlanFromTechniques)
//   V.  Podsumowanie                            [stałe]
//   VI. Spis tabel i wykresów                   [stałe]
// Różnica między sprawami to WYŁĄCZNIE dobór modułów IV, nie konstrukcja
// dokumentu. Numer „IV.x" przypisuje TU plan sprawy — buildery nie zaszywają
// go na sztywno.

export type IVKind =
  | "ekofin"
  | "espi"
  | "aktywnosc"
  | "relacje"
  | "wash"
  | "imo"
  | "layering"
  | "pumpdump"
  | "fixing"
  | "reversal"
  | "concentration"
  | "infomanip";

export type IVChapter = { kind: IVKind; no: string; title: string; perSession?: boolean };

// HubTech (90 s.): 1 ekon-fin, 2 ESPI/EBI, 3 aktywność grupy, 4 wash, 5 IMO,
// 6 layering, 7 relacje.
const HUBTECH: IVChapter[] = [
  { kind: "ekofin", no: "IV.1", title: "Analiza ekonomiczno-finansowa oraz otoczenia rynkowego" },
  { kind: "espi", no: "IV.2", title: "Analiza raportów bieżących w systemie ESPI i EBI" },
  { kind: "aktywnosc", no: "IV.3", title: "Aktywność podmiotów z Grupy" },
  { kind: "wash", no: "IV.4", title: "Wash trades" },
  { kind: "imo", no: "IV.5", title: "Improper matched orders" },
  { kind: "layering", no: "IV.6", title: "Layering and spoofing" },
  { kind: "relacje", no: "IV.7", title: "Identyfikacja relacji pomiędzy podmiotami z Grupy" },
];

// MLM (134 s.): 1 ekon-fin, 2 ESPI/EBI, 3 relacje, 4 layering (10 sesji osobno),
// 5 wash, 6 pump&dump.
const MLM: IVChapter[] = [
  { kind: "ekofin", no: "IV.1", title: "Analiza ekonomiczno-finansowa oraz otoczenia rynkowego" },
  { kind: "espi", no: "IV.2", title: "Analiza raportów bieżących w systemie ESPI i EBI" },
  { kind: "relacje", no: "IV.3", title: "Identyfikacja relacji pomiędzy podmiotami z Grupy" },
  { kind: "layering", no: "IV.4", title: "Layering & spoofing", perSession: true },
  { kind: "wash", no: "IV.5", title: "Wash trades" },
  { kind: "pumpdump", no: "IV.6", title: "Pump and dump" },
];

// Domyślny plan (sprawa nierozpoznana) — kanoniczny superzbiór w naturalnej kolejności.
const DEFAULT: IVChapter[] = [
  { kind: "ekofin", no: "IV.1", title: "Analiza ekonomiczno-finansowa oraz otoczenia rynkowego" },
  { kind: "espi", no: "IV.2", title: "Analiza raportów bieżących w systemie ESPI i EBI" },
  { kind: "aktywnosc", no: "IV.3", title: "Aktywność podmiotów z Grupy" },
  { kind: "wash", no: "IV.4", title: "Wash trades" },
  { kind: "imo", no: "IV.5", title: "Improper matched orders" },
  { kind: "layering", no: "IV.6", title: "Layering and spoofing" },
  { kind: "relacje", no: "IV.7", title: "Identyfikacja relacji pomiędzy podmiotami z Grupy" },
];

export function casePlan(caseName: string): IVChapter[] {
  const n = (caseName || "").toUpperCase();
  if (n.includes("HUB")) return HUBTECH;
  if (n.includes("MLM") || n.includes("MILISYS")) return MLM;
  return DEFAULT;
}

export function planChapter(caseName: string, kind: IVKind): IVChapter | null {
  return casePlan(caseName).find((c) => c.kind === kind) ?? null;
}

export function chapterNoFor(caseName: string, kind: IVKind): string {
  return planChapter(caseName, kind)?.no ?? "IV";
}

export function chapterTitleFor(caseName: string, kind: IVKind): string {
  return planChapter(caseName, kind)?.title ?? IV_TITLE[kind] ?? kind;
}

// Techniki manipulacji obecne w planie sprawy (do rozdz. III i Wniosków).
export function planTechniques(caseName: string): IVKind[] {
  return casePlan(caseName)
    .map((c) => c.kind)
    .filter((k) => TECH_KINDS.includes(k));
}

// Techniczne rodzaje rozdziałów (uzasadnienia technik manipulacji).
// Kolejność = kolejność na liście w A2: katalog bazowy KM, potem detektory
// wskaźnikowe zał. I MAR (fixing lit. g, odwrócenie lit. d, koncentracja lit. e)
// i manipulacja informacją (cross-link ESPI ↔ reakcja kursu).
export const TECH_KINDS: IVKind[] = [
  "wash",
  "imo",
  "layering",
  "pumpdump",
  "fixing",
  "reversal",
  "concentration",
  "infomanip",
];

// Katalog modułów IV wybieralnych per sprawa (A2). „aktywnosc" to moduł
// przeglądowy, nie technika MAR: KM użył go w HUBTECH (12 sesji — pełny
// przegląd wykonalny), pominął w MLM (101 sesji — przegląd zastępuje analiza
// per technika, layering sesja-po-sesji).
export const CATALOG_KINDS: IVKind[] = ["aktywnosc", ...TECH_KINDS];

const IV_TITLE: Record<IVKind, string> = {
  ekofin: "Analiza ekonomiczno-finansowa oraz otoczenia rynkowego",
  espi: "Analiza raportów bieżących w systemie ESPI i EBI",
  aktywnosc: "Aktywność podmiotów z Grupy",
  relacje: "Identyfikacja relacji pomiędzy podmiotami z Grupy",
  wash: "Wash trades",
  imo: "Improper matched orders",
  layering: "Layering and spoofing",
  pumpdump: "Pump and dump",
  fixing: "Manipulacja na fixingu (marking the close)",
  reversal: "Odwrócenie pozycji w krótkim okresie",
  concentration: "Koncentracja zleceń w krótkim odcinku sesji",
  infomanip: "Manipulacja informacją",
};

// Plan IV budowany z modułów wybranych w A2 (z dowodów), nie z presetu.
//
// SZKIELET ROZDZIAŁU IV JEST STAŁY, ZMIENNE SĄ TYLKO TECHNIKI:
//   IV.1 ekon-fin, IV.2 ESPI/EBI, IV.3 aktywność Grupy — zawsze;
//   dalej rozdziały technik w kolejności wyboru (tyle, ile wykryto);
//   na końcu relacje między podmiotami — jako synteza.
//
// ⚠️ „AKTYWNOŚĆ" I „RELACJE" TO ROZDZIAŁY STRUKTURALNE, NIE TECHNIKI. Wcześniej
// obie wchodziły do planu tylko wtedy, gdy znalazły się na liście wybranych modułów,
// przez co w sprawie ZASTAL (dobór A2: wash, pumpdump, layering) rozdział o
// aktywności Grupy — z tabelami obrotu i atrybucją per podmiot — NIE WSZEDŁ DO
// OPINII WCALE, a relacje przeskoczyły na IV.3. Wydruk wyglądał na kompletny, bo
// numeracja była ciągła. Dobór technik ma rozstrzygać, KTÓRE techniki opisujemy,
// a nie czy opinia zawiera opis obrotu badanych podmiotów.
export function buildPlanFromTechniques(selected: IVKind[]): IVChapter[] {
  const mods = selected.filter((k) => CATALOG_KINDS.includes(k));
  const STRUKTURALNE: IVKind[] = ["ekofin", "espi", "aktywnosc", "relacje"];
  const techs = mods.filter((k) => !STRUKTURALNE.includes(k));
  const order: IVKind[] = ["ekofin", "espi", "aktywnosc", ...techs, "relacje"];
  return order.map((kind, i) => ({ kind, no: `IV.${i + 1}`, title: IV_TITLE[kind] }));
}

// Plan sprawy: z wyboru modułów (A2) jeśli jest; inaczej preset (Hub/MLM/domyślny).
export function resolvePlan(caseName: string, selected?: IVKind[] | null): IVChapter[] {
  const mods = (selected ?? []).filter((k) => CATALOG_KINDS.includes(k));
  return mods.length ? buildPlanFromTechniques(mods) : casePlan(caseName);
}
