import { describe, expect, it } from "vitest";

import { chartSvg } from "@/lib/opinion/charts";
import { wykresAdekwatnosci, wykresSzeregu } from "@/lib/opinion/charts-bank";

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
