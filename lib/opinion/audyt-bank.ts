// Rubryka audytu opinii bankowej.
//
// DLACZEGO OSOBNA, A NIE WSPÓLNA Z GPW:
// Rubryka GPW ocenia, czy każda teza o TECHNICE MANIPULACJI ma pokrycie w liczbie
// i czy wskazano literę załącznika I do MAR. W opinii o ryzyku kredytowym banku nie
// ma ani technik, ani MAR — więc audytor wystawiłby „brak" za nieobecność rzeczy,
// których w tej dziedzinie być nie może, i niska ocena czytałaby się jak wada opinii.
//
// Kryteria bankowe pilnują tego, co w TEJ dziedzinie psuje opinię najczęściej:
// anachronicznego przepisu i wnioskowania wstecznego.

export type KryteriumRubryki = { id: string; waga: number; opis: string };

export const RUBRYKA_BANK: KryteriumRubryki[] = [
  {
    id: "pytania",
    waga: 20,
    opis:
      "Każde pytanie organu ma w rozdziale III (Wnioski) wyraźną, wprost sformułowaną odpowiedź, " +
      "a nie samo streszczenie ustaleń.",
  },
  {
    id: "pokrycie",
    waga: 20,
    opis:
      "Każda teza o kondycji kontrahenta jest poparta konkretną wartością (współczynnik, kwota, " +
      "udział) — a ta wartość występuje w WYKAZIE METRYK silnika.",
  },
  {
    id: "stan_prawny",
    waga: 20,
    opis:
      "Powołane przepisy OBOWIĄZYWAŁY w dacie ocenianego zdarzenia. Powołanie aktu późniejszego " +
      "(np. CRR do decyzji z 2008 r.) jest błędem dyskwalifikującym — zgłoś je zawsze.",
  },
  {
    id: "wsteczne",
    waga: 15,
    opis:
      "Ocena opiera się WYŁĄCZNIE na informacjach dostępnych w dniu decyzji. Powołanie zdarzeń " +
      "późniejszych (upadek kontrahenta, publikacje po tej dacie) jako podstawy oceny to " +
      "wnioskowanie wsteczne.",
  },
  {
    id: "zastrzezenia",
    waga: 10,
    opis:
      "Wnioski nie opierają się na wartościach, które silnik oznaczył jako niewiarygodne; wartości " +
      "doliczone z tożsamości mają ujawnione pochodzenie.",
  },
  {
    id: "fakty_oceny",
    waga: 10,
    opis:
      "Ustalenia faktyczne są oddzielone od ocen; opinia nie przesądza winy ani zamiaru, " +
      "a kwalifikacji czynu pozostawia organowi.",
  },
  {
    id: "luki",
    waga: 5,
    opis:
      "Braki dowodowe są wypowiedziane wprost („w aktach nie ma…”) zamiast przemilczane, " +
      "a ustalenia liczbowe mają wskazane źródło (plik, strona).",
  },
];

export const SYSTEM_AUDYT_BANK =
  "Jesteś audytorem opinii biegłego sądowego z zakresu bankowości i ryzyka kredytowego. " +
  "Twoim zadaniem NIE jest napisanie ani poprawienie opinii, lecz jej OCENA wobec rubryki. " +
  "ZASADY BEZWZGLĘDNE: " +
  "(1) Oceniaj wyłącznie na podstawie przekazanego TEKSTU OPINII, WYKAZU METRYK i podanej daty zdarzenia. " +
  "(2) Każdą liczbę z opinii traktuj jako niepotwierdzoną, jeśli nie odnajdujesz jej w wykazie metryk — " +
  "zgłoś to przy kryterium „pokrycie”. " +
  "(3) Sprawdź DATY obowiązywania powołanych przepisów wobec daty zdarzenia; akt późniejszy zgłoś " +
  "przy kryterium „stan_prawny” niezależnie od tego, jak trafna jest reszta wywodu. " +
  "(4) Nie chwal. Uwaga ma wskazywać KONKRETNY brak (rozdział + czego brakuje), inaczej jest bezużyteczna. " +
  "(5) Nie rozstrzygaj, czy bank postąpił prawidłowo — to rola biegłego, a kwalifikacja czynu należy do organu. " +
  "(6) Odpowiadasz WYŁĄCZNIE wywołaniem narzędzia oceń_opinie.";
