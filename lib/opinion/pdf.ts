// Renderer opinii → PDF w tej samej formie co analiza OSINT (wspólny kit pdfmake:
// IBM Plex Sans, banery rozdziałów, spis treści z numeracją, tabele, stopka).
// Odpowiednik renderOpinionDocx, ale wynik to PDF (bez LibreOffice — działa na Vercel).
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BLUE, GRAY, dataTable, h1Nodes, frame, renderPdf, type Pm } from "@/lib/pdf/kit";

import type { Opinion, Chapter, OpTable } from "./build";
import { chartSvg, type ChartSpec } from "./charts";

const isTopChapter = (no: string) => /^(I|II|III|IV|V|VI|VII)$/.test(no.trim());

// Wykres z danych silnika: SVG → PNG (resvg + DejaVu, jak w DOCX) → data URL do pdfmake.
// Identyczny wygląd co w .docx; błąd renderu → null (degradacja do ramki „do wstawienia").
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
      font: fontPath
        ? { fontFiles: [fontPath], defaultFontFamily: "DejaVu Sans", loadSystemFonts: false }
        : { loadSystemFonts: true },
      background: "white",
    });
    return "data:image/png;base64," + Buffer.from(r.render().asPng()).toString("base64");
  } catch {
    return null;
  }
}

function sourceLine(sig: string | null): Pm {
  return {
    text: `Źródło: opracowanie własne na podstawie akt sprawy${sig ? ` ${sig}` : ""}.`,
    italics: true, fontSize: 8, color: "#595959", margin: [0, 1, 0, 10],
  };
}

function caption(text: string): Pm {
  return { text, bold: true, alignment: "center", fontSize: 9.5, margin: [0, 8, 0, 4] };
}

// Ramka „do wstawienia" (wyróżnione tło) — miejsce na wykres/tabelę bez danych silnika.
function placeholderBox(text: string): Pm {
  return {
    table: { widths: ["*"], body: [[{ text, italics: true, fontSize: 9, color: "#44506A", fillColor: "#EEF1F6", margin: [8, 6, 8, 6] }]] },
    layout: "noBorders", margin: [0, 4, 0, 8],
  };
}

function tableBlock(tbl: OpTable, sig: string | null): Pm[] {
  return [caption(tbl.caption), dataTable(tbl.head, tbl.rows), sourceLine(sig)];
}

function chapterNodes(ch: Chapter, final: boolean, sig: string | null): Pm[] {
  const out: Pm[] = [];
  const title = `${ch.no}. ${ch.title}`;
  if (isTopChapter(ch.no)) {
    out.push(...h1Nodes(title, false));
  } else {
    out.push({
      text: title, style: "h2", alignment: "left", margin: [0, 12, 0, 5],
      tocItem: true, tocStyle: { color: GRAY, fontSize: 9.5 }, tocMargin: [16, 1, 0, 0],
    });
  }
  if (ch.source && !final)
    out.push({ text: `Źródło: ${ch.source}`, italics: true, fontSize: 8.5, color: "#808080", margin: [0, 0, 0, 6] });

  for (const p of ch.paras)
    out.push({ text: (p.conf === "todo" ? "[do uzupełnienia] " : "") + p.text, style: "body", margin: [0, 0, 0, 6] });

  for (const tbl of ch.tables ?? (ch.table ? [ch.table] : []))
    out.push(...tableBlock(tbl, sig));

  for (const ph of ch.placeholders ?? []) {
    const img = ph.chart ? chartDataUrl(ph.chart) : null;
    if (img) {
      out.push(
        { image: img, width: 384, alignment: "center", margin: [0, 6, 0, 2] },
        { text: `${ph.label ?? "Wykres"}. ${ph.name}`, bold: true, alignment: "center", fontSize: 9, margin: [0, 0, 0, 2] },
        sourceLine(sig),
      );
    } else {
      out.push(placeholderBox(`[${ph.label ?? (ph.kind === "wykres" ? "Wykres — do wstawienia" : "Tabela — do wstawienia")}] ${ph.name}`));
    }
  }

  if (ch.findings?.length) {
    out.push({ text: "Wnioski cząstkowe:", bold: true, margin: [0, 8, 0, 4] });
    out.push({ ul: ch.findings.map((f) => f.text), margin: [4, 0, 0, 6] });
  }
  if (ch.attachments?.length)
    ch.attachments.forEach((a, i) => out.push({ text: `Zał. ${i + 1}. ${a}`, fontSize: 9.5, margin: [0, 0, 0, 3] }));
  if (ch.evidence?.length) {
    out.push({ text: "Wykaz materiału dowodowego (akta poddane badaniu):", bold: true, fontSize: 9.5, margin: [0, 8, 0, 4] });
    ch.evidence.forEach((a, i) => out.push({ text: `${i + 1}. ${a}`, fontSize: 9, margin: [0, 0, 0, 2] }));
  }

  return out;
}

function docDefinition(op: Opinion, final: boolean): Pm {
  const sig = op.signature;
  const content: Pm[] = [];

  // ── strona tytułowa (wyśrodkowana) ──
  content.push(
    { text: `Sygn. akt ${sig ?? "—"}`, alignment: "center", fontSize: 11, margin: [0, 90, 0, 0] },
    { text: "OPINIA BIEGŁEGO", alignment: "center", bold: true, color: BLUE, fontSize: 30, margin: [0, 70, 0, 6] },
    ...(final ? [] : [{ text: "(projekt roboczy)", alignment: "center", italics: true, fontSize: 11, color: "#808080", margin: [0, 0, 0, 0] }]),
    { text: `w sprawie ${op.caseName}`, alignment: "center", fontSize: 13, margin: [30, 24, 30, 0] },
    { text: op.expert, alignment: "center", italics: true, fontSize: 11, margin: [0, 110, 0, 0] },
  );

  // ── spis treści (osobna strona) ──
  content.push(
    { text: "Spis treści", style: "tocTitle", alignment: "center", pageBreak: "before", margin: [0, 0, 0, 16] },
    { toc: {} },
  );

  // ── podstawa prawna (osobna strona; TOC zostaje sam na str. 2) ──
  content.push(...h1Nodes("Podstawa prawna", true));
  content.push({ ul: op.legalBasis, margin: [4, 0, 0, 6] });

  // ── rozdziały ──
  for (const ch of op.chapters) content.push(...chapterNodes(ch, final, sig));

  // ── klauzula i podpis ──
  content.push(
    {
      text: "Świadom odpowiedzialności karnej za złożenie fałszywej opinii (art. 233 § 4 k.k.) oświadczam, że opinię sporządziłem zgodnie z najlepszą wiedzą.",
      italics: true, style: "body", margin: [0, 16, 0, 0],
    },
    { text: op.expert, alignment: "right", margin: [0, 34, 0, 0] },
  );

  return { ...frame(`Opinia biegłego${sig ? " — sygn. " + sig : ""}`), content };
}

export async function renderOpinionPdf(op: Opinion, opts: { final?: boolean } = {}): Promise<Buffer> {
  return renderPdf(docDefinition(op, !!opts.final));
}
