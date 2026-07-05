// Deterministyczny montaż opinii z subanaliz.
//
// Zasada: LLM NIE LICZY. Wszystkie liczby pochodzą z silnika faktów (tabela
// `metrics`); proza jest szablonowa. Szkielet I–VI jest stały; rdzeń IV (1–7)
// układa plan sprawy (lib/opinion/chapters.ts). Opinia montuje się z
// ZATWIERDZONYCH subanaliz (tabela `subanalyses`); rozdział bez subanalizy
// pokazuje miejsce w strukturze oznaczone jako „do wygenerowania".

import {
  annexIRef,
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
import type { ChartSpec } from "./charts";

export type Conf = "grounded" | "review" | "todo";
export type Para = { text: string; conf: Conf };
export type OpTable = { caption: string; head: string[]; rows: string[][] };
// Placeholder elementu graficznego/tabelarycznego. Gdy silnik ma dane serii
// (chart), DOCX renderuje prawdziwy wykres (charts.ts → PNG); bez danych —
// oznaczone miejsce, biegły wstawia element ręcznie.
export type Placeholder = { kind: "wykres" | "tabela"; name: string; label?: string; chart?: ChartSpec };
export type Chapter = {
  no: string;
  title: string;
  status: "ready" | "draft" | "todo";
  source?: string;
  paras: Para[];
  table?: OpTable;
  tables?: OpTable[]; // wiele tabel numerowanych w jednym rozdziale (np. OHLC + sprzedaż + kupno)
  placeholders?: Placeholder[]; // wykresy/tabele do wstawienia przez biegłego
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

// Placeholdery elementów, których silnik jeszcze nie renderuje (wzorzec: opinia
// referencyjna używa wykresów nr 1–5 oraz tabel spoza obecnego zakresu silnika).
// DOCX/montaż oznaczają miejsce i nazwę; biegły wstawia element ręcznie.
const CHAPTER_PLACEHOLDERS: Partial<Record<IVKind, Placeholder[]>> = {
  ekofin: [
    { kind: "wykres", name: "Kurs akcji emitenta na tle spółek porównywalnych / sektora" },
    { kind: "tabela", name: "Wybrane dane ekonomiczno-finansowe emitenta (okresy porównawcze)" },
  ],
  espi: [{ kind: "tabela", name: "Reakcja kursu i wolumenu na poszczególne komunikaty ESPI/EBI" }],
  aktywnosc: [
    { kind: "wykres", name: "Kurs i wolumen obrotu akcjami w okresie objętym analizą" },
    { kind: "wykres", name: "Skumulowane saldo wolumenu i gotówki Grupy (akumulacja/wyprzedaż)" },
  ],
  wash: [{ kind: "wykres", name: "Udział transakcji wewnątrzgrupowych (wash trades) w wolumenie sesji" }],
  layering: [{ kind: "wykres", name: "Udział anulowanego wolumenu kupna Grupy per sesja" }],
  relacje: [{ kind: "tabela", name: "Macierz powiązań osobowych i kapitałowych podmiotów Grupy" }],
  pumpdump: [{ kind: "wykres", name: "Kurs zamknięcia w okresie analizy — fazy pump i dump" }],
};

// Dane serii wykresu dla placeholdera — wyłącznie z metryk silnika. Zwraca
// undefined, gdy serii brak (placeholder zostaje ramką „do wstawienia").
function chartFor(kind: IVKind, name: string, metrics: Metric[]): ChartSpec | undefined {
  const days = mdays(metrics);
  if (!days.length) return undefined;
  const at = (key: string, d: string) => metrics.find((m) => m.key === key && m.session_day === d)?.value ?? null;
  const byPrefix = (pfx: string, d: string) =>
    metrics.find((m) => m.key.startsWith(pfx) && m.session_day === d)?.value ?? null;
  const series = (f: (d: string) => number | null) => days.map(f);
  const has = (vals: (number | null)[]) => vals.some((v) => v != null);

  if (kind === "aktywnosc" && /kurs i wolumen/i.test(name)) {
    const close = series((d) => at("day_close", d));
    const vol = series((d) => at("day_sess_vol", d));
    if (!has(close)) return undefined;
    return {
      title: name,
      days,
      left: { label: "Kurs zamknięcia", unit: "zł", values: close, kind: "line" },
      right: has(vol) ? { label: "Wolumen sesji", unit: "szt", values: vol, kind: "bars" } : undefined,
    };
  }
  if (kind === "aktywnosc" && /saldo/i.test(name)) {
    const cumVol = series((d) => at("day_grp_cum_vol", d));
    const cumCash = series((d) => at("day_grp_cum_cash", d));
    if (!has(cumCash) && !has(cumVol)) return undefined;
    return {
      title: name,
      days,
      left: { label: "Skum. przychód Grupy", unit: "zł", values: cumCash, kind: "line" },
      right: has(cumVol) ? { label: "Skum. saldo wolumenu (pozycja)", unit: "szt", values: cumVol, kind: "line" } : undefined,
    };
  }
  if (kind === "wash") {
    const wash = series((d) => byPrefix("wash_", d));
    if (!has(wash)) return undefined;
    return {
      title: name,
      days,
      left: { label: "Udział transakcji wewnątrzgrupowych", unit: "%", values: wash, kind: "bars" },
    };
  }
  if (kind === "layering") {
    const cancels = series((d) => byPrefix("cancel_", d));
    if (!has(cancels)) return undefined; // brak danych zleceń → ramka
    return {
      title: name,
      days,
      left: { label: "Anulowany wolumen kupna Grupy", unit: "%", values: cancels, kind: "bars" },
    };
  }
  if (kind === "pumpdump") {
    const close = series((d) => at("day_close", d));
    if (!has(close)) return undefined;
    return {
      title: name,
      days,
      left: { label: "Kurs zamknięcia", unit: "zł", values: close, kind: "line" },
    };
  }
  return undefined; // np. ekofin — wymaga danych porównawczych spoza silnika
}

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

// ── Rozbicia per podmiot×sesja (wzorzec KM: Zal.1–10 „aktywność <data>") ──────
// Aktywność każdego podmiotu Grupy danego dnia po obu stronach (ede_bval/…/ede_svol).
type EdeRow = { entity: string; bval: number; bvol: number; sval: number; svol: number };
function edeByDay(metrics: Metric[]): Map<string, Map<string, EdeRow>> {
  const days = new Map<string, Map<string, EdeRow>>();
  for (const m of metrics) {
    if (!m.session_day || !m.key.startsWith("ede_")) continue;
    const [field, entity] = [m.key.slice(4, 8), m.key.split("::")[1]];
    if (!entity) continue;
    const byEnt = days.get(m.session_day) ?? new Map<string, EdeRow>();
    const row = byEnt.get(entity) ?? { entity, bval: 0, bvol: 0, sval: 0, svol: 0 };
    if (field === "bval") row.bval = m.value ?? 0;
    else if (field === "bvol") row.bvol = m.value ?? 0;
    else if (field === "sval") row.sval = m.value ?? 0;
    else if (field === "svol") row.svol = m.value ?? 0;
    byEnt.set(entity, row);
    days.set(m.session_day, byEnt);
  }
  return days;
}

// Tabela aktywności podmiotów Grupy w jednej sesji — kupno/sprzedaż/saldo.
function sessionEntityTable(ede: Map<string, Map<string, EdeRow>>, day: string): OpTable | null {
  const byEnt = ede.get(day);
  if (!byEnt?.size) return null;
  const rows = [...byEnt.values()].sort((a, b) => b.bval + b.sval - (a.bval + a.sval));
  return {
    caption: `Tabela. Aktywność podmiotów z Grupy w sesji ${day} — kupno, sprzedaż i saldo wolumenu`,
    head: ["Podmiot", "Kupno (zł)", "Kupno (szt)", "Sprzedaż (zł)", "Sprzedaż (szt)", "Saldo wol. (szt)"],
    rows: rows.map((r) => [
      cap(r.entity),
      plnum(r.bval > 0 ? r.bval : null, "zł"),
      plnum(r.bvol > 0 ? r.bvol : null, "szt"),
      plnum(r.sval > 0 ? r.sval : null, "zł"),
      plnum(r.svol > 0 ? r.svol : null, "szt"),
      plnum(r.bvol - r.svol, "szt"),
    ]),
  };
}

// Dobór sesji kluczowych do rozbicia (KM MLM: 10 sesji z 101). Kryterium jawne
// i zwalidowane na wyroczni: ranking po SUMIE anulowanego wolumenu kupna Grupy
// w sesji (lay_cancelled::) odtwarza 7/10 sesji wskazanych w finale KM; czysty
// odsetek anulacji (cancel_) trafia 0/10 (wygrywają mikrosesje). Gdy brak danych
// zleceń — udział Grupy w wartości obrotu sesji. Zwrot chronologiczny.
function keySessions(metrics: Metric[], max: number): { days: string[]; criterion: string } {
  const cancelledVol = new Map<string, number>();
  for (const m of metrics)
    if (m.key.startsWith("lay_cancelled::") && m.session_day)
      cancelledVol.set(m.session_day, (cancelledVol.get(m.session_day) ?? 0) + (m.value ?? 0));
  if (cancelledVol.size)
    return {
      days: [...cancelledVol.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([d]) => d).sort(),
      criterion: "największy anulowany wolumen zleceń kupna Grupy w sesji",
    };
  const share = new Map<string, number>();
  for (const d of mdays(metrics)) {
    const sv = metrics.find((m) => m.key === "day_sess_val" && m.session_day === d)?.value ?? 0;
    const gv = metrics.find((m) => m.key === "day_grp_val" && m.session_day === d)?.value ?? 0;
    if (sv > 0) share.set(d, gv / sv);
  }
  return {
    days: [...share.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([d]) => d).sort(),
    criterion: "największy udział Grupy w wartości obrotu sesji",
  };
}

// Fakty sesji dla promptu redakcji (layering/aktywność) — liczby dnia, które
// model ma przepisać w akapitach sesyjnych zamiast oznaczać [do uzupełnienia].
export function sessionFacts(metrics: Metric[], days: string[]): string[] {
  const out: string[] = [];
  for (const d of days) {
    const at = (k: string) => metrics.find((m) => m.key === k && m.session_day === d)?.value ?? null;
    const byPfx = (p: string) => metrics.find((m) => m.key.startsWith(p) && m.session_day === d)?.value ?? null;
    const sval = at("day_sess_val");
    const gval = at("day_grp_val");
    const close = at("day_close");
    const chg = at("day_change_pct");
    const cancel = byPfx("cancel_");
    const layCancelled = metrics
      .filter((m) => m.key.startsWith("lay_cancelled::") && m.session_day === d)
      .reduce((a, m) => a + (m.value ?? 0), 0);
    const parts: string[] = [];
    if (sval != null) parts.push(`obrót sesji ${plnum(sval, "zł")}`);
    if (gval != null)
      parts.push(
        `z udziałem Grupy ${plnum(gval, "zł")}` +
          (sval ? ` (${plnum(Math.round((gval / sval) * 10000) / 100, "%")})` : ""),
      );
    if (close != null)
      parts.push(`kurs zamknięcia ${plnum(close, "zł")}${chg != null ? ` (zmiana ${chg > 0 ? "+" : ""}${plnum(chg, "%")})` : ""}`);
    if (cancel != null) parts.push(`anulacje kupna Grupy ${plnum(cancel, "%")} zadeklarowanego wolumenu`);
    if (layCancelled > 0) parts.push(`anulowany wolumen kupna Grupy ${plnum(Math.round(layCancelled), "szt")}`);
    if (parts.length) out.push(`${d} — ${parts.join("; ")}`);
  }
  return out;
}

// Zdanie wprowadzające sesji (KM-style „Sesja giełdowa w dniu …") — z metryk dnia.
function sessionNarrative(metrics: Metric[], d: string): string {
  const at = (k: string) => metrics.find((m) => m.key === k && m.session_day === d)?.value ?? null;
  const sval = at("day_sess_val");
  const gval = at("day_grp_val");
  const close = at("day_close");
  const chg = at("day_change_pct");
  const shareTxt = sval && gval != null ? `${plnum(Math.round((gval / sval) * 10000) / 100, "%")}` : null;
  return (
    `Sesja giełdowa w dniu ${d}. Wartość obrotu wyniosła ${plnum(sval, "zł")}` +
    (gval != null ? `, z czego transakcje z udziałem Grupy ${plnum(gval, "zł")}${shareTxt ? ` (${shareTxt})` : ""}` : ``) +
    (close != null
      ? `; kurs zamknięcia ${plnum(close, "zł")}${chg != null ? ` (zmiana ${chg > 0 ? "+" : ""}${plnum(chg, "%")})` : ""}`
      : ``) +
    `. Aktywność poszczególnych podmiotów Grupy w tej sesji przedstawia tabela.`
  );
}

// Fixing (zał. I lit. A pkt g MAR) — udział Grupy przy ustalaniu kursów otwarcia
// i zamknięcia per sesja + zlecenia „zachęcające" 16:50–17:00 niezrealizowane.
function fixingTable(metrics: Metric[]): OpTable | null {
  const days = [
    ...new Set(
      metrics.filter((m) => m.key === "fix_close_share" || m.key === "fix_open_share").map((m) => m.session_day as string),
    ),
  ].sort();
  if (!days.length) return null;
  const at = (k: string, d: string) => metrics.find((m) => m.key === k && m.session_day === d)?.value ?? null;
  return {
    caption:
      "Tabela. Aktywność Grupy przy ustalaniu kursów odniesienia (fixing) — udział w wolumenie fixingu otwarcia i zamknięcia oraz zlecenia z fazy przed zamknięciem niezrealizowane",
    head: ["Sesja", "Fixing otwarcia — udział Grupy", "Fixing zamknięcia — udział Grupy", "Wolumen fix. zamknięcia", "Zlec. 16:50–17:00 niezreal. (szt)"],
    rows: days.map((d) => [
      d,
      plnum(at("fix_open_share", d), "%"),
      plnum(at("fix_close_share", d), "%"),
      plnum(at("fix_close_vol", d), "szt"),
      plnum(at("fix_pre_cancel_cnt", d)),
    ]),
  };
}

// Odwrócenie pozycji w krótkim okresie (zał. I lit. A pkt d MAR) — podmioty Grupy
// kupujące i sprzedające w tej samej sesji (min z wartości kupna i sprzedaży).
function reversalTable(metrics: Metric[]): OpTable | null {
  const rows = metrics
    .filter((m) => m.key.startsWith("rev_val::") && m.session_day)
    .map((m) => ({ day: m.session_day as string, entity: m.key.split("::")[1], value: m.value }))
    .sort((a, b) => (a.day === b.day ? (b.value ?? 0) - (a.value ?? 0) : a.day.localeCompare(b.day)));
  if (!rows.length) return null;
  return {
    caption: "Tabela. Odwrócenie pozycji w tej samej sesji — podmioty Grupy kupujące i sprzedające (wartość odwrócenia)",
    head: ["Sesja", "Podmiot", "Odwrócenie pozycji (zł)"],
    rows: rows.map((r) => [r.day, cap(r.entity), plnum(r.value, "zł")]),
  };
}

// Improper matched orders per sesja — liczba i wartość zleceń wewnątrzgrupowych
// dopasowanych w czasie (≤ próg s). Źródło: metryki imo_day_count / imo_day_value.
function imoSessionTable(metrics: Metric[]): OpTable | null {
  const days = [...new Set(metrics.filter((m) => m.key === "imo_day_count").map((m) => m.session_day as string))].sort();
  if (!days.length) return null;
  const at = (k: string, d: string) => metrics.find((m) => m.key === k && m.session_day === d)?.value ?? null;
  return {
    caption: "Tabela. Improper matched orders — zlecenia wewnątrzgrupowe dopasowane w czasie (≤2 s) per sesja",
    head: ["Sesja", "Liczba dopasowań", "Wartość (zł)"],
    rows: days.map((d) => [d, plnum(at("imo_day_count", d)), plnum(at("imo_day_value", d), "zł")]),
  };
}

// Improper matched orders — pary podmiotów Grupy wg wartości dopasowanych zleceń.
function imoPairTable(metrics: Metric[]): OpTable | null {
  const rows = metrics
    .filter((m) => m.key.startsWith("imo_pair::"))
    .map((m) => {
      const [a, b] = m.key.slice("imo_pair::".length).split("|");
      return { a, b, value: m.value };
    })
    .sort((x, y) => (y.value ?? 0) - (x.value ?? 0));
  if (!rows.length) return null;
  return {
    caption: "Tabela. Improper matched orders — pary podmiotów z Grupy wg wartości dopasowanych zleceń",
    head: ["Para podmiotów", "Wartość dopasowanych zleceń (zł)"],
    rows: rows.map((r) => [`${cap(r.a)} ↔ ${cap(r.b)}`, plnum(r.value, "zł")]),
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

// Sprzedaż podmiotów z Grupy w rozbiciu na sesje (ede_sval/svol::) — ledger per
// (sesja, podmiot), z udziałem w wartości sesji. Odpowiednik „Tabel 24/25" KM.
function perSessionEntityTable(metrics: Metric[]): OpTable | null {
  type Row = { day: string; entity: string; sval: number | null; svol: number | null };
  const map = new Map<string, Row>();
  const get = (day: string, e: string): Row => map.get(day + "|" + e) ?? { day, entity: e, sval: null, svol: null };
  for (const m of metrics) {
    if (!m.session_day) continue;
    if (m.key.startsWith("ede_sval::")) {
      const e = m.key.split("::")[1];
      map.set(m.session_day + "|" + e, { ...get(m.session_day, e), sval: m.value });
    } else if (m.key.startsWith("ede_svol::")) {
      const e = m.key.split("::")[1];
      map.set(m.session_day + "|" + e, { ...get(m.session_day, e), svol: m.value });
    }
  }
  const rows = [...map.values()].filter((r) => (r.sval ?? 0) > 0);
  if (!rows.length) return null;
  rows.sort((a, b) => (a.day === b.day ? (b.sval ?? 0) - (a.sval ?? 0) : a.day.localeCompare(b.day)));
  const sessVal = (d: string) => metrics.find((m) => m.key === "day_sess_val" && m.session_day === d)?.value ?? null;
  return {
    caption: "Tabela. Sprzedaż podmiotów z Grupy w rozbiciu na sesje (wartość, udział w wartości sesji, wolumen)",
    head: ["Sesja", "Podmiot", "Wartość sprzedaży (zł)", "Udział w wart. sesji", "Wolumen"],
    rows: rows.slice(0, 100).map((r) => {
      const sv = sessVal(r.day);
      const share = r.sval != null && sv ? Math.round((r.sval / sv) * 10000) / 100 : null;
      return [r.day, cap(r.entity), plnum(r.sval, "zł"), plnum(share, "%"), plnum(r.svol, "szt")];
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
  // Odwrócenie pozycji w tej samej sesji (zał. I lit. A pkt d MAR).
  const revTop = metrics
    .filter((m) => m.key.startsWith("rev_val::"))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0];
  if (revTop?.value != null)
    findings.push(
      `Odwrócenie pozycji w jednej sesji (${annexIRef("d")}): największe — ` +
        `${cap(revTop.key.split("::")[1])}, ${plnum(revTop.value, "zł")} (${revTop.session_day}).`,
    );

  // Gdy plan sprawy nie ma rozdziału „aktywność" (np. MLM) — fixing ląduje tutaj,
  // żeby wskaźnik z lit. g) zał. I nie przepadł.
  const hasAkt = casePlan(caseName).some((c) => c.kind === "aktywnosc");
  const fixPeakW = hasAkt ? null : mpeak(metrics, "fix_close_share");
  if (fixPeakW?.value != null) {
    sec.push(
      `Aktywność przy ustalaniu kursów odniesienia (${annexIRef("g")}). Udział Grupy w wolumenie ` +
        `transakcji fixingu zamknięcia sięgał ${plnum(fixPeakW.value, "%")} (sesja ${fixPeakW.session_day}); ` +
        `zestawienie per sesja w tabeli fixingu poniżej.`,
    );
    findings.push(`Udział Grupy w fixingu zamknięcia do ${plnum(fixPeakW.value, "%")} (${fixPeakW.session_day}) — ${annexIRef("g")}.`);
  }

  const washTables = [
    washDailyTable(metrics) ??
      dailyTable(
        metrics,
        "wash_",
        "Tabela. Udział transakcji wewnątrzgrupowych (wash trades) w wolumenie sesji",
        "Wash-trades (% wolumenu)",
      ),
    perSessionEntityTable(metrics),
    reversalTable(metrics),
    ...(hasAkt ? [] : [fixingTable(metrics)]),
  ].filter((x): x is OpTable => x != null);
  return {
    kind: "wash",
    chapterNo: no,
    title,
    bodyMd: sec.join("\n\n"),
    data: {
      table: washTables[0] ?? null,
      tables: washTables.length ? washTables : undefined,
      findings,
      legalRefs: [t.mar, t.rd, annexIRef("c"), annexIRef("d"), LEGAL_REFS.manipulacja],
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
  // Rozbicie sesja po sesji (wzorzec KM MLM: 10 sesji, każda z odrębnym zestawieniem
  // aktywności podmiotów). Dobór sesji jawny — kryterium w treści rozdziału.
  const ede = perSession ? edeByDay(metrics) : null;
  const ks = perSession ? keySessions(metrics, 10) : null;
  const sessionTables: OpTable[] = [];
  if (perSession && ks && ede) {
    const usable = ks.days.filter((d) => ede.get(d)?.size);
    if (usable.length) {
      sec.push(
        `Analizę przeprowadzono sesja po sesji dla ${plnum(usable.length)} sesji kluczowych ` +
          `(kryterium doboru: ${ks.criterion}). Dla każdej z tych sesji zestawiono aktywność ` +
          `poszczególnych podmiotów Grupy po stronie kupna i sprzedaży wraz z saldem wolumenu.`,
      );
      for (const d of usable) {
        sec.push(sessionNarrative(metrics, d));
        const t = sessionEntityTable(ede, d);
        if (t) sessionTables.push(t);
      }
    }
  }
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
  if (sessionTables.length)
    findings.push(`Rozbicie aktywności podmiotów Grupy sesja po sesji: ${plnum(sessionTables.length)} sesji kluczowych.`);
  // Tabela anulacji tylko przy policzonych danych zleceń (bez danych = nie
  // produkujemy tabeli samych „—").
  const cancelTable =
    (perSession ? layeringSessionTable(metrics) : null) ??
    (cancelPeak?.value != null
      ? dailyTable(
          metrics,
          "cancel_",
          "Tabela. Udział anulowanego wolumenu w zadeklarowanym wolumenie kupna Grupy",
          "Anulacje kupna (%)",
        )
      : null);
  const tables = [...(cancelTable ? [cancelTable] : []), ...sessionTables];
  return {
    kind: "layering",
    chapterNo: no,
    title,
    bodyMd: sec.join("\n\n"),
    data: {
      table: tables[0] ?? null,
      tables: tables.length ? tables : undefined,
      findings,
      legalRefs: [t.mar, t.rd, annexIRef("f")],
    },
  };
}

// IV.x — Improper matched orders. Zlecenia wewnątrzgrupowe dopasowane w czasie (TIME_DIFF).
function buildImoSubanaliza(caseName: string, metrics: Metric[]): SubResult {
  const { no, title } = ivMeta(caseName, "imo");
  const t = TECHNIQUES.imo;
  const cnt = mfind(metrics, "imo_count");
  const val = mfind(metrics, "imo_value");
  const vol = mfind(metrics, "imo_volume");
  const thr1 = mfind(metrics, "imo_thr_1s");
  const thr2 = mfind(metrics, "imo_thr_2s");
  const thr5 = mfind(metrics, "imo_thr_5s");
  const peak = mpeak(metrics, "imo_day_count");
  const topPair = metrics.filter((m) => m.key.startsWith("imo_pair::")).sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0];
  const topPairName = topPair ? topPair.key.slice("imo_pair::".length).split("|").map(cap).join(" ↔ ") : null;

  const sec: string[] = [];
  sec.push(
    `Nawiązując do rozdziału III, przedmiotem analizy są transakcje o cechach improper matched orders — zleceń ` +
      `kupna i sprzedaży o zbliżonych parametrach, składanych w krótkim odstępie czasu z rachunków działających ` +
      `w porozumieniu (${t.mar}; ${t.rd}). Miarą bliskości czasowej jest różnica czasu złożenia zlecenia kupna i ` +
      `sprzedaży (TIME_DIFF); za dopasowane uznano transakcje wewnątrzgrupowe o różnicy do 2 sekund.`,
  );
  if (cnt?.value != null) {
    sec.push(
      `W okresie analizy zidentyfikowano ${plnum(cnt.value)} transakcji wewnątrzgrupowych, w których zlecenia ` +
        `złożono niemal jednocześnie (≤2 s), o łącznej wartości ${plnum(val?.value, "zł")} i wolumenie ` +
        `${plnum(vol?.value, "szt")}.` +
        (thr1?.value != null
          ? ` Rozkład wg progu czasowego: ≤1 s — ${plnum(thr1.value)}, ≤2 s — ${plnum(thr2?.value)}, ≤5 s — ` +
            `${plnum(thr5?.value)} transakcji, co wskazuje na koncentrację dopasowań w bardzo krótkich odstępach.`
          : ``),
    );
    if (peak?.value != null)
      sec.push(
        `Poniższa tabela przedstawia rozkład dopasowanych zleceń na sesje. Największą liczbę odnotowano w sesji ` +
          `${peak.session_day} (${plnum(peak.value)}); dopasowania koncentrują się w końcowej części okresu analizy.`,
      );
    if (topPairName)
      sec.push(
        `Zestawienie par podmiotów wskazuje, że największą wartość dopasowanych zleceń odnotowano w relacji ` +
          `${topPairName} (${plnum(topPair!.value, "zł")}). Powtarzalność dopasowań między tymi samymi podmiotami ` +
          `stanowi okoliczność istotną dla oceny działania w porozumieniu.`,
      );
  } else {
    sec.push(`[Do uzupełnienia: brak policzonych dopasowań — policz wskaźniki na zakładce Analiza liczbowa.]`);
  }
  sec.push(
    `Składanie zleceń o zbliżonych parametrach i bliskim czasie, prowadzących do wzajemnego dopasowania między ` +
      `rachunkami powiązanymi, objęte jest wskaźnikami manipulacji z załącznika II do rozporządzenia 2016/522 i ` +
      `podlega ocenie w świetle art. 12 MAR. Ustalenie ma charakter faktyczny i nie przesądza o zamiarze ani ` +
      `kwalifikacji prawnokarnej, co pozostaje w gestii sądu.`,
  );

  const findings: string[] = [];
  if (cnt?.value != null)
    findings.push(`Zlecenia wewnątrzgrupowe dopasowane w czasie (≤2 s): ${plnum(cnt.value)} transakcji, ${plnum(val?.value, "zł")}.`);
  if (topPairName) findings.push(`Dominująca para dopasowań: ${topPairName} (${plnum(topPair!.value, "zł")}).`);

  const tables = [imoSessionTable(metrics), imoPairTable(metrics)].filter((x): x is OpTable => x != null);
  return {
    kind: "imo",
    chapterNo: no,
    title,
    bodyMd: sec.join("\n\n"),
    data: {
      table: tables[0] ?? null,
      tables: tables.length ? tables : undefined,
      findings,
      legalRefs: [t.mar, t.rd, annexIRef("c"), LEGAL_REFS.manipulacja],
    },
  };
}

// IV.x — Pump and dump. Fazy z silnika (kursy zamknięcia) + saldo; fallback: plik notowań.
function buildPumpDumpSubanaliza(caseName: string, metrics: Metric[], quotes?: QuoteDyn | null): SubResult {
  const { no, title } = ivMeta(caseName, "pumpdump");
  const t = TECHNIQUES.pumpdump;
  const sec: string[] = [
    `Schemat pump and dump (${t.mar}; ${t.rd}): zajęcie pozycji długiej, sztuczne wywindowanie ceny, ` +
      `a następnie wyprzedaż pakietu po zawyżonym kursie.`,
  ];
  const pump = mfind(metrics, "phase_pump_pct");
  const dump = mfind(metrics, "phase_dump_pct");
  const tot = mfind(metrics, "phase_total_pct");
  const findings: string[] = [];
  if (pump?.value != null) {
    sec.push(
      `Fazy zmiany kursu (na kursach zamknięcia, z danych transakcyjnych): faza wzrostowa („pump") — ` +
        `${pump.value > 0 ? "+" : ""}${plnum(pump.value, "%")} do szczytu w sesji ${pump.session_day}; ` +
        `faza spadkowa („dump") — ${plnum(dump?.value, "%")} (do ${dump?.session_day}); zmiana łączna ` +
        `${tot?.value != null && tot.value > 0 ? "+" : ""}${plnum(tot?.value, "%")}. Fazy zestawiać ze ` +
        `skumulowanym saldem Grupy (akumulacja/wyprzedaż) oraz wskaźnikami ${annexIRef("a")} i ${annexIRef("b")}.`,
    );
    findings.push(
      `Fazy kursu: pump ${pump.value > 0 ? "+" : ""}${plnum(pump.value, "%")} (szczyt ${pump.session_day}), ` +
        `dump ${plnum(dump?.value, "%")}; łącznie ${tot?.value != null && tot.value > 0 ? "+" : ""}${plnum(tot?.value, "%")}.`,
    );
  } else if (quotes) {
    sec.push(
      `Dynamika kursu w okresie od ${quotes.from} do ${quotes.to}: wzrost z ${plnum(quotes.start, "zł")} ` +
        `do maksimum ${plnum(quotes.maxClose, "zł")} (${quotes.peakDate}) — o ${plnum(quotes.changeStartMaxPct, "%")}; ` +
        `kurs na koniec okresu ${plnum(quotes.end, "zł")} (${plnum(quotes.changeStartEndPct, "%")} względem początku).`,
    );
  } else {
    sec.push(`[Do uzupełnienia: dynamika kursu (kurs początkowy, maksymalny, data szczytu, skala wzrostu) — z pliku notowań.]`);
  }
  sec.push(
    `Identyfikację fazy „pompowania" (kupno + komunikaty) oraz fazy wyprzedaży pakietu przez podmioty ` +
      `z Grupy należy powiązać z raportami bieżącymi spółki (rozdz. ESPI) oraz saldem Grupy. ` +
      `[Do uzupełnienia: przypisanie konkretnych komunikatów do faz.]`,
  );
  return {
    kind: "pumpdump",
    chapterNo: no,
    title,
    bodyMd: sec.join("\n\n"),
    data: { table: saldoTable(metrics), findings, legalRefs: [t.mar, t.rd, annexIRef("a"), annexIRef("b")] },
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

  // Fixing (lit. g) i koncentracja śródsesyjna (lit. e) — z detektorów silnika.
  const fixPeak = mpeak(metrics, "fix_close_share");
  const fixOpenPeak = mpeak(metrics, "fix_open_share");
  const concPeak = mpeak(metrics, "conc_peak_share");
  if (fixPeak?.value != null)
    sec.push(
      `Aktywność przy ustalaniu kursów odniesienia (${annexIRef("g")}). Udział Grupy w wolumenie ` +
        `transakcji fixingu zamknięcia sięgał ${plnum(fixPeak.value, "%")} (sesja ${fixPeak.session_day})` +
        (fixOpenPeak?.value != null
          ? `, a w fixingu otwarcia — ${plnum(fixOpenPeak.value, "%")} (${fixOpenPeak.session_day})`
          : ``) +
      `. Poniższa tabela fixingu zestawia udziały per sesja wraz z liczbą zleceń Grupy składanych ` +
        `w fazie przed zamknięciem (16:50–17:00) i niezrealizowanych — obraz oddziaływania na kurs ` +
        `teoretyczny bez wejścia do obrotu.`,
    );
  if (concPeak?.value != null)
    sec.push(
      `Koncentracja śródsesyjna (${annexIRef("e")}). Największa koncentracja aktywności Grupy w oknie ` +
        `15-minutowym odpowiadała ${plnum(concPeak.value, "%")} wolumenu całej sesji (${concPeak.session_day}).`,
    );

  // Rozbicie per sesja — aktywność każdego podmiotu Grupy dzień po dniu (jak
  // załączniki „aktywność <data>" w opinii wzorcowej). Krótkie okno → wszystkie
  // sesje; dłuższe → sesje kluczowe wg jawnego kryterium.
  const edeAkt = edeByDay(metrics);
  const allDays = mdays(metrics);
  const aktDays = (allDays.length <= 15 ? allDays : keySessions(metrics, 15).days).filter((d) => edeAkt.get(d)?.size);
  const aktTables: OpTable[] = [];
  if (aktDays.length) {
    sec.push(
      `Rozbicie per sesja. Dla ${allDays.length <= 15 ? "każdej sesji objętej analizą" : `${plnum(aktDays.length)} sesji kluczowych (kryterium: ${keySessions(metrics, 15).criterion})`} ` +
        `zestawiono niżej aktywność poszczególnych podmiotów Grupy po stronie kupna i sprzedaży wraz z saldem ` +
        `wolumenu — obraz tego, kto, kiedy i po której stronie obrotu występował.`,
    );
    for (const d of aktDays) {
      const t = sessionEntityTable(edeAkt, d);
      if (t) aktTables.push(t);
    }
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
  if (fixPeak?.value != null)
    findings.push(`Udział Grupy w fixingu zamknięcia do ${plnum(fixPeak.value, "%")} (${fixPeak.session_day}) — ${annexIRef("g")}.`);
  if (concPeak?.value != null)
    findings.push(`Koncentracja śródsesyjna Grupy do ${plnum(concPeak.value, "%")} wolumenu sesji w oknie 15 min (${concPeak.session_day}) — ${annexIRef("e")}.`);
  if (espi.length)
    findings.push(`W aktach ${espi.length} raportów ESPI/EBI do zestawienia czasowego ze skokami kursu (rozdz. IV.2).`);

  const tables = [
    ohlcTable(metrics),
    entityTable(metrics),
    entityBuyTable(metrics),
    saldoTable(metrics),
    fixingTable(metrics),
    ...aktTables,
  ].filter((t): t is OpTable => t != null);
  if (aktTables.length) findings.push(`Rozbicie aktywności per sesja: ${plnum(aktTables.length)} zestawień podmiot×sesja.`);
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
      legalRefs: [LEGAL_REFS.manipulacja, annexIRef("a"), annexIRef("b"), annexIRef("g"), annexIRef("e")],
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

  // Fazy pump/dump na kursach zamknięcia (deterministyczny silnik; metodyka
  // empirycznych badań manipulacji — analiza faz wzrostowej i spadkowej).
  const pump = mfind(metrics, "phase_pump_pct");
  const dump = mfind(metrics, "phase_dump_pct");
  const tot = mfind(metrics, "phase_total_pct");
  const cf = mfind(metrics, "phase_close_first");
  const cpk = mfind(metrics, "phase_close_peak");
  const clast = mfind(metrics, "phase_close_last");
  if (pump?.value != null)
    sec.push(
      `Fazy zmiany kursu (na kursach zamknięcia, z danych transakcyjnych). Faza wzrostowa („pump"): ` +
        `od ${plnum(cf?.value, "zł")} (${cf?.session_day}) do szczytu ${plnum(cpk?.value, "zł")} ` +
        `(${cpk?.session_day}) — zmiana ${pump.value > 0 ? "+" : ""}${plnum(pump.value, "%")}. ` +
        `Faza spadkowa („dump"): do ${plnum(clast?.value, "zł")} (${clast?.session_day}) — ` +
        `${plnum(dump?.value, "%")}. Zmiana łączna w okresie: ${tot?.value != null && tot.value > 0 ? "+" : ""}${plnum(tot?.value, "%")}. ` +
        `Sekwencja silnego wzrostu i następującej po nim wyprzedaży podlega ocenie łącznie z saldem ` +
        `Grupy (rozdz. aktywności) oraz wskaźnikami ${annexIRef("a")} i ${annexIRef("b")}.`,
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
  // Zestawienie notowań sesyjnych (OHLC) — źródło „kursów granicznych faz" i wolumenów,
  // o które prosi ta analiza; liczone przez silnik, więc nie [do uzupełnienia].
  const ohlc = ohlcTable(metrics);
  if (ohlc)
    sec.push(
      `Zestawienie notowań sesyjnych (kurs otwarcia, najwyższy, najniższy, zamknięcia, zmiana i wolumen) ` +
        `przedstawia poniższa tabela OHLC — stanowi ono podstawę oceny dynamiki kursu oraz wyznaczenia ` +
        `kursów granicznych faz wzrostowej i spadkowej.`,
    );
  sec.push(
    `Ocena. [Do uzupełnienia przez biegłego: czy dynamika kursu znajduje uzasadnienie w fundamentach i ` +
      `informacjach publicznych — brak takiego uzasadnienia wzmacnia tezę o oderwaniu ceny od wartości.]`,
  );

  const findings: string[] = [];
  if (pump?.value != null)
    findings.push(
      `Fazy kursu (zamknięcia): pump ${pump.value > 0 ? "+" : ""}${plnum(pump.value, "%")} ` +
        `(${cf?.session_day} → ${cpk?.session_day}), dump ${plnum(dump?.value, "%")} (→ ${clast?.session_day}); ` +
        `łącznie ${tot?.value != null && tot.value > 0 ? "+" : ""}${plnum(tot?.value, "%")}.`,
    );
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
      table: ohlc,
      tables: ohlc ? [ohlc] : undefined,
      findings,
      legalRefs: [LEGAL_REFS.informacjaPoufna, LEGAL_REFS.obowiazekRaportowy, annexIRef("a"), annexIRef("b")],
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

// ── Atrybucja podmiotowa — rejestr aktywności rachunków Grupy (KM-style) ──────
// Wzorzec KM: „Texla PTE Ltd. — 20, 30 maja, 1, 3 czerwca, 21 września (5 dni)".
// Deterministycznie z ede_* (sesje, w których podmiot wystąpił po stronie kupna
// lub sprzedaży) + wartości. ≤10 sesji → wymień wszystkie daty; więcej → zakres.
function attributionRegister(metrics: Metric[], maxEntities = 12): string[] {
  type Acc = { entity: string; days: Set<string>; bval: number; sval: number };
  const acc = new Map<string, Acc>();
  for (const m of metrics) {
    if (!m.session_day || !m.key.startsWith("ede_")) continue;
    const entity = m.key.split("::")[1];
    if (!entity) continue;
    const a = acc.get(entity) ?? { entity, days: new Set<string>(), bval: 0, sval: 0 };
    a.days.add(m.session_day);
    if (m.key.startsWith("ede_bval::")) a.bval += m.value ?? 0;
    if (m.key.startsWith("ede_sval::")) a.sval += m.value ?? 0;
    acc.set(entity, a);
  }
  const all = [...acc.values()].sort((a, b) => b.bval + b.sval - (a.bval + a.sval));
  if (!all.length) return [];
  const round2 = (x: number) => Math.round(x * 100) / 100;
  const lines = all.slice(0, maxEntities).map((a, i) => {
    const days = [...a.days].sort();
    const daysTxt =
      days.length <= 10
        ? days.join(", ")
        : `od ${days[0]} do ${days[days.length - 1]}`;
    const saldo = round2(a.sval - a.bval);
    return (
      `${i + 1}. ${cap(a.entity)} — sesje: ${daysTxt} (${days.length} ${days.length === 1 ? "sesja" : "sesji"}); ` +
      `kupno łącznie ${plnum(round2(a.bval), "zł")}, sprzedaż łącznie ${plnum(round2(a.sval), "zł")}, ` +
      `saldo gotówkowe ${saldo > 0 ? "+" : ""}${plnum(saldo, "zł")}.`
    );
  });
  const rest = all.slice(maxEntities);
  if (rest.length) {
    const rb = round2(rest.reduce((s, a) => s + a.bval, 0));
    const rs = round2(rest.reduce((s, a) => s + a.sval, 0));
    lines.push(
      `${maxEntities + 1}. Pozostałe podmioty z Grupy (${rest.length}) — łącznie kupno ${plnum(rb, "zł")}, ` +
        `sprzedaż ${plnum(rs, "zł")}.`,
    );
  }
  return lines;
}

// Relacje transakcyjne wewnątrz Grupy — pary wash (pair_intra::) i dopasowań (imo_pair::).
function pairRegister(metrics: Metric[]): string[] {
  const fmtPair = (k: string, pfx: string) => k.slice(pfx.length).split("|").map(cap).join(" ↔ ");
  const wash = metrics
    .filter((m) => m.key.startsWith("pair_intra::"))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .slice(0, 5)
    .map((m) => `${fmtPair(m.key, "pair_intra::")} (obrót wzajemny ${plnum(m.value, "zł")})`);
  const imo = metrics
    .filter((m) => m.key.startsWith("imo_pair::"))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .slice(0, 3)
    .map((m) => `${fmtPair(m.key, "imo_pair::")} (zlecenia dopasowane ≤2 s, ${plnum(m.value, "zł")})`);
  const out: string[] = [];
  if (wash.length) out.push(`pary o największym obrocie wzajemnym: ${wash.join("; ")}`);
  if (imo.length) out.push(`pary o dopasowaniach czasowych zleceń: ${imo.join("; ")}`);
  return out;
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
  const groupVal = mfind(metrics, "group_turnover_value");
  const nTx = mfind(metrics, "totals_transactions");
  const valTx = mfind(metrics, "totals_value");
  const seller = topSeller(metrics);
  const buyer = topBuyer(metrics);
  const imoCnt = mfind(metrics, "imo_count");
  const imoVal = mfind(metrics, "imo_value");
  const days = mdays(metrics);
  const lastDay = days.length ? days[days.length - 1] : null;
  const atLast = (k: string) =>
    lastDay ? metrics.find((m) => m.key === k && m.session_day === lastDay)?.value ?? null : null;
  const cumCash = atLast("day_grp_cum_cash");
  const cumVol = atLast("day_grp_cum_vol");
  const hi = mpeak(metrics, "day_high");
  const ups = metrics
    .filter((m) => m.key === "day_change_pct" && (m.value ?? 0) > 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const dn = metrics.filter((m) => m.key === "day_change_pct").sort((a, b) => (a.value ?? 0) - (b.value ?? 0))[0];
  const topImo = metrics.filter((m) => m.key.startsWith("imo_pair::")).sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0];

  const approved = stored
    .filter((s) => s.status === "zatwierdzona" && s.chapter_no.startsWith("IV"))
    .sort((a, b) => a.chapter_no.localeCompare(b.chapter_no, "pl"));
  const techKinds = new Set(["wash", "imo", "layering", "pumpdump"]);
  const approvedTech = approved.filter((s) => techKinds.has(s.kind));
  const findingsOf = (kind: string) => (approved.find((s) => s.kind === kind)?.data?.findings ?? []).join(" ").trim();

  // Materiał wyciągnięty z akt (ekstrakcje PDF) — zapisany jako subanalizy pomocnicze.
  const events =
    (stored.find((s) => s.kind === "espi_events")?.data as unknown as {
      events?: { date?: string; type?: string; subject?: string; session?: string }[];
    } | null)?.events ?? [];
  const evSess = events.filter((e) => e.session);
  const shared =
    (stored.find((s) => s.kind === "krs_boards")?.data as unknown as {
      shared?: { name?: string; entities?: string[] }[];
    } | null)?.shared ?? [];
  const ipRows = stored.find((s) => s.kind === "powiazania_dane")?.data?.table?.rows ?? [];

  const parts: string[] = [];
  parts.push(
    `Wnioski formułuje się wyłącznie na podstawie ustaleń z rozdziału IV (analiza materiału dowodowego)` +
      (nTx?.value != null
        ? `, opartych na ${plnum(nTx.value)} transakcjach o łącznej wartości ${plnum(valTx?.value, "zł")} (dane UTP/GPW)`
        : ``) +
      `. Celem opinii jest weryfikacja, czy zebrany materiał potwierdza zarzuty postawione w zawiadomieniu ` +
      `— bez przejmowania tez z zawiadomienia ani z opinii innego biegłego. Odpowiedzi odnoszą się wprost ` +
      `do pytań postanowienia (Q1–Q4).`,
  );

  if (!approved.length) {
    parts.push(
      `[Do uzupełnienia: brak zatwierdzonych rozdziałów IV. Wnioski można sformułować dopiero po ` +
        `wykonaniu i zatwierdzeniu analiz dowodowych (techniki, aktywność, relacje).]`,
    );
  } else {
    // ── Q1 — sztuczne kształtowanie ceny / wprowadzenie w błąd / racjonalność ekonomiczna ──
    parts.push(PROSECUTOR_QUESTIONS[0]);
    const q1: string[] = [];
    if (hi?.value != null && ups[0]?.value != null)
      q1.push(
        `kurs osiągnął maksimum ${plnum(hi.value, "zł")} (${hi.session_day}), przy skokowych zmianach ` +
          `zamknięcia do +${plnum(ups[0].value, "%")} (${ups[0].session_day})` +
          (dn?.value != null && dn.value < 0 ? ` i spadkach do ${plnum(dn.value, "%")} (${dn.session_day})` : ``) +
          ` — rozdz. IV.3`,
      );
    if (groupShare?.value != null)
      q1.push(
        `rachunki Grupy odpowiadały za ${plnum(groupShare.value, "%")} wartości obrotu` +
          (groupVal?.value != null ? ` (${plnum(groupVal.value, "zł")})` : ``) +
          ` — rozdz. IV.3`,
      );
    if (washPeak?.value != null)
      q1.push(`transakcje wzajemne sięgały ${plnum(washPeak.value, "%")} wolumenu sesji (${washPeak.session_day}) — rozdz. IV.4`);
    if (cumCash != null)
      q1.push(
        `skumulowane saldo gotówki Grupy wyniosło ${plnum(cumCash, "zł")}` +
          (cumVol != null ? ` przy skumulowanym saldzie wolumenu ${plnum(cumVol, "szt")}` : ``) +
          ` — obraz odpowiadający upłynnianiu znacznego pakietu akcji (rozdz. IV.3)`,
      );
    parts.push(
      `Odpowiedź na Q1: ${q1.join("; ")}. Obrót o takiej strukturze mógł dawać nieprawdziwe sygnały co do ` +
        `podaży, popytu i płynności instrumentu oraz przyczyniać się do ukształtowania ceny na poziomie ` +
        `oderwanym od uzasadnienia ekonomicznego` +
        (findingsOf("ekofin") ? ` (ustalenia ekonomiczno-finansowe — rozdz. IV.1: ${findingsOf("ekofin")})` : ``) +
        `.`,
    );

    // ── Q2 — techniki manipulacyjne ──
    parts.push(PROSECUTOR_QUESTIONS[1]);
    if (approvedTech.length) {
      const lines = approvedTech.map((s) => {
        const t = TECHNIQUES[s.kind as TechniqueId];
        const f = (s.data?.findings ?? []).join(" ").trim();
        return `• ${t.label} (${t.mar}; ${t.rd}) — ${f || "[brak ustaleń liczbowych w rozdziale]"}`;
      });
      parts.push(
        `Odpowiedź na Q2 — w materiale dowodowym zidentyfikowano ustalenia odpowiadające następującym ` +
          `technikom:\n${lines.join("\n")}`,
      );
    }

    // ── Q3 — działanie wspólnie i w porozumieniu ──
    parts.push(PROSECUTOR_QUESTIONS[2]);
    const q3: string[] = [];
    if (ipRows.length) {
      const r0 = ipRows[0];
      q3.push(
        `zbieżność techniczna: ${plnum(ipRows.length)} par rachunków korzystało ze wspólnych adresów IP ` +
          `(najsilniej ${r0[0]} ↔ ${r0[1]}: ${r0[2]} wspólnych IP) — rozdz. IV.7`,
      );
    }
    if (imoCnt?.value != null)
      q3.push(
        `zbieżność czasowa zleceń: ${plnum(imoCnt.value)} transakcji wewnątrzgrupowych o zleceniach złożonych ` +
          `w odstępie ≤2 s, o wartości ${plnum(imoVal?.value, "zł")}` +
          (topImo ? ` (dominująca para ${topImo.key.slice("imo_pair::".length).split("|").map(cap).join(" ↔ ")})` : ``) +
          ` — rozdz. IV.5`,
      );
    if (shared.length) {
      const names = shared.slice(0, 3).map((x) => x.name).filter(Boolean).join(", ");
      q3.push(
        `powiązania osobowe: ${plnum(shared.length)} osób pełni funkcje w więcej niż jednym podmiocie ` +
          `ujawnionym w odpisach KRS (m.in. ${names}) — rozdz. IV.7`,
      );
    }
    if (cancelPeak?.value != null)
      q3.push(
        `obraz arkusza zleceń: anulacje zleceń kupna Grupy sięgały ${plnum(cancelPeak.value, "%")} ` +
          `zadeklarowanego wolumenu (${cancelPeak.session_day}) — rozdz. IV.6`,
      );
    parts.push(
      q3.length
        ? `Odpowiedź na Q3 — okoliczności wskazujące na współdziałanie: ${q3.join("; ")}.`
        : `Odpowiedź na Q3: [do uzupełnienia po zatwierdzeniu rozdziału relacji].`,
    );

    // ── Q4 — pozostałe uwagi biegłego ──
    parts.push(PROSECUTOR_QUESTIONS[3]);
    const q4: string[] = [];
    if (evSess.length)
      q4.push(
        `zbieżność czasowa zdarzeń korporacyjnych z sesjami o skrajnych parametrach obrotu: ` +
          evSess.map((e) => `${e.date} — ${(e.type || e.subject || "").trim()} (sesja ${e.session})`).join("; ") +
          ` — rozdz. IV.2`,
      );
    if (seller)
      q4.push(
        `koncentracja podaży: największym sprzedawcą był podmiot ${cap(seller.entity)} ` +
          `(${plnum(seller.share, "%")} wartości obrotu; ${plnum(seller.val, "zł")})`,
      );
    if (buyer && buyer.entity !== seller?.entity)
      q4.push(`po stronie kupna dominował podmiot ${cap(buyer.entity)} (${plnum(buyer.val, "zł")})`);
    parts.push(q4.length ? `Odpowiedź na Q4 — okoliczności dodatkowe: ${q4.join("; ")}.` : `Odpowiedź na Q4: [do uzupełnienia].`);

    // ── Atrybucja podmiotowa — kto, kiedy i w jakiej skali (rejestr z ede_*) ──
    const reg = attributionRegister(metrics);
    if (reg.length) {
      parts.push(
        `Atrybucja podmiotowa. Rejestr aktywności rachunków Grupy — sesje, w których dany podmiot ` +
          `występował po stronie kupna lub sprzedaży, wraz z łącznymi wartościami (dane transakcyjne ` +
          `UTP/TREM; szczegółowe rozbicia per sesja — rozdział IV):\n${reg.join("\n")}`,
      );
      const pairs = pairRegister(metrics);
      if (pairs.length)
        parts.push(
          `Relacje transakcyjne wewnątrz Grupy istotne dla oceny współdziałania: ${pairs.join("; ")}.`,
        );
    }

    // Pozostałe zatwierdzone rozdziały IV (ekofin/ESPI/aktywność/relacje) — zestawienie.
    const other = approved.filter((s) => !techKinds.has(s.kind));
    if (other.length) {
      const fs = other
        .map((s) => `${s.title} (rozdz. ${s.chapter_no}): ${(s.data?.findings ?? []).join(" ")}`.trim())
        .filter(Boolean);
      if (fs.length) parts.push(`Zestawienie pozostałych ustaleń rozdziału IV:\n• ${fs.join("\n• ")}`);
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

  // Tabele pomocnicze z ekstrakcji źródeł PDF: zdarzenia ESPI → rozdział ESPI,
  // organy z odpisów KRS → rozdział relacji. Realne dane z akt, nie placeholdery.
  const AUX_TABLES: [IVKind, string][] = [
    ["espi", "espi_events"],
    ["relacje", "krs_boards"],
    ["ekofin", "fin_stats"],
  ];
  for (const [kind, auxKind] of AUX_TABLES) {
    const p = plan.find((x) => x.kind === kind);
    const aux = stored.find((s) => s.kind === auxKind)?.data?.table ?? null;
    if (!p || !aux) continue;
    const ch = merged.find((x) => x.no === p.no);
    if (!ch || ch.status === "todo") continue;
    const cur = chapterTables(ch);
    if (!cur.some((t) => t.caption === aux.caption)) ch.tables = [...cur, aux];
  }

  // Placeholdery wykresów/tabel. Gdy silnik ma serie danych — wykres renderuje
  // się naprawdę (chart); bez danych zostaje oznaczone miejsce dla biegłego.
  for (const p of plan) {
    const ph = CHAPTER_PLACEHOLDERS[p.kind];
    if (!ph?.length) continue;
    const ch = merged.find((x) => x.no === p.no);
    if (ch && ch.status !== "todo")
      ch.placeholders = ph.map((x) => ({
        ...x,
        chart: x.kind === "wykres" ? chartFor(p.kind, x.name, metrics) : undefined,
      }));
  }

  // Globalna numeracja tabel (Tabela nr N) w kolejności rozdziałów — spójna dla
  // podpisów w rozdziałach i spisu tabel w rozdziale VI. Rozdział VI (spis) pomijany.
  let tno = 0;
  const toc: { n: number; caption: string; chNo: string }[] = [];
  for (const c of merged) {
    if (c.no === "VI") continue;
    for (const t of chapterTables(c)) {
      tno++;
      t.caption = t.caption.replace(/^Tabela(\s+nr\s+\d+)?\.\s*/, `Tabela nr ${tno}. `);
      toc.push({ n: tno, caption: t.caption.replace(/^Tabela nr \d+\.\s*/, ""), chNo: c.no });
    }
  }
  // Wykresy per sesja (słupki grupowane kupno/sprzedaż per podmiot) — dla
  // rozdziałów z tabelami „w sesji <data>" (layering perSession, aktywność).
  // Wzorzec KM MLM: dziesiątki wykresów sesyjnych przy analizie layeringu.
  const edeAll = edeByDay(metrics);
  for (const ch of merged) {
    if (ch.status === "todo") continue;
    const dates = [
      ...new Set(
        chapterTables(ch)
          .map((t) => t.caption.match(/w sesji (\d{4}-\d{2}-\d{2})/)?.[1])
          .filter((d): d is string => !!d),
      ),
    ].slice(0, 12);
    if (!dates.length) continue;
    const extra: Placeholder[] = [];
    for (const d of dates) {
      const byEnt = edeAll.get(d);
      if (!byEnt?.size) continue;
      const rows = [...byEnt.values()].sort((a, b) => b.bval + b.sval - (a.bval + a.sval)).slice(0, 14);
      extra.push({
        kind: "wykres",
        name: `Aktywność podmiotów z Grupy w sesji ${d} — wartość kupna i sprzedaży`,
        chart: {
          title: `Aktywność podmiotów z Grupy — sesja ${d}`,
          days: rows.map((r) => cap(r.entity).slice(0, 18)),
          left: { label: "Kupno", unit: "zł", values: rows.map((r) => (r.bval > 0 ? r.bval : null)), kind: "bars" },
          right: { label: "Sprzedaż", unit: "zł", values: rows.map((r) => (r.sval > 0 ? r.sval : null)), kind: "bars" },
        },
      });
    }
    if (extra.length) ch.placeholders = [...(ch.placeholders ?? []), ...extra];
  }

  // Numeracja wykresów: wyrenderowane z danych silnika (chart) + oznaczone
  // miejsca „do wstawienia" — wspólna, globalna numeracja jak w KM.
  let wno = 0;
  const chartToc: { n: number; name: string; chNo: string; rendered: boolean }[] = [];
  for (const c of merged) {
    if (c.no === "VI") continue;
    for (const ph of c.placeholders ?? []) {
      if (ph.kind === "wykres") {
        wno++;
        ph.label = ph.chart ? `Wykres nr ${wno}` : `Wykres nr ${wno} — do wstawienia`;
        chartToc.push({ n: wno, name: ph.name, chNo: c.no, rendered: !!ph.chart });
      } else {
        ph.label = "Tabela — do wstawienia";
      }
    }
  }
  const vi = merged.find((c) => c.no === "VI");
  if (vi && (toc.length || chartToc.length)) {
    vi.status = "ready";
    vi.paras = [
      ...toc.map((e) => ({ conf: "grounded" as Conf, text: `Tabela nr ${e.n}. ${e.caption} (rozdz. ${e.chNo}).` })),
      ...chartToc.map((e) => ({
        conf: (e.rendered ? "grounded" : "review") as Conf,
        text: `Wykres nr ${e.n}. ${e.name} (rozdz. ${e.chNo})${e.rendered ? "" : " — do wstawienia"}.`,
      })),
    ];
  }

  return {
    caseName: caseRow.name,
    signature: caseRow.signature,
    expert: EXPERT,
    generatedAt: new Date().toISOString(),
    legalBasis: LEGAL_BASIS,
    chapters: merged,
  };
}
