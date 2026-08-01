import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { docxText, tekstZPliku, xlsxText } from "@/lib/intake/office";

// Minimalne archiwa w formatach Office — bez plików na dysku, bo te bywają
// przenoszone, a testy nie mogą od nich zależeć.
async function docx(akapity: string[]): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<w:document><w:body>${akapity.map((t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "arraybuffer" });
}

async function xlsx(wiersze: string[][]): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const slownik = [...new Set(wiersze.flat().filter((c) => Number.isNaN(Number(c))))];
  zip.file(
    "xl/sharedStrings.xml",
    `<sst>${slownik.map((s) => `<si><t>${s}</t></si>`).join("")}</sst>`,
  );
  const rows = wiersze
    .map(
      (r) =>
        `<row>${r
          .map((c) =>
            Number.isNaN(Number(c))
              ? `<c t="s"><v>${slownik.indexOf(c)}</v></c>`
              : `<c><v>${c}</v></c>`,
          )
          .join("")}</row>`,
    )
    .join("");
  zip.file("xl/worksheets/sheet1.xml", `<worksheet><sheetData>${rows}</sheetData></worksheet>`);
  return zip.generateAsync({ type: "arraybuffer" });
}

describe("odczyt formatów Office", () => {
  it("docx: akapity w osobnych liniach", async () => {
    const t = await docxText(await docx(["Uchwała nr 6/A/2007", "Limity kwartalne"]));
    expect(t.split("\n").filter(Boolean)).toEqual(["Uchwała nr 6/A/2007", "Limity kwartalne"]);
  });

  it("xlsx: podstawia słownik napisów, inaczej zostają same liczby bez etykiet", async () => {
    // To jest realny układ z akt MBR — kwoty limitów bez nazw pozycji są bezużyteczne.
    const t = await xlsxText(await xlsx([["Limit lokaty do 1 dnia", "254", "272"]]));
    expect(t).toBe("Limit lokaty do 1 dnia | 254 | 272");
  });

  it("xlsx: pomija wiersze puste", async () => {
    const t = await xlsxText(await xlsx([["A", "1"], ["", ""], ["B", "2"]]));
    expect(t.split("\n")).toEqual(["A | 1", "B | 2"]);
  });

  it("formaty OLE2 i nieznane zwracają pustkę, nie strumień bajtów", async () => {
    // Wpuszczenie binariów do promptu mogłoby wyprodukować zmyślone dane.
    expect(await tekstZPliku("rachunek.doc", new ArrayBuffer(64))).toBe("");
    expect(await tekstZPliku("dane.xls", new ArrayBuffer(64))).toBe("");
  });
});
