// Renderer raportu „Spoofing & Layering" → PDF (kit pdfmake, IBM Plex Sans, spis treści,
// tabele, wykres). Wejście: wynik detektora (engine.spoofing) zapisany jako subanaliza
// `spoofing_analysis`. Kolorowane tabele sekwencji zleceń jak we wzorze analityka:
// warstwa anulowana (czerwony), warstwa częściowa (pomarańczowy), sprzedaż zrealizowana (zielony).
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BLUE, CELLBG, SUB, gridLayout, dataTable, h1Nodes, frame, renderPdf, type Pm } from "@/lib/pdf/kit";

import { chartSvg, type ChartSpec } from "./charts";

export type SpoofOrder = { entity: string; side: string; entry: string; cancel: string; limit: number; vol: number; realised: number; cancelled: number; cls: string };
export type SpoofDay = {
  day: string; declared_buy: number; cancelled_buy: number; cancel_ratio: number; buy_orders: number;
  layer_orders: number; price_levels: number; price_min: number | null; price_max: number | null;
  sell_exec_vol: number; sell_exec_orders: number; entities: string[]; manip: boolean; orders: SpoofOrder[];
};
export type SpoofAnalysis = {
  days: SpoofDay[]; manip_days: string[]; entities: string[];
  totals: { sessions_flagged: number; cancelled_buy_total: number; declared_buy_total: number; sell_exec_total: number; layer_orders_total: number };
  params: { min_cancel_vol: number; min_cancel_share: number };
  meta: { caseName: string; signature: string };
};

const DETAIL_DAYS = 12;
const ORANGE = "#FCE8CC", REDBG = "#F8D2D5", GREENBG = "#D7EAD9";
const pl = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("pl-PL"));
const pct = (r: number) => `${(r * 100).toFixed(1).replace(".", ",")}%`;
const zl = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 4 }));

// Wykres słupkowy (anulowany wolumen kupna per sesja) → PNG (resvg+DejaVu, jak w opinii).
let fontPath: string | null | undefined;
function chartDataUrl(spec: ChartSpec): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Resvg } = require("@resvg/resvg-js") as typeof import("@resvg/resvg-js");
    if (fontPath === undefined) {
      const p = join(process.cwd(), "node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf");
      try { readFileSync(p); fontPath = p; } catch { fontPath = null; }
    }
    const r = new Resvg(chartSvg(spec), {
      fitTo: { mode: "width", value: 1400 },
      font: fontPath ? { fontFiles: [fontPath], defaultFontFamily: "DejaVu Sans", loadSystemFonts: false } : { loadSystemFonts: true },
      background: "white",
    });
    return "data:image/png;base64," + Buffer.from(r.render().asPng()).toString("base64");
  } catch { return null; }
}

function legendChip(fill: string, text: string): Pm {
  return { columns: [
    { width: 14, table: { body: [[{ text: " ", fillColor: fill, fontSize: 6 }]] }, layout: "noBorders", margin: [0, 1, 0, 0] },
    { width: "*", text, fontSize: 8.5, margin: [4, 0, 0, 0] },
  ], columnGap: 0, margin: [0, 0, 0, 3] };
}

const clsLabel: Record<string, string> = {
  layer: "warstwa kupna — anulowana",
  layer_partial: "warstwa kupna — częśc. zrealizowana",
  sell_exec: "sprzedaż — zrealizowana",
};
const clsFill: Record<string, string> = { layer: REDBG, layer_partial: ORANGE, sell_exec: GREENBG };

// Kolorowana tabela sekwencji zleceń dla jednej sesji.
function orderTable(orders: SpoofOrder[]): Pm {
  const head = ["Podmiot", "Czas", "Str.", "Limit", "Wolumen", "Zrealiz.", "Anulow.", "Rodzaj"].map(
    (h) => ({ text: h, bold: true, alignment: "center", fillColor: CELLBG, fontSize: 7.5, margin: [2, 2, 2, 2] }));
  const rows = orders.map((o) => {
    const fill = clsFill[o.cls] || "#FFFFFF";
    const cell = (t: string, align = "left") => ({ text: t, fontSize: 7.5, alignment: align, fillColor: fill, margin: [2, 1.5, 2, 1.5] });
    return [
      cell(o.entity), cell(o.entry || "—", "center"), cell(o.side, "center"),
      cell(zl(o.limit), "right"), cell(pl(o.vol), "right"), cell(pl(o.realised), "right"),
      cell(pl(o.cancelled), "right"), cell(clsLabel[o.cls] || o.cls),
    ];
  });
  return {
    table: { headerRows: 1, widths: [96, 42, 18, 40, 52, 52, 52, "*"], body: [head, ...rows] },
    layout: gridLayout(), margin: [0, 2, 0, 10],
  };
}

function dayNarrative(d: SpoofDay): string {
  const range = d.price_min != null && d.price_max != null ? `${zl(d.price_min)}–${zl(d.price_max)} zł` : "—";
  return (
    `W dniu ${d.day} podmiot(y) ${d.entities.join(", ") || "Grupy"} złożyły ${d.layer_orders} zleceń kupna o cechach ` +
    `warstw (łączny zadeklarowany wolumen ${pl(d.declared_buy)} szt), z których anulowano ${pl(d.cancelled_buy)} szt ` +
    `(udział anulacji ${pct(d.cancel_ratio)}), rozłożonych na ${d.price_levels} poziomach cen (${range}); równolegle ` +
    `Grupa zrealizowała sprzedaż ${pl(d.sell_exec_vol)} szt po stronie przeciwnej. Wzorzec — duże, w większości ` +
    `anulowane zlecenia kupna wielowarstwowo, przy jednoczesnej realizacji sprzedaży — odpowiada technice ` +
    `layering/spoofing (zał. I lit. a MAR; art. 12 ust. 1 lit. a MAR).`
  );
}

function docDefinition(a: SpoofAnalysis): Pm {
  const sig = a.meta.signature || "—";
  const content: Pm[] = [];

  // ── strona tytułowa ──
  content.push(
    { text: `Sygn. akt ${sig}`, alignment: "center", fontSize: 11, margin: [0, 80, 0, 0] },
    { text: "ANALIZA — SPOOFING I LAYERING", alignment: "center", bold: true, color: BLUE, fontSize: 26, margin: [0, 60, 0, 8] },
    { text: "Wykrywanie sygnałów i dowodów techniki manipulacji na podstawie arkusza zleceń", alignment: "center", italics: true, fontSize: 12, margin: [30, 0, 30, 0] },
    { text: a.meta.caseName ? `w sprawie ${a.meta.caseName}` : "", alignment: "center", fontSize: 12, margin: [30, 26, 30, 0] },
    { text: "Analiza deterministyczna (arkusz zleceń UTP). Ocena prawna należy do biegłego i sądu.", alignment: "center", italics: true, fontSize: 8.5, color: SUB, margin: [40, 120, 40, 0] },
  );

  // ── spis treści ──
  content.push(
    { text: "Spis treści", style: "tocTitle", alignment: "center", pageBreak: "before", margin: [0, 0, 0, 16] },
    { toc: {} },
  );

  // ── metodyka ──
  content.push(...h1Nodes("METODYKA I PODSTAWY", true));
  content.push(
    { text: [{ text: "Definicja. ", bold: true }, "Layering to odmiana spoofingu — składanie wielu zleceń limitowanych po jednej stronie arkusza na różnych poziomach cen (warstwy), bez zamiaru realizacji, w celu wywołania złudzenia podaży/popytu; realizacja następuje po stronie przeciwnej po sztucznie utworzonej cenie, a zlecenia-warstwy są następnie anulowane (G. Mark, „Spoofing and Layering”, J. Corp. L. 45:2)."], style: "body", margin: [0, 0, 0, 6] },
    { text: [{ text: "Podstawa prawna. ", bold: true }, "Art. 12 ust. 1 lit. a) rozporządzenia MAR (2014/596) — zlecenia wprowadzające lub mogące wprowadzać w błąd co do podaży/popytu lub ceny; Załącznik I sekcja A lit. a) MAR; w prawie USA — CEA §4c(a)(5) (CFTC) oraz Exchange Act §9(a)(2)/§10(b)."], style: "body", margin: [0, 0, 0, 6] },
    { text: [{ text: "Źródło danych. ", bold: true }, "Arkusz zleceń UTP (jeden wiersz na zlecenie): strona (K/S), wolumen zadeklarowany, wolumen zrealizowany, limit (cena), czas wprowadzenia i modyfikacji/anulacji. „Anulowany” wolumen = wolumen zadeklarowany − zrealizowany (część niewprowadzona do obrotu)."], style: "body", margin: [0, 0, 0, 6] },
    { text: [{ text: "Kryterium wykrycia (per sesja). ", bold: true }, `duże zlecenia kupna Grupy, w większości niezrealizowane i anulowane (udział anulacji ≥ ${pct(a.params.min_cancel_share)}, anulowany wolumen ≥ ${pl(a.params.min_cancel_vol)} szt), rozłożone na wielu poziomach cen, przy jednoczesnej realizacji sprzedaży Grupy po stronie przeciwnej. Detekcja jest obiektywna i wskazuje wszystkie sesje spełniające kryterium; wybór najsilniejszych przykładów należy do biegłego.`], style: "body", margin: [0, 0, 0, 8] },
    { text: "Legenda kolorów w tabelach sekwencji:", bold: true, fontSize: 9.5, margin: [0, 0, 0, 4] },
    legendChip(REDBG, "warstwa kupna anulowana — zlecenie „layeringowe” niewprowadzone do obrotu (pozorny popyt)"),
    legendChip(ORANGE, "warstwa kupna częściowo zrealizowana / modyfikowana"),
    legendChip(GREENBG, "sprzedaż zrealizowana — strona przeciwna, korzystająca ze sztucznie utworzonej ceny"),
  );

  // ── podsumowanie ──
  content.push(...h1Nodes("PODSUMOWANIE — SESJE ZE ZNAMIONAMI LAYERING/SPOOFING", false));
  content.push({
    text: [
      "Na podstawie arkusza zleceń wykryto ", { text: `${a.totals.sessions_flagged} sesji`, bold: true },
      " spełniających kryterium layering/spoofing. Łączny anulowany wolumen kupna Grupy w tych sesjach: ",
      { text: `${pl(a.totals.cancelled_buy_total)} szt`, bold: true }, " (z zadeklarowanych ", pl(a.totals.declared_buy_total),
      " szt); liczba zleceń-warstw: ", { text: pl(a.totals.layer_orders_total), bold: true },
      "; zrealizowana sprzedaż Grupy po stronie przeciwnej: ", pl(a.totals.sell_exec_total), " szt. Podmioty: ",
      { text: a.entities.join(", ") || "—", bold: true }, ".",
    ], style: "body", margin: [0, 0, 0, 8],
  });

  const flagged = a.days.filter((d) => d.manip).sort((x, y) => y.cancelled_buy - x.cancelled_buy);
  const top = flagged.slice(0, DETAIL_DAYS);
  const img = chartDataUrl({
    title: "Anulowany wolumen kupna Grupy — sesje ze znamionami layering (top 12)",
    days: top.map((d) => d.day.slice(5)),
    left: { kind: "bars", values: top.map((d) => d.cancelled_buy), unit: "szt", label: "anul. kupno" },
  } as ChartSpec);
  if (img) content.push({ image: img, width: 400, alignment: "center", margin: [0, 4, 0, 8] });

  content.push({ text: `Wszystkie ${flagged.length} sesji spełniających kryterium (malejąco wg anulowanego wolumenu kupna):`, fontSize: 9.5, bold: true, margin: [0, 2, 0, 4] });
  content.push(dataTable(
    ["Data", "Podmioty", "Zadekl. kupno", "Anulowane", "Udział", "Warstwy", "Poziomy", "Sprzedaż zreal."],
    flagged.map((d) => [d.day, d.entities.join(", ") || "—", pl(d.declared_buy), pl(d.cancelled_buy), pct(d.cancel_ratio), String(d.layer_orders), String(d.price_levels), pl(d.sell_exec_vol)]),
    [13, 22, 12, 12, 9, 8, 8, 16],
  ));
  content.push({ text: "Źródło: arkusz zleceń UTP (opracowanie własne, detekcja deterministyczna).", italics: true, fontSize: 7.5, color: SUB, margin: [0, 1, 0, 6] });

  // ── szczegóły sekwencji (dni z zachowanymi zleceniami) ──
  const detail = top.filter((d) => d.orders && d.orders.length);
  if (detail.length) {
    content.push(...h1Nodes("SEKWENCJE ZLECEŃ — SZCZEGÓŁY", false));
    content.push({ text: `Poniżej sekwencje zleceń Grupy dla ${detail.length} najsilniejszych sesji (kolory wg legendy w Metodyce).`, style: "body", margin: [0, 0, 0, 6] });
    for (const d of detail) {
      content.push({ text: `Sesja ${d.day}`, style: "h2", alignment: "left", margin: [0, 10, 0, 3], tocItem: true, tocStyle: { color: "#3A3A3A", fontSize: 9.5 }, tocMargin: [16, 1, 0, 0] });
      content.push({ text: dayNarrative(d), fontSize: 9, lineHeight: 1.35, margin: [0, 0, 0, 5] });
      content.push(orderTable(d.orders));
    }
  }

  // ── wnioski ──
  content.push(...h1Nodes("WNIOSKI", false));
  content.push(
    { text: [
      "Zgromadzony materiał (arkusz zleceń) wskazuje na powtarzalny, wielosesyjny wzorzec odpowiadający technice ",
      { text: "layering/spoofing", bold: true }, ": Grupa wprowadzała duże zlecenia kupna na wielu poziomach cen, w przeważającej części ",
      { text: "niezrealizowane i anulowane", bold: true }, " (tworzące pozorny popyt), przy jednoczesnej realizacji sprzedaży po stronie przeciwnej po podniesionej cenie.",
    ], style: "body", margin: [0, 0, 0, 6] },
    { text: "Niniejsza analiza ma charakter faktyczny i deterministyczny (wprost z arkusza zleceń). Ustalenie, czy zachowanie wyczerpuje znamiona manipulacji w rozumieniu art. 12 MAR — w tym ocena zamiaru — należy do biegłego oraz organu i sądu.", italics: true, style: "body", margin: [0, 0, 0, 6] },
  );

  return { ...frame(`Spoofing & Layering — ${a.meta.caseName || "sprawa"} (${sig})`), content };
}

export async function renderSpoofingPdf(a: SpoofAnalysis): Promise<Buffer> {
  return renderPdf(docDefinition(a));
}
