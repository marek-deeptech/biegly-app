/**
 * Wykresy sesyjne IV.6 i wykaz załączników — ze źródeł PER INSTRUMENT.
 *
 * ⚠️ REGRESJA. Detektor layeringu biegał już osobno dla CSY i RSY (`spoofing_csy`,
 * `spoofing_rsy`), ale opinia nadal czytała zbiorczy `spoofing_analysis` sprzed
 * rozdzielenia walorów — wykresy sesyjne i wykaz załączników niosły sesje zmieszane
 * z dwóch arkuszy zleceń, bez informacji, którego waloru dotyczą.
 */
import { describe, expect, it } from "vitest";
import { buildOpinion } from "@/lib/opinion/build";

type Sub = NonNullable<Parameters<typeof buildOpinion>[3]>[number];

const sesja = (day: string, cancelled: number) => ({
  day, manip: true, cancelled_buy: cancelled, declared_buy: cancelled * 2,
  cancel_ratio: 0.5, sell_exec_vol: 900, layer_orders: 3,
  series: {
    times: ["09:00", "09:15"], sumK: [10, 20], sumS: [5, 5], diff: [5, 15],
    price: [1.05, 1.15], bid: [1, 1.1], ask: [1.2, 1.3],
  },
});

const spoof = (kind: string, dni: ReturnType<typeof sesja>[], flagged: number, zbadane: number): Sub =>
  ({
    kind, chapter_no: "IV", title: kind, status: "szkic", body_md: "",
    data: { analysis: { days: dni, totals: { sessions_flagged: flagged }, examined: { sessions: zbadane } } },
  }) as unknown as Sub;

// Rozdział IV.6 musi istnieć w opinii (status ≠ „todo"), inaczej wykresy nie mają
// gdzie wejść — stąd subanaliza `layering` z ustaleniem obok analiz detektora.
const LAYERING = {
  kind: "layering", chapter_no: "IV.6", title: "Layering and spoofing", status: "szkic",
  body_md: "x".repeat(400), data: { findings: ["CSY: sesji ze znamionami layeringu 8."] },
} as unknown as Sub;

const TECHNIKI = { kind: "techniki", chapter_no: "IV", title: "Techniki", status: "zatwierdzona", body_md: "", data: { selected: ["layering"] } } as unknown as Sub;
const CASE = { name: "ZASTAL", signature: "III K 193/23/1" };

describe("IV.6 czyta analizy per instrument", () => {
  it("wykresy sesyjne powstają z obu walorów i niosą jego nazwę", () => {
    const op = buildOpinion(CASE, [], [], [
      TECHNIKI,
      LAYERING,
      spoof("spoofing_csy", [sesja("2019-03-29", 12777)], 8, 148),
      spoof("spoofing_rsy", [sesja("2019-03-29", 4000)], 0, 120),
    ]);
    const nazwy = op.chapters
      .flatMap((c) => (c.placeholders ?? []).map((p) => p.name))
      .filter((n) => n.includes("Sesja 2019-03-29"));
    expect(nazwy.length).toBe(2); // ta sama data w dwóch arkuszach — dwa różne wykresy
    expect(nazwy.some((n) => n.includes("CSY"))).toBe(true);
    expect(nazwy.some((n) => n.includes("RSY"))).toBe(true);
  });

  it("wykaz załączników podaje wynik i PODSTAWĘ dla każdego waloru", () => {
    const op = buildOpinion(CASE, [], [], [
      TECHNIKI,
      LAYERING,
      spoof("spoofing_csy", [sesja("2019-03-29", 12777)], 8, 148),
      spoof("spoofing_rsy", [], 0, 120),
    ]);
    const wykaz = JSON.stringify(op);
    expect(wykaz).toMatch(/CSY: 8 sesji ze znamionami techniki z 148 zbadanych/);
    // Zero MUSI iść z podstawą — inaczej czyta się jak brak materiału dowodowego.
    expect(wykaz).toMatch(/RSY: 0 sesji ze znamionami techniki z 120 zbadanych/);
  });

  it("sprawa jednoinstrumentowa nadal działa na zbiorczej analizie", () => {
    const op = buildOpinion({ name: "HUBTECH", signature: null }, [], [], [
      TECHNIKI,
      LAYERING,
      spoof("spoofing_analysis", [sesja("2019-03-29", 46000)], 5, 60),
    ]);
    expect(JSON.stringify(op)).toMatch(/5 sesji ze znamionami techniki z 60 zbadanych/);
  });
});
