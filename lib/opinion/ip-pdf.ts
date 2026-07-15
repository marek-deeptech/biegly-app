// Renderer załącznika „Wykaz powiązań — zbieżność adresów IP" → PDF (kit pdfmake,
// IBM Plex Sans). Wejście: subanaliza `powiazania_dane` (engine.ip) — pary użytkowników
// dzielących logowania z tych samych adresów IP. Evidence-only: zbieżność IP to surowy
// dowód współdzielenia infrastruktury; ocenę działania w porozumieniu przeprowadza sąd.
import { GRAY, dataTable, h1Nodes, frame, renderPdf, type Pm } from "@/lib/pdf/kit";

export type IpTable = { caption: string; head: string[]; rows: string[][] };
export type IpData = {
  caseName: string;
  signature: string | null;
  summary: string;
  table: IpTable;
  findings: string[];
};

function docDefinition(d: IpData): Pm {
  const content: Pm[] = [
    { text: `Sygn. akt ${d.signature ?? "—"}`, alignment: "center", fontSize: 10, margin: [0, 0, 0, 2] },
    { text: `Sprawa: ${d.caseName}`, alignment: "center", fontSize: 10, color: GRAY, margin: [0, 0, 0, 10] },
    ...h1Nodes("Załącznik — Wykaz powiązań: zbieżność adresów IP", false),
    {
      text:
        "Metodyka: zestawienie oparte na danych logowań (adresy IP przypisane do rachunków/użytkowników). " +
        "Wskazano pary użytkowników, którzy logowali się z co najmniej jednego wspólnego adresu IP. Zbieżność IP " +
        "jest surowym dowodem współdzielenia infrastruktury dostępowej; ocena, czy świadczy o działaniu w " +
        "porozumieniu, należy do organu procesowego.",
      style: "body", margin: [0, 0, 0, 8],
    },
  ];
  if (d.summary) content.push({ text: d.summary, style: "body", margin: [0, 0, 0, 10] });
  content.push(
    { text: d.table.caption, bold: true, alignment: "center", fontSize: 9.5, margin: [0, 4, 0, 4] },
    dataTable(d.table.head, d.table.rows),
    {
      text: `Źródło: opracowanie własne na podstawie akt sprawy${d.signature ? ` ${d.signature}` : ""}.`,
      italics: true, fontSize: 8, color: "#595959", margin: [0, 2, 0, 10],
    },
  );
  if (d.findings.length) {
    content.push({ text: "Ustalenia:", bold: true, margin: [0, 6, 0, 4] });
    content.push({ ul: d.findings, margin: [4, 0, 0, 6] });
  }
  return { ...frame(`Załącznik — wykaz powiązań IP${d.signature ? " · sygn. " + d.signature : ""}`), content };
}

export async function renderIpPdf(d: IpData): Promise<Buffer> {
  return renderPdf(docDefinition(d));
}
