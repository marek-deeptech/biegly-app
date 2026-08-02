// Tryb postępowania — karne albo cywilne. JEDNO miejsce, w którym zapisane jest,
// czym różni się opinia dla prokuratora od opinii dla sądu cywilnego.
//
// DLACZEGO TO NIE JEST CECHA DZIEDZINY
// Dziedzina mówi, CO się bada (manipulacja instrumentem / ryzyko bankowe). Tryb mówi,
// KOMU i w jakim postępowaniu odpowiada biegły — a to są osie niezależne: sprawa
// bankowa może być karna (MBR, PO III Ds 84.2020) albo cywilna (SK Bank, II C 595/23),
// tak samo manipulacyjna.
//
// CO WYSZŁO NA SPRAWIE SK BANKU
// Wszystkie prompty bankowe mówiły „opinia w sprawie karnej na zlecenie prokuratury"
// i odsyłały do organu „kwalifikację czynu", powołując art. 296 k.k. W sprawie
// II C 595/23 (powództwo o zapłatę przeciwko UKNF i Bankowi BPS) taka opinia byłaby
// adresowana do nieistniejącego adresata i zastrzegałaby się co do rzeczy, o które
// nikt nie pyta — a milczałaby o granicy, która tam obowiązuje naprawdę: ocena
// odpowiedzialności odszkodowawczej należy do sądu, nie do biegłego.

export type Tryb = "karne" | "cywilne";

export type OpisTrybu = {
  /** Etykieta do interfejsu. */
  label: string;
  /** Kto zleca i czyta opinię — wchodzi w pierwsze zdanie promptu. */
  rola: string;
  /** Skąd biorą się pytania, na które opinia odpowiada. */
  zrodloPytan: string;
  /** Czego biegłemu NIE WOLNO przesądzać — granica kompetencji w tym trybie. */
  pozaKompetencja: string;
  /** Jak nazywać uczestników. Podsunięcie nazewnictwa, nie ustaleń. */
  strony: string;
};

export const TRYBY: Record<Tryb, OpisTrybu> = {
  karne: {
    label: "Karne",
    rola:
      "sporządzasz opinię w sprawie karnej na zlecenie organu prowadzącego postępowanie " +
      "(prokuratury albo sądu karnego)",
    zrodloPytan: "pytania organu z postanowienia o dopuszczeniu dowodu z opinii biegłego",
    pozaKompetencja:
      "wina, zamiar i kwalifikacja prawna czynu — te należą wyłącznie do organu procesowego " +
      "i nie wolno ich przesądzać ani sugerować",
    strony: "podejrzany/oskarżony, pokrzywdzony",
  },
  cywilne: {
    label: "Cywilne",
    rola: "sporządzasz opinię na zlecenie sądu cywilnego, w sprawie z powództwa strony",
    zrodloPytan:
      "teza dowodowa z postanowienia sądu o dopuszczeniu dowodu z opinii biegłego oraz pytania " +
      "stron, jeżeli sąd dopuścił je do rozpoznania",
    pozaKompetencja:
      "ocena odpowiedzialności odszkodowawczej, wykładnia przepisów, ocena wiarygodności " +
      "świadków i rozstrzygnięcie o żądaniu pozwu — to należy do sądu; biegły dostarcza " +
      "wiadomości specjalnych, a nie ocenia roszczenia",
    strony: "powód, pozwani",
  },
};

/** Tryb sprawy; brak wartości = karne, bo tak działały wszystkie sprawy sprzed migracji 0014. */
export function trybDla(tryb?: string | null): OpisTrybu {
  return TRYBY[(tryb ?? "") as Tryb] ?? TRYBY.karne;
}

/**
 * Blok promptu opisujący tryb — wspólny dla redakcji rozdziałów, wniosków i wstępu.
 *
 * Trzyma się w jednym miejscu, bo rozjazd między rozdziałami byłby widoczny w gotowym
 * dokumencie: jeden rozdział zastrzegałby się co do kwalifikacji czynu, a sąsiedni
 * co do odpowiedzialności odszkodowawczej.
 */
export function blokTrybu(tryb?: string | null): string {
  const t = trybDla(tryb);
  return (
    `Jesteś biegłym sądowym: ${t.rola}. Odpowiadasz na ${t.zrodloPytan}. ` +
    `POZA TWOJĄ KOMPETENCJĄ pozostają: ${t.pozaKompetencja}. ` +
    `Strony postępowania nazywaj właściwie dla tego trybu (${t.strony}). ` +
    // ⚠️ Akta bywają MIESZANE. W sprawie SK Banku (cywilnej) leży akt oskarżenia
    // z art. 296 k.k., a model przeniósł z niego ramę karną: rozdział kończył się
    // zastrzeżeniem „kwalifikacja z art. 296 § 1 i 3 k.k. pozostaje w gestii sądu",
    // choć w tym postępowaniu nikogo nie oskarża się o przestępstwo.
    "AKTA MOGĄ ZAWIERAĆ MATERIAŁ Z INNEGO POSTĘPOWANIA (np. akt oskarżenia w sprawie " +
    "karnej). Możesz się na nie powoływać jako na DOWÓD, ale zastrzeżeń właściwych " +
    "tamtemu trybowi nie przenoś do tej opinii — granica Twojej kompetencji wynika " +
    "z postępowania, w którym Cię powołano, a nie z dokumentów leżących w aktach."
  );
}
