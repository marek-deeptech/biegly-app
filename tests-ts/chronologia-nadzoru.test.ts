import { describe, expect, it } from "vitest";

import { udzialPoliczony, zbudujChronologie, type OkresNadzorczy } from "@/lib/opinion/chronologia-nadzoru";

// Dane z Harmonogramu działań UKNF wobec SBRiR (załącznik nr 20, akta II C 595/23).
const OKRESY: OkresNadzorczy[] = [
  { dzien: "2013-12-31", kontekst: "wg stanu na koniec IV kwartału 2013", portfel_kredytowy: 1655286, portfel_utrata: 115338, udzial_utrata_pct: 6.97, fundusze_wlasne: 248473, wsp_wyplacalnosci_pct: 13.16 },
  { dzien: "2014-12-31", kontekst: "sprawozdawczość na 31 grudnia 2014", portfel_kredytowy: 2500215, portfel_utrata: 560663, udzial_utrata_pct: 22.42, fundusze_wlasne: 389566, wsp_wyplacalnosci_pct: 13.84 },
  { dzien: "2015-09-30", kontekst: "utworzenie rezerw pogłębiło stratę", portfel_kredytowy: 2891671, portfel_utrata: 1336012, udzial_utrata_pct: 46.2, wsp_wyplacalnosci_pct: 8.61, wynik_finansowy: -115446 },
];
const DZIEN = "2015-03-16"; // ostatnia lokata powoda

describe("chronologia nadzorcza", () => {
  it("udział liczy z ilorazu, nie przepisuje z dokumentu", () => {
    // Moment przekroczenia progu jest ustaleniem opinii, więc nie może zależeć
    // od liczby, którą OCR mógł przenieść z sąsiedniej tabeli.
    expect(udzialPoliczony({ dzien: "x", kontekst: "", portfel_kredytowy: 1222476, portfel_utrata: 115338, udzial_utrata_pct: 6.3 })).toBe(9.43);
  });

  it("okresy PÓŹNIEJSZE niż oceniane zdarzenie idą do osobnej tabeli", () => {
    // Sprawozdawczość za III kwartał 2015 opisuje stan, o którym w marcu 2015 nikt
    // wiedzieć nie mógł — w tabeli głównej byłaby wnioskowaniem wstecznym.
    const w = zbudujChronologie(OKRESY, [], DZIEN);
    const t = w.data.tables as { caption: string; rows: string[][] }[];
    expect(t[0].rows.map((r) => r[0])).toEqual(["2013-12-31", "2014-12-31"]);
    expect(t[1].caption).toContain("nie stanowią podstawy ustalenia stanu wiedzy");
    expect(t[1].rows[0][0]).toBe("2015-09-30");
  });

  it("nazywa NAJŚWIEŻSZE dane dostępne w dniu zdarzenia i ich zwłokę", () => {
    const f = zbudujChronologie(OKRESY, [], DZIEN).findings.join(" ");
    expect(f).toContain("pochodzą z 2014-12-31");
    expect(f).toContain("75 dni wcześniej");
    expect(f).toContain("22.42%");
  });

  it("podaje trend udziału — to on odpowiada na pytanie „od kiedy”", () => {
    const f = zbudujChronologie(OKRESY, [], DZIEN).findings.join(" ");
    expect(f).toContain("2013-12-31 — 6.97%");
    expect(f).toContain("2015-09-30 — 46.20%");
  });

  it("bez okresu przed datą mówi wprost, że ustalić się nie da", () => {
    const f = zbudujChronologie(OKRESY, [], "2012-01-01").findings.join(" ");
    expect(f).toContain("nie da się");
  });

  it("zdarzenia nadzorcze trafiają do własnej tabeli, posortowane", () => {
    const w = zbudujChronologie(OKRESY, [
      { data: "2014-09-29", organ: "UKNF", opis: "Zakończenie inspekcji kompleksowej." },
      { data: "2013-04-01", organ: "KNF", opis: "Wystąpienie na podstawie art. 138 Prawa bankowego." },
    ], DZIEN);
    const t = w.data.tables as { caption: string; rows: string[][] }[];
    const zdarzenia = t.find((x) => x.caption.includes("Działania nadzorcze"))!;
    expect(zdarzenia.rows.map((r) => r[0])).toEqual(["2013-04-01", "2014-09-29"]);
  });

  it("prompt okresów zakazuje łączenia tabel i wymaga kontekstu daty", async () => {
    const { systemOkresy } = await import("@/lib/opinion/chronologia-nadzoru");
    const s = systemOkresy(["Spółdzielczy Bank Rzemiosła i Rolnictwa"]);
    expect(s).toContain("NIE ŁĄCZ wartości z różnych tabel");
    expect(s).toContain("ZAWSZE podaj `kontekst`");
    expect(s).toContain("wartości WYKAZANE");
    expect(s).toContain("Nie przeliczaj na złote");
  });

  it("oba prompty WIĄŻĄ ekstrakcję z badanym podmiotem", async () => {
    // Bez tego moduł zebrał zdarzenia ze sprawozdania Komisji Nadzoru Audytowego
    // za 2009 r. — o posiedzeniach EGAOB w Brukseli — i wstawił je do chronologii banku.
    const { systemOkresy, systemZdarzenia } = await import("@/lib/opinion/chronologia-nadzoru");
    for (const s of [systemOkresy(["SK Bank"]), systemZdarzenia(["SK Bank"])]) {
      expect(s).toContain("BADANY PODMIOT: SK Bank");
      expect(s).toContain("POMIŃ");
    }
  });

  it("prompt zdarzeń nie pozwala oceniać reakcji nadzoru", async () => {
    const { systemZdarzenia } = await import("@/lib/opinion/chronologia-nadzoru");
    expect(systemZdarzenia(["X"])).toContain("nie rozstrzygaj, czy nadzór zareagował właściwie");
  });
});
