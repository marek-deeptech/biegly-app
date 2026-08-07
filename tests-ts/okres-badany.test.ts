/**
 * Okres badany — JEDNO źródło dla wszystkich rozdziałów liczbowych.
 *
 * ⚠️ REGRESJA, KTÓREJ PILNUJE TEN PLIK. Rozdziały brały okno skądinąd: IV.1 z całego
 * zakresu metryk, IV.4/IV.5/IV.6 z ręcznych flag. Dla ZASTAL ta sama faza wzrostowa
 * CSY wyszła +1175 % (od 4.12.2017 — pierwsza sesja w danych) i +920 % (od 11.12.2017 —
 * data z postanowienia). Dwie sprzeczne liczby w jednej opinii, obie policzone
 * poprawnie; sprzeczne było wejście.
 */
import { describe, expect, it } from "vitest";
import { okresBadany, opisOkresu, wOknie } from "@/lib/opinion/okres";
import { fazyKursu, type Metryka } from "@/lib/opinion/instrumenty";

const SUBS = [
  { kind: "ekofin_dane", data: { config: { odBadany: "2017-12-11", doBadany: "2019-09-30" } } },
  { kind: "trem_csy", data: {} },
];

describe("okres badany", () => {
  it("bierze się z konfiguracji kroku 4 (daty z postanowienia)", () => {
    const o = okresBadany(SUBS);
    expect(o).toEqual({ od: "2017-12-11", do: "2019-09-30", zrodlo: "konfiguracja" });
    expect(opisOkresu(o)).toMatch(/postanowieni/);
  });

  it("flagi nadpisują konfigurację i są oznaczone jako ręczne", () => {
    const o = okresBadany(SUBS, { od: "2018-01-02", do: "2018-06-29" });
    expect(o.zrodlo).toBe("flagi");
    expect(opisOkresu(o)).toMatch(/ręcznie/);
  });

  it("brak okresu przerywa bieg zamiast liczyć na przypadkowym zakresie", () => {
    expect(() => okresBadany([{ kind: "trem_csy", data: {} }])).toThrow(/okresu badanego/);
    expect(() => okresBadany([{ kind: "ekofin_dane", data: { config: { odBadany: "2017-12-11" } } }])).toThrow();
  });

  it("filtr przepuszcza metryki bez daty (agregaty całego okresu)", () => {
    const f = wOknie(okresBadany(SUBS));
    expect(f(null)).toBe(true);
    expect(f("2017-12-04")).toBe(false); // sprzed postanowienia
    expect(f("2017-12-11")).toBe(true); // granica należy do okresu
    expect(f("2019-09-30")).toBe(true);
    expect(f("2019-10-01")).toBe(false);
  });

  it("okno zmienia fazę wzrostową — dlatego musi pochodzić z jednego miejsca", () => {
    const m = (d: string, v: number): Metryka => ({ key: "day_close", value: v, session_day: d });
    const CSY = [m("2017-12-04", 0.8), m("2017-12-11", 1.0), m("2019-09-09", 10.2), m("2019-09-30", 9.9)];
    expect(fazyKursu(CSY)!.pumpPct).toBe(1175); // cały zakres danych
    const f = wOknie(okresBadany(SUBS));
    expect(fazyKursu(CSY.filter((x) => f(x.session_day)))!.pumpPct).toBe(920); // okres z postanowienia
  });
});
