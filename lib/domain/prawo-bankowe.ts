// KATALOG PRAWNY DZIEDZINY BANKOWEJ — DATOWANY.
//
// ⚠️ POWÓD ISTNIENIA DAT — NIE JEST TO OZDOBA:
// Zachowanie banku ocenia się według stanu prawnego z DNIA ZDARZENIA, nie z dnia
// pisania opinii. W sprawie MBR decyzja zapadła 11.09.2008 — a rozporządzenie CRR
// (575/2013) obowiązuje dopiero od 2014 r. Powołanie CRR do oceny decyzji z 2008 r.
// byłoby błędem merytorycznym, który obrona wytknie natychmiast. Biegły oparł tam
// wnioski na Uchwale nr 5/2007 KNB — i tak właśnie musi działać dobór przepisu.
//
// W dziedzinie GPW ten problem nie występuje: MAR obowiązuje niezmiennie od 2016 r.,
// więc katalog w legal.ts dat nie potrzebuje. Tutaj bez nich katalog byłby szkodliwy.

export type Przepis = {
  /** Odwołanie w postaci, w jakiej ma trafić do opinii. */
  ref: string;
  /** Pełna nazwa aktu — do rozdziału „Podstawa prawna". */
  akt: string;
  /** Czego dotyczy — do doboru przepisu pod moduł analizy. */
  zakres: string;
  /** Obowiązuje od (ISO). */
  od: string;
  /** Obowiązuje do (ISO); brak = obowiązuje nadal. */
  do?: string;
  /** Co zastąpił — pozwala wskazać w opinii ciągłość regulacji. */
  zastapil?: string;
  /** Moduły analizy, dla których przepis jest właściwy. */
  moduly: BankModul[];
};

export type BankModul =
  | "makro"
  | "sygnaly_rynkowe"
  | "media"
  | "ekspozycja_sektor"
  | "sprawozdania"
  | "adekwatnosc"
  | "limity"
  | "procedury"
  | "otoczenie_prawne";

export const PRZEPISY_BANK: Przepis[] = [
  // ── Stan prawny sprzed CRD IV/CRR (sprawy z lat 2007–2013) ────────────────
  {
    ref: "Uchwała nr 1/2007 KNB",
    akt: "Uchwała nr 1/2007 Komisji Nadzoru Bankowego z dnia 13 marca 2007 r. w sprawie zakresu i szczegółowych zasad wyznaczania wymogów kapitałowych",
    zakres: "wymogi kapitałowe z tytułu poszczególnych rodzajów ryzyka",
    od: "2007-04-01",
    do: "2013-12-31",
    moduly: ["adekwatnosc", "otoczenie_prawne"],
  },
  {
    ref: "Uchwała nr 4/2007 KNB",
    akt: "Uchwała nr 4/2007 Komisji Nadzoru Bankowego z dnia 13 marca 2007 r. w sprawie szczegółowych zasad i warunków uwzględniania zaangażowań przy ustalaniu przestrzegania limitu koncentracji zaangażowań",
    zakres: "limity koncentracji zaangażowań",
    od: "2007-04-01",
    do: "2013-12-31",
    moduly: ["limity", "otoczenie_prawne"],
  },
  {
    // To jest przepis, na którym biegły oparł wnioski w sprawie MBR.
    ref: "Uchwała nr 5/2007 KNB, § 5",
    akt: "Uchwała nr 5/2007 Komisji Nadzoru Bankowego z dnia 13 marca 2007 r. w sprawie szczegółowych zasad i sposobu ogłaszania przez banki informacji o charakterze jakościowym i ilościowym oraz zasad zarządzania ryzykiem",
    zakres:
      "obowiązek wykorzystywania wiarygodnych informacji o sytuacji ekonomicznej podmiotów, uwzględniania informacji jakościowych o zarządzaniu oraz innych rodzajów ryzyka powiązanych z zaangażowaniem",
    od: "2007-04-01",
    do: "2013-12-31",
    moduly: ["procedury", "otoczenie_prawne", "limity"],
  },
  // ── CRD IV / CRR — od 2014 ────────────────────────────────────────────────
  {
    ref: "art. 92 CRR",
    akt: "Rozporządzenie Parlamentu Europejskiego i Rady (UE) nr 575/2013 (CRR)",
    zakres:
      "współczynniki kapitałowe: CET1 ≥ 4,5%, Tier 1 ≥ 6%, łączny współczynnik kapitałowy ≥ 8%",
    od: "2014-01-01",
    zastapil: "Uchwała nr 1/2007 KNB",
    moduly: ["adekwatnosc"],
  },
  {
    ref: "art. 395 CRR",
    akt: "Rozporządzenie Parlamentu Europejskiego i Rady (UE) nr 575/2013 (CRR)",
    zakres: "limit dużych ekspozycji — 25% uznanego kapitału wobec jednego klienta lub grupy powiązanych klientów",
    od: "2014-01-01",
    zastapil: "Uchwała nr 4/2007 KNB",
    moduly: ["limity", "ekspozycja_sektor"],
  },
  {
    ref: "art. 429 CRR",
    akt: "Rozporządzenie Parlamentu Europejskiego i Rady (UE) nr 575/2013 (CRR)",
    zakres: "wskaźnik dźwigni finansowej",
    od: "2014-01-01",
    moduly: ["adekwatnosc"],
  },
  {
    ref: "art. 412 CRR w zw. z rozp. del. (UE) 2015/61",
    akt: "Rozporządzenie (UE) nr 575/2013 (CRR) oraz rozporządzenie delegowane Komisji (UE) 2015/61",
    zakres: "wymóg pokrycia wypływów netto (LCR)",
    od: "2015-10-01",
    moduly: ["adekwatnosc"],
  },
  {
    ref: "art. 74 CRD IV",
    akt: "Dyrektywa Parlamentu Europejskiego i Rady 2013/36/UE (CRD IV)",
    zakres: "systemy zarządzania ryzykiem, procedury i mechanizmy kontroli wewnętrznej",
    od: "2014-01-01",
    moduly: ["procedury", "otoczenie_prawne"],
  },
  // ── Prawo krajowe — ciągłe ────────────────────────────────────────────────
  {
    ref: "art. 9 Prawa bankowego",
    akt: "Ustawa z dnia 29 sierpnia 1997 r. — Prawo bankowe",
    zakres: "obowiązek funkcjonowania systemu zarządzania ryzykiem i kontroli wewnętrznej",
    od: "1998-01-01",
    moduly: ["procedury", "otoczenie_prawne"],
  },
  {
    ref: "art. 70 Prawa bankowego",
    akt: "Ustawa z dnia 29 sierpnia 1997 r. — Prawo bankowe",
    zakres: "badanie zdolności kredytowej jako warunek zaangażowania środków",
    od: "1998-01-01",
    moduly: ["sprawozdania", "procedury"],
  },
  {
    ref: "art. 71 Prawa bankowego",
    akt: "Ustawa z dnia 29 sierpnia 1997 r. — Prawo bankowe",
    zakres: "limity koncentracji zaangażowań (przed przeniesieniem materii do CRR)",
    od: "1998-01-01",
    do: "2013-12-31",
    moduly: ["limity"],
  },
  {
    ref: "ustawa o funkcjonowaniu banków spółdzielczych",
    akt: "Ustawa z dnia 7 grudnia 2000 r. o funkcjonowaniu banków spółdzielczych, ich zrzeszaniu się i bankach zrzeszających",
    zakres: "ustrój banków spółdzielczych i banków zrzeszających, fundusze własne, zasady zrzeszenia",
    od: "2001-01-28",
    moduly: ["adekwatnosc", "otoczenie_prawne", "procedury"],
  },
  // ── Strona karna — kwalifikacja czynu zarządu ─────────────────────────────
  {
    ref: "art. 296 § 1 i 3 k.k.",
    akt: "Ustawa z dnia 6 czerwca 1997 r. — Kodeks karny",
    zakres:
      "nadużycie uprawnień lub niedopełnienie obowiązku przez osobę zajmującą się sprawami majątkowymi, wyrządzające znaczną szkodę majątkową",
    od: "1998-09-01",
    moduly: ["procedury", "otoczenie_prawne"],
  },
];

/**
 * Przepisy obowiązujące w dniu zdarzenia, właściwe dla danego modułu analizy.
 *
 * `dzien` to data OCENIANEGO ZACHOWANIA (np. dzień decyzji o lokacie), nie data
 * sporządzenia opinii. Pomyłka w tym miejscu to powołanie nieobowiązującego przepisu.
 */
export function przepisyNaDzien(dzien: string, modul?: BankModul): Przepis[] {
  return PRZEPISY_BANK.filter(
    (p) => p.od <= dzien && (!p.do || p.do >= dzien) && (!modul || p.moduly.includes(modul)),
  );
}

/**
 * Przepisy, które w dniu zdarzenia jeszcze NIE obowiązywały, a bywają omyłkowo
 * powoływane (np. CRR do oceny decyzji z 2008 r.). Zwracane po to, żeby audytor
 * opinii mógł je wychwycić jako błąd, zamiast przepuścić.
 */
export function przepisyAnachroniczne(dzien: string): Przepis[] {
  return PRZEPISY_BANK.filter((p) => p.od > dzien);
}
