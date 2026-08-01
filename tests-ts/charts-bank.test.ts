import { describe, expect, it } from "vitest";

import { chartSvg } from "@/lib/opinion/charts";
import { wykresAdekwatnosci, wykresSzeregu, wykresyPozycji } from "@/lib/opinion/charts-bank";

// Układ tabeli dokładnie taki, jaki produkuje /api/bank: wskaźniki w wierszach,
// okresy w kolumnach, na końcu zmiana, próg i podstawa progu.
const TABELA = {
  head: ["Wskaźnik", "2006-12-31", "2007-12-31", "2008-06-30", "Zmiana", "Próg", "Podstawa progu"],
  rows: [
    ["Współczynnik kapitału podstawowego Tier 1 (CET1)", "8,17 %", "6,17 %", "5,47 %", "-0.70 p.p.", "—", "brak progu w tym stanie prawnym"],
    ["Łączny współczynnik kapitałowy", "15,04 %", "11,18 %", "11,16 %", "-0.02 p.p.", "8%", "Uchwała nr 1/2007 KNB"],
  ],
};

describe("wykresy dziedziny bankowej", () => {
  it("nie rysuje progu, którego w danym okresie NIE BYŁO", () => {
    // Silnik wpisuje „—", gdy przepisu jeszcze nie ma (przed CRR nie istniał wymóg
    // CET1). Zamiana tego na 0 kazałaby narysować próg na poziomie zerowym
    // i sugerować wymóg, którego nie było.
    const w = wykresAdekwatnosci(TABELA, "kapitału podstawowego")!;
    expect(w.prog).toBeUndefined();
    expect(chartSvg(w)).not.toContain("stroke-dasharray");
  });

  it("rysuje próg tam, gdzie obowiązywał, wraz z podstawą prawną", () => {
    const w = wykresAdekwatnosci(TABELA, "Łączny współczynnik")!;
    expect(w.prog?.wartosc).toBe(8);
    expect(w.prog?.label).toContain("Uchwała nr 1/2007 KNB");
  });

  it("skala obejmuje próg, nawet gdy leży poniżej wszystkich wartości", () => {
    // Współczynnik 11–15% przy progu 8% dawał oś od 11 — linia progu wypadała poza
    // pole wykresu i czytelnik nie widział, jak daleko jest do minimum.
    const svg = chartSvg(wykresAdekwatnosci(TABELA, "Łączny współczynnik")!);
    expect(svg).toContain("stroke-dasharray");
    expect(svg).toContain("próg 8%");
  });

  it("obraca tabelę: okresy z nagłówka stają się osią X", () => {
    const w = wykresAdekwatnosci(TABELA, "Łączny współczynnik")!;
    expect(w.days).toEqual(["2006-12-31", "2007-12-31", "2008-06-30"]);
    expect(w.left.values).toEqual([15.04, 11.18, 11.16]);
  });

  it("znacznik dnia decyzji nie przesuwa się na notowanie późniejsze", () => {
    // Przesunięcie w prawo sugerowałoby, że decyzja zapadła po notowaniu,
    // którego oceniany nie mógł znać.
    const t = { head: ["Miesiąc", "Wartość"], rows: [["2008-07-31", "3 743,64"], ["2008-08-29", "3 848,65"], ["2008-09-30", "3 180,51"]] };
    const svg = chartSvg(wykresSzeregu(t, "ICEX", "", "2008-09-11")!);
    expect(svg).toContain("dzień decyzji");
  });

  it("szereg krótszy niż 3 punkty nie daje wykresu", () => {
    expect(wykresSzeregu({ head: ["a", "b"], rows: [["2008-01-01", "1"]] }, "X", "")).toBeNull();
  });
});

describe("wykresy kwotowe ze sprawozdań", () => {
  const POZ = {
    head: ["Pozycja", "2006-12-31", "2007-12-31", "2008-06-30", "Zmiana", "Źródło"],
    rows: [
      ["Fundusze własne razem", "235 258", "225 576", "283 224", "+20.4%", "—"],
      ["Aktywa ważone ryzykiem (RWA)", "1 564 300", "2 017 470", "2 537 072", "+62.2%", "—"],
      ["Aktywa ogółem", "2 246 340", "2 948 910", "3 862 797", "+72.0%", "—"],
      ["Kredyty i pożyczki udzielone klientom", "1 596 184", "1 974 907", "2 548 164", "+59.6%", "—"],
    ],
  };

  it("zestawia wielkości PARAMI — sama suma bilansowa nic nie mówi", () => {
    const w = wykresyPozycji(POZ);
    const fw = w.find((x) => x.spec.title.startsWith("Fundusze własne"))!;
    expect(fw.spec.left.values).toEqual([235258, 225576, 283224]);
    expect(fw.spec.right?.values).toEqual([1564300, 2017470, 2537072]);
  });

  it("rysuje słupki, nie linie — trzy daty bilansowe to nie szereg ciągły", () => {
    // Linia sugerowałaby ciągłość między datami bilansowymi, której nie ma.
    const w = wykresyPozycji(POZ)[0];
    expect(w.spec.left.kind).toBe("bars");
    expect(w.spec.right?.kind).toBe("bars");
    // Wspólna jednostka → wspólna skala. Bez niej 283 224 i 2 537 072 wyglądałyby
    // podobnie i wykres mówiłby coś przeciwnego niż dane.
    expect(w.spec.left.unit).toBe(w.spec.right?.unit);
  });

  it("NIE rysuje okresu objętego zastrzeżeniem i mówi o tym w tytule", () => {
    // Wykres jest podsumowaniem, którego czytelnik nie zweryfikuje — słupek
    // poprowadzony przez wartość niewiarygodną publikuje błąd w formie
    // najtrudniejszej do wychwycenia.
    const w = wykresyPozycji(POZ, ["2007-12-31: bilans nie domyka się — różnica 27,5%"])[0];
    expect(w.spec.left.values).toEqual([235258, null, 283224]);
    expect(w.spec.title).toContain("bez okresu 2007-12-31");
  });

  it("nie rysuje pary, w której brakuje jednej z wielkości", () => {
    const bezRwa = { ...POZ, rows: POZ.rows.filter((r) => !r[0].includes("RWA")) };
    expect(wykresyPozycji(bezRwa).some((x) => x.spec.title.startsWith("Fundusze własne"))).toBe(false);
  });

  it("seria bez jednostki nie dostaje pustego nawiasu w legendzie", () => {
    // „Aktywa ważone ryzykiem (RWA) ()" wygląda w opinii sądowej jak usterka pliku.
    expect(chartSvg(wykresyPozycji(POZ)[0].spec)).not.toContain(" ()");
  });
});
