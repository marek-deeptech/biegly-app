// KATALOG WSKAŹNIKÓW WYMOGÓW KAPITAŁOWYCH — krok „Lista wskaźników" toru bankowego.
//
// DWA REŻIMY, DWA ŹRÓDŁA, JEDEN EKRAN:
// 1. Wymogi regulacyjne (wszystkie banki) — progi DATOWANE, lustro `PROGI`
//    z engine/bank.py. Datowanie nie jest ozdobą: CRR obowiązuje od 2014 r.,
//    LCR dochodził do 100% schodkami — powołanie progu spoza daty zdarzenia
//    to błąd merytoryczny (patrz lib/domain/prawo-bankowe.ts).
// 2. Rubryka banku zrzeszającego (banki spółdzielcze) — 16 wskaźników w 4 obszarach
//    z wagami, lustro `WSKAZNIKI_EF` z engine/analiza_ekonomiczna.py (uchwała
//    nr 12/14/AB/BS/2002, odczyt ZE SKANU, akta SK Banku k. 162 i nast.).
//
// ⚠️ LUSTRO TS↔PY JEST PILNOWANE TESTEM (tests/test_wskazniki_katalog_ts.py),
// tak samo jak bliźniacza logika wyboru pliku UTP. Test czyta ten plik LINIA PO
// LINII — każdy wpis katalogu MUSI zostać w jednej linii, bo rozjechany katalog
// pokazywałby biegłemu inne progi niż te, którymi silnik liczy naruszenia.

export type TypInstytucji = "bank_komercyjny" | "bank_spoldzielczy" | "inna";

export const TYPY_INSTYTUCJI: { id: TypInstytucji; label: string }[] = [
  { id: "bank_komercyjny", label: "Bank (komercyjny / zrzeszający S.A.)" },
  { id: "bank_spoldzielczy", label: "Bank spółdzielczy" },
  { id: "inna", label: "Inna instytucja finansowa" },
];

export type WymogKapitalowy = {
  kod: string;
  nazwa: string;
  /** Z czego wskaźnik się liczy — do objaśnienia w panelu, nie do liczenia. */
  formula: string;
  minimum: number;
  podstawa: string;
  od: string;
  do?: string;
};

// Lustro engine/bank.py PROGI — jeden wpis na linię (parser testu mostu).
export const WYMOGI_KAPITALOWE: WymogKapitalowy[] = [
  { kod: "tcr", nazwa: "Współczynnik wypłacalności", formula: "fundusze własne / aktywa ważone ryzykiem", minimum: 8.0, podstawa: "Uchwała nr 1/2007 KNB", od: "2007-04-01", do: "2013-12-31" },
  { kod: "cet1", nazwa: "Współczynnik kapitału podstawowego Tier 1 (CET1)", formula: "kapitał CET1 / aktywa ważone ryzykiem", minimum: 4.5, podstawa: "art. 92 ust. 1 lit. a CRR", od: "2014-01-01" },
  { kod: "tier1", nazwa: "Współczynnik kapitału Tier 1", formula: "kapitał Tier 1 / aktywa ważone ryzykiem", minimum: 6.0, podstawa: "art. 92 ust. 1 lit. b CRR", od: "2014-01-01" },
  { kod: "tcr", nazwa: "Łączny współczynnik kapitałowy", formula: "fundusze własne / aktywa ważone ryzykiem", minimum: 8.0, podstawa: "art. 92 ust. 1 lit. c CRR", od: "2014-01-01" },
  { kod: "dzwignia", nazwa: "Wskaźnik dźwigni finansowej", formula: "kapitał Tier 1 / ekspozycja całkowita", minimum: 3.0, podstawa: "art. 92 ust. 1 lit. d CRR w brzmieniu rozp. 2019/876", od: "2021-06-28" },
  { kod: "lcr", nazwa: "Wskaźnik pokrycia wypływów netto (LCR)", formula: "aktywa płynne / wypływy netto 30 dni", minimum: 60.0, podstawa: "rozp. del. (UE) 2015/61", od: "2015-10-01", do: "2016-12-31" },
  { kod: "lcr", nazwa: "Wskaźnik pokrycia wypływów netto (LCR)", formula: "aktywa płynne / wypływy netto 30 dni", minimum: 70.0, podstawa: "rozp. del. (UE) 2015/61", od: "2017-01-01", do: "2017-12-31" },
  { kod: "lcr", nazwa: "Wskaźnik pokrycia wypływów netto (LCR)", formula: "aktywa płynne / wypływy netto 30 dni", minimum: 80.0, podstawa: "rozp. del. (UE) 2015/61", od: "2018-01-01", do: "2018-12-31" },
  { kod: "lcr", nazwa: "Wskaźnik pokrycia wypływów netto (LCR)", formula: "aktywa płynne / wypływy netto 30 dni", minimum: 100.0, podstawa: "rozp. del. (UE) 2015/61", od: "2019-01-01" },
];

/** Wymogi obowiązujące w dniu zdarzenia. Pusty `dzien` → cały katalog (przegląd). */
export function wymogiNaDzien(dzien: string): WymogKapitalowy[] {
  if (!dzien) return WYMOGI_KAPITALOWE;
  return WYMOGI_KAPITALOWE.filter((w) => w.od <= dzien && (!w.do || w.do >= dzien));
}

// ── Rubryka banku zrzeszającego (uchwała nr 12/14/AB/BS/2002) ─────────────────
export const OBSZARY_RUBRYKI: { id: string; label: string }[] = [
  { id: "adekwatnosc", label: "Adekwatność kapitałów" },
  { id: "jakosc_aktywow", label: "Jakość aktywów" },
  { id: "efektywnosc", label: "Efektywność działania" },
  { id: "plynnosc", label: "Płynność finansowa" },
];

export type PozycjaRubryki = { kod: string; obszar: string; nazwa: string; waga: number };

// Lustro engine/analiza_ekonomiczna.py WSKAZNIKI_EF — jeden wpis na linię (parser testu mostu).
export const RUBRYKA_BS: PozycjaRubryki[] = [
  { kod: "wsp_wyplacalnosci", obszar: "adekwatnosc", nazwa: "Współczynnik wypłacalności", waga: 0.5 },
  { kod: "roe", obszar: "adekwatnosc", nazwa: "Wskaźnik zwrotu z kapitału (ROE netto)", waga: 0.3 },
  { kod: "odpis_podporzadkowane", obszar: "adekwatnosc", nazwa: "Roczny odpis zobowiązań podporządkowanych / zannualizowany wynik finansowy netto", waga: 0.1 },
  { kod: "fundusz_udzialowy", obszar: "adekwatnosc", nazwa: "Fundusz udziałowy / fundusze podstawowe", waga: 0.1 },
  { kod: "naleznosci_zagrozone", obszar: "jakosc_aktywow", nazwa: "Należności zagrożone / należności ogółem (wg wartości nominalnej)", waga: 0.3 },
  { kod: "zagrozone_do_aktywow", obszar: "jakosc_aktywow", nazwa: "Należności zagrożone / aktywa ogółem (wg wartości nominalnej)", waga: 0.25 },
  { kod: "aktywa_pracujace", obszar: "jakosc_aktywow", nazwa: "Aktywa pracujące / aktywa bilansowe", waga: 0.35 },
  { kod: "pokrycie_rezerwami", obszar: "jakosc_aktywow", nazwa: "Pokrycie należności zagrożonych rezerwami celowymi (utworzone / wymagane)", waga: 0.1 },
  { kod: "roa", obszar: "efektywnosc", nazwa: "Stopa zwrotu z aktywów (ROA netto)", waga: 0.3 },
  { kod: "marza_odsetkowa", obszar: "efektywnosc", nazwa: "Marża odsetkowa", waga: 0.3 },
  { kod: "koszty_do_wyniku", obszar: "efektywnosc", nazwa: "Koszty działania / wynik działalności bankowej", waga: 0.3 },
  { kod: "rezerwy_do_wyniku", obszar: "efektywnosc", nazwa: "Wynik z rezerw celowych / wynik działalności bankowej", waga: 0.1 },
  { kod: "plynnosc_aktywow", obszar: "plynnosc", nazwa: "Wskaźnik płynności aktywów (aktywa płynne / aktywa ogółem)", waga: 0.3 },
  { kod: "plynne_do_niestabilnych", obszar: "plynnosc", nazwa: "Aktywa płynne / pasywa niestabilne", waga: 0.3 },
  { kod: "kredyty_do_depozytow", obszar: "plynnosc", nazwa: "Kredyty wg wartości bilansowej / depozyty", waga: 0.2 },
  { kod: "stabilnosc_depozytow", obszar: "plynnosc", nazwa: "Wskaźnik stabilności depozytów (depozyty stabilne / depozyty ogółem)", waga: 0.2 },
];

/**
 * Kody wskaźników, które silnik faktycznie LICZY z akt (engine/bank.py `wskazniki`
 * i /api/bank dla rubryki). Panel oznacza je „liczony przez silnik" — pozostałe
 * pozycje rubryki bywają wypełniane wartościami WYKAZANYMI przez zrzeszającego
 * (gwiazdka), o innym statusie dowodowym.
 */
export const LICZONE_PRZEZ_SILNIK = new Set([
  "cet1", "tier1", "tcr", "dzwignia", "lcr",
  ...RUBRYKA_BS.map((r) => r.kod),
]);
