/**
 * Katalog wskaźników wymogów kapitałowych — krok „Lista wskaźników".
 * Niezmienniki TS; zgodność z silnikiem Pythona pilnuje test mostu
 * tests/test_wskazniki_katalog_ts.py (ta sama zasada co bliźniak wyboru UTP).
 */
import { describe, expect, it } from "vitest";

import {
  OBSZARY_RUBRYKI,
  RUBRYKA_BS,
  WYMOGI_KAPITALOWE,
  wymogiNaDzien,
} from "@/lib/domain/wskazniki-bank";

describe("katalog wymogów kapitałowych", () => {
  it("progi są rozłączne w czasie per wskaźnik — jeden próg na dzień", () => {
    // Dwa progi tego samego wskaźnika obowiązujące naraz = panel pokazuje
    // sprzeczne minimum. LCR ma cztery schodki i one nie mogą na siebie nachodzić.
    for (const kod of new Set(WYMOGI_KAPITALOWE.map((w) => w.kod))) {
      for (const dzien of ["2008-09-11", "2014-06-30", "2015-10-01", "2017-06-30", "2019-01-01", "2022-01-01"]) {
        const naraz = wymogiNaDzien(dzien).filter((w) => w.kod === kod);
        expect(naraz.length, `${kod} na ${dzien}: ${naraz.length} progów naraz`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("epoki się nie mieszają: 2008 = sam współczynnik wypłacalności, 2015+ = CRR", () => {
    const mbr = wymogiNaDzien("2008-09-11");
    expect(mbr.map((w) => w.kod)).toEqual(["tcr"]);
    expect(mbr[0].podstawa).toContain("KNB");
    const sk = wymogiNaDzien("2015-03-16").map((w) => w.kod);
    expect(sk).toEqual(expect.arrayContaining(["cet1", "tier1", "tcr"]));
    expect(sk).not.toContain("lcr"); // LCR dopiero od X 2015
    expect(wymogiNaDzien("2015-10-01").map((w) => w.kod)).toContain("lcr");
  });

  it("LCR dochodzi do 100% schodkami bez dziur", () => {
    const oczekiwane: [string, number][] = [
      ["2015-10-01", 60], ["2017-01-01", 70], ["2018-01-01", 80], ["2019-01-01", 100], ["2026-01-01", 100],
    ];
    for (const [dzien, minimum] of oczekiwane) {
      const lcr = wymogiNaDzien(dzien).find((w) => w.kod === "lcr");
      expect(lcr?.minimum, `LCR na ${dzien}`).toBe(minimum);
    }
  });

  it("rubryka BS: 16 wskaźników, po 4 w obszarze, wagi obszaru sumują się do 1,00", () => {
    // Suma wag to kontrola KOMPLETNOŚCI odczytu ze skanu uchwały — dokładnie ona
    // wykryła zgubiony przez OCR wiersz „fundusz udziałowy/fundusze podstawowe".
    expect(RUBRYKA_BS.length).toBe(16);
    expect(OBSZARY_RUBRYKI.length).toBe(4);
    for (const o of OBSZARY_RUBRYKI) {
      const wiersze = RUBRYKA_BS.filter((r) => r.obszar === o.id);
      expect(wiersze.length, o.id).toBe(4);
      expect(Math.round(wiersze.reduce((s, r) => s + r.waga, 0) * 100) / 100, o.id).toBe(1.0);
    }
  });
});
