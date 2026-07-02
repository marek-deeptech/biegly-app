// Serwerowy generator .docx z modelu opinii. Trzymany osobno od build.ts,
// aby pakiet `docx` nie trafiał do bundla klienta (opinion-view importuje
// wyłącznie build.ts).
import {
  AlignmentType,
  Document,
  Footer,
  HeadingLevel,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

import type { Opinion } from "./build";

export function renderOpinionDocx(op: Opinion, opts: { final?: boolean } = {}): Document {
  const children: (Paragraph | Table)[] = [];

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

  children.push(
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Podstawa prawna")] }),
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
          spacing: { after: 100 },
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
    sections: [
      {
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

function docxTable(head: string[], rows: string[][]): Table {
  const headRow = new TableRow({
    tableHeader: true,
    children: head.map(
      (h) =>
        new TableCell({
          shading: { fill: "f0ede6" },
          children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 18 })] })],
        }),
    ),
  });
  const bodyRows = rows.map(
    (r) =>
      new TableRow({
        children: r.map(
          (c) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: c, size: 18 })] })] }),
        ),
      }),
  );
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headRow, ...bodyRows] });
}
