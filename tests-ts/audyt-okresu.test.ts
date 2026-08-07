/**
 * Bramka „proza mówi o tym samym okresie, co liczby".
 *
 * ⚠️ REGRESJA. Wydruk v5 opinii ZASTAL w pięciu rozdziałach twierdził, że badanie
 * zaczyna się 4 grudnia 2017 r. — data pierwszej sesji w policzonym pliku, podczas
 * gdy postanowienie wskazuje 11 grudnia. Wyszło to dopiero przy czytaniu 171 stron.
 */
import { describe, expect, it } from "vitest";
import { audytOkresu, naISO, zleDatyOkresu } from "@/lib/opinion/audyt-okresu";

const OKNO = { od: "2017-12-11", do: "2019-09-30" };

describe("daty słowne", () => {
  it("czyta polski zapis daty", () => {
    expect(naISO("4 grudnia 2017 r.")).toBe("2017-12-04");
    expect(naISO("11 grudnia 2017 r.")).toBe("2017-12-11");
    expect(naISO("27 września 2019 r.")).toBe("2019-09-27");
    expect(naISO("2018-03-21")).toBe("2018-03-21");
    expect(naISO("bez daty")).toBeNull();
  });
});

describe("rozjazd okresu w prozie", () => {
  it("łapie datę spoza okna w zdaniu o zakresie badania", () => {
    const p = "Okres objęty analizą obejmuje przedział od dnia 4 grudnia 2017 r. do dnia 30 września 2019 r.";
    expect(zleDatyOkresu(p, OKNO)).toEqual(["2017-12-04"]);
  });

  it("milczy, gdy proza podaje granice zgodne z postanowieniem", () => {
    const p =
      "Okres badany wskazany w postanowieniu obejmuje 11 grudnia 2017 r. – 30 września 2019 r., " +
      "a zestawienie transakcji obejmuje 201 dni sesyjnych.";
    expect(zleDatyOkresu(p, OKNO)).toEqual([]);
  });

  it("data poboczna drugiego instrumentu jest dopuszczalna po jawnym wskazaniu", () => {
    const p = "Badaniem objęto akcje CSY od 11 grudnia 2017 r. do 30 września 2019 r., a akcje RSY do 27 września 2019 r.";
    expect(zleDatyOkresu(p, OKNO)).toEqual(["2019-09-27"]);
    expect(zleDatyOkresu(p, OKNO, ["2019-09-27"])).toEqual([]);
  });

  it("data raportu wymieniona w zdaniu o okresie nie jest granicą", () => {
    const p =
      "W okresie badanym pierwszy raport bieżący opublikowano 22 grudnia 2017 r., " +
      "a analiza obejmuje przedział od 11 grudnia 2017 r. do 30 września 2019 r.";
    expect(zleDatyOkresu(p, OKNO)).toEqual([]);
  });

  it("nie rusza dat sesji poza zdaniami o zakresie badania", () => {
    const p = "W sesji 21 marca 2018 r. kurs wzrósł o 9,6 %. Wolumen wyniósł 870 szt.";
    expect(zleDatyOkresu(p, OKNO)).toEqual([]);
  });
});

describe("audyt całej opinii", () => {
  const dl = (n: number) => "x".repeat(n);
  const PLAN = ["ekofin", "espi", "aktywnosc", "wash", "pumpdump", "layering", "relacje"];

  it("zbiera trzy rodzaje zastrzeżeń", () => {
    const z = audytOkresu(
      [
        { kind: "proza_i", chapter_no: "I", body_md: `Okres objęty analizą: od 4 grudnia 2017 r. ${dl(400)}` },
        { kind: "wash", chapter_no: "IV.4", body_md: dl(400), data: { proza_sprzed_przeliczenia: true } },
        { kind: "fixing", chapter_no: "IV", body_md: dl(400) },
        { kind: "relacje", chapter_no: "IV.7", body_md: dl(400) },
      ],
      OKNO,
      PLAN,
    );
    expect(z.map((x) => x.rodzaj)).toEqual(["okres", "proza-starsza", "poza-planem"]);
    // Rejestry danych mają chapter_no „IV", ale nie są rozdziałami — bez alarmu.
    expect(
      audytOkresu(
        [{ kind: "powiazania_dane", chapter_no: "IV", body_md: dl(900) }, { kind: "proza_iv", chapter_no: "IV", body_md: dl(900) }],
        OKNO, PLAN,
      ),
    ).toEqual([]);
    expect(z[0].opis).toMatch(/2017-12-04/);
    expect(z[2].kind).toBe("fixing");
  });

  it("krótkie szkice i rozdziały z planu nie generują szumu", () => {
    expect(audytOkresu([{ kind: "fixing", chapter_no: "IV", body_md: "szkic" }], OKNO, PLAN)).toEqual([]);
    expect(audytOkresu([{ kind: "relacje", chapter_no: "IV.7", body_md: "y".repeat(400) }], OKNO, PLAN)).toEqual([]);
  });
});
