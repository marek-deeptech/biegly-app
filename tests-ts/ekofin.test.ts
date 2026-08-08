/**
 * Silnik kroku 4 GPW (ekofin) — parser stooq, kontrast obrotu, indeks 100,
 * dynamika pozycji i wskaźniki wykazane.
 *
 * PARYTET Z KM: finał HubTech podaje wprost — 1545 dni sesyjnych od debiutu
 * 2.07.2014 do 8.09.2020, średni dzienny wolumen 624 000 szt., średnia dzienna
 * wartość obrotu (wg cen zamknięcia) 260 405,34 zł; w okresie 9.09–21.10.2020
 * średni wolumen 9 409 400 szt. Test na złotym pliku hub_d.csv (warsztat KM)
 * pilnuje, że silnik odtwarza te liczby CO DO GROSZA — a przy braku kopii
 * lokalnej test jest pomijany, nie udaje zielonego (konwencja fixtures).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  doWspolnejJednostki,
  dynamikaFin,
  mnoznikJednostki,
  indeks100,
  kluczOkresu,
  kontrastObrotu,
  liczbaPl,
  mnoznikiWykazane,
  wskaznikiRentownosci,
  parsujStooqCsv,
} from "@/lib/opinion/ekofin";

const CSV_PL = [
  "Data,Otwarcie,Najwyzszy,Najnizszy,Zamkniecie,Wolumen",
  "2020-09-07,1.00,1.10,0.95,1.00,1000",
  "2020-09-08,1.00,1.20,1.00,1.10,2000",
  "2020-09-09,1.10,1.60,1.10,1.50,50000",
  "2020-09-10,1.50,2.00,1.40,2.00,70000",
  "zepsuty,wiersz,bez,daty,,",
].join("\n");

describe("parsujStooqCsv", () => {
  it("czyta polski nagłówek stooq i odrzuca wiersz bez daty Z UWAGĄ", () => {
    const { notowania, uwagi } = parsujStooqCsv(CSV_PL);
    expect(notowania).toHaveLength(4);
    expect(notowania[0]).toMatchObject({ dzien: "2020-09-07", zamkniecie: 1.0, wolumen: 1000 });
    expect(uwagi.join(" ")).toMatch(/odrzucono/);
  });

  it("czyta nagłówek angielski (Date,Open,…)", () => {
    const { notowania } = parsujStooqCsv("Date,Open,High,Low,Close,Volume\n2020-01-02,1,2,1,1.5,10");
    expect(notowania[0].zamkniecie).toBe(1.5);
  });
});

describe("kontrastObrotu", () => {
  it("liczy średnie przed i w okresie badanym oraz krotność (wartość wg cen zamknięcia)", () => {
    const { notowania } = parsujStooqCsv(CSV_PL);
    const k = kontrastObrotu(notowania, "2020-09-09", "2020-10-21")!;
    expect(k.przed.dniSesyjnych).toBe(2);
    expect(k.przed.sredniWolumen).toBe(1500);
    // (1000·1,00 + 2000·1,10) / 2 = 1600
    expect(k.przed.sredniaWartoscObrotu).toBeCloseTo(1600, 6);
    expect(k.badany.sredniWolumen).toBe(60000);
    expect(k.krotnoscWolumenu).toBeCloseTo(40, 6);
  });
});

describe("indeks100", () => {
  const em = parsujStooqCsv(CSV_PL).notowania;
  it("baza = pierwsza sesja emitenta ≥ dacie bazowej; peer bez notowania dostaje LOCF", () => {
    const peer = parsujStooqCsv(
      "Data,Otwarcie,Najwyzszy,Najnizszy,Zamkniecie,Wolumen\n2020-09-07,2,2,2,2.0,1\n2020-09-09,2,2,2,3.0,1",
    ).notowania;
    const ix = indeks100({ ticker: "HUB", notowania: em }, [{ ticker: "P1", notowania: peer }], "2020-09-07")!;
    expect(ix.bazaDzien).toBe("2020-09-07");
    expect(ix.emitent[0]).toBeCloseTo(100);
    expect(ix.emitent[3]).toBeCloseTo(200); // 2,00 / 1,00
    // peer: 8.09 bez notowania → LOCF ze 100; 9.09: 3,0/2,0 = 150
    expect(ix.perPeer[0].wartosci[1]).toBeCloseTo(100);
    expect(ix.perPeer[0].wartosci[2]).toBeCloseTo(150);
    expect(ix.medianaPeers[2]).toBeCloseTo(150);
    expect(ix.uwagi.join(" ")).toMatch(/LOCF/);
  });

  it("próbkuje długie serie z zachowaniem pierwszego i ostatniego punktu", () => {
    const duzo = Array.from({ length: 1000 }, (_, i) => {
      const d = new Date(Date.UTC(2015, 0, 1) + i * 86400000).toISOString().slice(0, 10);
      return `${d},1,1,1,${1 + i / 1000},10`;
    });
    const { notowania } = parsujStooqCsv("Data,Otwarcie,Najwyzszy,Najnizszy,Zamkniecie,Wolumen\n" + duzo.join("\n"));
    const ix = indeks100({ ticker: "X", notowania }, [], "2015-01-01", 400)!;
    expect(ix.dni.length).toBeLessThanOrEqual(401);
    expect(ix.dni[0]).toBe("2015-01-01");
    expect(ix.dni[ix.dni.length - 1]).toBe(notowania[notowania.length - 1].dzien);
  });
});

describe("liczbaPl / kluczOkresu", () => {
  it("czyta zapis polski i nawias księgowy jako minus", () => {
    expect(liczbaPl("1 234,56")).toBeCloseTo(1234.56);
    expect(liczbaPl("(123)")).toBe(-123);
    expect(liczbaPl("2.265.831")).toBe(2265831);
    expect(liczbaPl("b.d.")).toBeNull();
  });
  it("porządkuje kwartały, półrocza i lata", () => {
    expect(kluczOkresu("III kw. 2020")).toMatchObject({ rok: 2020, pod: 3, rodzaj: "kw" });
    expect(kluczOkresu("I półrocze 2020")).toMatchObject({ rok: 2020, pod: 1, rodzaj: "pol" });
    expect(kluczOkresu("2019")).toMatchObject({ rok: 2019, rodzaj: "rok" });
    expect(kluczOkresu("za okres sprawozdawczy")).toBeNull();
  });

  it("rozpoznaje daty bilansowe i trzyma je OSOBNO od kwartałów", () => {
    // Sprawozdania podają część wielkości pod datą dzienną. Stan na 30.09 (zapas)
    // nie może być porównywany z „III kw." (strumień) — stąd osobny rodzaj.
    expect(kluczOkresu("30-09-2017")).toMatchObject({ rok: 2017, pod: 930, rodzaj: "dzien" });
    expect(kluczOkresu("2017-12-31")).toMatchObject({ rok: 2017, pod: 1231, rodzaj: "dzien" });
    const { table } = dynamikaFin([
      { issuer: "CSY S.A.", position: "kapitał własny", period: "30-09-2016", value: "24 566 829", unit: "zł" },
      { issuer: "CSY S.A.", position: "kapitał własny", period: "30-09-2017", value: "27 216 873", unit: "zł" },
    ]);
    const r = table!.rows.find((x) => x[2] === "30-09-2017")!;
    expect(r[5]).toBe("10,8%"); // r/r wobec tego samego dnia rok wcześniej
  });
});

describe("dynamikaFin", () => {
  it("liczy Δ okres poprzedni i Δ r/r; strata w nawiasie działa", () => {
    const { table } = dynamikaFin([
      { position: "Przychody netto", period: "III kw. 2019", value: "100", unit: "tys. zł" },
      { position: "Przychody netto", period: "II kw. 2020", value: "150", unit: "tys. zł" },
      { position: "Przychody netto", period: "III kw. 2020", value: "300", unit: "tys. zł" },
      { position: "Zysk netto", period: "III kw. 2019", value: "(50)", unit: "tys. zł" },
      { position: "Zysk netto", period: "III kw. 2020", value: "25", unit: "tys. zł" },
    ]);
    // Układ kolumn: [Emitent, Pozycja, Okres, Wartość, Δ poprz., Δ r/r].
    const rows = table!.rows;
    const p3 = rows.find((r) => r[1] === "Przychody netto" && r[2] === "III kw. 2020")!;
    expect(p3[4]).toBe("100,0%"); // vs II kw. 2020
    expect(p3[5]).toBe("200,0%"); // vs III kw. 2019
    const z = rows.find((r) => r[1] === "Zysk netto" && r[2] === "III kw. 2020")!;
    expect(z[5]).toBe("150,0%"); // z −50 na +25 względem |−50|
  });

  it("NIE miesza emitentów: ta sama pozycja dwóch spółek to dwa osobne szeregi", () => {
    // Regresja ze sprawy ZASTAL (CSY S.A. + RSY S.A.): grupowanie po samej nazwie
    // pozycji liczyłoby dynamikę między liczbami RÓŻNYCH spółek — wynik wyglądałby
    // wiarygodnie i byłby bez sensu.
    const { table } = dynamikaFin([
      { issuer: "CSY S.A.", position: "przychody netto ze sprzedaży", period: "2016", value: "17 086", unit: "tys. zł" },
      { issuer: "CSY S.A.", position: "przychody netto ze sprzedaży", period: "2017", value: "19 501", unit: "tys. zł" },
      { issuer: "RSY S.A.", position: "przychody netto ze sprzedaży", period: "2016", value: "912", unit: "tys. zł" },
      { issuer: "RSY S.A.", position: "przychody netto ze sprzedaży", period: "2017", value: "363", unit: "tys. zł" },
    ]);
    const rows = table!.rows;
    expect(table!.head[0]).toBe("Emitent");
    const csy = rows.find((r) => r[0] === "CSY S.A." && r[2] === "2017")!;
    const rsy = rows.find((r) => r[0] === "RSY S.A." && r[2] === "2017")!;
    expect(csy[4]).toBe("14,1%"); // 17 086 → 19 501
    expect(rsy[4]).toBe("-60,2%"); // 912 → 363, a NIE 19 501 → 363
  });

  it("jednostki pieniężne SPROWADZA do wspólnej i liczy dynamikę", () => {
    // ⚠️ ZMIANA REGUŁY (7.08.2026). Dawniej pozycja z niejednolitą jednostką
    // zostawała bez dynamiki — bezpiecznie, ale w sprawie ZASTAL siedem pozycji
    // CSY S.A. nie było w ogóle policzonych, bo sprawozdania podają te same
    // wielkości raz w tysiącach, raz w złotych. Mnożnik jest ze SŁOWNIKA jednostek,
    // więc przeliczenie nie jest domysłem co do rzędu wielkości.
    const { table, uwagi } = dynamikaFin([
      { position: "Suma bilansowa", period: "2019", value: "10", unit: "mln zł" },
      { position: "Suma bilansowa", period: "2020", value: "12000", unit: "tys. zł" },
    ]);
    const w = table!.rows.find((r) => r[2] === "2020")!;
    expect(w[3].replace(/[\s\u00a0]/g, " ")).toBe("12 000 tys. zł"); // jednostka najczęstsza w serii
    expect(w[4]).toBe("20,0%"); // 10 mln zł = 10 000 tys. zł → 12 000 tys. zł
    expect(uwagi.join(" ")).toMatch(/sprowadzono do jednostki/);
  });

  it("wielkości RÓŻNEJ MIARY nadal zostają bez dynamiki", () => {
    // Procentu i sztuk nie wolno sprowadzać do złotych — tu odmowa jest jedyną
    // uczciwą odpowiedzią.
    const { table, uwagi } = dynamikaFin([
      { position: "Rentowność", period: "2019", value: "10", unit: "%" },
      { position: "Rentowność", period: "2020", value: "12000", unit: "tys. zł" },
    ]);
    expect(table).toBeNull();
    expect(uwagi.join(" ")).toMatch(/różnej miary/);
  });

  it("słownik jednostek zna skalę złotego i odrzuca resztę", () => {
    expect(mnoznikJednostki("zł")).toBe(1);
    expect(mnoznikJednostki("tys. zł")).toBe(1e3);
    expect(mnoznikJednostki("w tys. PLN")).toBe(1e3);
    expect(mnoznikJednostki("mln zł")).toBe(1e6);
    expect(mnoznikJednostki("mld zł")).toBe(1e9);
    expect(mnoznikJednostki("%")).toBeNull();
    expect(mnoznikJednostki("szt.")).toBeNull();
    expect(mnoznikJednostki("")).toBeNull();
  });

  it("okres narastający „I-III kw.” to WŁASNY rodzaj, nie kwartał", () => {
    // ⚠️ Sprawozdanie kwartalne podaje obok siebie kwartał i narastająco od początku
    // roku. Wcześniej etykieta nie pasowała do żadnego wzorca i obserwacja wypadała
    // z tabeli BEZ ŚLADU — dla CSY S.A. dwie z sześciu.
    expect(kluczOkresu("I-III kw. 2017")).toEqual({ rok: 2017, pod: 3, rodzaj: "narast" });
    expect(kluczOkresu("I–III kw. 2016")).toEqual({ rok: 2016, pod: 3, rodzaj: "narast" });
    expect(kluczOkresu("III kw. 2017")).toEqual({ rok: 2017, pod: 3, rodzaj: "kw" });

    const { table } = dynamikaFin([
      { issuer: "CSY S.A.", position: "przychody", period: "I-III kw. 2016", value: "13 415 324", unit: "zł" },
      { issuer: "CSY S.A.", position: "przychody", period: "I-III kw. 2017", value: "14 923 773", unit: "zł" },
      { issuer: "CSY S.A.", position: "przychody", period: "III kw. 2016", value: "4 169 878", unit: "zł" },
      { issuer: "CSY S.A.", position: "przychody", period: "III kw. 2017", value: "4 957 136", unit: "zł" },
    ]);
    const narast = table!.rows.find((r) => r[2] === "I-III kw. 2017")!;
    const kwartal = table!.rows.find((r) => r[2] === "III kw. 2017")!;
    expect(narast[5]).toBe("11,2%"); // r/r wobec I-III kw. 2016, NIE wobec kwartału
    expect(kwartal[5]).toBe("18,9%");
  });

  it("obserwacja z nierozpoznanym okresem trafia do uwag, nie ginie", () => {
    const { uwagi } = dynamikaFin([
      { position: "przychody", period: "2016", value: "100", unit: "zł" },
      { position: "przychody", period: "2017", value: "120", unit: "zł" },
      { position: "przychody", period: "okres świąteczny", value: "5", unit: "zł" },
    ]);
    expect(uwagi.join(" ")).toMatch(/nie rozpoznano okresu/);
  });

  it("jednostką docelową jest ta, w której podano NAJWIĘCEJ okresów", () => {
    const w = doWspolnejJednostki([
      { unit: "tys. zł", value: "1 000" },
      { unit: "tys. zł", value: "2 000" },
      { unit: "zł", value: "3 000 000" },
    ])!;
    expect(w.jednostka).toBe("tys. zł");
    expect(w.wartosci).toEqual([1000, 2000, 3000]);
    expect(w.przeliczonych).toBe(1);
  });
});

describe("mnoznikiWykazane", () => {
  it("przepisuje wartości portali bez liczenia", () => {
    const { table } = mnoznikiWykazane(
      "wskaznik,emitent,mediana_branzy,na_dzien,zrodlo\nC/Z,12.5,8.1,2020-10-21,biznesradar.pl",
    );
    expect(table!.rows[0]).toEqual(["C/Z", "12.5", "8.1", "2020-10-21", "biznesradar.pl"]);
    expect(table!.caption).toMatch(/WYKAZANE/);
  });
});

describe("PARYTET z finałem KM — złoty plik hub_d.csv", () => {
  const GOLDEN = join(
    process.env.HOME ?? "",
    "biegly-backup/files/405f8449-98ee-4d8a-8ed5-70bfb90c8776/HUBTECH/HUBTECH OUTPUT/OPINIA/hub_d.csv",
  );
  it.skipIf(!existsSync(GOLDEN))("odtwarza liczby z rozdziału IV.1 opinii HubTech", () => {
    const { notowania } = parsujStooqCsv(readFileSync(GOLDEN, "utf8"));
    const k = kontrastObrotu(notowania, "2020-09-09", "2020-10-21")!;
    // KM: „(1545 dni sesyjnych)… 624.000 sztuk… 260.405,34 zł”
    expect(k.przed.dniSesyjnych).toBe(1545);
    // Silnik daje 624 000,6 — KM w tekście obciął do pełnego tysiąca; ±1 szt.
    // to różnica prezentacji, nie metodyki (wartość złotowa zgadza się co do grosza).
    expect(Math.abs(k.przed.sredniWolumen! - 624000)).toBeLessThanOrEqual(1);
    expect(k.przed.sredniaWartoscObrotu!).toBeCloseTo(260405.34, 2);
    // KM: „średni dzienny wolumen… wyniósł 9.409.400 sztuk”
    expect(Math.round(k.badany.sredniWolumen!)).toBe(9409400);
  });
});

describe("wskaźniki rentowności (część tabeli nr 3 wzorca)", () => {
  const ITEMS = [
    { issuer: "CSY S.A.", position: "przychody netto ze sprzedaży", period: "2017", value: "19 501", unit: "tys. zł" },
    { issuer: "CSY S.A.", position: "zysk/strata netto", period: "2017", value: "5 368", unit: "tys. zł" },
    { issuer: "CSY S.A.", position: "zysk/strata z działalności operacyjnej", period: "2017", value: "1 950", unit: "tys. zł" },
    { issuer: "CSY S.A.", position: "kapitał własny", period: "2017", value: "28 626", unit: "tys. zł" },
    { issuer: "CSY S.A.", position: "suma bilansowa (aktywa razem)", period: "2017", value: "53 680", unit: "tys. zł" },
    // inny okres tej samej spółki — nie wolno mieszać z powyższym
    { issuer: "CSY S.A.", position: "przychody netto ze sprzedaży", period: "2016", value: "17 086", unit: "tys. zł" },
    // inna spółka — też osobno
    { issuer: "RSY S.A.", position: "przychody netto ze sprzedaży", period: "2017", value: "363", unit: "tys. zł" },
    { issuer: "RSY S.A.", position: "zysk/strata netto", period: "2017", value: "1 784", unit: "tys. zł" },
  ];

  it("liczy cztery wskaźniki z pozycji tego samego okresu", () => {
    const { wskazniki } = wskaznikiRentownosci(ITEMS);
    const csy2017 = wskazniki.filter((w) => w.emitent === "CSY S.A." && w.okres === "2017");
    expect(csy2017.map((w) => w.nazwa.split(" (")[0]).sort()).toEqual([
      "ROA", "ROE", "Rentowność netto", "Rentowność operacyjna",
    ]);
    expect(csy2017.find((w) => w.nazwa.startsWith("Rentowność netto"))!.wartoscPct).toBeCloseTo(27.53, 2);
    expect(csy2017.find((w) => w.nazwa.startsWith("ROE"))!.wartoscPct).toBeCloseTo(18.75, 2);
    expect(csy2017.find((w) => w.nazwa.startsWith("ROA"))!.wartoscPct).toBeCloseTo(10.0, 1);
  });

  it("nie miesza okresów ani emitentów", () => {
    const { wskazniki } = wskaznikiRentownosci(ITEMS);
    // 2016 ma tylko przychody — bez licznika nie ma wskaźnika
    expect(wskazniki.some((w) => w.okres === "2016")).toBe(false);
    // RSY ma przychody i wynik netto → tylko rentowność netto
    const rsy = wskazniki.filter((w) => w.emitent === "RSY S.A.");
    expect(rsy).toHaveLength(1);
    expect(rsy[0].wartoscPct).toBeCloseTo(491.46, 1); // wynik z wyceny, nie ze sprzedaży
  });

  it("mianownik zerowy nie tworzy wskaźnika (dzielenie bez sensu, nie nieskończoność)", () => {
    const { wskazniki, uwagi } = wskaznikiRentownosci([
      { issuer: "X", position: "przychody netto ze sprzedaży", period: "2020", value: "0", unit: "tys. zł" },
      { issuer: "X", position: "zysk/strata netto", period: "2020", value: "100", unit: "tys. zł" },
    ]);
    expect(wskazniki).toEqual([]);
    expect(uwagi.join(" ")).toMatch(/Nie policzono/);
  });

  it("jednostki niejednolite w serii są sprowadzane przed liczeniem", () => {
    const { wskazniki } = wskaznikiRentownosci([
      { issuer: "Y", position: "przychody netto ze sprzedaży", period: "2020", value: "10 000 000", unit: "zł" },
      { issuer: "Y", position: "przychody netto ze sprzedaży", period: "2019", value: "8 000", unit: "tys. zł" },
      { issuer: "Y", position: "zysk/strata netto", period: "2020", value: "1 000 000", unit: "zł" },
    ]);
    expect(wskazniki.find((w) => w.okres === "2020" && w.nazwa.startsWith("Rentowność netto"))!.wartoscPct).toBeCloseTo(10, 2);
  });
});
