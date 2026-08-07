/**
 * Mapa wzorca MBR (rozdz. V, moduły A–L) — odwzorowanie finalnej opinii na
 * miejsca w aplikacji. Test pilnuje KOMPLETNOŚCI odwzorowania: wymóg klienta
 * brzmi „analiza analogicznie do MBR", więc zgubiona litera = moduł wzorca,
 * którego aplikacja nie realizuje i nikt tego nie widzi.
 */
import { describe, expect, it } from "vitest";

import { literyPodzakladki, MAPA_MBR, SUPLEMENT_SK } from "@/lib/domain/analiza-bank-mapa";
import { TECH_LABEL } from "@/lib/intake/completeness";

describe("mapa wzorca MBR A–L", () => {
  it("obejmuje KOMPLET liter A–L, każdą dokładnie raz, ze stronami rosnąco", () => {
    const litery = MAPA_MBR.map((m) => m.litery);
    expect(litery).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"]);
    const strony = MAPA_MBR.map((m) => m.strona);
    expect(strony).toEqual([...strony].sort((a, b) => a - b));
    // Kotwice wzorca z ustaleń: kalendarium = s. 73, otoczenie prawne = s. 93.
    expect(MAPA_MBR.find((m) => m.litery === "K")!.strona).toBe(73);
    expect(MAPA_MBR.find((m) => m.litery === "L")!.strona).toBe(93);
  });

  it("każdy moduł wzorca i suplementu wskazuje ISTNIEJĄCY moduł danych aplikacji", () => {
    // Litera z nieznanym kind byłaby obietnicą bez pokrycia — rejestr kompletności
    // (TECH_LABEL) jest tu słownikiem modułów, które aplikacja faktycznie zna.
    for (const m of [...MAPA_MBR, ...SUPLEMENT_SK.map((s) => ({ litery: s.podzakladka, kinds: s.kinds }))]) {
      expect(m.kinds.length, String(m.litery)).toBeGreaterThan(0);
      for (const k of m.kinds) expect(TECH_LABEL[k], `${m.litery}: nieznany moduł ${k}`).toBeTruthy();
    }
  });

  it("rdzeń analityczny D–J żyje w podzakładkach, tło A–C, K, L — we własnych krokach", () => {
    const gdzie = Object.fromEntries(MAPA_MBR.map((m) => [m.litery, m.gdzie]));
    for (const l of ["D", "E", "F", "G", "H", "I", "J"]) expect("podzakladka" in gdzie[l], l).toBe(true);
    for (const l of ["A", "B", "C", "K"]) expect(gdzie[l]).toEqual({ krok: "makro" });
    expect(gdzie["L"]).toEqual({ krok: "prawo" });
  });

  it("etykiety liter podzakładek składają się z mapy, nie z ręki", () => {
    expect(literyPodzakladki("sprawozdania")).toBe("V.I–J");
    expect(literyPodzakladki("sygnaly")).toBe("V.G–H");
    expect(literyPodzakladki("media")).toBe("V.D–F");
    // Suplement SK nie ma liter wzorca — pusta etykieta, nie zmyślona.
    expect(literyPodzakladki("rubryka")).toBe("");
  });
});
