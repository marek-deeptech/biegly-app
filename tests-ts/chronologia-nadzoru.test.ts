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
    // Zapis POLSKI — to tekst opinii dla sądu, nie wydruk techniczny.
    expect(f).toContain("22,42%");
  });

  it("podaje trend udziału — to on odpowiada na pytanie „od kiedy”", () => {
    const f = zbudujChronologie(OKRESY, [], DZIEN).findings.join(" ");
    expect(f).toContain("2013-12-31 — 6,97%");
    expect(f).toContain("2015-09-30 — 46,20%");
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

describe("jednostki kwot", () => {
  it("sprowadza tysiące złotych do złotych", async () => {
    // Harmonogram UKNF podaje w tys. zł, pisma procesowe w zł. Model przepisuje jedne
    // i drugie wiernie — w jednej kolumnie stają wtedy 1 578 i 3 828 641 288.
    const { doZlotych } = await import("@/lib/opinion/chronologia-nadzoru");
    const { okresy } = doZlotych([
      { dzien: "2012-12-31", kontekst: "k", suma_bilansowa: 1578168, jednostka: "tys. zł" },
      { dzien: "2014-12-31", kontekst: "k", suma_bilansowa: 3828641288, jednostka: "zł" },
    ]);
    expect(okresy[0].suma_bilansowa).toBe(1_578_168_000);
    expect(okresy[1].suma_bilansowa).toBe(3_828_641_288);
  });

  it("brak jednostki NIE jest zgadywany — okres zostaje oznaczony", async () => {
    const { doZlotych } = await import("@/lib/opinion/chronologia-nadzoru");
    const { okresy, uwagi } = doZlotych([{ dzien: "2013-12-31", kontekst: "k", suma_bilansowa: 3105 }]);
    expect(okresy[0].suma_bilansowa).toBe(3105); // bez przeliczenia
    expect(uwagi[0]).toContain("nie podano jednostki");
  });

  it("procenty nie są przeliczane", async () => {
    const { doZlotych } = await import("@/lib/opinion/chronologia-nadzoru");
    const { okresy } = doZlotych([
      { dzien: "2014-12-31", kontekst: "k", suma_bilansowa: 3828, wsp_wyplacalnosci_pct: 13.84, jednostka: "mln zł" },
    ]);
    expect(okresy[0].suma_bilansowa).toBe(3_828_000_000);
    expect(okresy[0].wsp_wyplacalnosci_pct).toBe(13.84);
  });

  it("wykrywa resztkowy skok skali po przeliczeniu", async () => {
    // Suma bilansowa banku nie rośnie stukrotnie w kwartał — to jedyny sygnał, jaki
    // zostaje, gdy deklarowana jednostka była błędna.
    const { skokiSkali } = await import("@/lib/opinion/chronologia-nadzoru");
    const u = skokiSkali([
      { dzien: "2013-12-31", kontekst: "k", suma_bilansowa: 3105 },
      { dzien: "2014-12-31", kontekst: "k", suma_bilansowa: 3828641288 },
    ]);
    expect(u[0]).toContain("skala nieosiągalna");
  });

  it("normalny wzrost nie jest zgłaszany", async () => {
    const { skokiSkali } = await import("@/lib/opinion/chronologia-nadzoru");
    expect(skokiSkali([
      { dzien: "2013-12-31", kontekst: "k", suma_bilansowa: 3_105_177_000 },
      { dzien: "2014-12-31", kontekst: "k", suma_bilansowa: 3_828_641_288 },
    ])).toHaveLength(0);
  });
});

describe("odczyt tabel z obrazu strony", () => {
  const TABELE = [
    {
      strona: 7,
      jednostka: "Dane w tys. zł",
      kolumny: ["31.12.2012", "31.03.2013"],
      wiersze: [
        { etykieta: "Suma bilansowa", wartosci: ["1.578.168", "2.429.334"] },
        { etykieta: "Portfel kredytowy", wartosci: ["1.132.934", "1.222.476"] },
        { etykieta: "Portfel kredytowy z utratą wartości", wartosci: ["66.380", "115.338"] },
        { etykieta: "Portfel kredytowy z utratą wartości/portfel kredytowy", wartosci: ["5,86%", "6,39%"] },
        { etykieta: "Współczynnik wypłacalności", wartosci: ["10,60%", "9,61%"] },
      ],
    },
    // Przypis z jednostką stoi tylko pod pierwszą tabelą, a obowiązuje dla wszystkich.
    {
      strona: 9,
      jednostka: "",
      kolumny: ["31.12.2012", "31.12.2013"],
      wiersze: [{ etykieta: "Suma bilansowa", wartosci: ["1.578.168", "3.105.177"] }],
    },
  ];

  it("rozpoznaje wiersz ILORAZOWY mimo polskich znaków", async () => {
    // `\w` to [A-Za-z0-9_] i nie obejmuje „ą” — wzorzec „utrat\w*\s+wartoś” nie łapał
    // „utratą wartości”, pole zostawało puste, a kontrola porównująca udział podany
    // z policzonym MILCZAŁA z braku danych. Zero zastrzeżeń wyglądało jak czysty wynik.
    const { okresyZTabel } = await import("@/lib/opinion/chronologia-run");
    const o = okresyZTabel(TABELE)[1]; // 2013-03-31
    expect(o.udzial_utrata_pct).toBe(6.39);
    expect(o.portfel_utrata).toBe(115338);
  });

  it("wiersz ilorazowy nie jest brany za kwotowy", async () => {
    const { okresyZTabel } = await import("@/lib/opinion/chronologia-run");
    const o = okresyZTabel(TABELE)[0]; // 2012-12-31
    expect(o.portfel_utrata).toBe(66380);   // nie 5.86
    expect(o.udzial_utrata_pct).toBe(5.86);
  });

  it("jednostka z przypisu propaguje się na tabele bez przypisu", async () => {
    // `??` nie łapie pustego łańcucha, więc połowa okresów zostawała w tysiącach
    // obok drugiej połowy w złotych — z pozornym spadkiem sumy bilansowej do 0,1%.
    const { okresyZTabel } = await import("@/lib/opinion/chronologia-run");
    for (const o of okresyZTabel(TABELE)) expect(o.jednostka).toContain("tys");
  });

  it("nagłówek kolumny staje się datą ISO, a kontekst wskazuje stronę", async () => {
    const { okresyZTabel } = await import("@/lib/opinion/chronologia-run");
    const o = okresyZTabel(TABELE)[0];
    expect(o.dzien).toBe("2012-12-31");
    expect(o.kontekst).toContain("str. 7");
  });

  it("ta sama kolumna w dwóch tabelach nie jest nadpisywana", async () => {
    // 31.12.2012 powtarza się jako kolumna bazowa; wartości muszą być zgodne,
    // a nie zastępowane przez późniejszy odczyt.
    const { okresyZTabel } = await import("@/lib/opinion/chronologia-run");
    expect(okresyZTabel(TABELE).filter((o) => o.dzien === "2012-12-31")).toHaveLength(1);
  });
});
