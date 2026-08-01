import { describe, expect, it } from "vitest";

import { packDla, wymaganeTypy, WSZYSTKIE_PAKIETY } from "@/lib/domain";
import { przepisyAnachroniczne, przepisyNaDzien } from "@/lib/domain/prawo-bankowe";
import { classifyPath } from "@/lib/intake/classify";
import { buildCompleteness } from "@/lib/intake/completeness";

// Nazwy plików pochodzą z realnych akt PO III Ds 84.2020. Są WBUDOWANE, nie czytane
// z dysku: golden testy silnika padły już raz, gdy katalog źródłowy uporządkowano.
const AKTA_MBR = [
  "postanowienie o powołaniu biegłego.pdf",
  "Skany akt 84.2020/uchwała metodyka limitow.pdf",
  "Skany akt 84.2020/protokoły KZAiP.pdf",
  "Skany akt 84.2020/uchwała kompetencje do podejmowania dec.pdf",
  "Skany akt 84.2020/audyt wew.pdf",
  "Skany akt 84.2020/BION MBR.pdf",
  "załączniki/ZAŁĄCZNIK 5 - SF-GLITNIR-2008-2q.pdf",
  "załączniki/ZAŁĄCZNIK 6 - SF-GLITNIR-2007.pdf",
  "CDS default.xlsx",
  "CBI 2008 enska.pdf",
  "Icelandic whispers shake faith in boom _ Financial Times.pdf",
];

describe("klasyfikacja akt bankowych", () => {
  it.each([
    // Raport sektorowy nadzoru, mimo skrótu KNB w nazwie — nie źródło prawa.
    ["KNB bankispoldzielcze 2006.pdf", "NADZOR_KNF"],
    // Uchwała KNB to JEST źródło prawa.
    ["Uchwały KNB 2007/Uchwała nr 1 _2007 Komisji Nadzoru Bankowego.pdf", "AKT_PRAWNY"],
    // Regulacja DOTYCZĄCA ratingów, nie komunikat agencji.
    ["rozporządzenie - rating.pdf", "AKT_PRAWNY"],
    ["Skany akt 84.2020/uchwała metodyka limitow.pdf", "METODYKA_LIMITOW"],
    ["Skany akt 84.2020/uchwała kompetencje do podejmowania dec.pdf", "UCHWALA_WEWNETRZNA"],
    ["załączniki/ZAŁĄCZNIK 5 - SF-GLITNIR-2008-2q.pdf", "SPRAWOZDANIE_BANK"],
    ["CBI 2008 enska.pdf", "RAPORT_BANK_CENTRALNY"],
    ["CDS default.xlsx", "DANE_RYNKOWE_SZEREG"],
    ["RACHUNEK I KARTA BIEGŁEGO PROKURATURA MBR.doc", "RACHUNEK_BIEGLEGO"],
    // Wykres sporządzony do opinii — wyjście, nie dowód. Reguła grafiki musi
    // wyprzedzać merytoryczne, bo podciąg „cds" pasowałby wcześniej.
    ["grafika/CDS Glitnir.jpg", "GRAFIKA"],
    // Podkreślenia zamiast spacji — dopasowanie po spłaszczeniu separatorów.
    ["Domanska_Szaruga_Ryzyko_kredytowe_w_swietle NUK.pdf", "LITERATURA"],
  ])("%s → %s", (plik, oczekiwany) => {
    expect(classifyPath(plik, "ryzyko_bankowe")).toBe(oczekiwany);
  });

  it.each([
    ["HUBTECH/Transakcje_i_Zlecenia_HUBTech 2020 prok.xlsx", "DANE_UTP"],
    ["MLM/UTP_TREM_2022.xlsx", "DANE_TREM"],
    ["ZASTAL/Zestawienie zlecen (wszystkie instrumenty).xlsx", "DANE_BROKERSKIE"],
  ])("klasyfikacja GPW pozostaje nietknięta: %s → %s", (plik, oczekiwany) => {
    expect(classifyPath(plik)).toBe(oczekiwany);
  });
});

describe("raport kompletności", () => {
  const docs = AKTA_MBR.map((p) => ({ rel_path: p, doc_type: classifyPath(p, "ryzyko_bankowe") }));

  it("wypisuje moduły dziedziny bankowej, nie techniki GPW", () => {
    // Lista modułów brana ze stałej WYMOGI powodowała, że raport sprawy bankowej
    // wypisywał wash trades i layering — techniki, których ta dziedzina nie zna.
    const r = buildCompleteness(docs, "ryzyko_bankowe");
    const kody = r.techniki.map((t) => t.kind);
    expect(kody).toContain("adekwatnosc");
    expect(kody).toContain("limity");
    expect(kody).not.toContain("wash");
    expect(kody).not.toContain("layering");
  });

  it("brak sprawozdań blokuje współczynniki kapitałowe", () => {
    const bez = docs.filter((d) => d.doc_type !== "SPRAWOZDANIE_BANK");
    const r = buildCompleteness(bez, "ryzyko_bankowe");
    const adekw = r.techniki.find((t) => t.kind === "adekwatnosc");
    expect(adekw?.dostepna).toBe(false);
    expect(r.braki_krytyczne.join(" ")).toContain("Sprawozdania");
  });

  it("skan bez warstwy tekstowej NIE spełnia wymogu", () => {
    // Najgroźniejszy błąd, jaki ta aplikacja może popełnić: w sprawie MBR raport
    // pokazał 10/10, a dziewięć kluczowych dokumentów miało zero znaków na 125
    // stronach. Obecność pliku w aktach to nie to samo co dostęp do jego treści.
    const skan = [{ rel_path: "postanowienie o powołaniu biegłego.pdf", doc_type: "POSTANOWIENIE", warstwa_tekstu: "brak" }];
    const r = buildCompleteness(skan, "ryzyko_bankowe");
    const w = r.wymogi.find((x) => x.wymog.id === "postanowienie")!;
    expect(w.spelniony).toBe(false);
    expect(w.bezOcr).toContain("postanowienie o powołaniu biegłego.pdf");
  });

  it("ten sam skan po OCR spełnia wymóg", () => {
    const poOcr = [{ rel_path: "postanowienie o powołaniu biegłego.pdf", doc_type: "POSTANOWIENIE", warstwa_tekstu: "ocr" }];
    const w = buildCompleteness(poOcr, "ryzyko_bankowe").wymogi.find((x) => x.wymog.id === "postanowienie")!;
    expect(w.spelniony).toBe(true);
    expect(w.bezOcr).toEqual([]);
  });

  it("dokumenty sprzed migracji 0011 (bez informacji) liczą się jak dotąd", () => {
    const stare = [{ rel_path: "postanowienie.pdf", doc_type: "POSTANOWIENIE" }];
    expect(buildCompleteness(stare, "ryzyko_bankowe").wymogi.find((x) => x.wymog.id === "postanowienie")!.spelniony).toBe(true);
  });

  it("sprawa bez typu zachowuje raport GPW", () => {
    const r = buildCompleteness([{ rel_path: "x.xlsx", doc_type: "DANE_UTP" }]);
    expect(r.techniki.map((t) => t.kind)).toContain("wash");
  });
});

describe("katalog prawny datowany", () => {
  it("dla decyzji z 11.09.2008 daje stan prawny z tamtej daty", () => {
    const refy = przepisyNaDzien("2008-09-11").map((p) => p.ref);
    // To przepis, na którym biegły faktycznie oparł wnioski w sprawie MBR.
    expect(refy).toContain("Uchwała nr 5/2007 KNB, § 5");
    expect(refy.some((r) => r.includes("CRR"))).toBe(false);
  });

  it("oznacza CRR jako anachronizm wobec zdarzenia z 2008", () => {
    // Powołanie CRR do oceny decyzji sprzed 2014 to błąd, który obrona wytknie.
    const anach = przepisyAnachroniczne("2008-09-11").map((p) => p.ref);
    expect(anach).toContain("art. 92 CRR");
  });

  it("dla zdarzenia z 2020 daje CRR zamiast uchwał KNB", () => {
    const refy = przepisyNaDzien("2020-06-01", "adekwatnosc").map((p) => p.ref);
    expect(refy).toContain("art. 92 CRR");
    expect(refy.some((r) => r.includes("KNB"))).toBe(false);
  });
});

describe("rejestr pakietów dziedzinowych", () => {
  it("sprawa bez typu spada na dziedzinę GPW", () => {
    // Trzy sprawy założone przed migracją 0010 nie mają typu i muszą działać.
    expect(packDla(null).id).toBe("manipulacja_gpw");
    expect(packDla("nieznany").id).toBe("manipulacja_gpw");
  });

  it("obie dziedziny mają 6–8 rozdziałów głównych", () => {
    // Szkielet jest stały w obrębie dziedziny; zmienna jest liczba podrozdziałów.
    for (const p of WSZYSTKIE_PAKIETY) {
      expect(p.szkielet.length).toBeGreaterThanOrEqual(6);
      expect(p.szkielet.length).toBeLessThanOrEqual(8);
    }
  });

  it("rola rozdziału jest wspólna dla dziedzin — stąd współdzielony korpus stylu", () => {
    const role = (id: string) =>
      WSZYSTKIE_PAKIETY.find((p) => p.id === id)!.szkielet.map((r) => r.rola);
    for (const rola of ["proza_i", "wnioski", "analiza"]) {
      expect(role("manipulacja_gpw")).toContain(rola);
      expect(role("ryzyko_bankowe")).toContain(rola);
    }
  });

  it("wymagane typy dziedziny bankowej wywodzą się z wymogów krytycznych", () => {
    const { required } = wymaganeTypy("ryzyko_bankowe");
    expect(required).toContain("SPRAWOZDANIE_BANK");
    expect(required).toContain("METODYKA_LIMITOW");
    expect(required).not.toContain("DANE_UTP");
  });
});
