import { describe, expect, it } from "vitest";

import { podzielNaRozdzialy, rodzajZTytulu, rozdzialyZDocx } from "@/lib/opinion/wzorce";

// Minimalny word/document.xml — akapity ze stylami nagłówków i treścią między nimi.
// Odwzorowuje strukturę opinii biegłego: rozdział główny + podrozdziały technik.
const akapit = (tekst: string, styl?: string) =>
  `<w:p ${styl ? `><w:pPr><w:pStyle w:val="${styl}"/></w:pPr` : ""}><w:r><w:t>${tekst}</w:t></w:r></w:p>`;

const wypelniacz = (n: number) => akapit("x".repeat(n));

const DOCX = [
  akapit("I. PRZEDMIOT I PODSTAWA PRAWNA OPINII", "Heading1"),
  wypelniacz(600),
  akapit("IV. ANALIZA", "Heading1"),
  wypelniacz(600),
  akapit("4. Wash trades", "Heading2"),
  wypelniacz(700),
  akapit("6. Layering and spoofing", "Heading2"),
  wypelniacz(700),
  akapit("A) INFLACJA – CPI", "Heading2"),
  wypelniacz(600),
].join("");

describe("rozdzialyZDocx", () => {
  it("czyta poziom 2 — czyli rozdziały technik, które regex gubił", () => {
    const r = rozdzialyZDocx(DOCX);
    expect(r.map((x) => x.tytul)).toEqual([
      "I. PRZEDMIOT I PODSTAWA PRAWNA OPINII",
      "IV. ANALIZA",
      "4. Wash trades",
      "6. Layering and spoofing",
      "A) INFLACJA – CPI",
    ]);
    // Bez poziomu 2 wszystkie trzy podrozdziały zlepiłyby się w blok „IV. ANALIZA".
    expect(r.filter((x) => x.poziom === 2)).toHaveLength(3);
  });

  it("bierze numer z tytułu — rzymski, arabski i literowy", () => {
    const r = rozdzialyZDocx(DOCX);
    expect(r.map((x) => x.no)).toEqual(["I", "IV", "4", "6", "A"]);
  });

  it("pomija nagłówki bez treści (pozycje spisu treści)", () => {
    const spis = [akapit("I. WNIOSKI", "Heading1"), akapit("II. ANALIZA", "Heading1"), wypelniacz(600)].join("");
    expect(rozdzialyZDocx(spis).map((x) => x.tytul)).toEqual(["II. ANALIZA"]);
  });

  it("zwraca pustą listę, gdy dokument nie ma stylów nagłówków", () => {
    // P24 nie ma ich wcale — wtedy ingest musi spaść na wzorce tekstowe.
    expect(rozdzialyZDocx([wypelniacz(600), wypelniacz(600)].join(""))).toEqual([]);
  });
});

describe("podzielNaRozdzialy (ścieżka tekstowa — PDF i pliki bez stylów)", () => {
  it("rozpoznaje nagłówki nienumerowane WERSALIKAMI", () => {
    const tekst = [
      "PRZEDMIOT I PODSTAWA PRAWNA OPINII",
      "a".repeat(500),
      "ZASTOSOWANE TECHNIKI MANIPULACJI",
      "b".repeat(500),
    ].join("\n");
    expect(podzielNaRozdzialy(tekst).map((r) => r.tytul)).toEqual([
      "PRZEDMIOT I PODSTAWA PRAWNA OPINII",
      "ZASTOSOWANE TECHNIKI MANIPULACJI",
    ]);
  });

  it("rozpoznaje numerację arabską obok rzymskiej", () => {
    const tekst = ["1. PRZEDMIOT OPINII", "a".repeat(500), "IV. ANALIZA", "b".repeat(500)].join("\n");
    expect(podzielNaRozdzialy(tekst).map((r) => r.no)).toEqual(["1", "IV"]);
  });

  it("nie ucina tytułu na półpauzie", () => {
    // „ANALIZA – ODPOWIEDZI NA PYTANIA" nie pasowało do klasy znaków, przez co cały
    // ogon opinii (179 tys. znaków w SFI) zostawał doklejony do rozdziału „WNIOSKI".
    const tekst = ["WNIOSKI", "a".repeat(500), "ANALIZA – ODPOWIEDZI NA PYTANIA", "b".repeat(500)].join("\n");
    const r = podzielNaRozdzialy(tekst);
    expect(r).toHaveLength(2);
    expect(r[1].tytul).toContain("ODPOWIEDZI");
  });
});

describe("rodzajZTytulu", () => {
  it.each([
    ["4. Wash trades", "wash"],
    ["6. Layering and spoofing", "layering"],
    ["5. Improper matched orders", "imo"],
    ["3. Aktywność podmiotów z Grupy", "aktywnosc"],
    ["7. Identyfikacja relacji pomiędzy podmiotami z Grupy", "relacje"],
    ["2. Analiza raportów bieżących w systemie ESPI i EBI", "espi"],
    ["1. Analiza ekonomiczno-finansowa oraz otoczenia rynkowego", "ekofin"],
  ])("technika GPW: %s → %s", (tytul, oczekiwany) => {
    expect(rodzajZTytulu(tytul)).toBe(oczekiwany);
  });

  it("rozdział teoretyczny nie trafia do ekonomiczno-finansowego", () => {
    // Wzorzec `finansow` łapał „instrumentem FINANSOWYM" z nazwy rozdziału
    // teoretycznego i wpisywał go jako wzorzec analizy ekonomiczno-finansowej.
    expect(rodzajZTytulu("MANIPULACJA INSTRUMENTEM FINANSOWYM – UJĘCIE TEORETYCZNE")).toBe("proza_iii");
    expect(rodzajZTytulu("MANIPULACJA INSTRUMENTEM FINANSOWYM – UJĘCIE PRAWNE")).toBe("proza_iii");
  });

  it("odpowiedzi na pytania organu pełnią rolę wniosków", () => {
    // W nowszym szkielecie biegłego nie ma rozdziału „Wnioski" — jest ten.
    expect(rodzajZTytulu("ODPOWIEDZI NA POSTAWIONE PYTANIA")).toBe("wnioski");
    expect(rodzajZTytulu("III. WNIOSKI")).toBe("wnioski");
  });

  it.each([
    ["A) INFLACJA – CPI", "makro"],
    ["H) NOTOWANIA CDS (CREDIT DEFAULT SWAPS) BANKÓW ISLANDZKICH", "sygnaly_rynkowe"],
    ["D) ISTOTNY ARTYKUŁ Z POLSKIEJ PRASY", "media"],
    ["F) AKTYWA BANKÓW ISLANDZKICH W STOSUNKU DO PKB", "ekspozycja_sektor"],
    ["I) ANALIZA WYBRANYCH ELEMENTÓW SPRAWOZDANIA FINANSOWEGO", "sprawozdania"],
    ["L) OTOCZENIE PRAWNE I STANDARDY IDENTYFIKACJI RYZYKA", "otoczenie_prawne"],
  ])("moduł bankowy: %s → %s", (tytul, oczekiwany) => {
    expect(rodzajZTytulu(tytul)).toBe(oczekiwany);
  });
});
