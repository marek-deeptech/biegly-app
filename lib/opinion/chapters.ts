// Plan rozdziału IV (ANALIZA) per sprawa — konfigurowalny zestaw i kolejność.
//
// Zweryfikowane na finalnych opiniach KM: szkielet I–VI jest stały, a rdzeń IV
// (rozdziały 1–7) różni się między sprawami zestawem i kolejnością technik.
// Numer „IV.x" przypisuje TU plan sprawy — buildery nie zaszywają go na sztywno.

export type IVKind =
  | "ekofin"
  | "espi"
  | "aktywnosc"
  | "relacje"
  | "wash"
  | "imo"
  | "layering"
  | "pumpdump";

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
  return planChapter(caseName, kind)?.title ?? kind;
}

// Techniki manipulacji obecne w planie sprawy (do rozdz. III i Wniosków).
export function planTechniques(caseName: string): IVKind[] {
  return casePlan(caseName)
    .map((c) => c.kind)
    .filter((k) => TECH_KINDS.includes(k));
}

// Techniczne rodzaje rozdziałów (uzasadnienia technik manipulacji).
export const TECH_KINDS: IVKind[] = ["wash", "imo", "layering", "pumpdump"];

const IV_TITLE: Record<IVKind, string> = {
  ekofin: "Analiza ekonomiczno-finansowa oraz otoczenia rynkowego",
  espi: "Analiza raportów bieżących w systemie ESPI i EBI",
  aktywnosc: "Aktywność podmiotów z Grupy",
  relacje: "Identyfikacja relacji pomiędzy podmiotami z Grupy",
  wash: "Wash trades",
  imo: "Improper matched orders",
  layering: "Layering and spoofing",
  pumpdump: "Pump and dump",
};

// Plan IV budowany z technik wybranych w A2 (z dowodów), nie z presetu.
// Stały szkielet: ekon-fin, ESPI/EBI, aktywność, [techniki], relacje.
export function buildPlanFromTechniques(techniques: IVKind[]): IVChapter[] {
  const order: IVKind[] = [
    "ekofin",
    "espi",
    "aktywnosc",
    ...TECH_KINDS.filter((k) => techniques.includes(k)),
    "relacje",
  ];
  return order.map((kind, i) => ({ kind, no: `IV.${i + 1}`, title: IV_TITLE[kind] }));
}

// Plan sprawy: z wyboru technik (A2) jeśli jest; inaczej preset (Hub/MLM/domyślny).
export function resolvePlan(caseName: string, selected?: IVKind[] | null): IVChapter[] {
  const techs = (selected ?? []).filter((k) => TECH_KINDS.includes(k));
  return techs.length ? buildPlanFromTechniques(techs) : casePlan(caseName);
}
