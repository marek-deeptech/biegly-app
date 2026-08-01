import { describe, expect, it } from "vitest";

import { przepisyAnachroniczne, przepisyNaDzien } from "@/lib/domain/prawo-bankowe";
import { zbudujMedia, zbudujOtoczeniePrawne, zbudujSektor } from "@/lib/opinion/warsztat-bank";

const DZIEN = "2008-09-11"; // dzień decyzji w sprawie MBR

const PRASA = [
  { plik: "ft.pdf", data: "2008-03-28", tytul: "Icelandic whispers shake faith in boom", zrodlo: "Financial Times", teza: "Rynek kwestionuje finansowanie islandzkich banków." },
  { plik: "islandia.pdf", data: "2008-10-06", tytul: "Islandia w tarapatach", zrodlo: "prasa krajowa", teza: "Opis upadku banków islandzkich." },
  { plik: "nieznany.pdf", data: "", tytul: "Bez daty", zrodlo: "?", teza: "…" },
];

describe("moduł media — stan wiedzy dostępnej w dniu decyzji", () => {
  it("nie wpuszcza publikacji późniejszej do tabeli dowodowej", () => {
    // Artykuł z 6.10.2008 opisuje upadek Glitnira. Użyty na poparcie tezy o sygnałach
    // dostępnych 11.09.2008 byłby wnioskowaniem wstecznym — zarzutem wobec całej opinii.
    const m = zbudujMedia(PRASA, DZIEN);
    const glowna = (m.data.tables as { rows: string[][] }[])[0];
    expect(glowna.rows.map((r) => r[0])).toEqual(["2008-03-28"]);
  });

  it("nie usuwa publikacji późniejszej, tylko ją oznacza", () => {
    const m = zbudujMedia(PRASA, DZIEN);
    const t = m.data.tables as { caption: string; rows: string[][] }[];
    expect(t).toHaveLength(2);
    expect(t[1].caption).toContain("PÓŹNIEJSZE");
    expect(t[1].caption).toContain("nie stanowią podstawy");
    expect(t[1].rows[0][0]).toBe("2008-10-06");
  });

  it("bez daty zdarzenia mówi wprost, że podziału nie da się zrobić", () => {
    const m = zbudujMedia(PRASA, "");
    expect(m.findings.join(" ")).toContain("nie podzielono");
    expect(m.data.tables).toHaveLength(1);
  });

  it("publikacja bez daty jest zgłaszana jako nieprzydatna dowodowo", () => {
    expect(zbudujMedia(PRASA, DZIEN).findings.join(" ")).toContain("bez ustalonej daty");
    expect(zbudujMedia(PRASA, DZIEN).data.bezDaty).toEqual(["nieznany.pdf"]);
  });

  it("ten sam artykuł z dwóch plików liczy się raz", () => {
    // Akta MBR mają ten artykuł FT dwukrotnie: jako ZAŁĄCZNIK 3 i jako luźną kopię.
    // Policzony dwa razy dawał „3 publikacje" tam, gdzie są dwie — a to twierdzenie
    // o zawartości akt, nie drobiazg redakcyjny.
    const kopia = { ...PRASA[0], plik: "ZALACZNIK 3 - ft.pdf" };
    const m = zbudujMedia([...PRASA, kopia], DZIEN);
    const glowna = (m.data.tables as { rows: string[][] }[])[0];
    expect(glowna.rows).toHaveLength(1);
    expect(glowna.rows[0][4]).toBe("ft.pdf; ZALACZNIK 3 - ft.pdf");
    expect(m.findings.join(" ")).toContain("w więcej niż jednym pliku");
  });

  it("brak publikacji sprzed zdarzenia jest ustaleniem, nie ciszą", () => {
    const m = zbudujMedia([PRASA[1]], DZIEN);
    expect(m.findings[0]).toContain("nie ma publikacji prasowych");
  });
});

describe("moduł ekspozycja_sektor", () => {
  const M = [
    { plik: "cbi.pdf", miara: "aktywa sektora bankowego do PKB", wartosc: "9,5×", naDzien: "2007", kraj: "Islandia", strona: "s. 12" },
    { plik: "knf.pdf", miara: "aktywa sektora do PKB", wartosc: "0,8×", naDzien: "2007", kraj: "" },
  ];

  it("odrzuca miarę bez wskazanego państwa", () => {
    // Relacja aktywów do PKB podstawiona z innego kraju jest błędem niewykrywalnym
    // w gotowym tekście — liczba wygląda równie wiarygodnie.
    const s = zbudujSektor(M, 3, DZIEN);
    expect((s.data.table as { rows: string[][] }).rows).toHaveLength(1);
    expect(s.findings.join(" ")).toContain("bez wskazania państwa");
  });

  it("ostrzega, gdy miary dotyczą różnych państw", () => {
    const s = zbudujSektor([M[0], { ...M[1], kraj: "Polska" }], 3, DZIEN);
    expect(s.findings.join(" ")).toContain("różnych państw");
  });

  it("brak danych nazywa luką dowodową zamiast milczeć", () => {
    expect(zbudujSektor([], 0, DZIEN).findings[0]).toContain("nie ma raportów");
  });

  it("odróżnia brak raportów od raportów, z których nic nie odczytano", () => {
    // Powiedzenie „w aktach nie ma raportów", gdy są trzy, jest twierdzeniem
    // nieprawdziwym o aktach — i kieruje biegłego w złe miejsce.
    const s = zbudujSektor([], 3, DZIEN);
    expect(s.findings[0]).toContain("są 3 raporty");
    expect(s.findings[0]).toContain("odczytu ręcznego");
    expect(s.findings[0]).not.toContain("nie ma raportów");
  });
});

describe("moduł otoczenie_prawne — z datowanego katalogu, bez modelu", () => {
  it("dla decyzji z 2008 r. nie podaje CRR wśród przepisów właściwych", () => {
    // Ten błąd jest powodem istnienia dat w katalogu: CRR obowiązuje od 2014 r.
    const o = zbudujOtoczeniePrawne(przepisyNaDzien(DZIEN), przepisyAnachroniczne(DZIEN), DZIEN);
    const refy = (o.data.tables as { rows: string[][] }[])[0].rows.map((r) => r[0]).join(" ");
    expect(refy).not.toMatch(/CRR|575\/2013/);
    expect(refy).toContain("Uchwała");
  });

  it("CRR trafia do tabeli zakazanej, a nie znika z rozdziału", () => {
    const o = zbudujOtoczeniePrawne(przepisyNaDzien(DZIEN), przepisyAnachroniczne(DZIEN), DZIEN);
    const t = o.data.tables as { caption: string; rows: string[][] }[];
    expect(t[1].caption).toContain("weszły w życie PO");
    expect(t[1].rows.map((r) => r[0]).join(" ")).toMatch(/CRR|575\/2013/);
    expect(o.findings.join(" ")).toContain("błędem merytorycznym");
  });

  it("bez daty zdarzenia nie zgaduje stanu prawnego", () => {
    const o = zbudujOtoczeniePrawne(przepisyNaDzien("2008-09-11"), [], "");
    expect((o.data.tables as { rows: string[][] }[])[0].rows).toHaveLength(0);
    expect(o.findings[0]).toContain("stanu prawnego nie ustalono");
  });
});
