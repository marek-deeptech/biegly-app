// Deterministyczny montaż opinii z subanaliz.
//
// Zasada: LLM NIE LICZY. Wszystkie liczby pochodzą z silnika faktów (tabela
// `metrics`); proza jest szablonowa. Szkielet I–VI jest stały; rdzeń IV (1–7)
// układa plan sprawy (lib/opinion/chapters.ts). Opinia montuje się z
// ZATWIERDZONYCH subanaliz (tabela `subanalyses`); rozdział bez subanalizy
// pokazuje miejsce w strukturze oznaczone jako „do wygenerowania".

import {
  LEGAL_REFS,
  PROSECUTOR_QUESTIONS,
  TECHNIQUES,
  techniqueRef,
  type TechniqueId,
} from "./legal";
import {
  casePlan,
  chapterNoFor,
  chapterTitleFor,
  planTechniques,
  resolvePlan,
  type IVChapter,
  type IVKind,
} from "./chapters";

export type Conf = "grounded" | "review" | "todo";
export type Para = { text: string; conf: Conf };
export type OpTable = { caption: string; head: string[]; rows: string[][] };
export type Chapter = {
  no: string;
  title: string;
  status: "ready" | "draft" | "todo";
  source?: string;
  paras: Para[];
  table?: OpTable;
  tables?: OpTable[]; // wiele tabel numerowanych w jednym rozdziale (np. OHLC + sprzedaż + kupno)
  findings?: Para[];
  attachments?: string[];
};
export type Opinion = {
  caseName: string;
  signature: string | null;
  expert: string;
  generatedAt: string;
  legalBasis: string[];
  chapters: Chapter[];
};

// Wynik generatora subanalizy (do zapisania w `subanalyses`).
export type SubResult = {
  kind: string;
  chapterNo: string;
  title: string;
  bodyMd: string;
  data: { table: OpTable | null; tables?: OpTable[]; findings: string[]; legalRefs: string[] };
};
export type QuantResult = SubResult;

// Zapisana subanaliza (z tabeli `subanalyses`).
export type StoredSub = {
  kind: string;
  chapter_no: string;
  title: string;
  status: string; // 'szkic' | 'zatwierdzona'
  body_md: string;
  data: { table?: OpTable | null; tables?: OpTable[]; findings?: string[]; legalRefs?: string[] } | null;
};

type Metric = {
  key: string;
  value: number | null;
  unit: string | null;
  session_day: string | null;
};
type Doc = { rel_path: string; provenance: string | null; doc_type?: string | null };

// Dynamika kursu z notowania-engine (lib/quotes/parse.ts).
export type QuoteDyn = {
  from: string;
  to: string;
  start: number;
  end: number;
  maxClose: number;
  peakDate: string;
  changeStartMaxPct: number;
  changeStartEndPct: number;
};

const EXPERT = "mgr Krzysztof Michrowski — biegły sądowy";
const LEGAL_BASIS = [
  "art. 12 rozporządzenia MAR (UE) 596/2014 — definicja manipulacji na rynku",
  "rozporządzenie delegowane (UE) 2016/522, załącznik II — wskaźniki manipulacji",
  "art. 183 ustawy z dnia 29 lipca 2005 r. o obrocie instrumentami finansowymi",
];

// ── pomocnicze ───────────────────────────────────────────────────────────────
function plnum(n: number | null | undefined, unit?: string | null): string {
  if (n == null) return "—";
  const s = n.toLocaleString("pl-PL");
  if (unit === "%") return `${s}%`;
  return unit ? `${s} ${unit}` : s;
}
function basename(p: string): string {
  return p.split("/").pop() || p;
}
function splitParas(md: string): string[] {
  return md.split(/\n\n+/).map((s) => s.trim()).filter(Boolean);
}
function mfind(metrics: Metric[], key: string): Metric | null {
  return metrics.find((m) => m.key === key) ?? null;
}
function mpeak(metrics: Metric[], prefix: string): Metric | null {
  return metrics
    .filter((m) => m.key.startsWith(prefix))
    .reduce<Metric | null>((a, b) => ((b.value ?? -1) > (a?.value ?? -1) ? b : a), null);
}
function mdays(metrics: Metric[]): string[] {
  return [...new Set(metrics.filter((m) => m.session_day).map((m) => m.session_day as string))].sort();
}
function periodOf(metrics: Metric[]): string {
  const d = mdays(metrics);
  return d.length ? `od ${d[0]} do ${d[d.length - 1]}` : "[okres do uzupełnienia]";
}
function docList(ds: Doc[], n = 15): string {
  return (
    ds.slice(0, n).map((d) => "• " + basename(d.rel_path)).join("\n") +
    (ds.length > n ? `\n• … (+${ds.length - n})` : "")
  );
}
function byType(documents: Doc[], t: string): Doc[] {
  return documents.filter((d) => d.doc_type === t);
}

// Tabela dzienna wskaźnika (np. wash/cancel) — wprost z metryk silnika.
function dailyTable(metrics: Metric[], prefix: string, caption: string, col: string): OpTable | null {
  const days = mdays(metrics);
  if (!days.length) return null;
  return {
    caption,
    head: ["Sesja", col],
    rows: days.map((d) => {
      const m = metrics.find((x) => x.session_day === d && x.key.startsWith(prefix));
      return [d, m ? plnum(m.value, "%") : "—"];
    }),
  };
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// Pivot metryk per podmiot (ent_sell_share/val/vol::) → lista podmiotów.
type EntRow = { entity: string; share: number | null; val: number | null; vol: number | null };
function pivotEntities(metrics: Metric[]): EntRow[] {
  const map = new Map<string, { share: number | null; val: number | null; vol: number | null }>();
  const get = (e: string) => map.get(e) ?? { share: null, val: null, vol: null };
  for (const m of metrics) {
    if (m.key.startsWith("ent_sell_share::")) {
      const e = m.key.split("::")[1];
      map.set(e, { ...get(e), share: m.value });
    } else if (m.key.startsWith("ent_sell_val::")) {
      const e = m.key.split("::")[1];
      map.set(e, { ...get(e), val: m.value });
    } else if (m.key.startsWith("ent_sell_vol::")) {
      const e = m.key.split("::")[1];
      map.set(e, { ...get(e), vol: m.value });
    }
  }
  return [...map.entries()]
    .map(([entity, v]) => ({ entity, ...v }))
    .sort((a, b) => (b.share ?? -1) - (a.share ?? -1));
}

function entityTable(metrics: Metric[]): OpTable | null {
  const ents = pivotEntities(metrics);
  if (!ents.length) return null;
  return {
    caption: "Tabela. Zestawienie per podmiot z Grupy — strona sprzedaży (wartość, udział i wolumen)",
    head: ["Podmiot", "Wartość sprzedaży (zł)", "Udział sprzedaży", "Wolumen sprzedaży"],
    rows: ents.map((e) => [cap(e.entity), plnum(e.val, "zł"), plnum(e.share, "%"), plnum(e.vol, "szt")]),
  };
}

function topSeller(metrics: Metric[]): EntRow | null {
  const ents = pivotEntities(metrics);
  return ents.length ? ents[0] : null;
}

// Pivot per podmiot po stronie KUPNA (ent_buy_share/val/vol::), sortowany wartością.
function pivotEntitiesBuy(metrics: Metric[]): EntRow[] {
  const map = new Map<string, { share: number | null; val: number | null; vol: number | null }>();
  const get = (e: string) => map.get(e) ?? { share: null, val: null, vol: null };
  for (const m of metrics) {
    if (m.key.startsWith("ent_buy_share::")) {
      const e = m.key.split("::")[1];
      map.set(e, { ...get(e), share: m.value });
    } else if (m.key.startsWith("ent_buy_val::")) {
      const e = m.key.split("::")[1];
      map.set(e, { ...get(e), val: m.value });
    } else if (m.key.startsWith("ent_buy_vol::")) {
      const e = m.key.split("::")[1];
      map.set(e, { ...get(e), vol: m.value });
    }
  }
  return [...map.entries()]
    .map(([entity, v]) => ({ entity, ...v }))
    .sort((a, b) => (b.val ?? -1) - (a.val ?? -1));
}

function entityBuyTable(metrics: Metric[]): OpTable | null {
  const ents = pivotEntitiesBuy(metrics).filter((e) => (e.val ?? 0) > 0);
  if (!ents.length) return null;
  return {
    caption: "Tabela. Zestawienie per podmiot z Grupy — strona kupna (wartość, udział i wolumen)",
    head: ["Podmiot", "Wartość kupna (zł)", "Udział kupna", "Wolumen kupna"],
    rows: ents.map((e) => [cap(e.entity), plnum(e.val, "zł"), plnum(e.share, "%"), plnum(e.vol, "szt")]),
  };
}

function topBuyer(metrics: Metric[]): EntRow | null {
  const ents = pivotEntitiesBuy(metrics);
  return ents.length ? ents[0] : null;
}

// Kurs (OHLC) i wolumen instrumentu per sesja — odpowiednik „Tabeli nr 8" z opinii.
function ohlcTable(metrics: Metric[]): OpTable | null {
  const days = [...new Set(metrics.filter((m) => m.key === "day_close").map((m) => m.session_day as string))].sort();
  if (!days.length) return null;
  const at = (k: string, d: string) => metrics.find((m) => m.key === k && m.session_day === d)?.value ?? null;
  return {
    caption:
      "Tabela. Kurs (OHLC) i wolumen instrumentu per sesja — zmiana kursu zamknięcia względem poprzedniej sesji objętej analizą",
    head: ["Sesja", "Otwarcie", "Najwyższy", "Najniższy", "Zamknięcie", "Zmiana", "Wolumen sesji"],
    rows: days.map((d) => {
      const pct = at("day_change_pct", d);
      return [
        d,
        plnum(at("day_open", d), "zł"),
        plnum(at("day_high", d), "zł"),
        plnum(at("day_low", d), "zł"),
        plnum(at("day_close", d), "zł"),
        pct == null ? "—" : `${pct > 0 ? "+" : ""}${plnum(pct, "%")}`,
        plnum(at("day_sess_vol", d), "szt"),
      ];
    }),
  };
}

// Saldo Grupy per sesja — wolumen (pozycja) i gotówka (przychód), dziennie i skumulowane.
// Sygnatura akumulacja→wyprzedaż: skumulowany przychód rośnie w fazie dystrybucji.
function saldoTable(metrics: Metric[]): OpTable | null {
  const days = [...new Set(metrics.filter((m) => m.key === "day_grp_cum_cash").map((m) => m.session_day as string))].sort();
  if (!days.length) return null;
  const at = (k: string, d: string) => metrics.find((m) => m.key === k && m.session_day === d)?.value ?? null;
  return {
    caption:
      "Tabela. Saldo Grupy per sesja — wolumen (pozycja: kupno−sprzedaż) i gotówka (przychód: sprzedaż−kupno), dziennie oraz skumulowane",
    head: ["Sesja", "Saldo wol. dnia", "Skum. wolumen (pozycja)", "Saldo got. dnia (zł)", "Skum. przychód (zł)"],
    rows: days.map((d) => [
      d,
      plnum(at("day_grp_net_vol", d), "szt"),
      plnum(at("day_grp_cum_vol", d), "szt"),
      plnum(at("day_grp_net_cash", d), "zł"),
      plnum(at("day_grp_cum_cash", d), "zł"),
    ]),
  };
}

// Bogata tabela dzienna wash (odpowiednik Tab 24–28): sesja × wolumen/wartość/udziały.
function washDailyTable(metrics: Metric[]): OpTable | null {
  const days = [...new Set(metrics.filter((m) => m.key === "day_sess_vol").map((m) => m.session_day as string))].sort();
  if (!days.length) return null;
  const at = (k: string, d: string) => metrics.find((m) => m.key === k && m.session_day === d)?.value ?? null;
  const washOf = (d: string) => metrics.find((m) => m.session_day === d && m.key.startsWith("wash_"))?.value ?? null;
  return {
    caption: "Tabela. Obrót Grupy i wewnątrzgrupowy per sesja (wolumen, wartość, udziały)",
    head: ["Sesja", "Wolumen sesji", "Wolumen wewnątrzgr.", "Wash %", "Wartość Grupy (zł)", "Udział Grupy wart."],
    rows: days.map((d) => {
      const sval = at("day_sess_val", d);
      const gval = at("day_grp_val", d);
      const gshare = gval != null && sval ? Math.round((gval / sval) * 10000) / 100 : null;
      return [
        d,
        plnum(at("day_sess_vol", d), "szt"),
        plnum(at("day_intra_vol", d), "szt"),
        plnum(washOf(d), "%"),
        plnum(gval, "zł"),
        plnum(gshare, "%"),
      ];
    }),
  };
}

// Pivot layering per sesja i podmiot (lay_share:: / lay_cancelled::) → tabela.
function layeringSessionTable(metrics: Metric[]): OpTable | null {
  type Row = { day: string; entity: string; share: number | null; cancelled: number | null };
  const map = new Map<string, Row>();
  const get = (day: string, e: string): Row =>
    map.get(day + "|" + e) ?? { day, entity: e, share: null, cancelled: null };
  for (const m of metrics) {
    if (!m.session_day) continue;
    if (m.key.startsWith("lay_share::")) {
      const e = m.key.split("::")[1];
      map.set(m.session_day + "|" + e, { ...get(m.session_day, e), share: m.value });
    } else if (m.key.startsWith("lay_cancelled::")) {
      const e = m.key.split("::")[1];
      map.set(m.session_day + "|" + e, { ...get(m.session_day, e), cancelled: m.value });
    }
  }
  const rows = [...map.values()];
  if (!rows.length) return null;
  rows.sort((a, b) => (a.day === b.day ? (b.cancelled ?? -1) - (a.cancelled ?? -1) : a.day.localeCompare(b.day)));
  return {
    caption: "Tabela. Layering & spoofing per sesja i podmiot — anulowany wolumen kupna",
    head: ["Sesja", "Podmiot", "Anulowano (szt)", "Udział anulacji"],
    rows: rows.map((r) => [r.day, cap(r.entity), plnum(r.cancelled, "szt"), plnum(r.share, "%")]),
  };
}

// ── Rozdziały IV — buildery techniczne (szablon 7-częściowy KM) ───────────────

function ivMeta(caseName: string, kind: IVKind): { no: string; title: string } {
  return { no: chapterNoFor(caseName, kind), title: chapterTitleFor(caseName, kind) };
}

// IV.x — Wash trades (sztuczny obrót). Liczby: wash_{dzień} + udział Grupy.
function buildWashSubanaliza(caseName: string, metrics: Metric[]): SubResult {
  const { no, title } = ivMeta(caseName, "wash");
  const t = TECHNIQUES.wash;
  const washPeak = mpeak(metrics, "wash_");
  const groupShare = mfind(metrics, "group_turnover_share");
  const top = topSeller(metrics);
  const sec: string[] = [];
  sec.push(
    `Poniżej biegły dokonał analizy transakcji dokonanych przez członków Grupy pod kątem ` +
      `współdziałania w generowaniu sztucznego obrotu oraz transakcji wzajemnych (por. rozdz. III).`,
  );
  sec.push(
    top
      ? `Kluczowe podmioty. Największy udział w wartości sprzedaży miał podmiot ${cap(top.entity)} ` +
        `(${plnum(top.share, "%")}, wolumen ${plnum(top.vol, "szt")}); pełne zestawienie per podmiot ` +
        `znajduje się w rozdziale aktywności/relacji Grupy.`
      : `Kluczowe podmioty po stronie kupna i sprzedaży. [Do uzupełnienia z tabel per podmiot — policz wskaźniki.]`,
  );
  sec.push(
    `Poniższa tabela prezentuje udział transakcji wewnątrzgrupowych (wash trades) w wolumenie ` +
      `sesji w poszczególnych dniach. ` +
      (groupShare?.value != null
        ? `Łączny udział rachunków Grupy w wartości obrotu instrumentem wyniósł ${plnum(groupShare.value, "%")}. `
        : ``) +
      (washPeak?.value != null
        ? `Apogeum udziału transakcji wewnątrzgrupowych przypada na sesję ${washPeak.session_day} i ` +
          `wynosi ${plnum(washPeak.value, "%")} wolumenu sesyjnego.`
        : `[Do uzupełnienia: brak policzonych wskaźników wash — policz wskaźniki na zakładce Analiza liczbowa.]`),
  );
  sec.push(
    `Transakcje wzajemne nie powodują zmiany rzeczywistego właściciela ekonomicznego instrumentu i ` +
      `stanowią pozorny obrót (${t.mar}; ${t.rd}). Zgodnie z ${LEGAL_REFS.manipulacja} koncentracja ` +
      `wolumenu w relacjach między podmiotami powiązanymi podlega ocenie jako generująca mylące ` +
      `sygnały rynkowe.`,
  );
  sec.push(
    `Obrót wewnątrzgrupowy pełnił rolę pomocniczą wobec sprzedaży kierowanej na rynek zewnętrzny; ` +
      `zagadnienie anulowania zleceń kupna omówiono w części dotyczącej layering & spoofing.`,
  );
  const findings: string[] = [];
  if (washPeak?.value != null)
    findings.push(
      `Transakcje wzajemne (wash trades) sięgały ${plnum(washPeak.value, "%")} wolumenu sesji ` +
        `(${washPeak.session_day}) — pozorny obrót mylący co do płynności.`,
    );
  if (groupShare?.value != null)
    findings.push(`Udział Grupy w wartości obrotu: ${plnum(groupShare.value, "%")}.`);
  return {
    kind: "wash",
    chapterNo: no,
    title,
    bodyMd: sec.join("\n\n"),
    data: {
      table:
        washDailyTable(metrics) ??
        dailyTable(
          metrics,
          "wash_",
          "Tabela. Udział transakcji wewnątrzgrupowych (wash trades) w wolumenie sesji",
          "Wash-trades (% wolumenu)",
        ),
      findings,
      legalRefs: [t.mar, t.rd, LEGAL_REFS.manipulacja],
    },
  };
}

// IV.x — Layering & spoofing. Liczby: cancel_{dzień} (anulacje kupna Grupy).
function buildLayeringSubanaliza(caseName: string, metrics: Metric[], perSession = false): SubResult {
  const { no, title } = ivMeta(caseName, "layering");
  const t = TECHNIQUES.layering;
  const cancelPeak = mpeak(metrics, "cancel_");
  const sec: string[] = [];
  sec.push(
    `Analiza dotyczy składania przez podmioty z Grupy zleceń kupna o znacznym wolumenie, które ` +
      `następnie były anulowane przed realizacją (por. rozdz. III) — ${t.mar}; ${t.rd}.`,
  );
  sec.push(
    `Poniższa tabela prezentuje udział anulowanego wolumenu w zadeklarowanym wolumenie kupna Grupy ` +
      `w poszczególnych sesjach. ` +
      (cancelPeak?.value != null
        ? `Największe anulowanie zleceń kupna przypada na sesję ${cancelPeak.session_day} i wynosi ` +
          `${plnum(cancelPeak.value, "%")} zadeklarowanego wolumenu kupna.`
        : `[Do uzupełnienia: brak policzonych wskaźników anulacji — policz wskaźniki na zakładce Analiza liczbowa.]`),
  );
  if (perSession)
    sec.push(
      `Analiza prowadzona jest sesja po sesji — dla każdej sesji giełdowej objętej postanowieniem ` +
        `sporządza się odrębne zestawienie aktywności (załącznik per sesja). [Do uzupełnienia: rozbicie ` +
        `na sesje z tabelami aktywności poszczególnych podmiotów — z rozszerzenia silnika.]`,
    );
  sec.push(
    `Składanie i niezwłoczne anulowanie zleceń bez zamiaru ich realizacji wywołuje mylne wrażenie ` +
      `popytu lub podaży i wprowadza uczestników rynku w błąd co do rzeczywistej relacji popytu i podaży.`,
  );
  const findings: string[] = [];
  if (cancelPeak?.value != null)
    findings.push(
      `Anulacje zleceń kupna Grupy sięgały ${plnum(cancelPeak.value, "%")} zadeklarowanego wolumenu ` +
        `(${cancelPeak.session_day}) — sygnał techniki layering & spoofing.`,
    );
  return {
    kind: "layering",
    chapterNo: no,
    title,
    bodyMd: sec.join("\n\n"),
    data: {
      table:
        (perSession ? layeringSessionTable(metrics) : null) ??
        dailyTable(
          metrics,
          "cancel_",
          "Tabela. Udział anulowanego wolumenu w zadeklarowanym wolumenie kupna Grupy",
          "Anulacje kupna (%)",
        ),
      findings,
      legalRefs: [t.mar, t.rd],
    },
  };
}

// IV.x — Improper matched orders. Silnik nie liczy jeszcze czasu dopasowań → szkielet.
function buildImoSubanaliza(caseName: string, metrics: Metric[]): SubResult {
  void metrics;
  const { no, title } = ivMeta(caseName, "imo");
  const t = TECHNIQUES.imo;
  const sec: string[] = [
    `Analiza czasu zawieranych transakcji pod kątem wzajemnego dopasowania zleceń (${t.mar}; ${t.rd}).`,
    `Praktyka przejawia się składaniem zleceń o identycznych lub zbliżonych parametrach (wolumen, cena) ` +
      `w krótkich odstępach czasu, z rachunków pozostających pod kontrolą lub działających w porozumieniu.`,
    `[Do uzupełnienia z rozszerzenia silnika: pary zleceń kupna/sprzedaży o zbliżonych parametrach i ` +
      `bliskim czasie złożenia (analiza czasu), wraz z rachunkami stron.]`,
  ];
  return {
    kind: "imo",
    chapterNo: no,
    title,
    bodyMd: sec.join("\n\n"),
    data: { table: null, findings: [], legalRefs: [t.mar, t.rd] },
  };
}

// IV.x — Pump and dump. Faza pompowania/wyprzedaży; liczby z dynamiki kursu.
function buildPumpDumpSubanaliza(caseName: string, metrics: Metric[], quotes?: QuoteDyn | null): SubResult {
  void metrics;
  const { no, title } = ivMeta(caseName, "pumpdump");
  const t = TECHNIQUES.pumpdump;
  const sec: string[] = [
    `Schemat pump and dump (${t.mar}; ${t.rd}): zajęcie pozycji długiej, sztuczne wywindowanie ceny, ` +
      `a następnie wyprzedaż pakietu po zawyżonym kursie.`,
  ];
  if (quotes)
    sec.push(
      `Dynamika kursu w okresie od ${quotes.from} do ${quotes.to}: wzrost z ${plnum(quotes.start, "zł")} ` +
        `do maksimum ${plnum(quotes.maxClose, "zł")} (${quotes.peakDate}) — o ${plnum(quotes.changeStartMaxPct, "%")}; ` +
        `kurs na koniec okresu ${plnum(quotes.end, "zł")} (${plnum(quotes.changeStartEndPct, "%")} względem początku).`,
    );
  else
    sec.push(`[Do uzupełnienia: dynamika kursu (kurs początkowy, maksymalny, data szczytu, skala wzrostu) — z pliku notowań.]`);
  sec.push(
    `[Do uzupełnienia: identyfikacja fazy „pompowania" (kupno + pozytywne komunikaty) oraz fazy ` +
      `wyprzedaży pakietu przez podmioty z Grupy, w powiązaniu z raportami bieżącymi spółki.]`,
  );
  return {
    kind: "pumpdump",
    chapterNo: no,
    title,
    bodyMd: sec.join("\n\n"),
    data: { table: null, findings: [], legalRefs: [t.mar, t.rd] },
  };
}

// IV.x — Aktywność podmiotów z Grupy (skala obecności + dynamika kursu + saldo).
function buildAktywnoscSubanaliza(caseName: string, metrics: Metric[], documents: Doc[] = []): SubResult {
  const { no, title } = ivMeta(caseName, "aktywnosc");
  const nTx = mfind(metrics, "totals_transactions");
  const valTx = mfind(metrics, "totals_value");
  const volTx = mfind(metrics, "totals_volume");
  const groupShare = mfind(metrics, "group_turnover_share");
  const groupVal = mfind(metrics, "group_turnover_value");
  const sec: string[] = [
    `Na podstawie danych transakcyjnych z systemu UTP (GPW) przeanalizowano ${plnum(nTx?.value)} ` +
      `transakcji o łącznej wartości ${plnum(valTx?.value, "zł")} i wolumenie ${plnum(volTx?.value, "szt")}.`,
    `Udział rachunków powiązanych (Grupy) w wartości obrotu wyniósł ${plnum(groupShare?.value, "%")}` +
      (groupVal?.value != null ? ` (${plnum(groupVal.value, "zł")})` : ``) +
      `, co wskazuje na zdolność wywierania dominującego wpływu na kształtowanie kursu instrumentu.`,
  ];

  // Dynamika kursu (OHLC) — skrajne zamknięcia i największe dzienne zmiany.
  const closeHi = mpeak(metrics, "day_high");
  const chgUps = metrics
    .filter((m) => m.key === "day_change_pct" && (m.value ?? 0) > 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const chgDn = metrics
    .filter((m) => m.key === "day_change_pct")
    .sort((a, b) => (a.value ?? 0) - (b.value ?? 0))[0];
  if (closeHi?.value != null) {
    const ups = chgUps
      .slice(0, 2)
      .map((m) => `${m.session_day} (+${plnum(m.value, "%")})`)
      .join(" oraz ");
    sec.push(
      `Dynamika kursu. Poniższa tabela OHLC prezentuje kurs otwarcia, najwyższy, najniższy i zamknięcia ` +
        `oraz wolumen w kolejnych sesjach. Kurs maksymalny w okresie wyniósł ${plnum(closeHi.value, "zł")} ` +
        `(sesja ${closeHi.session_day}).` +
        (ups ? ` Największe dzienne wzrosty kursu zamknięcia odnotowano w sesjach ${ups}` : ``) +
        (chgDn?.value != null && chgDn.value < 0
          ? `, po których wystąpił wyraźny spadek — ${chgDn.session_day} (${plnum(chgDn.value, "%")}).`
          : `.`) +
        ` Taka sekwencja skokowych ruchów cenowych w krótkich odstępach czasu wymaga zestawienia ze ` +
        `skalą obecności podmiotów Grupy w obrocie.`,
    );
  }

  sec.push(
    `Zestawienie per podmiot. Poniższe tabele zestawiają podmioty z Grupy według wartości, udziału i ` +
      `wolumenu — odrębnie po stronie sprzedaży i po stronie kupna.`,
  );
  const top = topSeller(metrics);
  const buy = topBuyer(metrics);
  if (top)
    sec.push(
      `Po stronie sprzedaży największy udział w wartości obrotu miał podmiot ${cap(top.entity)} ` +
        `(${plnum(top.share, "%")}; ${plnum(top.val, "zł")}; wolumen ${plnum(top.vol, "szt")}), co stanowi ` +
        `pozycję szczytową w zestawieniu.`,
    );
  if (buy && buy.entity !== top?.entity)
    sec.push(
      `Po stronie kupna dominującą pozycję zajął podmiot ${cap(buy.entity)} ` +
        `(${plnum(buy.share, "%")}; ${plnum(buy.val, "zł")}; wolumen ${plnum(buy.vol, "szt")}). ` +
        `Aktywność Grupy była zatem obecna po obu stronach obrotu — zarówno w budowaniu, jak i w ` +
        `redukcji pozycji.`,
    );

  // Saldo Grupy — akumulacja/wyprzedaż z danych transakcyjnych (grounded).
  const days = mdays(metrics);
  const lastDay = days.length ? days[days.length - 1] : null;
  const cumAt = (k: string) => (lastDay ? metrics.find((m) => m.key === k && m.session_day === lastDay)?.value ?? null : null);
  const cumCash = cumAt("day_grp_cum_cash");
  const cumVol = cumAt("day_grp_cum_vol");
  const topCash = metrics
    .filter((m) => m.key === "day_grp_net_cash" && (m.value ?? 0) > 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .slice(0, 3);
  if (cumCash != null) {
    const revDays = topCash.map((m) => `${m.session_day} (${plnum(m.value, "zł")})`).join(", ");
    sec.push(
      `Saldo Grupy (akumulacja i wyprzedaż). Poniższa tabela zestawia dzienne i skumulowane saldo Grupy: ` +
        `wolumenu (pozycja = kupno − sprzedaż) oraz gotówki (przychód = sprzedaż − kupno). Skumulowany przychód ` +
        `Grupy na koniec okresu (${lastDay}) wyniósł ${plnum(cumCash, "zł")}` +
        (cumVol != null ? `, przy skumulowanym saldzie wolumenu ${plnum(cumVol, "szt")}` : ``) +
        `. ` +
        (revDays ? `Największe dodatnie przepływy gotówkowe (wyprzedaż pakietu) skoncentrowały się w sesjach ${revDays}. ` : ``) +
        (cumVol != null && cumVol < 0
          ? `Ujemne skumulowane saldo wolumenu wskazuje, że w badanym okresie Grupa była w przewadze stroną ` +
            `podażową — obraz odpowiadający upłynnianiu znacznego pakietu akcji.`
          : ``),
    );
  }

  // Zbieżność czasowa skoków kursu z raportami bieżącymi (cross-link do IV.2).
  const espi = byType(documents, "RAPORT_ESPI_EBI");
  if (espi.length)
    sec.push(
      `Zbieżność z raportami bieżącymi. W aktach znajduje się ${espi.length} raport(ów) ESPI/EBI (szczegółowo ` +
        `w rozdz. IV.2)` +
        (closeHi?.session_day ? `; skokowe ruchy kursu — w szczególności wokół sesji ${closeHi.session_day} — ` : `; skokowe ruchy kursu `) +
        `należy zestawić w czasie z datami publikacji komunikatów spółki. Przypisanie konkretnych numerów i dat ` +
        `komunikatów do poszczególnych sesji pozostaje [do uzupełnienia z rozdz. IV.2].`,
    );

  const findings: string[] = [];
  if (groupShare?.value != null)
    findings.push(`Udział Grupy w wartości obrotu: ${plnum(groupShare.value, "%")}.`);
  if (top) findings.push(`Największy sprzedawca z Grupy: ${cap(top.entity)} (${plnum(top.share, "%")}).`);
  if (buy) findings.push(`Największy kupujący z Grupy: ${cap(buy.entity)} (${plnum(buy.share, "%")}).`);
  if (closeHi?.value != null)
    findings.push(`Kurs maksymalny w okresie: ${plnum(closeHi.value, "zł")} (${closeHi.session_day}).`);
  if (cumCash != null) findings.push(`Skumulowany przychód Grupy w okresie: ${plnum(cumCash, "zł")}${lastDay ? ` (${lastDay})` : ""}.`);
  if (espi.length)
    findings.push(`W aktach ${espi.length} raportów ESPI/EBI do zestawienia czasowego ze skokami kursu (rozdz. IV.2).`);

  const tables = [ohlcTable(metrics), entityTable(metrics), entityBuyTable(metrics), saldoTable(metrics)].filter(
    (t): t is OpTable => t != null,
  );
  return {
    kind: "aktywnosc",
    chapterNo: no,
    title,
    bodyMd: sec.join("\n\n"),
    data: {
      table:
        tables[0] ??
        dailyTable(
          metrics,
          "wash_",
          "Tabela. Obecność Grupy w obrocie — udział transakcji wewnątrzgrupowych w wolumenie sesji",
          "Udział wewnątrzgrupowy (% wolumenu)",
        ),
      tables: tables.length ? tables : undefined,
      findings,
      legalRefs: [LEGAL_REFS.manipulacja],
    },
  };
}

// IV.x — Analiza ekonomiczno-finansowa i otoczenie rynkowe (IV.1). Test falsyfikacji.
export function buildEkofinSubanaliza(
  caseName: string,
  metrics: Metric[],
  documents: Doc[],
  quotes?: QuoteDyn | null,
): SubResult {
  const { no, title } = ivMeta(caseName, "ekofin");
  const period = periodOf(metrics);
  const fin = byType(documents, "SPRAWOZDANIE_FIN");
  const notow = byType(documents, "NOTOWANIA_REF");
  const stanp = byType(documents, "ZAWIAD_STAN_POSIADANIA");

  const sec: string[] = [];
  sec.push(
    `Celem analizy jest ustalenie, czy zmiana kursu instrumentu w okresie ${period} znajduje ` +
      `uzasadnienie w sytuacji ekonomiczno-finansowej spółki oraz w publicznie dostępnych ` +
      `informacjach, czy też ma charakter oderwany od fundamentów — co wzmacniałoby tezę o manipulacji.`,
  );
  sec.push(
    `Dynamika kursu i wolumenu. ` +
      (quotes
        ? `W okresie od ${quotes.from} do ${quotes.to} kurs zmienił się z ${plnum(quotes.start, "zł")} ` +
          `do maksymalnie ${plnum(quotes.maxClose, "zł")} w dniu ${quotes.peakDate} — wzrost o ` +
          `${plnum(quotes.changeStartMaxPct, "%")}. Kurs na koniec okresu: ${plnum(quotes.end, "zł")} ` +
          `(${plnum(quotes.changeStartEndPct, "%")} względem początku).`
        : (notow.length
            ? `W aktach znajdują się dane notowań (${notow.length}) — wygeneruj subanalizę, aby policzyć dynamikę kursu. `
            : `Brak w aktach danych notowań. `) +
          `[Do uzupełnienia: kurs początkowy, maksymalny, procentowa zmiana, data szczytu.]`),
  );
  sec.push(
    `Sytuacja finansowa spółki. ` +
      (fin.length
        ? `Zidentyfikowano ${fin.length} dokument(ów) finansowych:\n${docList(fin)}\n`
        : `Brak w aktach sprawozdań finansowych. `) +
      `[Do uzupełnienia: czy wyniki i perspektywy spółki uzasadniają zaobserwowaną zmianę kursu.]`,
  );
  if (stanp.length)
    sec.push(
      `Zmiany stanu posiadania. Zidentyfikowano ${stanp.length} zawiadomienie(a) — istotne dla oceny ` +
        `przepływu pakietów i powiązania z dynamiką kursu.`,
    );
  sec.push(
    `Ocena. [Do uzupełnienia przez biegłego: brak uzasadnienia dynamiki kursu w fundamentach i ` +
      `informacjach publicznych wzmacnia tezę o oderwaniu ceny od wartości i o manipulacji.]`,
  );

  const findings: string[] = [];
  if (quotes)
    findings.push(
      `Kurs wzrósł o ${plnum(quotes.changeStartMaxPct, "%")} (z ${plnum(quotes.start, "zł")} do ` +
        `${plnum(quotes.maxClose, "zł")}, szczyt ${quotes.peakDate}).`,
    );
  findings.push(
    `W aktach: ${fin.length} dok. finansowych, ${notow.length} zbiór(ów) notowań, ${stanp.length} ` +
      `zawiadomień o stanie posiadania.`,
  );
  return {
    kind: "ekofin",
    chapterNo: no,
    title,
    bodyMd: sec.join("\n\n"),
    data: {
      table: null,
      findings,
      legalRefs: [LEGAL_REFS.informacjaPoufna, LEGAL_REFS.obowiazekRaportowy],
    },
  };
}

// IV.x — Analiza raportów bieżących ESPI/EBI (IV.2).
function buildEspiSubanaliza(caseName: string, metrics: Metric[], documents: Doc[]): SubResult {
  void metrics;
  const { no, title } = ivMeta(caseName, "espi");
  const espi = byType(documents, "RAPORT_ESPI_EBI");
  const sec: string[] = [
    `Analiza raportów bieżących i okresowych spółki w systemach ESPI i EBI pod kątem ich charakteru ` +
      `cenotwórczego oraz zgodności z obowiązkiem informacyjnym (${LEGAL_REFS.obowiazekRaportowy}).`,
    espi.length
      ? `W okresie objętym analizą zidentyfikowano ${espi.length} raport(ów):\n${docList(espi)}\n`
      : `Brak w aktach raportów ESPI/EBI. `,
    `[Do uzupełnienia przez biegłego: czy którykolwiek komunikat wypełniał definicję informacji poufnej ` +
      `(${LEGAL_REFS.informacjaPoufna}) i czy tłumaczy ruch kursu; czy raporty nosiły znamiona ` +
      `manipulacji informacją (${TECHNIQUES.infomanip.mar}).]`,
  ];
  return {
    kind: "espi",
    chapterNo: no,
    title,
    bodyMd: sec.join("\n\n"),
    data: {
      table: null,
      findings: [`Zidentyfikowano ${espi.length} raport(ów) ESPI/EBI.`],
      legalRefs: [LEGAL_REFS.informacjaPoufna, LEGAL_REFS.obowiazekRaportowy, TECHNIQUES.infomanip.mar],
    },
  };
}

// IV.x — Identyfikacja relacji / porozumienie (IP + relacje osobowe).
function buildRelacjeSubanaliza(caseName: string, metrics: Metric[], documents: Doc[]): SubResult {
  const { no, title } = ivMeta(caseName, "relacje");
  // Gdy sprawa nie ma osobnego rozdziału „aktywność" — tu trafia tabela per podmiot.
  const grupaTable = casePlan(caseName).some((c) => c.kind === "aktywnosc") ? null : entityTable(metrics);
  const ip = byType(documents, "DANE_IP");
  const osint = byType(documents, "ANALIZA_OSINT");
  const broker = byType(documents, "DANE_BROKERSKIE");
  const sec: string[] = [
    `Celem analizy jest ustalenie, czy aktywność rachunków nosi znamiona działania wspólnie i w ` +
      `porozumieniu, w oparciu o zbieżność adresów IP, relacje osobowe oraz wzorce czasowe zleceń.`,
    `Zbieżność adresów IP. ` +
      (ip.length ? `W aktach dane logowań/IP (${ip.length}):\n${docList(ip)}\n` : `Brak w aktach danych IP. `) +
      `[Do uzupełnienia: które adresy IP były współdzielone przez różne rachunki Grupy.]`,
    `Relacje osobowe. ` +
      (osint.length ? `Analiza OSINT / graf powiązań (${osint.length}):\n${docList(osint)}\n` : `Brak analizy OSINT. `) +
      `[Do uzupełnienia: relacje rodzinne i biznesowe między posiadaczami rachunków, wspólne zarządy.]`,
    `Wspólni pełnomocnicy/decydenci. ` +
      (broker.length ? `Dane z firm inwestycyjnych (${broker.length}) pozwalają ustalić pełnomocników. ` : ``) +
      `[Do uzupełnienia: wspólni pełnomocnicy/decydenci rachunków, wspólne dane kontaktowe.]`,
    `Ocena. [Do uzupełnienia: czy zbieżność IP, relacje osobowe i wzorce czasowe wskazują na działanie ` +
      `wspólnie i w porozumieniu w rozumieniu art. 12 MAR.]`,
  ];
  return {
    kind: "relacje",
    chapterNo: no,
    title,
    bodyMd: sec.join("\n\n"),
    data: {
      table: grupaTable,
      findings: [
        `W aktach: ${ip.length} zbiór(ów) IP, ${osint.length} analiz OSINT, ${broker.length} zestawień brokerskich.`,
      ],
      legalRefs: ["art. 12 ust. 1 MAR", "art. 12 ust. 2 lit. a–c MAR"],
    },
  };
}

// Dyspozytor IV — zwraca subanalizę dla danego rodzaju rozdziału.
export function buildIVChapter(
  kind: IVKind,
  caseName: string,
  metrics: Metric[],
  documents: Doc[],
  quotes?: QuoteDyn | null,
): SubResult {
  switch (kind) {
    case "ekofin":
      return buildEkofinSubanaliza(caseName, metrics, documents, quotes);
    case "espi":
      return buildEspiSubanaliza(caseName, metrics, documents);
    case "aktywnosc":
      return buildAktywnoscSubanaliza(caseName, metrics, documents);
    case "relacje":
      return buildRelacjeSubanaliza(caseName, metrics, documents);
    case "wash":
      return buildWashSubanaliza(caseName, metrics);
    case "imo":
      return buildImoSubanaliza(caseName, metrics);
    case "layering": {
      const ch = casePlan(caseName).find((c) => c.kind === "layering");
      return buildLayeringSubanaliza(caseName, metrics, !!ch?.perSession);
    }
    case "pumpdump":
      return buildPumpDumpSubanaliza(caseName, metrics, quotes);
  }
}

// Zgodność wsteczna: stary podgląd „ilościowa" → aktywność Grupy.
export function buildQuantitativeSubanaliza(metrics: Metric[]): QuantResult | null {
  if (!metrics.length) return null;
  return buildAktywnoscSubanaliza("", metrics);
}

// ── III. Wstęp — ujęcie teoretyczne (z biblioteki prawnej; bez liczb sprawy) ──
export function buildTeoriaIII(caseName: string): SubResult {
  const techs = planTechniques(caseName);
  const ids: TechniqueId[] = (techs.length ? techs : (["wash", "imo", "layering", "pumpdump"] as IVKind[]))
    .map((k) => k as unknown as TechniqueId)
    .filter((id) => id in TECHNIQUES);
  const sec: string[] = [
    `Niniejszy rozdział przedstawia teoretyczno-prawne ujęcie technik manipulacji instrumentem ` +
      `finansowym w świetle art. 12 rozporządzenia MAR oraz wskaźników z załącznika II do ` +
      `rozporządzenia delegowanego (UE) 2016/522. Definicje mają charakter ogólny i nie odwołują się ` +
      `do liczb niniejszej sprawy.`,
  ];
  for (const id of ids) {
    const t = TECHNIQUES[id];
    sec.push(`${t.label} (${t.mar}; ${t.rd}). ${t.definicja}`);
  }
  // Manipulacja informacją zawsze w teorii (przewija się w obu opiniach).
  if (!ids.includes("infomanip")) {
    const t = TECHNIQUES.infomanip;
    sec.push(`${t.label} (${t.mar}). ${t.definicja}`);
  }
  return {
    kind: "proza_iii",
    chapterNo: "III",
    title: "Wstęp — ujęcie teoretyczne",
    bodyMd: sec.join("\n\n"),
    data: { table: null, findings: [], legalRefs: ids.map((id) => techniqueRef(id)) },
  };
}

// ── II. Wnioski — synteza WYŁĄCZNIE z zatwierdzonych analiz dowodowych (IV) ────
// Zasada evidence-only: nie przejmujemy tez ani konkluzji z opinii KM, ani z
// zawiadomienia UKNF/GPW. Wnioski potwierdzają (lub nie) zarzuty na podstawie
// ustaleń z rozdziału IV; brak dowodu = [do uzupełnienia], nigdy konkluzja.
export function buildWnioskiSubanaliza(
  caseName: string,
  metrics: Metric[],
  stored: StoredSub[],
): SubResult {
  void caseName;
  const washPeak = mpeak(metrics, "wash_");
  const cancelPeak = mpeak(metrics, "cancel_");
  const groupShare = mfind(metrics, "group_turnover_share");
  const seller = topSeller(metrics);
  const approved = stored
    .filter((s) => s.status === "zatwierdzona" && s.chapter_no.startsWith("IV"))
    .sort((a, b) => a.chapter_no.localeCompare(b.chapter_no, "pl"));
  const techKinds = new Set(["wash", "imo", "layering", "pumpdump"]);
  const approvedTech = approved.filter((s) => techKinds.has(s.kind));

  const parts: string[] = [];
  parts.push(
    `Wnioski formułuje się wyłącznie na podstawie ustaleń z rozdziału IV (analiza materiału ` +
      `dowodowego). Celem opinii jest weryfikacja, czy zebrany materiał potwierdza zarzuty postawione ` +
      `w zawiadomieniu — bez przejmowania tez z zawiadomienia ani z opinii innego biegłego.`,
  );

  if (!approved.length) {
    parts.push(
      `[Do uzupełnienia: brak zatwierdzonych rozdziałów IV. Wnioski można sformułować dopiero po ` +
        `wykonaniu i zatwierdzeniu analiz dowodowych (techniki, aktywność, relacje).]`,
    );
  } else {
    // Techniki — tylko te faktycznie zbadane w zatwierdzonych rozdziałach IV.
    if (approvedTech.length) {
      const lines = approvedTech.map((s) => {
        const t = TECHNIQUES[s.kind as TechniqueId];
        const f = (s.data?.findings ?? []).join(" ").trim();
        return `• ${t.label} (${t.mar}; ${t.rd}) — ${f || "[brak ustaleń liczbowych w rozdziale]"}`;
      });
      parts.push(
        `Analiza materiału dowodowego (rozdz. IV) obejmuje następujące techniki i ich ustalenia:\n${lines.join("\n")}`,
      );
    }
    // Liczby — wyłącznie z silnika (dane UTP), bez interpretacji.
    const nums: string[] = [];
    if (washPeak?.value != null)
      nums.push(`wolumen transakcji wewnątrzgrupowych do ${plnum(washPeak.value, "%")} wolumenu sesji (${washPeak.session_day})`);
    if (cancelPeak?.value != null)
      nums.push(`anulacje zleceń kupna Grupy do ${plnum(cancelPeak.value, "%")} zadeklarowanego wolumenu (${cancelPeak.session_day})`);
    if (groupShare?.value != null)
      nums.push(`udział Grupy w wartości obrotu ${plnum(groupShare.value, "%")}`);
    if (nums.length)
      parts.push(`Ustalenia liczbowe (deterministyczny silnik, dane UTP): ${nums.join("; ")}.`);

    if (seller)
      parts.push(
        `Największy udział w wartości sprzedaży akcji w badanym okresie miał podmiot ` +
          `${cap(seller.entity)} (${plnum(seller.share, "%")}, wolumen ${plnum(seller.vol, "szt")}).`,
      );

    // Pozostałe zatwierdzone rozdziały IV (ekofin/ESPI/aktywność/relacje).
    const other = approved.filter((s) => !techKinds.has(s.kind));
    if (other.length) {
      const fs = other
        .map((s) => `${s.title} (rozdz. ${s.chapter_no}): ${(s.data?.findings ?? []).join(" ")}`.trim())
        .filter(Boolean);
      if (fs.length) parts.push(`Pozostałe ustalenia z rozdziału IV:\n• ${fs.join("\n• ")}`);
    }
  }

  parts.push(
    `Powyższe stanowią ustalenia faktyczne wynikające z analizy materiału dowodowego i odnoszą się do ` +
      `pytań postanowienia o powołaniu biegłego. Ocena, czy potwierdzają one zarzuty manipulacji ` +
      `instrumentem finansowym (art. 12 MAR), oraz kwalifikacja prawnokarna, zamiar i wina konkretnych ` +
      `osób — pozostają w wyłącznej kompetencji organu prowadzącego postępowanie oraz sądu.`,
  );

  return {
    kind: "wnioski",
    chapterNo: "II",
    title: "Wnioski",
    bodyMd: parts.join("\n\n"),
    data: {
      table: null,
      findings: [
        `Wnioski wynikają wyłącznie z zatwierdzonych analiz dowodowych (rozdz. IV); ocena prawnokarna — w gestii sądu.`,
      ],
      legalRefs: ["art. 12 MAR", LEGAL_REFS.manipulacja],
    },
  };
}

const SUB_LABEL: Record<string, string> = {
  ekofin: "ekonomiczno-finansowa i otoczenie",
  espi: "raporty ESPI/EBI",
  aktywnosc: "aktywność Grupy (silnik faktów)",
  relacje: "relacje / porozumienie (IP / OSINT)",
  wash: "wash trades (silnik faktów)",
  imo: "improper matched orders",
  layering: "layering & spoofing (silnik faktów)",
  pumpdump: "pump and dump",
  wnioski: "synteza wniosków",
  proza_i: "redakcja rozdziału I (model)",
  proza_iii: "rozdział III — ujęcie teoretyczne",
  proza_v: "redakcja rozdziału V (model)",
};

// Rozdział opinii z zapisanej subanalizy (zatwierdzona → grounded/ready).
function chapterFromStored(s: StoredSub, noOverride?: string, titleOverride?: string): Chapter {
  const conf: Conf = s.status === "zatwierdzona" ? "grounded" : "review";
  return {
    no: noOverride ?? s.chapter_no,
    title: titleOverride ?? s.title,
    status: s.status === "zatwierdzona" ? "ready" : "draft",
    source:
      `Subanaliza: ${SUB_LABEL[s.kind] ?? s.kind}` +
      (s.status === "zatwierdzona" ? " · zatwierdzona" : " · szkic"),
    paras: splitParas(s.body_md).map((t) => ({ text: t, conf })),
    table: s.data?.table ?? undefined,
    tables: s.data?.tables && s.data.tables.length ? s.data.tables : undefined,
    findings: (s.data?.findings ?? []).map((t) => ({ text: t, conf: "grounded" as Conf })),
  };
}

// Wszystkie tabele rozdziału (wiele numerowanych albo pojedyncza) w kolejności.
function chapterTables(c: Chapter): OpTable[] {
  if (c.tables && c.tables.length) return c.tables;
  return c.table ? [c.table] : [];
}

export function buildOpinion(
  caseRow: { name: string; signature: string | null },
  metrics: Metric[],
  documents: Doc[],
  stored: StoredSub[] = [],
): Opinion {
  const inputDocs = documents.filter((d) => d.provenance !== "wyjście");
  const td = stored.find((s) => s.kind === "techniki");
  const selectedTech = (td?.data as { selected?: string[] } | null)?.selected as IVKind[] | undefined;
  const plan: IVChapter[] = resolvePlan(caseRow.name, selectedTech);
  const byKind = new Map(stored.map((s) => [s.kind, s] as const));

  // Rozdział IV — wg planu sprawy: zapisana subanaliza albo miejsce „do wygenerowania".
  const ivChapters: Chapter[] = plan.map((p) => {
    const s = byKind.get(p.kind);
    if (s) return chapterFromStored(s, p.no, p.title);
    return {
      no: p.no,
      title: p.title,
      status: "todo" as const,
      paras: [{ conf: "todo" as Conf, text: `Rozdział do wygenerowania (subanaliza: ${SUB_LABEL[p.kind] ?? p.kind}).` }],
    };
  });
  const tablesIV = ivChapters.flatMap((c) => chapterTables(c).map((t) => ({ no: c.no, table: t })));

  // III — z biblioteki (chyba że zapisano redakcję modelu proza_iii).
  const storedIII = byKind.get("proza_iii");
  const iiiChapter: Chapter = storedIII
    ? chapterFromStored(storedIII, "III", "Wstęp — ujęcie teoretyczne")
    : (() => {
        const t = buildTeoriaIII(caseRow.name);
        return {
          no: "III",
          title: t.title,
          status: "ready" as const,
          source: "Biblioteka prawna (definicje technik MAR/RD)",
          paras: splitParas(t.bodyMd).map((x) => ({ text: x, conf: "grounded" as Conf })),
        };
      })();

  const chapters: Chapter[] = [
    {
      no: "I",
      title: "Przedmiot i podstawa prawna opinii",
      status: "draft",
      paras: [
        {
          conf: "review",
          text:
            `Przedmiotem opinii jest ocena, czy w obrocie instrumentem finansowym objętym sprawą` +
            `${caseRow.signature ? ` (sygn. ${caseRow.signature})` : ""} doszło do manipulacji w ` +
            `rozumieniu art. 12 MAR, a jeżeli tak — w jaki sposób i przez kogo. Opinia odpowiada na ` +
            `pytania postanowienia o powołaniu biegłego.`,
        },
        ...PROSECUTOR_QUESTIONS.map((q) => ({ conf: "review" as Conf, text: q })),
        {
          conf: "todo",
          text: "Do uzupełnienia: oznaczenie spółki i instrumentu, okres objęty analizą oraz lista podmiotów (Grupa) z LEI i reprezentantami zgodnie z treścią postanowienia.",
        },
      ],
    },
    {
      no: "II",
      title: "Wnioski",
      status: "todo",
      paras: [
        {
          conf: "todo",
          text:
            "Sekcja generowana po zatwierdzeniu subanaliz — synteza odpowiedzi na pytania postanowienia " +
            "(z mapą Q1–Q4), z rozdzieleniem ustaleń faktycznych od ocen zastrzeżonych dla sądu.",
        },
      ],
    },
    iiiChapter,
    ...ivChapters,
    {
      no: "V",
      title: "Podsumowanie",
      status: "todo",
      paras: [
        {
          conf: "todo",
          text: "Podsumowanie generowane na etapie montażu po zatwierdzeniu rozdziałów IV.",
        },
      ],
    },
    {
      no: "VI",
      title: "Spis tabel i wykresów oraz wykaz załączników",
      status: tablesIV.length || inputDocs.length ? "ready" : "todo",
      paras: tablesIV.length
        ? tablesIV.map((c, i) => ({ conf: "grounded" as Conf, text: `Tabela ${i + 1}. ${c.table.caption.replace(/^Tabela\.\s*/, "")} (rozdz. ${c.no}).` }))
        : [{ conf: "todo", text: "Spis tabel zostanie uzupełniony po wykonaniu analiz." }],
      attachments: inputDocs.slice(0, 300).map((d) => basename(d.rel_path)),
    },
  ];

  // Rozdziały stałe I, II, V nadpisuje zapisana subanaliza o tym numerze
  // (np. „Wnioski" jako kind=wnioski/chapter_no=II, redakcje proza_i/proza_v).
  const exact = new Map(
    stored
      .filter((s) => ["I", "II", "V"].includes(s.chapter_no))
      .map((s) => [s.chapter_no, s] as const),
  );
  const merged = chapters.map((c) => (exact.has(c.no) ? chapterFromStored(exact.get(c.no)!, c.no, c.title) : c));

  return {
    caseName: caseRow.name,
    signature: caseRow.signature,
    expert: EXPERT,
    generatedAt: new Date().toISOString(),
    legalBasis: LEGAL_BASIS,
    chapters: merged,
  };
}
