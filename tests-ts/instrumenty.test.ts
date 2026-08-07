/**
 * Rozdzielenie operacji liczbowych na instrumenty.
 *
 * ⚠️ SEDNO: w sprawie ZASTAL (CSY + RSY) zestaw łączny dawał liczby bez desygnatu —
 * wolumen sesji jako suma dwóch różnych papierów, kurs zamknięcia po cichu wzięty
 * z jednego z nich, a fazy kursu (+1050 % / −13,91 %) nieopisujące ŻADNEGO
 * instrumentu (CSY: +920 % / −2,94 %; RSY: +742,86 % / 0 %). Te testy pilnują,
 * że liczby idą per instrument i że przeplot da się wykryć.
 */
import { describe, expect, it } from "vitest";
import {
  czyZmieszane,
  fazyKursu,
  instrumentySprawy,
  metrykiInstrumentu,
  tabelaFaz,
  type Metryka,
} from "@/lib/opinion/instrumenty";

const m = (key: string, value: number | null, session_day?: string): Metryka => ({ key, value, session_day });

// Realne kursy graniczne z akt: CSY 0,80 → 10,20 → 9,90; RSY 1,40 → 11,80 → 11,80.
const CSY: Metryka[] = [
  m("day_close", 0.8, "2017-12-04"),
  m("day_close", 2.98, "2018-03-20"),
  m("day_close", 10.2, "2019-09-09"),
  m("day_close", 9.9, "2019-09-30"),
];
const RSY: Metryka[] = [
  m("day_close", 1.4, "2017-12-11"),
  m("day_close", 2.5, "2018-03-20"),
  m("day_close", 11.8, "2019-09-27"),
];

const SUBS = [
  { kind: "trem_csy", data: { label: "CSY", metrics: CSY } },
  { kind: "trem_rsy", data: { label: "RSY", metrics: RSY } },
  { kind: "wash", data: { findings: [] } },
];

describe("instrumenty sprawy", () => {
  it("wykrywa instrumenty z subanaliz trem_* i zwraca je stabilnie", () => {
    expect(instrumentySprawy(SUBS).map((x) => `${x.ticker}/${x.label}`)).toEqual(["csy/CSY", "rsy/RSY"]);
  });

  it("metryki instrumentu pochodzą z JEGO subanalizy, nie z zestawu łącznego", () => {
    expect(metrykiInstrumentu(SUBS, "csy")).toHaveLength(4);
    expect(metrykiInstrumentu(SUBS, "rsy")).toHaveLength(3);
    expect(metrykiInstrumentu(SUBS, "brak")).toEqual([]);
  });
});

describe("fazyKursu — liczone per instrument", () => {
  it("odtwarza fazy CSY i RSY osobno, zgodnie z akt", () => {
    const c = fazyKursu(CSY)!;
    expect(c.pumpPct).toBeCloseTo(1175, 0); // 0,80 → 10,20
    expect(c.dzienSzczytu).toBe("2019-09-09");
    expect(c.dumpPct).toBeCloseTo(-2.94, 2); // 10,20 → 9,90
    const r = fazyKursu(RSY)!;
    expect(r.pumpPct).toBeCloseTo(742.86, 2); // 1,40 → 11,80
    expect(r.dumpPct).toBe(0); // szczyt na końcu okresu
  });

  it("żadna z faz per instrument nie równa się fazie z zestawu zmieszanego", () => {
    // Zestaw łączny dawał +1050 % / −13,91 % — wielkości, których nie ma
    // w żadnym instrumencie. Ten test utrwala, dlaczego liczymy osobno.
    for (const f of [fazyKursu(CSY)!, fazyKursu(RSY)!]) {
      expect(Math.round(f.pumpPct)).not.toBe(1050);
      expect(Number(f.dumpPct.toFixed(2))).not.toBe(-13.91);
    }
  });

  it("szereg krótszy niż dwie sesje nie daje faz (zamiast zmyślać punkt odniesienia)", () => {
    expect(fazyKursu([m("day_close", 1, "2018-01-02")])).toBeNull();
    expect(fazyKursu([])).toBeNull();
  });
});

describe("czyZmieszane — bezpiecznik przed liczeniem na przeplocie", () => {
  it("wykrywa dwa różne kursy zamknięcia tej samej sesji", () => {
    expect(czyZmieszane([...CSY, ...RSY])).toBe(true); // 20.03.2018: 2,98 i 2,50
  });

  it("pojedynczy instrument nie jest zmieszany", () => {
    expect(czyZmieszane(CSY)).toBe(false);
    expect(czyZmieszane(RSY)).toBe(false);
  });
});

describe("tabelaFaz", () => {
  it("stawia instrumenty w osobnych wierszach z jawnym oznaczeniem", () => {
    const t = tabelaFaz([
      { label: "CSY S.A.", fazy: fazyKursu(CSY)! },
      { label: "RSY S.A.", fazy: fazyKursu(RSY)! },
    ])!;
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0][0]).toBe("CSY S.A.");
    expect(t.rows[0][5]).toMatch(/^\+1\s?175/);
    expect(t.caption).toMatch(/każdy instrument liczony osobno/);
  });

  it("brak instrumentów daje null", () => {
    expect(tabelaFaz([])).toBeNull();
  });
});
