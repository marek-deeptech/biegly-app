// Serwerowy generator .docx z modelu opinii. Trzymany osobno od build.ts,
// aby pakiet `docx` (i rasteryzacja wykresów) nie trafiały do bundla klienta
// (opinion-view importuje wyłącznie build.ts).
//
// Typografia: zasady UX/WCAG czytelności długich opracowań (nie ciasny skład):
// wyrównanie DO LEWEJ (justowanie tworzy „rzeki" — gorsze dla czytania), interlinia
// 1,5, odstęp międzyakapitowy ≈ rozmiar pisma, wyraźna hierarchia nagłówków
// (rozdziały główne wyśrodkowane), umiarkowane rozmiary. Times New Roman 11 pt.
// Podpisy tabel wyśrodkowane nad tabelą, „Źródło:" pod tabelą; cienkie obramowania.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
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
const PAGE_W = 11906; // A4
const PAGE_H = 16838;
const MARGIN = 1417; // 2,5 cm
const CONTENT_W = PAGE_W - 2 * MARGIN; // 9072 DXA
const LINE = 360; // interlinia 1,5 (WCAG/UX: min 1.5× dla czytelności)
const PARA_AFTER = 200; // odstęp międzyakapitowy ≈ rozmiar pisma (oddech)
const BODY = 22; // tekst 11 pt
const GRID = "808080"; // kolor cienkich linii tabel
const HEADBG = "F2F2F2"; // subtelne tło nagłówka tabeli
// Rozdział główny (I–VI) vs podrozdział (IV.1, IV.2 …) — dla hierarchii nagłówków.
const isTopChapter = (no: string) => /^(I|II|III|IV|V|VI|VII)$/.test(no.trim());

import type { Opinion } from "./build";
import { chartSvg, type ChartSpec } from "./charts";

const thin = { style: BorderStyle.SINGLE, size: 2, color: GRID };
const TABLE_BORDERS = { top: thin, bottom: thin, left: thin, right: thin, insideHorizontal: thin, insideVertical: thin };

// Rasteryzacja SVG→PNG (resvg) z fontem z repo; błąd → null (DOCX degraduje się do ramki).
let fontPath: string | null | undefined;
function chartPng(spec: ChartSpec): Buffer | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Resvg } = require("@resvg/resvg-js") as typeof import("@resvg/resvg-js");
    if (fontPath === undefined) {
      const p = join(process.cwd(), "node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf");
      try {
        readFileSync(p);
        fontPath = p;
      } catch {
        fontPath = null;
      }
    }
    const r = new Resvg(chartSvg(spec), {
      fitTo: { mode: "width", value: 2000 },
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

// Akapit tekstu ciągłego: wyrównany do lewej, interlinia 1,5, odstęp po akapicie.
function bodyPara(runs: TextRun[]): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { after: PARA_AFTER, line: LINE },
    children: runs,
  });
}

export function renderOpinionDocx(op: Opinion, opts: { final?: boolean } = {}): Document {
  const children: (Paragraph | Table | TableOfContents)[] = [];
  const sourceLine = () =>
    new Paragraph({
      spacing: { before: 40, after: 200 },
      children: [
        new TextRun({
          text: `Źródło: opracowanie własne na podstawie akt sprawy${op.signature ? ` ${op.signature}` : ""}.`,
          size: 16,
          color: "595959",
        }),
      ],
    });

  // ── Strona tytułowa (układ wyśrodkowany, książkowy) ──
  children.push(
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 1400, after: 40 }, children: [new TextRun({ text: "Sygn. akt " + (op.signature ?? "—"), size: 22 })] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 1200, after: 160 },
      children: [new TextRun({ text: "OPINIA BIEGŁEGO", bold: true, size: 44 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [new TextRun({ text: opts.final ? "" : "(projekt roboczy)", italics: true, size: 22, color: "808080" })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 400, after: 60 },
      children: [new TextRun({ text: "w sprawie " + op.caseName, size: 26 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 1600, after: 0 },
      children: [new TextRun({ text: op.expert, italics: true, size: 22 })],
    }),
  );

  // ── Spis treści ──
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      pageBreakBefore: true,
      spacing: { after: 240 },
      children: [new TextRun({ text: "Spis treści", bold: true, size: 28 })],
    }),
    new TableOfContents("Spis treści", { hyperlink: true, headingStyleRange: "1-3" }),
  );

  // ── Podstawa prawna ──
  children.push(
    new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, pageBreakBefore: true, children: [new TextRun("Podstawa prawna")] }),
  );
  for (const lb of op.legalBasis) {
    children.push(new Paragraph({ alignment: AlignmentType.LEFT, spacing: { after: 100, line: LINE }, bullet: { level: 0 }, children: [new TextRun(lb)] }));
  }

  // ── Rozdziały ──
  for (const ch of op.chapters) {
    children.push(
      new Paragraph({
        heading: isTopChapter(ch.no) ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
        alignment: isTopChapter(ch.no) ? AlignmentType.CENTER : AlignmentType.LEFT,
        children: [new TextRun({ text: `${ch.no}. ${ch.title}` })],
      }),
    );
    if (ch.source && !opts.final) {
      children.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: `Źródło: ${ch.source}`, italics: true, size: 18, color: "808080" })] }));
    }
    for (const p of ch.paras) {
      children.push(bodyPara([new TextRun({ text: (p.conf === "todo" ? "[do uzupełnienia] " : "") + p.text })]));
    }
    for (const tbl of ch.tables ?? (ch.table ? [ch.table] : [])) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 200, after: 60 },
          children: [new TextRun({ text: tbl.caption, bold: true, size: 18 })],
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
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200 }, children: [new ImageRun({ type: "png", data: png, transformation: { width: 560, height: 235 } })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 40, after: 20 }, children: [new TextRun({ text: `${ph.label ?? "Wykres"}. ${ph.name}`, bold: true, size: 18 })] }),
          sourceLine(),
        );
        continue;
      }
      children.push(
        new Paragraph({ spacing: { before: 120 }, children: [] }),
        placeholderBlock(`[${ph.label ?? (ph.kind === "wykres" ? "Wykres — do wstawienia" : "Tabela — do wstawienia")}] ${ph.name}`),
      );
    }
    if (ch.findings?.length) {
      children.push(new Paragraph({ spacing: { before: 200, after: 80 }, children: [new TextRun({ text: "Wnioski cząstkowe:", bold: true })] }));
      for (const f of ch.findings) {
        children.push(new Paragraph({ alignment: AlignmentType.LEFT, spacing: { after: 100, line: LINE }, bullet: { level: 0 }, children: [new TextRun(f.text)] }));
      }
    }
    if (ch.attachments?.length) {
      ch.attachments.forEach((a, i) => children.push(new Paragraph({ spacing: { after: 60, line: LINE }, children: [new TextRun({ text: `Zał. ${i + 1}. ${a}`, size: 20 })] })));
    }
    if (ch.evidence?.length) {
      children.push(new Paragraph({ spacing: { before: 160, after: 60, line: LINE }, children: [new TextRun({ text: "Wykaz materiału dowodowego (akta poddane badaniu):", bold: true, size: 20 })] }));
      ch.evidence.forEach((a, i) => children.push(new Paragraph({ spacing: { after: 40, line: LINE }, children: [new TextRun({ text: `${i + 1}. ${a}`, size: 18 })] })));
    }
  }

  // ── Klauzula i podpis ──
  children.push(
    bodyPara([new TextRun({
      text:
        "Świadom odpowiedzialności karnej za złożenie fałszywej opinii (art. 233 § 4 k.k.) " +
        "oświadczam, że opinię sporządziłem zgodnie z najlepszą wiedzą.",
      italics: true,
    })]),
    new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 480 }, children: [new TextRun({ text: op.expert })] }),
  );

  // Żywa pagina: tytuł opinii kapitalikami (small caps) z dolną linią.
  const runningHeader = new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { after: 120 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "AAAAAA", space: 4 } },
        children: [new TextRun({ text: `Opinia biegłego${op.signature ? " — sygn. " + op.signature : ""}`, smallCaps: true, size: 16, color: "666666" })],
      }),
    ],
  });

  return new Document({
    features: { updateFields: true },
    styles: {
      default: {
        document: { run: { font: "Times New Roman", size: BODY }, paragraph: { spacing: { line: LINE, after: PARA_AFTER } } },
        // Umiarkowane rozmiary (UX): H1 13 pt, H2 12 pt, H3 11 pt bold; duży oddech przed.
        heading1: { run: { font: "Times New Roman", size: 26, bold: true, color: "1a1a1a" }, paragraph: { spacing: { before: 480, after: 220, line: LINE } } },
        heading2: { run: { font: "Times New Roman", size: 24, bold: true, color: "1a1a1a" }, paragraph: { spacing: { before: 340, after: 160, line: LINE } } },
        heading3: { run: { font: "Times New Roman", size: 22, bold: true, color: "1a1a1a" }, paragraph: { spacing: { before: 240, after: 100, line: LINE } } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_W, height: PAGE_H },
            margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
          },
          titlePage: true, // pierwsza strona (tytułowa) bez żywej paginy
        },
        headers: { default: runningHeader },
        footers: {
          default: new Footer({
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "666666" })] })],
          }),
          first: new Footer({ children: [new Paragraph({ children: [] })] }),
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
  const n = Math.max(1, head.length);
  const first = n >= 4 ? Math.min(1900, Math.floor(CONTENT_W / n) + 500) : Math.floor(CONTENT_W / n);
  const rest = Math.floor((CONTENT_W - first) / Math.max(1, n - 1));
  const columnWidths = [first, ...Array.from({ length: n - 1 }, () => rest)];
  const cellW = (i: number) => ({ size: columnWidths[i] ?? rest, type: WidthType.DXA });
  // Nagłówek: wyśrodkowany, pogrubiony, subtelne tło (styl wzorca książkowego).
  const headRow = new TableRow({
    tableHeader: true,
    children: head.map(
      (h, i) =>
        new TableCell({
          shading: { fill: HEADBG },
          width: cellW(i),
          children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { line: 240 }, children: [new TextRun({ text: String(h ?? ""), bold: true, size: 18 })] })],
        }),
    ),
  });
  // Pierwsza kolumna (Sesja/Data/Podmiot) wyróżniona lekko; pozostałe zwykłe.
  const bodyRows = rows.map(
    (r) =>
      new TableRow({
        children: r.map(
          (c, i) =>
            new TableCell({
              width: cellW(i),
              children: [new Paragraph({ spacing: { line: 240 }, children: [new TextRun({ text: String(c ?? ""), size: 18 })] })],
            }),
        ),
      }),
  );
  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: CONTENT_W, type: WidthType.DXA },
    alignment: AlignmentType.CENTER,
    columnWidths,
    borders: TABLE_BORDERS,
    margins: { top: 40, bottom: 40, left: 90, right: 90 },
    rows: [headRow, ...bodyRows],
  });
}
