// Bramka wersji FINALNEJ opinii.
//
// DLACZEGO ISTNIEJE
// `?final=1` był zwykłym parametrem w adresie i nie sprawdzał niczego. Dawało się
// pobrać „opinię finalną" złożoną wyłącznie ze szkiców — dokument bez adnotacji
// „(projekt roboczy)" i bez znaczników „szkic" pod nagłówkami, czyli wyglądający
// na gotowy, choć żadnego rozdziału biegły nie zatwierdził. Sprawa SK Banku ma
// dziś wszystkie rozdziały w statusie „szkic".
//
// GRANICA ODPOWIEDZIALNOŚCI
// Aplikacja nie ocenia, czy treść jest dobra — od tego jest biegły i audytor.
// Sprawdza wyłącznie to, co da się sprawdzić bez oceny: czy pod każdym rozdziałem
// stoi decyzja człowieka. Wersja robocza pozostaje dostępna bez żadnych warunków.

import type { Opinion } from "./build";

export type WynikBramki = { ok: true } | { ok: false; powod: string; rozdzialy: string[] };

/**
 * Rozdziały, których brak zatwierdzenia nie blokuje wersji finalnej.
 *
 * Spisy i załączniki powstają mechanicznie ze złożenia dokumentu — nie ma czego
 * w nich zatwierdzać, a rozdział „Analiza" jest samą zapowiedzią modułów.
 */
const MECHANICZNE = /spis|załącznik|zalacznik/i;

/**
 * Rozdziały wymagające zatwierdzenia. JEDNA definicja dla serwera i dla interfejsu —
 * gdyby przycisk liczył je inaczej niż bramka, biegły widziałby przycisk aktywny
 * i dostawał odmowę, albo odwrotnie.
 */
export function rozdzialyDoZatwierdzenia(op: Opinion): string[] {
  return op.chapters
    .filter((c) => c.no !== "—" && !MECHANICZNE.test(c.title))
    .filter((c) => c.status !== "ready")
    .map((c) => c.no);
}

export function sprawdzFinalna(op: Opinion): WynikBramki {
  const niegotowe = rozdzialyDoZatwierdzenia(op);
  if (!niegotowe.length) return { ok: true };
  return {
    ok: false,
    rozdzialy: niegotowe,
    powod:
      `Wersja finalna wymaga zatwierdzenia wszystkich rozdziałów merytorycznych. ` +
      `Niezatwierdzone (${niegotowe.length}): ${niegotowe.join(", ")}. ` +
      `Pobierz wersję roboczą albo zatwierdź rozdziały w Kroku 5.`,
  };
}
