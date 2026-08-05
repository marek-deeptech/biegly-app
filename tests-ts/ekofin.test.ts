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
  dynamikaFin,
  indeks100,
  kluczOkresu,
  kontrastObrotu,
  liczbaPl,
  mnoznikiWykazane,
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
    const rows = table!.rows;
    const p3 = rows.find((r) => r[0] === "Przychody netto" && r[1] === "III kw. 2020")!;
    expect(p3[3]).toBe("100,0%"); // vs II kw. 2020
    expect(p3[4]).toBe("200,0%"); // vs III kw. 2019
    const z = rows.find((r) => r[0] === "Zysk netto" && r[1] === "III kw. 2020")!;
    expect(z[4]).toBe("150,0%"); // z −50 na +25 względem |−50|
  });

  it("pozycja z niejednolitą jednostką NIE dostaje dynamiki — tylko uwagę", () => {
    const { table, uwagi } = dynamikaFin([
      { position: "Suma bilansowa", period: "2019", value: "10", unit: "mln zł" },
      { position: "Suma bilansowa", period: "2020", value: "12000", unit: "tys. zł" },
    ]);
    expect(table).toBeNull();
    expect(uwagi.join(" ")).toMatch(/niejednolite/);
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
