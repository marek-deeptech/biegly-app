/**
 * Indeks tematyczny katalogu prawnego — krok „Otoczenie prawne" (wzorzec: opinia
 * MBR, rozdz. V.L). Test pilnuje, żeby odpowiedź na pytanie „gdzie w przepisach
 * jest mowa o adekwatności / płynności / kondycji finansowej" była kompletna
 * i DATOWANA — przepis spoza daty zdarzenia nie ma prawa wejść do indeksu.
 */
import { describe, expect, it } from "vitest";

import {
  PRZEPISY_BANK,
  przepisyWgTematu,
  TEMATY_PRAWNE,
} from "@/lib/domain/prawo-bankowe";

const wg = (dzien: string, temat: string) =>
  przepisyWgTematu(dzien).find((t) => t.temat.id === temat)!.przepisy.map((p) => p.ref);

describe("indeks tematyczny przepisów", () => {
  it("każdy przepis katalogu ma co najmniej jeden temat", () => {
    // Przepis bez tematu byłby niewidzialny dla kroku „Otoczenie prawne" —
    // dokładnie ta klasa błędu, co moduł nieobecny w jednym z pięciu rejestrów.
    const bez = PRZEPISY_BANK.filter((p) => !p.tematy.length).map((p) => p.ref);
    expect(bez, `przepisy bez tematu: ${bez.join(", ")}`).toEqual([]);
  });

  it("każdy temat przypisany przepisom istnieje w katalogu tematów", () => {
    const znane = new Set(TEMATY_PRAWNE.map((t) => t.id));
    for (const p of PRZEPISY_BANK) for (const t of p.tematy) expect(znane.has(t), `${p.ref}: nieznany temat ${t}`).toBe(true);
  });

  it("adekwatność kapitałowa: uchwała 1/2007 w 2008 r., art. 92 CRR w 2015 r. — nigdy na krzyż", () => {
    // Sedno datowania: sprawa MBR (11.09.2008) i sprawa SK (16.03.2015) dostają
    // RÓŻNE podstawy tego samego tematu.
    const mbr = wg("2008-09-11", "adekwatnosc_kapitalowa");
    expect(mbr).toContain("Uchwała nr 1/2007 KNB");
    expect(mbr).toContain("art. 128 Prawa bankowego (do 2013)");
    expect(mbr.join(" ")).not.toContain("CRR");
    const sk = wg("2015-03-16", "adekwatnosc_kapitalowa");
    expect(sk).toContain("art. 92 CRR");
    expect(sk).not.toContain("Uchwała nr 1/2007 KNB");
  });

  it("płynność: art. 8 Prawa bankowego zawsze; LCR dopiero od X 2015", () => {
    expect(wg("2008-09-11", "plynnosc")).toEqual(["art. 8 Prawa bankowego"]);
    expect(wg("2015-03-16", "plynnosc")).toEqual(["art. 8 Prawa bankowego"]);
    expect(wg("2015-10-01", "plynnosc")).toContain("art. 412 CRR w zw. z rozp. del. (UE) 2015/61");
  });

  it("kondycja finansowa: badanie zdolności kredytowej (art. 70 PB) w obu epokach", () => {
    for (const dzien of ["2008-09-11", "2015-03-16"]) {
      expect(wg(dzien, "kondycja_finansowa")).toContain("art. 70 Prawa bankowego");
    }
    // W 2008 r. temat niesie też §5 uchwały 5/2007 — przepis, na którym biegły
    // oparł wnioski w sprawie MBR.
    expect(wg("2008-09-11", "kondycja_finansowa")).toContain("Uchwała nr 5/2007 KNB, § 5");
  });

  it("temat bez przepisu na dany dzień zostaje z pustą listą, nie znika", () => {
    // „W tej dacie żaden przepis katalogu nie regulował X" jest ustaleniem.
    const tematy = przepisyWgTematu("2008-09-11").map((t) => t.temat.id);
    expect(tematy).toEqual(TEMATY_PRAWNE.map((t) => t.id));
  });
});
