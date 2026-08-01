import { describe, expect, it } from "vitest";

import { storageKey } from "@/lib/upload";

describe("klucz obiektu w magazynie", () => {
  it("odrzuca znaki, których Storage nie przyjmuje", () => {
    // „^icex_d (1).csv" — notowania indeksu ICEX, 682 obserwacje. Plik nie wgrał
    // się w ogóle, a wiersz w bazie powstał, więc akta liczyły go jako obecny.
    expect(storageKey("abc/^icex_d (1).csv")).toBe("abc/_icex_d (1).csv");
  });

  it("transliteruje polskie znaki, nie zamienia ich na podkreślenia", () => {
    expect(storageKey("x/uchwała metodyka limitów.pdf")).toBe("x/uchwala metodyka limitow.pdf");
  });

  it("zachowuje strukturę katalogów i rozszerzenie", () => {
    expect(storageKey("id/Skany akt/protokoły KZAiP.ocr.pdf")).toBe("id/Skany akt/protokoly KZAiP.ocr.pdf");
  });

  it("nie zostawia wiodącej kropki w segmencie ścieżki", () => {
    expect(storageKey("id/.ukryty.pdf")).toBe("id/_ukryty.pdf");
  });
});
