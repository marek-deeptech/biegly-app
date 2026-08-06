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
  /** Indeks tematyczny kroku „Otoczenie prawne" — patrz TEMATY_PRAWNE. */
  tematy: TematPrawny[];
};

/**
 * INDEKS TEMATYCZNY — odpowiada wprost na pytanie kroku „Otoczenie prawne":
 * GDZIE w przepisach obowiązujących w dacie zdarzenia jest mowa o adekwatności
 * kapitałowej, płynności i kondycji finansowej banku (wzorzec: opinia MBR,
 * rozdz. V.L, s. 93 — przegląd reżimu ostrożnościowego wg obszarów).
 *
 * Przypisanie jest RĘCZNE per przepis, nie po słowach kluczowych — ta sama zasada
 * co w przekładzie nazw BPS (engine/przeklad_bps.py): dopasowanie rozmyte myli
 * pozycje, a w dokumencie sądowym przepis o płynności podpięty pod adekwatność
 * to błąd, którego nikt nie zauważy do rozprawy.
 */
export type TematPrawny =
  | "adekwatnosc_kapitalowa"
  | "plynnosc"
  | "kondycja_finansowa"
  | "limity_koncentracja"
  | "proces_ryzyka"
  | "ustroj_spoldzielczy"
  | "odpowiedzialnosc_karna";

export const TEMATY_PRAWNE: { id: TematPrawny; label: string; opis: string }[] = [
  { id: "adekwatnosc_kapitalowa", label: "Adekwatność kapitałowa",
    opis: "Fundusze własne i współczynniki kapitałowe — ile kapitału bank MUSI utrzymywać wobec ryzyka" },
  { id: "plynnosc", label: "Płynność",
    opis: "Zdolność do regulowania zobowiązań — normy płynności i pokrycie wypływów" },
  { id: "kondycja_finansowa", label: "Kondycja finansowa i zdolność kredytowa",
    opis: "Badanie sytuacji ekonomiczno-finansowej — własnej i kontrahenta — jako warunek zaangażowania" },
  { id: "limity_koncentracja", label: "Limity i koncentracja zaangażowań",
    opis: "Granice zaangażowania wobec jednego podmiotu lub grupy powiązanej" },
  { id: "proces_ryzyka", label: "Proces zarządzania ryzykiem",
    opis: "Systemy identyfikacji, pomiaru i kontroli ryzyka oraz kontrola wewnętrzna" },
  { id: "ustroj_spoldzielczy", label: "Ustrój spółdzielczy",
    opis: "Zasady działania banków spółdzielczych i zrzeszających" },
  { id: "odpowiedzialnosc_karna", label: "Odpowiedzialność karna",
    opis: "Kwalifikacja czynu osób zajmujących się sprawami majątkowymi" },
];

export type BankModul =
  | "makro"
  | "sygnaly_rynkowe"
  | "media"
  | "ekspozycja_sektor"
  | "chronologia_nadzoru"
  | "sprawozdania"
  | "analiza_ekonomiczna"
  | "oceny_zrzeszajacego"
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
    tematy: ["adekwatnosc_kapitalowa"],
  },
  {
    ref: "Uchwała nr 4/2007 KNB",
    akt: "Uchwała nr 4/2007 Komisji Nadzoru Bankowego z dnia 13 marca 2007 r. w sprawie szczegółowych zasad i warunków uwzględniania zaangażowań przy ustalaniu przestrzegania limitu koncentracji zaangażowań",
    zakres: "limity koncentracji zaangażowań",
    od: "2007-04-01",
    do: "2013-12-31",
    moduly: ["limity", "otoczenie_prawne"],
    tematy: ["limity_koncentracja"],
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
    tematy: ["proces_ryzyka", "kondycja_finansowa"],
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
    tematy: ["adekwatnosc_kapitalowa"],
  },
  {
    ref: "art. 395 CRR",
    akt: "Rozporządzenie Parlamentu Europejskiego i Rady (UE) nr 575/2013 (CRR)",
    zakres: "limit dużych ekspozycji — 25% uznanego kapitału wobec jednego klienta lub grupy powiązanych klientów",
    od: "2014-01-01",
    zastapil: "Uchwała nr 4/2007 KNB",
    moduly: ["limity", "ekspozycja_sektor"],
    tematy: ["limity_koncentracja"],
  },
  {
    ref: "art. 429 CRR",
    akt: "Rozporządzenie Parlamentu Europejskiego i Rady (UE) nr 575/2013 (CRR)",
    zakres: "wskaźnik dźwigni finansowej",
    od: "2014-01-01",
    moduly: ["adekwatnosc"],
    tematy: ["adekwatnosc_kapitalowa"],
  },
  {
    ref: "art. 412 CRR w zw. z rozp. del. (UE) 2015/61",
    akt: "Rozporządzenie (UE) nr 575/2013 (CRR) oraz rozporządzenie delegowane Komisji (UE) 2015/61",
    zakres: "wymóg pokrycia wypływów netto (LCR)",
    od: "2015-10-01",
    moduly: ["adekwatnosc"],
    tematy: ["plynnosc"],
  },
  {
    ref: "art. 74 CRD IV",
    akt: "Dyrektywa Parlamentu Europejskiego i Rady 2013/36/UE (CRD IV)",
    zakres: "systemy zarządzania ryzykiem, procedury i mechanizmy kontroli wewnętrznej",
    od: "2014-01-01",
    moduly: ["procedury", "otoczenie_prawne"],
    tematy: ["proces_ryzyka"],
  },
  // ── Prawo krajowe — ciągłe ────────────────────────────────────────────────
  {
    // Norma płynności obowiązująca NIEPRZERWANIE od wejścia w życie Prawa bankowego —
    // dla spraw sprzed LCR (MBR: 2008, SK Bank: 2012–2015) to ONA jest podstawą
    // oceny płynności, bo LCR wszedł dopiero od października 2015 r.
    ref: "art. 8 Prawa bankowego",
    akt: "Ustawa z dnia 29 sierpnia 1997 r. — Prawo bankowe",
    zakres:
      "obowiązek utrzymywania płynności płatniczej dostosowanej do rozmiarów i rodzaju działalności banku",
    od: "1998-01-01",
    moduly: ["adekwatnosc", "otoczenie_prawne"],
    tematy: ["plynnosc"],
  },
  {
    // Krajowa kotwica adekwatności sprzed CRR: współczynnik wypłacalności co najmniej
    // 8% (nowo rozpoczynające 15%/12% w pierwszych latach). Materia przeszła do
    // art. 92 CRR z dniem 1.01.2014 — stąd data końcowa.
    ref: "art. 128 Prawa bankowego (do 2013)",
    akt: "Ustawa z dnia 29 sierpnia 1997 r. — Prawo bankowe",
    zakres:
      "obowiązek utrzymywania funduszy własnych dostosowanych do rozmiaru ryzyka oraz współczynnika wypłacalności co najmniej 8%",
    od: "1998-01-01",
    do: "2013-12-31",
    moduly: ["adekwatnosc", "otoczenie_prawne"],
    tematy: ["adekwatnosc_kapitalowa", "kondycja_finansowa"],
  },
  {
    ref: "art. 9 Prawa bankowego",
    akt: "Ustawa z dnia 29 sierpnia 1997 r. — Prawo bankowe",
    zakres: "obowiązek funkcjonowania systemu zarządzania ryzykiem i kontroli wewnętrznej",
    od: "1998-01-01",
    moduly: ["procedury", "otoczenie_prawne"],
    tematy: ["proces_ryzyka"],
  },
  {
    ref: "art. 70 Prawa bankowego",
    akt: "Ustawa z dnia 29 sierpnia 1997 r. — Prawo bankowe",
    zakres: "badanie zdolności kredytowej jako warunek zaangażowania środków",
    od: "1998-01-01",
    moduly: ["sprawozdania", "procedury"],
    tematy: ["kondycja_finansowa", "proces_ryzyka"],
  },
  {
    ref: "art. 71 Prawa bankowego",
    akt: "Ustawa z dnia 29 sierpnia 1997 r. — Prawo bankowe",
    zakres: "limity koncentracji zaangażowań (przed przeniesieniem materii do CRR)",
    od: "1998-01-01",
    do: "2013-12-31",
    moduly: ["limity"],
    tematy: ["limity_koncentracja"],
  },
  {
    ref: "ustawa o funkcjonowaniu banków spółdzielczych",
    akt: "Ustawa z dnia 7 grudnia 2000 r. o funkcjonowaniu banków spółdzielczych, ich zrzeszaniu się i bankach zrzeszających",
    zakres: "ustrój banków spółdzielczych i banków zrzeszających, fundusze własne, zasady zrzeszenia",
    od: "2001-01-28",
    moduly: ["adekwatnosc", "otoczenie_prawne", "procedury"],
    tematy: ["ustroj_spoldzielczy", "adekwatnosc_kapitalowa"],
  },
  // ── Strona karna — kwalifikacja czynu zarządu ─────────────────────────────
  {
    ref: "art. 296 § 1 i 3 k.k.",
    akt: "Ustawa z dnia 6 czerwca 1997 r. — Kodeks karny",
    zakres:
      "nadużycie uprawnień lub niedopełnienie obowiązku przez osobę zajmującą się sprawami majątkowymi, wyrządzające znaczną szkodę majątkową",
    od: "1998-09-01",
    moduly: ["procedury", "otoczenie_prawne"],
    tematy: ["odpowiedzialnosc_karna"],
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

/**
 * Indeks tematyczny na dzień zdarzenia: temat → przepisy, które go regulują.
 *
 * To jest odpowiedź kroku „Otoczenie prawne" na pytanie „gdzie w tych przepisach
 * jest mowa o adekwatności kapitałowej / płynności / kondycji finansowej banku".
 * Tematy bez żadnego przepisu NA TEN DZIEŃ zostają w wyniku z pustą listą —
 * „w tej dacie żaden przepis katalogu nie regulował X" jest ustaleniem, nie brakiem.
 */
export function przepisyWgTematu(dzien: string): { temat: (typeof TEMATY_PRAWNE)[number]; przepisy: Przepis[] }[] {
  const wlasciwe = przepisyNaDzien(dzien);
  return TEMATY_PRAWNE.map((t) => ({
    temat: t,
    przepisy: wlasciwe.filter((p) => p.tematy.includes(t.id)),
  }));
}
