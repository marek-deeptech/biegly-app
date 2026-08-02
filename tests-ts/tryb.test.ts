import { describe, expect, it } from "vitest";

import { blokTrybu, trybDla, TRYBY } from "@/lib/domain/tryb";
import { buildBankRedactPrompt } from "@/lib/opinion/redact-bank";
import { buildBankWnioskiPrompt } from "@/lib/opinion/wnioski-bank";

const BAZOWE = {
  kind: "wskazniki_bank" as const,
  title: "Współczynniki",
  caseName: "SK Bank",
  signature: "II C 595/23",
  dzienZdarzenia: "2015-08-01",
  tableText: null,
  findings: [],
  inventory: [],
  przepisy: [],
  anachroniczne: [],
};

describe("tryb postępowania", () => {
  it("brak wartości = karne — sprawy sprzed migracji 0014 działają bez zmian", () => {
    expect(trybDla(undefined)).toBe(TRYBY.karne);
    expect(trybDla(null)).toBe(TRYBY.karne);
    expect(trybDla("nieznany")).toBe(TRYBY.karne);
  });

  it("karne odsyła do organu winę, zamiar i kwalifikację czynu", () => {
    const b = blokTrybu("karne");
    expect(b).toContain("prokuratury");
    expect(b).toContain("kwalifikacja prawna czynu");
  });

  it("cywilne odsyła do sądu odpowiedzialność, a NIE winę i zamiar", () => {
    // W sprawie o zapłatę „wina i zamiar" to zastrzeżenie bezprzedmiotowe: opinia
    // zastrzegałaby się co do rzeczy, o które nikt nie pyta, a milczała o granicy,
    // która tam obowiązuje naprawdę.
    const b = blokTrybu("cywilne");
    expect(b).toContain("sądu cywilnego");
    expect(b).toContain("odpowiedzialności odszkodowawczej");
    expect(b).not.toContain("kwalifikacja prawna czynu");
  });

  it("nazewnictwo stron idzie za trybem", () => {
    expect(blokTrybu("karne")).toContain("oskarżony");
    expect(blokTrybu("cywilne")).toContain("powód");
  });
});

describe("prompty przejmują tryb", () => {
  it("rozdział analizy w sprawie cywilnej nie powołuje prokuratury", () => {
    const karny = buildBankRedactPrompt({ ...BAZOWE, tryb: "karne" }).system;
    const cywilny = buildBankRedactPrompt({ ...BAZOWE, tryb: "cywilne" }).system;
    expect(karny).toContain("prokuratury");
    expect(cywilny).not.toContain("prokuratury");
    expect(cywilny).toContain("sądu cywilnego");
  });

  it("wnioski w sprawie cywilnej odsyłają do sądu rozstrzygnięcie o żądaniu pozwu", () => {
    const p = buildBankWnioskiPrompt({
      caseName: "SK Bank", signature: "II C 595/23", dzienZdarzenia: null, pytania: [],
      material: { rejestr: [], braki: [], zastrzezenia: [], dopelnienia: [], nieWykonane: [], przepisy: [] },
      tryb: "cywilne",
    });
    expect(p.system).toContain("rozstrzygnięcie o żądaniu pozwu");
    // Obowiązek odpowiedzi zostaje niezależnie od trybu — to sedno opinii.
    expect(p.system).toContain("MUSISZ rozstrzygnąć jednoznacznie");
  });

  it("oba tryby zachowują zakaz wnioskowania wstecznego i „nie liczysz”", () => {
    for (const tryb of ["karne", "cywilne"] as const) {
      const s = buildBankRedactPrompt({ ...BAZOWE, tryb }).system;
      expect(s).toContain("NIE LICZYSZ");
      expect(s).toContain("wnioskowanie wsteczne");
    }
  });
});

describe("akta mieszane", () => {
  it("tryb cywilny zakazuje przenoszenia zastrzeżeń z innego postępowania", () => {
    // W aktach sprawy cywilnej SK Banku leży akt oskarżenia z art. 296 k.k.
    // Model przeniósł z niego ramę karną: rozdział kończył się zastrzeżeniem
    // „kwalifikacja z art. 296 § 1 i 3 k.k. pozostaje w gestii sądu", choć
    // w tym postępowaniu nikogo nie oskarża się o przestępstwo.
    const b = blokTrybu("cywilne");
    expect(b).toContain("AKTA MOGĄ ZAWIERAĆ MATERIAŁ Z INNEGO POSTĘPOWANIA");
    expect(b).toContain("zastrzeżeń właściwych tamtemu trybowi nie przenoś");
  });

  it("ostrzeżenie jest w obu trybach — akta karne też bywają mieszane", () => {
    expect(blokTrybu("karne")).toContain("AKTA MOGĄ ZAWIERAĆ MATERIAŁ Z INNEGO POSTĘPOWANIA");
  });
});
