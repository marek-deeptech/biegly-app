import { describe, expect, it } from "vitest";

import { dopelniaczOrganu, dataSlownie, formulaWstepna, blokTrybu, trybDla, TRYBY } from "@/lib/domain/tryb";
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

describe("klauzula zamykająca dokument", () => {
  it("jest cechą trybu, nie stałą w rendererze", () => {
    // Ten sam napis stał zaszyty w docx.ts i pdf.ts naraz — zmiana wymagała
    // pamiętania o dwóch plikach, a tryb do żadnego z nich nie docierał.
    for (const t of ["karne", "cywilne"]) expect(trybDla(t).klauzulaKoncowa).toBeTruthy();
  });

  it("powołanie na art. 233 § 4 k.k. zostaje TAKŻE w sprawie cywilnej", () => {
    // ⚠️ SPRAWDZONE: przepis dotyczy fałszywej opinii mającej służyć za dowód
    // „w postępowaniu sądowym lub w innym postępowaniu prowadzonym na podstawie
    // ustawy" — obejmuje więc postępowanie cywilne. To NIE jest formuła karna,
    // wbrew pierwszemu wrażeniu; usunięcie jej z opinii cywilnej byłoby błędem.
    expect(trybDla("cywilne").klauzulaKoncowa).toContain("art. 233 § 4 k.k.");
    expect(trybDla("karne").klauzulaKoncowa).toContain("art. 233 § 4 k.k.");
  });
});

describe("formuła wstępna", () => {
  it("mówi, kto zlecił opinię i na jakiej podstawie", () => {
    expect(
      formulaWstepna({ organ: "Sąd Okręgowy w Warszawie", dataPowolania: "2025-02-12", signature: "II C 595/23", tryb: "cywilne" }),
    ).toBe(
      "Opinia sporządzona na zlecenie Sądu Okręgowego w Warszawie, na podstawie postanowienia " +
        "o dopuszczeniu dowodu z opinii biegłego z dnia 12 lutego 2025 r., sygn. akt II C 595/23.",
    );
  });

  it("nazywa orzeczenie właściwie dla trybu", () => {
    // Sąd cywilny DOPUSZCZA DOWÓD z opinii; organ postępowania karnego POWOŁUJE biegłego.
    expect(formulaWstepna({ organ: "Prokuratura Okręgowa", tryb: "karne" })).toContain("o powołaniu biegłego");
    expect(formulaWstepna({ organ: "Sąd Okręgowy", tryb: "cywilne" })).toContain("o dopuszczeniu dowodu");
  });

  it("bez organu zwraca PUSTY napis — nie zgaduje", () => {
    // Dokument bez formuły jest niekompletny; dokument z organem wymyślonym przez
    // aplikację byłby dokumentem nieprawdziwym.
    expect(formulaWstepna({ organ: null, dataPowolania: "2025-02-12", signature: "II C 595/23" })).toBe("");
    expect(formulaWstepna({ organ: "   " })).toBe("");
  });

  it("radzi sobie bez daty postanowienia", () => {
    const f = formulaWstepna({ organ: "Sąd Okręgowy w Warszawie", signature: "II C 595/23", tryb: "cywilne" });
    expect(f).toContain("Sądu Okręgowego w Warszawie");
    expect(f).not.toContain("z dnia");
  });

  it("data po polsku, w dopełniaczu", () => {
    expect(dataSlownie("2025-02-12")).toBe("12 lutego 2025 r.");
    expect(dataSlownie(null)).toBe("");
  });
});

describe("odmiana nazwy organu", () => {
  it("odmienia sądy i prokuratury", () => {
    // „na zlecenie Sąd Okręgowy" to błąd gramatyczny na stronie tytułowej
    // dokumentu procesowego.
    expect(dopelniaczOrganu("Sąd Okręgowy w Warszawie")).toBe("Sądu Okręgowego w Warszawie");
    expect(dopelniaczOrganu("Sąd Rejonowy dla m.st. Warszawy")).toBe("Sądu Rejonowego dla m.st. Warszawy");
    expect(dopelniaczOrganu("Prokuratura Regionalna w Warszawie")).toBe("Prokuratury Regionalnej w Warszawie");
  });

  it("nieznanej nazwy NIE odmienia — zdanie układa się z dwukropkiem", () => {
    // Ogólna odmiana polskich nazw własnych jest zawodna; lepiej niezgrabnie
    // niż z błędem, którego biegły nie zauważy przed wysłaniem do sądu.
    expect(dopelniaczOrganu("Komisja Nadzoru Finansowego")).toBeNull();
    expect(formulaWstepna({ organ: "Komisja Nadzoru Finansowego", tryb: "karne" })).toContain(
      "na zlecenie: Komisja Nadzoru Finansowego",
    );
  });
});
