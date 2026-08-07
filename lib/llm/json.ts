/**
 * Wyjęcie obiektu JSON z odpowiedzi modelu.
 *
 * ⚠️ POWÓD. Naiwne „od pierwszego `{` do ostatniego `}`" wywraca się, gdy model
 * dopisze cokolwiek po JSON-ie — a dopisuje. Przy czytaniu sprawozdania RSY S.A.
 * zwrócił obiekt, po nim akapit wyjaśnienia („Powyższy fragment dotyczy udziałów
 * posiadanych PRZEZ RSY S.A. …”), a po nim POPRAWIONY obiekt. Sklejenie obu dało
 * `SyntaxError` i cały bieg przepadał, choć poprawna odpowiedź była w treści.
 *
 * Bierzemy OSTATNI poprawny obiekt: gdy model się poprawia, poprawka jest na końcu.
 */
export function ostatniJson<T = unknown>(surowa: string): T | null {
  const tekst = surowa.replace(/```json/gi, "```").split("```").join("\n");
  const kandydaci: string[] = [];
  let glebokosc = 0;
  let start = -1;
  let wTekscie = false;
  let ucieczka = false;
  for (let i = 0; i < tekst.length; i += 1) {
    const z = tekst[i];
    if (wTekscie) {
      if (ucieczka) ucieczka = false;
      else if (z === "\\") ucieczka = true;
      else if (z === '"') wTekscie = false;
      continue;
    }
    if (z === '"') wTekscie = true;
    else if (z === "{") {
      if (glebokosc === 0) start = i;
      glebokosc += 1;
    } else if (z === "}") {
      glebokosc -= 1;
      if (glebokosc === 0 && start >= 0) {
        kandydaci.push(tekst.slice(start, i + 1));
        start = -1;
      }
      if (glebokosc < 0) glebokosc = 0; // niesparowane zamknięcie — ignorujemy
    }
  }
  for (let i = kandydaci.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(kandydaci[i]) as T;
    } catch {
      // niepełny albo uszkodzony kandydat — próbujemy wcześniejszego
    }
  }
  return null;
}
