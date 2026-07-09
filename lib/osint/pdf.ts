// Renderer analizy OSINT → PDF. Typografia ze wspólnego kitu (lib/pdf/kit),
// tu tylko elementy specyficzne dla OSINT: rich-run (bold/italic/link), tabela
// relacji (2 kol.), graf jako wektor SVG oraz montaż dokumentu.
import { BLUE, HEADBG, SUB, LINKC, GRAY, USABLE, gridLayout, dataTable, h1Nodes, frame, renderPdf, type Pm } from "@/lib/pdf/kit";

import { milisystemGraphSvg } from "./graph";
import type { OsintContent, Block, Run } from "./content";

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

  return { ...frame(`Analiza OSINT — Grupa Milisystem (${c.meta.sygn})`), content };
}

export async function renderOsintPdf(c: OsintContent): Promise<Buffer> {
  return renderPdf(docDefinition(c));
}
