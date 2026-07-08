// Renderer analizy OSINT → PDF (pdfmake, serwerowo). IBM Plex Sans osadzony,
// wbudowany spis treści z numerami stron, numeracja stron, graf jako wektor SVG.
// Zastępuje lokalny łańcuch docx→LibreOffice: działa na Vercel (czysty JS, bez binariów).
import path from "node:path";

import { milisystemGraphSvg } from "./graph";
import type { OsintContent, Block, Run } from "./content";

// pdfmake serwerowy printer to CommonJS (module.exports = PdfPrinter). Ładujemy
// dynamicznie i rzutujemy na minimalny interfejs — @types/pdfmake typuje wariant
// przeglądarkowy, więc omijamy niedopasowanie typów.
type PdfDoc = { on(ev: "data" | "end" | "error", cb: (arg?: unknown) => void): void; end(): void };
type PdfPrinterCtor = new (fonts: unknown) => { createPdfKitDocument(dd: unknown): PdfDoc };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pm = any;

const BLUE = "#1F3864", HEADBG = "#DCE6F2", CELLBG = "#F3F5F9", GRID = "#AEB6C2";
const GRAY = "#3A3A3A", SUB = "#8A8F98", LINKC = "#2E74B5", H3C = "#2E5496", INK = "#1A1A1A";
const USABLE = 453; // A4 (595.28pt) − 2×71pt marginesu

function fontsDesc() {
  const dir = path.join(process.cwd(), "assets/fonts");
  const F = (n: string) => path.join(dir, n);
  return {
    IBMPlexSans: {
      normal: F("IBMPlexSans-Regular.ttf"),
      bold: F("IBMPlexSans-Bold.ttf"),
      italics: F("IBMPlexSans-Italic.ttf"),
      bolditalics: F("IBMPlexSans-BoldItalic.ttf"),
    },
  };
}

function runs(rs: Run[]): Pm[] {
  return rs.map((r) => {
    if (typeof r === "string") return { text: r };
    if ("b" in r) return { text: r.b, bold: true };
    if ("i" in r) return { text: r.i, italics: true };
    return { text: r.link, link: r.url, color: LINKC, decoration: "underline" };
  });
}

// Tabela relacji (2 kolumny): nagłówek scalony (baner) + wiersze [podmiot, opis].
function relTable(title: string, rows: [string, Run[]][]): Pm {
  const body: Pm[] = [
    [{ text: title, colSpan: 2, fillColor: HEADBG, color: BLUE, bold: true, alignment: "center", fontSize: 10, margin: [4, 4, 4, 4] }, {}],
    ...rows.map(([who, desc]) => [
      { text: who, bold: true, fontSize: 9.5, margin: [3, 3, 3, 3] },
      { text: runs(desc), fontSize: 9.5, margin: [3, 3, 3, 3] },
    ]),
  ];
  return { table: { headerRows: 1, widths: [118, USABLE - 118 - 8], body }, layout: gridLayout(), margin: [0, 0, 0, 11] };
}

// Tabela danych: nagłówek (wypełnienie) + wiersze; szerokości z procentów treści.
function dataTable(headers: string[], rows: string[][], pct?: number[]): Pm {
  const n = headers.length;
  const widths = (pct ?? headers.map(() => 100 / n)).map((p) => Math.round((p / 100) * (USABLE - 8)));
  const body: Pm[] = [
    headers.map((h) => ({ text: h, bold: true, alignment: "center", fillColor: CELLBG, fontSize: 9, margin: [3, 3, 3, 3] })),
    ...rows.map((r) => r.map((c) => ({ text: c, fontSize: 9, margin: [3, 3, 3, 3] }))),
  ];
  return { table: { headerRows: 1, widths, body }, layout: gridLayout(), margin: [0, 0, 0, 11] };
}

function gridLayout(): Pm {
  return {
    hLineWidth: () => 0.5, vLineWidth: () => 0.5,
    hLineColor: () => GRID, vLineColor: () => GRID,
    paddingLeft: () => 5, paddingRight: () => 5, paddingTop: () => 3, paddingBottom: () => 3,
  };
}

function blockToNodes(b: Block): Pm[] {
  switch (b.t) {
    case "p":
      return [{ text: runs(b.runs), style: "body", margin: [b.bullet ? 16 : 0, 0, 0, 6] }];
    case "h2":
      return [{
        text: b.text, style: "h2", alignment: "center", margin: [0, 10, 0, 5],
        ...(b.toc === false ? {} : { tocItem: true, tocStyle: { color: GRAY, fontSize: 9.5 }, tocMargin: [16, 1, 0, 0] }),
      }];
    case "h3":
      return [{ text: b.text, style: "h3", margin: [0, 8, 0, 4] }];
    case "arrow":
      return [{ text: runs(b.runs), fontSize: 9.5, lineHeight: 1.3, color: "#333333", margin: [12, 0, 0, 5] }];
    case "rel":
      return [relTable(b.title, b.rows)];
    case "data":
      return [dataTable(b.headers, b.rows, b.widths)];
    case "src":
      return [{
        text: [
          { text: "źródło: ", italics: true, color: SUB, fontSize: 7.5 },
          { text: b.label, link: b.url, italics: true, color: LINKC, decoration: "underline", fontSize: 7.5 },
        ], margin: [0, 1, 0, 11],
      }];
    case "graph":
      return [{ svg: milisystemGraphSvg(), width: USABLE, alignment: "center", margin: [0, 6, 0, 8] }];
  }
}

// Baner rozdziału (H1). tocItem osadzony w tekście banera; jeśli pdfmake nie zbiera
// wpisów z komórek tabeli, użyty jest osobny, niewidoczny kotwiczny wpis TOC.
function h1Nodes(heading: string, brk: boolean): Pm[] {
  return [
    { text: heading, tocItem: true, tocStyle: { bold: true, color: BLUE, fontSize: 10.5 }, tocMargin: [0, 5, 0, 0],
      color: "#FFFFFF", fontSize: 1, margin: [0, 0, 0, 0], ...(brk ? { pageBreak: "before" } : {}) },
    { table: { widths: ["*"], body: [[{ text: heading, style: "h1", alignment: "center", fillColor: HEADBG, margin: [6, 7, 6, 7] }]] },
      layout: "noBorders", margin: [0, 0, 0, 9] },
  ];
}

function docDefinition(c: OsintContent): Pm {
  const content: Pm[] = [];

  // ── strona tytułowa ──
  content.push(
    { text: [{ text: "Nr sprawy: ", bold: true }, c.meta.sygn], margin: [0, 6, 0, 4] },
    { text: [{ text: "Dotyczy: ", bold: true }, c.meta.dotyczy], margin: [0, 0, 0, 4] },
    { text: [{ text: "Przedmiot: ", bold: true }, c.meta.przedmiot], margin: [0, 0, 0, 4] },
    { text: "ANALIZA OSINT", alignment: "center", color: BLUE, bold: true, fontSize: 30, margin: [0, 150, 0, 12] },
    { text: c.meta.podtytul, alignment: "center", italics: true, fontSize: 12, lineHeight: 1.35, margin: [40, 0, 40, 160] },
    { text: "Zespół Analiz OSINT", alignment: "right", bold: true, margin: [0, 0, 0, 2] },
    { text: "na potrzeby postępowania przygotowawczego", alignment: "right", italics: true, fontSize: 9.5, margin: [0, 0, 0, 2] },
    { text: c.meta.zrodla, alignment: "right", italics: true, fontSize: 8.5, color: SUB },
  );

  // ── spis treści (osobna strona) ──
  content.push(
    { text: "Spis treści", style: "tocTitle", alignment: "center", pageBreak: "before", margin: [0, 0, 0, 16] },
    { toc: {} },
  );

  // ── rozdziały ──
  c.sections.forEach((s, i) => {
    const brk = i === 0 || s.heading.startsWith("ZAŁĄCZNIK");
    content.push(...h1Nodes(s.heading, brk));
    for (const b of s.blocks) content.push(...blockToNodes(b));
  });

  return {
    pageSize: "A4",
    pageMargins: [71, 54, 71, 60],
    defaultStyle: { font: "IBMPlexSans", fontSize: 10.5, lineHeight: 1.4, color: INK, alignment: "left" },
    styles: {
      h1: { fontSize: 13, bold: true, color: BLUE },
      h2: { fontSize: 11.5, bold: true, color: BLUE },
      h3: { fontSize: 10.5, bold: true, color: H3C },
      body: { fontSize: 10.5 },
      tocTitle: { fontSize: 13, bold: true, color: BLUE },
    },
    content,
    footer: (currentPage: number) =>
      currentPage === 1 ? "" : {
        text: `Analiza OSINT — Grupa Milisystem (${c.meta.sygn})  ·  ${currentPage}`,
        alignment: "center", fontSize: 7, color: SUB, margin: [0, 8, 0, 0],
      },
  };
}

export async function renderOsintPdf(c: OsintContent): Promise<Buffer> {
  const mod = (await import("pdfmake")) as unknown as { default: PdfPrinterCtor };
  const PdfPrinter = mod.default;
  const printer = new PdfPrinter(fontsDesc());
  const doc = printer.createPdfKitDocument(docDefinition(c));
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (ch) => chunks.push(ch as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", (e) => reject(e as Error));
    doc.end();
  });
}
