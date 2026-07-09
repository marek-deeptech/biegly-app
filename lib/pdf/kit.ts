// Wspólny „kit" renderu PDF (pdfmake, serwerowo) — jedno źródło typografii dla
// analizy OSINT i opinii: IBM Plex Sans osadzony, banery rozdziałów (H1),
// spis treści z numeracją stron, tabele z cienką siatką, stopka z numeracją.
// Działa na Vercel (czysty JS, bez LibreOffice); pdfmake w serverExternalPackages.
import path from "node:path";

// pdfmake serwerowy printer to CommonJS (module.exports = PdfPrinter); @types/pdfmake
// typuje wariant przeglądarkowy, więc ładujemy dynamicznie i rzutujemy na minimalny interfejs.
type PdfDoc = { on(ev: "data" | "end" | "error", cb: (arg?: unknown) => void): void; end(): void };
type PdfPrinterCtor = new (fonts: unknown) => { createPdfKitDocument(dd: unknown): PdfDoc };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Pm = any;

export const BLUE = "#1F3864", HEADBG = "#DCE6F2", CELLBG = "#F3F5F9", GRID = "#AEB6C2";
export const GRAY = "#3A3A3A", SUB = "#8A8F98", LINKC = "#2E74B5", H3C = "#2E5496", INK = "#1A1A1A";
export const USABLE = 453; // A4 (595.28pt) − 2×71pt marginesu

export function fontsDesc() {
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

export function gridLayout(): Pm {
  return {
    hLineWidth: () => 0.5, vLineWidth: () => 0.5,
    hLineColor: () => GRID, vLineColor: () => GRID,
    paddingLeft: () => 5, paddingRight: () => 5, paddingTop: () => 3, paddingBottom: () => 3,
  };
}

// Tabela danych: nagłówek (wypełnienie) + wiersze. Szerokości z procentów treści,
// albo auto — dla >=4 kolumn pierwsza (etykieta: Sesja/Data/Podmiot) nieco szersza.
export function dataTable(headers: string[], rows: string[][], pct?: number[]): Pm {
  const n = Math.max(1, headers.length);
  const usable = USABLE - 8;
  let widths: number[];
  if (pct) widths = pct.map((p) => Math.round((p / 100) * usable));
  else if (n >= 4) {
    const first = Math.min(0.22 * usable, usable / n + 0.06 * usable);
    const rest = (usable - first) / (n - 1);
    widths = [Math.round(first), ...Array.from({ length: n - 1 }, () => Math.round(rest))];
  } else {
    widths = Array.from({ length: n }, () => Math.round(usable / n));
  }
  const body: Pm[] = [
    headers.map((h) => ({ text: h, bold: true, alignment: "center", fillColor: CELLBG, fontSize: 9, margin: [3, 3, 3, 3] })),
    ...rows.map((r) => r.map((c) => ({ text: String(c ?? ""), fontSize: 9, margin: [3, 3, 3, 3] }))),
  ];
  return { table: { headerRows: 1, widths, body }, layout: gridLayout(), margin: [0, 0, 0, 11] };
}

// Baner rozdziału (H1) wyśrodkowany na wypełnieniu + niewidoczna kotwica wpisu TOC
// (pdfmake nie zawsze zbiera tocItem z komórek tabeli, więc kotwica jest osobnym tekstem).
export function h1Nodes(heading: string, brk: boolean): Pm[] {
  return [
    { text: heading, tocItem: true, tocStyle: { bold: true, color: BLUE, fontSize: 10.5 }, tocMargin: [0, 5, 0, 0],
      color: "#FFFFFF", fontSize: 1, margin: [0, 0, 0, 0], ...(brk ? { pageBreak: "before" } : {}) },
    { table: { widths: ["*"], body: [[{ text: heading, style: "h1", alignment: "center", fillColor: HEADBG, margin: [6, 7, 6, 7] }]] },
      layout: "noBorders", margin: [0, 0, 0, 9] },
  ];
}

// Rama dokumentu: rozmiar, marginesy, style, stopka z numeracją stron (pierwsza — tytułowa — bez stopki).
export function frame(footerLabel: string): Pm {
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
    footer: (currentPage: number) =>
      currentPage === 1 ? "" : {
        text: `${footerLabel}  ·  ${currentPage}`,
        alignment: "center", fontSize: 7, color: SUB, margin: [0, 8, 0, 0],
      },
  };
}

export async function renderPdf(docDefinition: Pm): Promise<Buffer> {
  const mod = (await import("pdfmake")) as unknown as { default: PdfPrinterCtor };
  const printer = new mod.default(fontsDesc());
  const doc = printer.createPdfKitDocument(docDefinition);
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (ch) => chunks.push(ch as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", (e) => reject(e as Error));
    doc.end();
  });
}
