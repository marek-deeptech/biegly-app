// MAPA WZORCA MBR — rozdział V finalnej opinii (PO III Ds 84.2020), moduły A–L,
// odwzorowane na miejsca w aplikacji. To jest ODPOWIEDŹ na wymóg „analiza
// ekonomiczno-finansowa analogicznie do MBR": każda litera wzorca ma wskazane,
// KTÓRA podzakładka kroku Analiza albo KTÓRY krok procesu ją realizuje.
//
// Strony wg wydania z 15.10.2021 (plik „2021.10.15 OPINIA PO III DS 84 2020.pdf").
// `kinds` wiąże literę z modułami danych (subanalyses.kind) ORAZ z rejestrem
// kompletności (lib/intake/completeness TECH_LABEL) — dzięki temu panel umie
// pokazać przy podzakładce, czego w aktach brakuje, zanim moduł policzy.

/** Gdzie w aplikacji żyje moduł wzorca: podzakładka kroku Analiza albo osobny krok. */
export type MiejsceModulu =
  | { podzakladka: "sprawozdania" | "sygnaly" | "media" }
  | { krok: "makro" | "prawo" };

export type ModulMbr = {
  litery: string;
  tytulMbr: string;
  /** Strona początkowa modułu w finalnej opinii MBR. */
  strona: number;
  /** Moduły danych aplikacji (subanalyses.kind / kompletność), które go realizują. */
  kinds: string[];
  gdzie: MiejsceModulu;
};

export const MAPA_MBR: ModulMbr[] = [
  { litery: "A", tytulMbr: "Inflacja — CPI", strona: 16, kinds: ["makro"], gdzie: { krok: "makro" } },
  { litery: "B", tytulMbr: "Kurs walutowy (EURISK, PLNISK)", strona: 19, kinds: ["makro"], gdzie: { krok: "makro" } },
  { litery: "C", tytulMbr: "Stopy procentowe", strona: 22, kinds: ["makro"], gdzie: { krok: "makro" } },
  { litery: "D", tytulMbr: "Istotny artykuł z polskiej prasy", strona: 25, kinds: ["media"], gdzie: { podzakladka: "media" } },
  { litery: "E", tytulMbr: "Istotny artykuł z prasy międzynarodowej", strona: 28, kinds: ["media"], gdzie: { podzakladka: "media" } },
  { litery: "F", tytulMbr: "Aktywa banków kontrahenta wobec PKB kraju", strona: 32, kinds: ["ekspozycja_sektor"], gdzie: { podzakladka: "media" } },
  { litery: "G", tytulMbr: "Groźba obniżki ratingów przez agencje", strona: 35, kinds: ["sygnaly_rynkowe"], gdzie: { podzakladka: "sygnaly" } },
  { litery: "H", tytulMbr: "Notowania CDS jako zignorowany sygnał ostrzegawczy", strona: 44, kinds: ["sygnaly_rynkowe"], gdzie: { podzakladka: "sygnaly" } },
  { litery: "I", tytulMbr: "Analiza sprawozdania finansowego kontrahenta (1 półrocze 2008)", strona: 57, kinds: ["sprawozdania", "adekwatnosc"], gdzie: { podzakladka: "sprawozdania" } },
  { litery: "J", tytulMbr: "Analiza sprawozdania finansowego kontrahenta (2007)", strona: 66, kinds: ["sprawozdania", "adekwatnosc"], gdzie: { podzakladka: "sprawozdania" } },
  { litery: "K", tytulMbr: "Inne istotne wydarzenia makroekonomiczne przed zdarzeniem", strona: 73, kinds: ["makro"], gdzie: { krok: "makro" } },
  { litery: "L", tytulMbr: "Otoczenie prawne i standardy identyfikacji ryzyka", strona: 93, kinds: ["otoczenie_prawne"], gdzie: { krok: "prawo" } },
];

/**
 * Moduły SPOZA wzorca MBR — dołożone sprawą SK Banku (metodyka zrzeszeniowa
 * i nadzór nad bankiem spółdzielczym). W sprawie typu MBR (ocena kontrahenta
 * zagranicznego) pozostają puste ZGODNIE ZE STANEM AKT — to nie jest usterka.
 */
export const SUPLEMENT_SK: { podzakladka: string; tytul: string; kinds: string[] }[] = [
  { podzakladka: "rubryka", tytul: "Rubryka 16 wskaźników banku zrzeszającego (uchwała 12/14/AB/BS/2002)", kinds: ["analiza_ekonomiczna"] },
  { podzakladka: "oceny", tytul: "Oceny zrzeszającego wystawione bankowi spółdzielczemu", kinds: ["oceny_zrzeszajacego"] },
  { podzakladka: "chronologia", tytul: "Chronologia nadzorcza i wskaźniki banku w czasie", kinds: ["chronologia_nadzoru"] },
  { podzakladka: "warsztat", tytul: "Proces decyzyjny i metodyka limitów", kinds: ["procedury", "limity"] },
];

/** Litery wzorca przypisane danej podzakładce — do etykiet zakładek („V.G–H"). */
export function literyPodzakladki(podzakladka: string): string {
  const litery = MAPA_MBR.filter((m) => "podzakladka" in m.gdzie && m.gdzie.podzakladka === podzakladka).map(
    (m) => m.litery,
  );
  if (!litery.length) return "";
  return litery.length === 1 ? `V.${litery[0]}` : `V.${litery[0]}–${litery[litery.length - 1]}`;
}
