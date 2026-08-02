import { describe, expect, it } from "vitest";

import { docTypesDla, typyDziedzinowe, typyKlasyfikacji } from "@/lib/intake/classify";
import { buildKlasyfikacjaPrompt, przefiltruj, PROG_PEWNOSCI } from "@/lib/intake/klasyfikacja-tresci";

const TYPY = docTypesDla("ryzyko_bankowe");
const DOK = [{ id: "a1", nazwa: "SKM_C451i26080211200.pdf", tekst: "UCHWAŁA NR 12/2014 ZARZĄDU KASY…" }];

describe("prompt klasyfikacji z treści", () => {
  it("zakazuje sugerowania się nazwą pliku", () => {
    // W sprawie SKOK wszystkie nazwy pochodzą ze skanera i nie niosą nic;
    // model, który by się nimi kierował, produkowałby szum udający klasyfikację.
    const { system } = buildKlasyfikacjaPrompt(TYPY, DOK);
    expect(system).toContain("Nazwa pliku nie niesie informacji");
    expect(system).toContain("nie wolno się nią sugerować");
  });

  it("każe zwrócić UNKNOWN zamiast zgadywać", () => {
    const { system } = buildKlasyfikacjaPrompt(TYPY, DOK);
    expect(system).toContain("błędna etykieta jest gorsza");
  });

  it("podaje katalog dziedziny, bez UNKNOWN jako celu", () => {
    const { user } = buildKlasyfikacjaPrompt(TYPY, DOK);
    expect(user).toContain("SPRAWOZDANIE_BANK");
    expect(user).toContain("PROTOKOL_KOMITETU");
    expect(user).not.toMatch(/^- UNKNOWN:/m);
  });

  it("uprzedza, że tekst pochodzi z OCR i bywa zniekształcony", () => {
    expect(buildKlasyfikacjaPrompt(TYPY, DOK).system).toContain("OCR");
  });
});

describe("odsiew wyników", () => {
  it("odrzuca typ spoza katalogu — inaczej dokument dostaje etykietę, której aplikacja nie zna", () => {
    const { przyjete, odrzucone } = przefiltruj(
      [{ id: "a", typ: "WYMYSLONY_TYP", pewnosc: 0.99, opis: "x" }],
      TYPY,
    );
    expect(przyjete).toHaveLength(0);
    expect(odrzucone[0].powod).toContain("spoza katalogu");
  });

  it("odrzuca poniżej progu pewności", () => {
    const { przyjete, odrzucone } = przefiltruj(
      [{ id: "a", typ: "SPRAWOZDANIE_BANK", pewnosc: PROG_PEWNOSCI - 0.01, opis: "x" }],
      TYPY,
    );
    expect(przyjete).toHaveLength(0);
    expect(odrzucone[0].powod).toContain("poniżej progu");
  });

  it("przepuszcza rozpoznanie pewne", () => {
    const { przyjete } = przefiltruj(
      [{ id: "a", typ: "PROTOKOL_KOMITETU", pewnosc: 0.9, opis: "Protokół posiedzenia zarządu kasy" }],
      TYPY,
    );
    expect(przyjete).toHaveLength(1);
  });

  it("UNKNOWN od modelu nie nadpisuje istniejącej klasyfikacji", () => {
    const { przyjete, odrzucone } = przefiltruj([{ id: "a", typ: "UNKNOWN", pewnosc: 0.95, opis: "?" }], TYPY);
    expect(przyjete).toHaveLength(0);
    expect(odrzucone[0].powod).toContain("nie rozpoznał");
  });
});

// ── Pierwszeństwo typów dziedzinowych ────────────────────────────────────────
// Sprawa bankowa dostaje rdzeń ogólnoprocesowy PLUS katalog bankowy — razem ~50 kodów,
// w których „pismo organu nadzoru" pasuje i do NADZOR_KNF, i do KORESPONDENCJI.
// W aktach SK Banku wystąpienie pokontrolne NIK trafiło do korespondencji, a fragment
// TEGO SAMEGO raportu — do materiałów nadzoru. Raport kompletności przestał wtedy
// widzieć rdzeń akt sprawy o nadzór.
describe("pierwszeństwo typów dziedziny", () => {
  const KONTEKST = { dziedzinowe: typyDziedzinowe("ryzyko_bankowe"), tryb: "cywilne" };

  it("dzieli katalog na dziedzinowy i ogólnoprocesowy", () => {
    const { user } = buildKlasyfikacjaPrompt(TYPY, DOK, KONTEKST);
    expect(user).toContain("TYPY DZIEDZINOWE");
    expect(user).toContain("TYPY OGÓLNOPROCESOWE");
    expect(user.indexOf("NADZOR_KNF")).toBeLessThan(user.indexOf("- KORESPONDENCJA:"));
  });

  it("mówi wprost, że forma pisma nie przesądza typu", () => {
    const { system } = buildKlasyfikacjaPrompt(TYPY, DOK, KONTEKST);
    expect(system).toContain("FORMA DOKUMENTU NIE PRZESĄDZA TYPU");
    expect(system).toContain("wybierz DZIEDZINOWY");
  });

  it("nie nazywa sprawy cywilnej karną", () => {
    expect(buildKlasyfikacjaPrompt(TYPY, DOK, KONTEKST).system).toContain("sprawy cywilnej");
    expect(buildKlasyfikacjaPrompt(TYPY, DOK, { tryb: "karne" }).system).toContain("sprawy karnej");
  });

  it("dziedzina GPW zostaje przy jednej liście — bez zmiany dla spraw sprzed migracji 0010", () => {
    const gpw = docTypesDla(null);
    const { user } = buildKlasyfikacjaPrompt(gpw, DOK, { dziedzinowe: typyDziedzinowe(null) });
    expect(user).not.toContain("TYPY DZIEDZINOWE");
    expect(user).toContain("DANE_UTP");
  });
});

describe("katalog podsuwany modelowi", () => {
  it("sprawie bankowej nie podsuwa kodu dublującego typ bankowy", () => {
    // Informacja dodatkowa do sprawozdania SK Banku dostała SPRAWOZDANIE_FIN zamiast
    // SPRAWOZDANIE_BANK, a zaświadczenie banku o stanie środków — DANE_BROKERSKIE
    // („Dane z firm inwestycyjnych"). Sama reguła pierwszeństwa tego nie domykała.
    const modelu = typyKlasyfikacji("ryzyko_bankowe");
    expect(modelu).not.toHaveProperty("SPRAWOZDANIE_FIN");
    expect(modelu).not.toHaveProperty("DANE_BROKERSKIE");
    expect(modelu).not.toHaveProperty("DANE_UTP");
    expect(modelu).toHaveProperty("SPRAWOZDANIE_BANK");
    expect(modelu).toHaveProperty("KORESPONDENCJA");
  });

  it("katalog ETYKIET zostaje pełny — dokument oznaczony kiedyś takim kodem ma się wyświetlać", () => {
    expect(docTypesDla("ryzyko_bankowe")).toHaveProperty("SPRAWOZDANIE_FIN");
    expect(docTypesDla("ryzyko_bankowe").DANE_BROKERSKIE.label).toBeTruthy();
  });

  it("dziedziny GPW nie zawęża", () => {
    expect(Object.keys(typyKlasyfikacji(null))).toEqual(Object.keys(docTypesDla(null)));
  });
});
