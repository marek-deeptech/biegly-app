import { describe, expect, it } from "vitest";

import { wykryjWarstwe } from "@/lib/intake/warstwa";

const blob = (b = 64) => new Blob([new Uint8Array(b)]);

describe("wykrywanie warstwy tekstowej przy wgrywaniu", () => {
  it("plik po naszym OCR jest oznaczony osobno od oryginału", async () => {
    // Rozróżnienie ma znaczenie: `ocr` to wynik naszego przetwarzania, nie dokument
    // z akt — przy ocenie, co realnie wpłynęło do analizy, trzeba je odróżniać.
    expect(await wykryjWarstwe("protokoły KZAiP.ocr.pdf", blob())).toBe("ocr");
  });

  it.each([
    ["metodyka.docx", "jest"],
    ["tabela limity.xlsx", "jest"],
    ["notowania.csv", "jest"],
  ])("format tekstowy %s → %s bez otwierania pliku", async (n, oczekiwany) => {
    expect(await wykryjWarstwe(n, blob())).toBe(oczekiwany);
  });

  it.each([["wykres 9.png"], ["CDS Glitnir.jpg"]])("obraz %s nie niesie tekstu", async (n) => {
    expect(await wykryjWarstwe(n, blob())).toBe("brak");
  });

  it("PDF nieczytelny daje 'brak', nie 'jest'", async () => {
    // Fałszywe „jest" zawyżyłoby kompletność akt — najgroźniejszy błąd tej aplikacji.
    expect(await wykryjWarstwe("skan.pdf", blob(128))).toBe("brak");
  });
});
