/**
 * Kalendarium wydarzeń makro — krok „Otoczenie makro" (wzorzec: opinia MBR,
 * rozdz. V.K, s. 73). Testy pilnują dwóch rzeczy, które w opinii sądowej są
 * groźne: podziału względem daty zdarzenia (wnioskowanie wsteczne) i tego,
 * żeby każdy wpis niósł źródło — wpis bez źródła nie nadaje się nawet na tło.
 */
import { describe, expect, it } from "vitest";

import {
  KALENDARIUM_MAKRO,
  KATEGORIE_WYDARZEN,
  wydarzeniaWzgledemDnia,
} from "@/lib/domain/kalendarium-makro";

describe("kalendarium makroekonomiczne", () => {
  it("każdy wpis ma poprawną datę ISO, kategorię z katalogu i źródło", () => {
    const kategorie = new Set(KATEGORIE_WYDARZEN.map((k) => k.id));
    for (const w of KALENDARIUM_MAKRO) {
      expect(w.dzien, w.opis).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(w.dzien)), `${w.dzien}: nie jest datą`).toBe(false);
      expect(kategorie.has(w.kategoria), `${w.dzien}: nieznana kategoria ${w.kategoria}`).toBe(true);
      expect(w.zrodlo.length, `${w.dzien}: wpis bez źródła`).toBeGreaterThan(10);
      expect(w.opis.length).toBeGreaterThan(20);
    }
  });

  it("dzieli wydarzenia względem daty zdarzenia — Lehman NIE jest tłem decyzji z 11.09.2008", () => {
    // Sedno sprawy MBR: decyzja zapadła 11.09.2008, Lehman upadł 15.09.2008.
    // Kalendarium, które by tego nie rozdzieliło, podsuwałoby wnioskowanie wsteczne.
    const { przed, po } = wydarzeniaWzgledemDnia("2008-09-11");
    expect(przed.some((w) => w.opis.includes("Lehman"))).toBe(false);
    expect(po.some((w) => w.opis.includes("Lehman"))).toBe(true);
    expect(przed.some((w) => w.opis.includes("Bear Stearns"))).toBe(true);
    // Granica jest domknięta: wydarzenie Z DNIA zdarzenia jest jeszcze „przed".
    expect(przed.some((w) => w.dzien === "2008-09-11")).toBe(true);
  });

  it("okresy obu spraw bankowych mają tło w kalendarium", () => {
    // MBR: 2007–2008 (kryzys subprime, przepisane z rozdz. V.K opinii).
    const mbr = KALENDARIUM_MAKRO.filter((w) => w.dzien >= "2007-01-01" && w.dzien <= "2008-09-11");
    expect(mbr.length).toBeGreaterThanOrEqual(15);
    expect(mbr.some((w) => w.zrodlo.includes("rozdz. V.K"))).toBe(true);
    // SK Bank: 2012–2015 (ujemne stopy, frank, QE, Grecja, Krym).
    const sk = KALENDARIUM_MAKRO.filter((w) => w.dzien >= "2012-01-01" && w.dzien <= "2015-12-31");
    expect(sk.length).toBeGreaterThanOrEqual(6);
    expect(sk.some((w) => w.kategoria === "wojna")).toBe(true);
    expect(sk.some((w) => w.kategoria === "polityka_pieniezna")).toBe(true);
  });

  it("bez daty zdarzenia nic nie wpada do „po” — panel mówi wtedy o braku podziału", () => {
    const { przed, po } = wydarzeniaWzgledemDnia(null);
    expect(po).toEqual([]);
    expect(przed.length).toBe(KALENDARIUM_MAKRO.length);
    // Wynik jest posortowany chronologicznie niezależnie od kolejności w katalogu.
    const dni = przed.map((w) => w.dzien);
    expect(dni).toEqual([...dni].sort());
  });
});
