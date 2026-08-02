import { describe, expect, it } from "vitest";

import { docTypesDla } from "@/lib/intake/classify";
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
