// Serwerowy generator .docx z modelu opinii. Trzymany osobno od build.ts,
// aby pakiet `docx` (i rasteryzacja wykresów) nie trafiały do bundla klienta
// (opinion-view importuje wyłącznie build.ts).
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  AlignmentType,
  Document,
  Footer,
  HeadingLevel,
  ImageRun,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

// Geometria strony: A4, marginesy 2,5 cm (standard pism procesowych).
// Szerokości tabel podajemy w DXA (1/20 pkt) z układem FIXED — zapis „100%"
// w w:tblW typu pct Word interpretuje błędnie (kolumny zapadają się do 1 znaku).
const PAGE_W = 11906; // A4
const PAGE_H = 16838;
const MARGIN = 1417; // 2,5 cm
const CONTENT_W = PAGE_W - 2 * MARGIN; // 9072 DXA

import type { Opinion } from "./build";
import { chartSvg, type ChartSpec } from "./charts";

// Rasteryzacja SVG→PNG (resvg, natywny binding) z fontem dostarczonym w repo —
// środowisko serverless nie ma fontów systemowych. Każdy błąd → null, a DOCX
// degraduje się do ramki placeholdera (generowanie opinii nigdy nie pada na wykresie).
let fontPath: string | null | undefined;
function chartPng(spec: ChartSpec): Buffer | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Resvg } = require("@resvg/resvg-js") as typeof import("@resvg/resvg-js");
    if (fontPath === undefined) {
      const p = join(process.cwd(), "node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf");
      try {
        readFileSync(p); // istnieje i jest czytelny?
        fontPath = p;
      } catch {
        fontPath = null;
      }
    }
    const r = new Resvg(chartSvg(spec), {
      fitTo: { mode: "width", value: 2000 }, // 2× dla ostrości wydruku
      font: fontPath
        ? { fontFiles: [fontPath], defaultFontFamily: "DejaVu Sans", loadSystemFonts: false }
        : { loadSystemFonts: true },
      background: "white",
    });
    return Buffer.from(r.render().asPng());
  } catch {
    return null;
  }
}

export function renderOpinionDocx(op: Opinion, opts: { final?: boolean } = {}): Document {
  const children: (Paragraph | Table | TableOfContents)[] = [];
  // Podpis źródła pod każdą tabelą/wykresem — konwencja opinii wzorcowych.
  const sourceLine = () =>
    new Paragraph({
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: `Źródło: opracowanie własne na podstawie akt sprawy${op.signature ? ` ${op.signature}` : ""}.`,
          italics: true,
          size: 16,
          color: "6b6f7a",
        }),
      ],
    });

  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "OPINIA BIEGŁEGO" + (opts.final ? "" : " (projekt roboczy)"), bold: true, size: 30 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [new TextRun({ text: op.caseName + (op.signature ? ` — sygn. ${op.signature}` : "") })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [new TextRun({ text: op.expert, italics: true, size: 20 })],
    }),
  );

  // Spis treści (pole TOC Worda) — buduje się z nagłówków rozdziałów; Word
  // aktualizuje pole przy otwarciu (features.updateFields poniżej).
  children.push(
    new Paragraph({
      spacing: { before: 120, after: 80 },
      children: [new TextRun({ text: "SPIS TREŚCI", bold: true })],
    }),
    new TableOfContents("Spis treści", { hyperlink: true, headingStyleRange: "1-3" }),
  );

  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      pageBreakBefore: true,
      children: [new TextRun("Podstawa prawna")],
    }),
  );
  for (const lb of op.legalBasis) {
    children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(lb)] }));
  }

  for (const ch of op.chapters) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240 },
        children: [new TextRun({ text: `${ch.no}. ${ch.title}` })],
      }),
    );
    if (ch.source && !opts.final) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: `Źródło: ${ch.source}`, italics: true, size: 18, color: "6b6f7a" })],
        }),
      );
    }
    for (const p of ch.paras) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          spacing: { after: 120, line: 288 }, // interlinia 1,2
          children: [new TextRun({ text: (p.conf === "todo" ? "[do uzupełnienia] " : "") + p.text })],
        }),
      );
    }
    for (const tbl of ch.tables ?? (ch.table ? [ch.table] : [])) {
      children.push(
        new Paragraph({
          spacing: { before: 80 },
          children: [new TextRun({ text: tbl.caption, italics: true, size: 18 })],
        }),
        docxTable(tbl.head, tbl.rows),
        sourceLine(),
      );
    }
    // Wykresy z danych silnika (PNG) albo — bez danych — oznaczone miejsce z nazwą.
    for (const ph of ch.placeholders ?? []) {
      const png = ph.chart ? chartPng(ph.chart) : null;
      if (png) {
        children.push(
          new Paragraph({
            spacing: { before: 120 },
            children: [new ImageRun({ type: "png", data: png, transformation: { width: 600, height: 252 } })],
          }),
          new Paragraph({
            children: [new TextRun({ text: `${ph.label ?? "Wykres"}. ${ph.name}`, italics: true, size: 18 })],
          }),
          sourceLine(),
        );
        continue;
      }
      children.push(
        new Paragraph({ spacing: { before: 80 }, children: [] }),
        placeholderBlock(
          `[${ph.label ?? (ph.kind === "wykres" ? "Wykres — do wstawienia" : "Tabela — do wstawienia")}] ${ph.name}`,
        ),
      );
    }
    if (ch.findings?.length) {
      children.push(
        new Paragraph({
          spacing: { before: 120 },
          children: [new TextRun({ text: "Wnioski cząstkowe:", bold: true })],
        }),
      );
      for (const f of ch.findings) {
        children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(f.text)] }));
      }
    }
    if (ch.attachments?.length) {
      ch.attachments.forEach((a, i) =>
        children.push(new Paragraph({ children: [new TextRun(`Zał. ${i + 1}. ${a}`)] })),
      );
    }
  }

  children.push(
    new Paragraph({
      spacing: { before: 360 },
      children: [
        new TextRun({
          text:
            "Świadom odpowiedzialności karnej za złożenie fałszywej opinii (art. 233 § 4 k.k.) " +
            "oświadczam, że opinię sporządziłem zgodnie z najlepszą wiedzą.",
          italics: true,
          size: 18,
        }),
      ],
    }),
    new Paragraph({ spacing: { before: 240 }, children: [new TextRun({ text: op.expert })] }),
  );

  return new Document({
    features: { updateFields: true },
    // Krój pisma pism procesowych: Times New Roman 11 pt; nagłówki spójne.
    styles: {
      default: {
        document: { run: { font: "Times New Roman", size: 22 } },
        heading1: { run: { font: "Times New Roman", size: 30, bold: true, color: "000000" } },
        heading2: {
          run: { font: "Times New Roman", size: 26, bold: true, color: "000000" },
          paragraph: { spacing: { before: 240, after: 120 } },
        },
        heading3: { run: { font: "Times New Roman", size: 23, bold: true, color: "000000" } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_W, height: PAGE_H },
            margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ children: ["Strona ", PageNumber.CURRENT, " / ", PageNumber.TOTAL_PAGES], size: 16 })],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
}

// Ramka placeholdera (wyróżnione tło) — oznacza miejsce na wykres/tabelę do wstawienia.
function placeholderBlock(text: string): Table {
  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [CONTENT_W],
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { fill: "eef1f6" },
            width: { size: CONTENT_W, type: WidthType.DXA },
            children: [new Paragraph({ children: [new TextRun({ text, italics: true, size: 18, color: "44506a" })] })],
          }),
        ],
      }),
    ],
  });
}

function docxTable(head: string[], rows: string[][]): Table {
  // Układ FIXED + jawne szerokości kolumn (DXA) — Word nie zapada kolumn do
  // szerokości znaku. Pierwsza kolumna (Sesja/Data/Podmiot) dostaje więcej.
  const n = Math.max(1, head.length);
  const first = n >= 4 ? Math.min(1900, Math.floor(CONTENT_W / n) + 500) : Math.floor(CONTENT_W / n);
  const rest = Math.floor((CONTENT_W - first) / Math.max(1, n - 1));
  const columnWidths = [first, ...Array.from({ length: n - 1 }, () => rest)];
  const cellW = (i: number) => ({ size: columnWidths[i] ?? rest, type: WidthType.DXA });
  // String(x ?? "") — komórki z ekstrakcji PDF bywają null (dane MLM), a docx
  // wywraca się na TextRun(null).
  const headRow = new TableRow({
    tableHeader: true,
    children: head.map(
      (h, i) =>
        new TableCell({
          shading: { fill: "f0ede6" },
          width: cellW(i),
          children: [new Paragraph({ children: [new TextRun({ text: String(h ?? ""), bold: true, size: 18 })] })],
        }),
    ),
  });
  const bodyRows = rows.map(
    (r) =>
      new TableRow({
        children: r.map(
          (c, i) =>
            new TableCell({
              width: cellW(i),
              children: [new Paragraph({ children: [new TextRun({ text: String(c ?? ""), size: 18 })] })],
            }),
        ),
      }),
  );
  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    rows: [headRow, ...bodyRows],
  });
}
