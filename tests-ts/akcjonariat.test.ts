/**
 * Historia zmian w akcjonariacie — rdzeń kroku.
 *
 * Fragmenty HTML pochodzą z rzeczywistej strony Bankier.pl dla Hub.Tech SA
 * (pobrana 7.08.2026): 68 wierszy historii i tabela emisji kapitału.
 *
 * ⚠️ DWIE RZECZY, KTÓRYCH NIE WIDAĆ W TREŚCI TABELI:
 *  • wzrost NIE ma plusa — kierunek zmiany siedzi w klasie `-positive`;
 *  • spadek udziału przy niezmienionej liczbie akcji to rozwodnienie emisją,
 *    nie zbycie. Bogusz Piotr „10,39 (-4,45)” z 2024-07-12 wygląda jak wyjście
 *    z akcjonariatu, a jest skutkiem rejestracji serii G w KRS tego samego dnia.
 */
import { describe, expect, it } from "vitest";
import {
  kwalifikuj,
  liczba,
  parsujEmisjeBankier,
  parsujHistorieBankier,
  dawneNazwy,
  toSamaSpolka,
  porownajZeSprawozdaniem,
  tabelaDni,
  tabelaEmisji,
  tabelaHistorii,
  tabelaRozbieznosci,
  uwagiZrodel,
  type ZmianaAkcjonariatu,
} from "@/lib/opinion/akcjonariat";

const wiersz = (
  nazwa: string,
  akcje: string,
  proc: string,
  data: string,
) => `<tr><td>${nazwa}</td><td>${akcje}</td><td>${proc}</td><td>${akcje}</td><td>${proc}</td><td>${data}</td></tr>`;
const wart = (v: string) => `<span class="a-quote-item -value">${v}</span>`;
const zm = (v: string, znak: "-positive" | "-negative") =>
  `<span class="a-quote-item -value-change ${znak}">(${v})</span>`;

const HTML = `
<table class="m-quotes-data-table"><thead><tr><th>Nazwa</th><th>Liczba akcji</th><th>Liczba głosów</th><th>Data zmiany</th></tr></thead>
<tbody><tr><td>Richfield</td><td>404 834 164 (60,65%)</td><td>404 834 164 (60,65%)</td><td>2024-07-15</td></tr></tbody></table>

<table class="m-quotes-data-table"><thead><tr><th>Opis operacji</th><th>Emisja</th><th>Cena</th><th>Kapitał po emisji</th><th>Daty</th></tr></thead>
<tbody>
<tr><td>seria G - kapitał docelowy</td><td>200 000 000 szt. 60 000 000,00 zł</td><td>Nominalna: 0,10 zł</td><td>667 490 180 szt. 66 749 018,00 zł</td><td>WZA: 2024-06-27 KNF: -- -- KRS: 2024-07-12 PDA: -- --</td></tr>
<tr><td>zmiana firmy z Boruta-Zachem SA na Hub.Tech SA</td><td>-- -- -- --</td><td>-- --</td><td>-- -- -- --</td><td>WZA: 2020-10-08 KNF: -- -- KRS: 2021-02-23 PDA: -- --</td></tr>
<tr><td>seria F - subskrypcja prywatna</td><td>150 000 000 szt. 37 500 000,00 zł</td><td>Nominalna: 0,10 zł</td><td>467 490 180 szt. 46 749 018,00 zł</td><td>WZA: 2020-07-30 KNF: -- -- KRS: 2021-02-23</td></tr>
</tbody></table>

<table class="m-quotes-data-table"><thead><tr><th>Nazwa</th><th>Liczba akcji</th><th>Procent akcji</th><th>Liczba głosów</th><th>Procent głosów</th><th>Data zmiany</th></tr></thead>
<tbody>
${wiersz("Richfield Equity Investments SCSp", wart("404 834 164") + zm("200 000 000", "-positive"), wart("60,65") + zm("16,84", "-positive"), "2024-07-15")}
${wiersz("Bogusz Piotr (ZWZ)", wart("69 400 000"), wart("10,39") + zm("-4,45", "-negative"), "2024-07-12")}
${wiersz("Midorana Investments Ltd.", wart("23 363 502") + zm("-17 591 528", "-negative"), wart("4,99") + zm("-3,77", "-negative"), "2021-07-20")}
${wiersz("Pozostali", wart("193 256 016"), wart("28,96"), "-- --")}
</tbody></table>`;

describe("parser Bankiera", () => {
  const historia = parsujHistorieBankier(HTML);

  it("czyta liczby w formacie polskim", () => {
    expect(liczba("404 834 164")).toBe(404834164);
    expect(liczba("60,65")).toBe(60.65);
    expect(liczba("-4,45")).toBe(-4.45);
    expect(liczba("-- --")).toBeNull();
  });

  it("bierze tabelę po NAGŁÓWKACH, nie po pozycji na stronie", () => {
    // Na stronie są trzy tabele; ta właściwa ma kolumnę „Procent akcji”.
    expect(historia.map((h) => h.akcjonariusz)).toEqual([
      "Richfield Equity Investments SCSp",
      "Bogusz Piotr (ZWZ)",
      "Midorana Investments Ltd.",
    ]);
  });

  it("wzrost bez plusa w treści wychodzi jako DODATNI (klasa -positive)", () => {
    const r = historia.find((h) => h.akcjonariusz.startsWith("Richfield"))!;
    expect(r.akcje).toBe(404834164);
    expect(r.akcjeZmiana).toBe(200000000);
    expect(r.procentZmiana).toBe(16.84);
  });

  it("spadek zachowuje znak ujemny", () => {
    const m = historia.find((h) => h.akcjonariusz.startsWith("Midorana"))!;
    expect(m.akcjeZmiana).toBe(-17591528);
    expect(m.procentZmiana).toBe(-3.77);
  });

  it("wiersz bez daty („Pozostali”) nie jest zmianą", () => {
    expect(historia.some((h) => h.akcjonariusz === "Pozostali")).toBe(false);
  });

  it("czyta emisje z datą rejestracji w KRS", () => {
    const e = parsujEmisjeBankier(HTML);
    expect(e).toHaveLength(3); // w tym wpis porządkowy o zmianie firmy
    expect(e[0]).toMatchObject({ akcjeEmisji: 200000000, kapitalPoSzt: 667490180, dataKrs: "2024-07-12", dataWza: "2024-06-27" });
  });

  it("strona bez tabel nie wywraca biegu", () => {
    expect(parsujHistorieBankier("<html><body>nic</body></html>")).toEqual([]);
    expect(parsujEmisjeBankier("")).toEqual([]);
  });
});

describe("kwalifikacja zdarzeń", () => {
  const zdarzenia = kwalifikuj(parsujHistorieBankier(HTML), parsujEmisjeBankier(HTML));
  const wg = (frag: string) => zdarzenia.find((z) => z.akcjonariusz.startsWith(frag))!;

  it("spadek udziału bez zmiany liczby akcji + emisja w KRS = ROZWODNIENIE", () => {
    const b = wg("Bogusz");
    expect(b.kwalifikacja).toBe("rozwodnienie");
    expect(b.uzasadnienie).toMatch(/NIEZMIENIONEJ liczbie akcji/);
    expect(b.uzasadnienie).toMatch(/2024-07-12/);
  });

  it("spadek liczby akcji to zbycie, niezależnie od emisji", () => {
    expect(wg("Midorana").kwalifikacja).toBe("zbycie");
  });

  it("wzrost w dniu rejestracji emisji wymaga rozstrzygnięcia: objęcie czy nabycie", () => {
    const r = wg("Richfield"); // 2024-07-15, emisja w KRS 2024-07-12 → w oknie 3 dni
    expect(r.kwalifikacja).toBe("objęcie emisji");
    expect(r.uzasadnienie).toMatch(/do rozstrzygnięcia/);
  });

  it("wpis bez emisji akcji (zmiana firmy) NIE uzasadnia zmiany pakietu", () => {
    // Tabela operacji Bankiera miesza emisje z wpisami porządkowymi; wzrost pakietu
    // Joyfix uzasadniano kiedyś „zmianą firmy z Boruta-Zachem SA na Hub.Tech SA”.
    const zmiana: ZmianaAkcjonariatu[] = [{
      data: "2021-02-26", akcjonariusz: "Joyfix Ltd.", akcje: 126625490, akcjeZmiana: 126625490,
      procent: 27.08, procentZmiana: 27.08, glosy: 126625490, glosyZmiana: 126625490, zrodlo: "bankier",
    }];
    const bezAkcji = [{ opis: "zmiana firmy z Boruta-Zachem SA na Hub.Tech SA", akcjeEmisji: null, kapitalPoSzt: null, dataKrs: "2021-02-23", dataWza: "2020-10-08" }];
    const w = kwalifikuj(zmiana, bezAkcji);
    expect(w[0].kwalifikacja).toBe("nabycie");
    expect(w[0].uzasadnienie).not.toMatch(/zmiana firmy/);
    // ta sama zmiana przy PRAWDZIWEJ emisji z tego dnia → objęcie emisji
    const zEmisja = kwalifikuj(zmiana, [...bezAkcji, { opis: "seria F", akcjeEmisji: 150000000, kapitalPoSzt: 467490180, dataKrs: "2021-02-23", dataWza: "2020-07-30" }]);
    expect(zEmisja[0].kwalifikacja).toBe("objęcie emisji");
    expect(zEmisja[0].uzasadnienie).toMatch(/seria F/);
  });

  it("bez emisji w pobliżu ten sam spadek udziału jest DO WYJAŚNIENIA, nie rozwodnieniem", () => {
    const sam = kwalifikuj(parsujHistorieBankier(HTML), []);
    expect(sam.find((z) => z.akcjonariusz.startsWith("Bogusz"))!.kwalifikacja).toBe("nieokreślone");
    expect(uwagiZrodel(sam).join(" ")).toMatch(/nie dają się zakwalifikować/);
  });
});

describe("tabele kroku", () => {
  const zdarzenia = kwalifikuj(parsujHistorieBankier(HTML), parsujEmisjeBankier(HTML));

  it("tabela historii niesie kwalifikację i źródło", () => {
    const t = tabelaHistorii(zdarzenia, "Hub.Tech S.A.")!;
    expect(t.head).toContain("Kwalifikacja");
    expect(t.rows[0][0]).toBe("2024-07-15");
    expect(t.rows[0][3]).toMatch(/^\+/); // zmiana ze znakiem
    expect(t.rows.every((r) => r[7] === "Bankier.pl")).toBe(true);
    expect(t.caption).toMatch(/Hub\.Tech/);
  });

  it("tabela dni grupuje po dacie i pomija wpisy bez zmiany", () => {
    const t = tabelaDni(zdarzenia)!;
    expect(t.rows.map((r) => r[0])).toEqual(["2024-07-15", "2024-07-12", "2021-07-20"]);
  });

  it("tabela emisji podaje datę KRS — kotwicę rozwodnienia", () => {
    expect(tabelaEmisji(parsujEmisjeBankier(HTML))!.rows[0][4]).toBe("2024-07-12");
  });

  it("puste wejście daje null, nie pustą tabelę w opinii", () => {
    expect(tabelaHistorii([])).toBeNull();
    expect(tabelaDni([])).toBeNull();
    expect(tabelaEmisji([])).toBeNull();
  });
});

describe("zestawienie ze sprawozdaniem zarządu", () => {
  const bankier = parsujHistorieBankier(HTML);
  const zeSprawozdania: ZmianaAkcjonariatu[] = [
    {
      data: "2024-12-31", akcjonariusz: "Bogusz Piotr (ZWZ)", akcje: 70000000, akcjeZmiana: null,
      procent: 10.49, procentZmiana: null, glosy: 70000000, glosyZmiana: null,
      zrodlo: "sprawozdanie", plik: "SPRAWOZDANIE_OPISOWE_2024.pdf",
    },
  ];

  it("różnica między dokumentem emitenta a serwisem jest USTALENIEM, nie błędem", () => {
    const r = porownajZeSprawozdaniem(bankier, zeSprawozdania);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ wgSprawozdania: 70000000, wgBankiera: 69400000, roznica: 600000 });
    const t = tabelaRozbieznosci(r)!;
    expect(t.rows[0][4]).toBe("+600 000".replace(/ /g, " "));
  });

  it("zgodność obu źródeł nie generuje wiersza", () => {
    const zgodne = [{ ...zeSprawozdania[0], akcje: 69400000 }];
    expect(porownajZeSprawozdaniem(bankier, zgodne)).toEqual([]);
    expect(tabelaRozbieznosci([])).toBeNull();
  });
});

describe("tożsamość emitenta pod dawną firmą", () => {
  /**
   * ⚠️ Sprawozdania w aktach są podpisane nazwą Z DNIA PUBLIKACJI. Kontrola „czy
   * dokument dotyczy emitenta” odrzucała własne sprawozdania Hub.Techu sprzed 2021 r.,
   * bo nosiły firmę Boruta-Zachem S.A. Dawne nazwy stoją w danych, które i tak pobieramy.
   */
  const emisje = parsujEmisjeBankier(HTML);

  it("wyciąga obie nazwy z wpisu o zmianie firmy", () => {
    expect(dawneNazwy(emisje)).toEqual(["Boruta-Zachem SA", "Hub.Tech SA"]);
    expect(dawneNazwy([])).toEqual([]);
  });

  it("dawna firma emitenta jest uznawana za tożsamą, obca spółka nie", () => {
    const nazwy = ["Hub.Tech", ...dawneNazwy(emisje)];
    expect(toSamaSpolka("Boruta – Zachem S.A.", nazwy)).toBe(true);
    expect(toSamaSpolka("Hub.Tech Spółka Akcyjna", nazwy)).toBe(true);
    expect(toSamaSpolka("InventionBio sp. z o.o.", nazwy)).toBe(false);
  });

  it("brak nazwy w dokumencie nie odrzuca pozycji (nie zgadujemy)", () => {
    expect(toSamaSpolka("", ["Hub.Tech"])).toBe(true);
  });
});
