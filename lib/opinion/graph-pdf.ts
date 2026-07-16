// Renderer załącznika „Graf powiązań" → PDF poziomy (A4 landscape, kit pdfmake).
// Wejście: gotowy wektor SVG grafu (kuratorowany milisystemGraphSvg albo generowany
// relationGraphSvg z danych ugruntowanych). Font IBMPlexSans zarejestrowany w pdfmake.
import { frame, renderPdf, type Pm } from "@/lib/pdf/kit";

export async function renderGraphPdf(opts: { caseName: string; signature: string | null; svg: string; note?: string }): Promise<Buffer> {
  // Szerokość dobrana tak, by graf (proporcje ~1,43) zmieścił się na wysokość poziomej A4.
  const content: Pm[] = [{ svg: opts.svg, width: 724, alignment: "center", margin: [0, 2, 0, 0] }];
  if (opts.note) content.push({ text: opts.note, italics: true, fontSize: 8, color: "#595959", margin: [0, 8, 0, 0] });
  return renderPdf({
    ...(frame(`Graf powiązań — ${opts.caseName}${opts.signature ? " · sygn. " + opts.signature : ""}`) as object),
    pageOrientation: "landscape",
    pageMargins: [34, 30, 34, 46],
    content,
  } as Pm);
}
