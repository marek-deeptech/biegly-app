/**
 * Uzupełnienia chronologii i promocja zdarzeń kluczowych do `findings`.
 *
 * ⚠️ POWÓD ISTNIENIA: do rejestru wniosków wchodzą WYŁĄCZNIE `findings` modułów.
 * W sprawie SK Banku strata brutto 56,7 mln zł (wynik inspekcji) i odrzucony program
 * naprawczy siedziały w 119 wierszach tabeli działań — wnioski odpowiadały na pytania
 * organu, nie wiedząc o nich. Te testy pilnują, że kotwice awansują do findings
 * i że zdarzenia dopisane skryptem przeżywają ponowny bieg bez dublowania.
 */
import { describe, expect, it } from "vitest";
import {
  scalUzupelniajace,
  ustaleniaKluczowe,
  zbudujChronologie,
  type ZdarzenieNadzorcze,
  type ZdarzenieUzupelniajace,
} from "@/lib/opinion/chronologia-nadzoru";

const Z = (data: string, opis: string, organ = "KNF"): ZdarzenieNadzorcze => ({ data, organ, opis });

describe("scalUzupelniajace", () => {
  const uzup: ZdarzenieUzupelniajace[] = [
    { kotwica: "nik-sygnal", data: "2016-11-09", organ: "NIK", opis: "W ocenie NIK tendencje RWEF stanowiły sygnał ostrzegawczy." },
  ];

  it("dopisuje zdarzenie, którego ekstrakcja nie znalazła", () => {
    const out = scalUzupelniajace([Z("2015-08-11", "Ustanowienie zarządu komisarycznego.")], uzup);
    expect(out).toHaveLength(2);
  });

  it("jest idempotentne po kotwicy — podwójny bieg skryptu nie dubluje wiersza", () => {
    const out = scalUzupelniajace([], [...uzup, ...uzup]);
    expect(out).toHaveLength(1);
  });

  it("nie dubluje zdarzenia, które model wyodrębnił tym samym początkiem treści", () => {
    const zModelu = Z("2016-11-09", "W ocenie NIK tendencje RWEF stanowiły sygnał ostrzegawczy.", "NIK");
    expect(scalUzupelniajace([zModelu], uzup)).toHaveLength(1);
  });
});

describe("ustaleniaKluczowe", () => {
  it("promuje stratę z inspekcji i program naprawczy, pomija zdarzenie rutynowe", () => {
    const f = ustaleniaKluczowe([
      Z("2014-11-14", "Stwierdzono wystąpienie straty brutto w kwocie 56,7 mln zł na 30.06.2014."),
      Z("2015-03-30", "Bank przekazał pierwszą wersję programu postępowania naprawczego."),
      Z("2013-05-10", "Przekazano okresową ankietę sprawozdawczą."),
    ]);
    expect(f.some((x) => x.includes("56,7 mln"))).toBe(true);
    expect(f.some((x) => x.includes("programu postępowania naprawczego"))).toBe(true);
    expect(f.some((x) => x.includes("ankietę"))).toBe(false);
  });

  it("dla wątku wieloetapowego bierze pierwsze i ostatnie zdarzenie chronologicznie", () => {
    const f = ustaleniaKluczowe([
      Z("2015-04-20", "UKNF wniósł zastrzeżenia do programu naprawczego."),
      Z("2014-12-01", "Wyznaczono termin przedłożenia programu naprawczego na 31.03.2015."),
      Z("2015-03-30", "Bank złożył program naprawczy."),
    ]);
    const prog = f.filter((x) => x.includes("naprawcz"));
    expect(prog).toHaveLength(2);
    expect(prog[0]).toContain("2014-12-01");
    expect(prog[1]).toContain("2015-04-20");
  });

  it("wzorce tolerują skróty i daty z kropkami („30.09.2015 r.”)", () => {
    // Regresja: [^.] w separatorze ucinał dopasowanie na kropce daty — zdarzenie
    // o niesporządzonej analizie kwartalnej nie awansowało do findings.
    const f = ustaleniaKluczowe([
      Z("2015-11-27", "Analiza kwartalna (system KOBRA) według stanu na 30.09.2015 r. nie została sporządzona."),
      Z("2015-06-09", "Opinie biegłych rewidentów za 2013 r. i 2014 r. nie zawierały zastrzeżeń."),
    ]);
    expect(f.some((x) => x.includes("KOBRA"))).toBe(true);
    expect(f.some((x) => x.includes("zastrzeżeń"))).toBe(true);
  });

  it("skrót obejmuje kotwicę, gdy liczba pada głęboko w treści", () => {
    // Regresja: zdarzenie o inspekcji awansowało dzięki „56,7 mln", ale skrót
    // „pierwsze 260 znaków" ucinał treść PRZED liczbą — rejestr wniosków dostawał
    // inspekcję bez wyniku i wnioski nie miały skąd wziąć kwoty.
    const preambula =
      "We wrześniu 2014 r. UKNF przeprowadził inspekcję kompleksową w Banku, obejmującą jakość " +
      "portfela kredytowego, adekwatność kapitałową, zarządzanie ryzykiem kredytowym oraz procesy " +
      "klasyfikacji ekspozycji i wyceny zabezpieczeń w segmencie deweloperskim i korporacyjnym. ";
    const f = ustaleniaKluczowe([
      Z("2014-09-01", preambula + "W efekcie stwierdzono stratę brutto w kwocie 56,7 mln zł na 30.06.2014."),
    ]);
    expect(f[0]).toContain("56,7 mln");
    expect(f[0]).toContain("[…]");
  });

  it("tnie długą treść na granicy słowa i nie przekracza limitu promowanych", () => {
    const dlugie = Z("2015-01-01", "RWEF " + "bardzo ".repeat(80) + "długi opis");
    const f = ustaleniaKluczowe([dlugie]);
    expect(f[0].length).toBeLessThan(340);
    expect(f[0]).toMatch(/…$/);
    const duzo = Array.from({ length: 30 }, (_, i) => Z(`2015-01-${String(i + 1).padStart(2, "0")}`, `RWEF pozycja ${i}`));
    expect(ustaleniaKluczowe(duzo).length).toBeLessThanOrEqual(10);
  });
});

describe("zbudujChronologie — findings zawierają zdarzenia kluczowe", () => {
  it("rejestr wniosków zobaczy stratę z inspekcji", () => {
    const w = zbudujChronologie(
      [{ dzien: "2014-12-31", kontekst: "wg stanu na 31.12.2014" }],
      [Z("2014-11-14", "Strata brutto w kwocie 56,7 mln zł na dzień 30 czerwca 2014 r.")],
      "2015-03-16",
    );
    expect(w.findings.some((x) => x.includes("Zdarzenie kluczowe") && x.includes("56,7 mln"))).toBe(true);
  });
});
