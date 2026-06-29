// Budowa promptu dla redakcji rozdziałów „miękkich" (I, III, V) przez model.
// Zasada: model REDAGUJE prozę, ale NIE liczy i NIE wymyśla — liczby i fakty
// pochodzą z silnika i są wstrzykiwane do promptu; model ma ich nie zmieniać.
// Czysta funkcja (bez SDK), żeby dało się ją testować.

export type RedactChapter = "I" | "III" | "V";

export const REDACT_META: Record<RedactChapter, { kind: string; chapterNo: string; title: string }> = {
  I: { kind: "proza_i", chapterNo: "I", title: "Przedmiot opinii i podstawa prawna" },
  III: { kind: "proza_iii", chapterNo: "III", title: "Wstęp teoretyczny — techniki manipulacji" },
  V: { kind: "proza_v", chapterNo: "V", title: "Podsumowanie" },
};

export type RedactInput = {
  chapter: RedactChapter;
  caseName: string;
  signature: string | null;
  period: string | null;
  facts: string[]; // ugruntowane fakty liczbowe z silnika
  approved: { title: string; findings: string[] }[]; // zatwierdzone wnioski IV.x
  legalBasis: string[];
};

const SYSTEM =
  "Jesteś asystentem biegłego sądowego specjalizującego się w manipulacji instrumentami finansowymi na GPW. " +
  "Redagujesz fragment opinii dla prokuratury i sądu poprawną, formalną polszczyzną prawniczą. " +
  "ZASADY BEZWZGLĘDNE: " +
  "(1) Nie wymyślaj liczb, dat, nazw ani faktów — używaj wyłącznie danych podanych w poleceniu; liczby przepisuj dokładnie w tej samej postaci. " +
  "(2) Nie przesądzaj o winie, zamiarze ani o kwalifikacji prawnokarnej — to wyłączna domena sądu; oddzielaj ustalenia faktyczne od ocen. " +
  "(3) Czego nie wiesz, oznacz nawiasem kwadratowym, np. [oznaczenie spółki], [pytania postanowienia] — nigdy nie zmyślaj danych sprawy. " +
  "(4) Unikaj sformułowań przesądzających typu „jednoznacznie”, „bez wątpienia”, „udowodniono”. " +
  "(5) Zwróć wyłącznie treść rozdziału prozą, bez nagłówka i bez komentarzy od siebie.";

export function buildRedactPrompt(inp: RedactInput): { system: string; user: string } {
  const meta = REDACT_META[inp.chapter];
  const parts: string[] = [];
  parts.push(`Zredaguj rozdział „${meta.title}" opinii biegłego sądowego.`);
  parts.push(`Sprawa: ${inp.caseName}${inp.signature ? ` (sygn. ${inp.signature})` : ""}.`);
  if (inp.period) parts.push(`Okres objęty analizą: ${inp.period}.`);
  if (inp.facts.length)
    parts.push("Ustalone fakty liczbowe (z deterministycznego silnika — przepisz dokładnie, nie zmieniaj):\n" +
      inp.facts.map((f) => "- " + f).join("\n"));
  if (inp.approved.length)
    parts.push("Zatwierdzone wnioski cząstkowe z rozdziału IV:\n" +
      inp.approved.map((a) => `• ${a.title}: ${a.findings.join(" ")}`).join("\n"));
  parts.push("Podstawa prawna sprawy: " + inp.legalBasis.join("; ") + ".");

  if (inp.chapter === "I")
    parts.push(
      "Opisz przedmiot opinii oraz podstawę prawną. Czego nie wiesz — oznaczenie spółki i instrumentu, " +
        "dokładny okres oraz pytania postanowienia o powołaniu biegłego — oznacz w nawiasach kwadratowych. Nie zmyślaj.",
    );
  if (inp.chapter === "III")
    parts.push(
      "Napisz wstęp teoretyczny o technikach manipulacji instrumentem finansowym: transakcje wzajemne (wash trades), " +
        "layering i spoofing, niewłaściwe dopasowania zleceń (matched orders) oraz schemat pump&dump — w świetle art. 12 MAR " +
        "i wskaźników z załącznika II do rozporządzenia 2016/522. To rozdział OGÓLNY — nie odwołuj się do konkretnych liczb tej sprawy.",
    );
  if (inp.chapter === "V")
    parts.push(
      "Napisz podsumowanie syntetyzujące ustalenia analizy. Wyraźnie oddziel ustalenia faktyczne (co pokazują dane) od ocen " +
        "zastrzeżonych dla sądu (kwalifikacja prawnokarna, zamiar, wina konkretnych osób).",
    );

  parts.push("Objętość: 2–4 akapity. Styl: formalny, bezosobowy, prawniczy. Zwróć samą treść rozdziału.");
  return { system: SYSTEM, user: parts.join("\n\n") };
}
