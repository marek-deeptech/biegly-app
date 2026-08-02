// Klasyfikacja dokumentów Z TREŚCI, nie z nazwy pliku.
//
// DLACZEGO TO MUSI ISTNIEĆ OBOK `classifyPath`
// Reguły nazewnicze działają, dopóki akta przychodzą z nazwami mówiącymi cokolwiek
// („metodyka limitow.pdf", „protokoły KZAiP.pdf"). W sprawie SKOK (RP I Ds 22.2016)
// wszystkie 33 dokumenty to skany z nazwami nadanymi przez skaner —
// `SKM_C451i26080211200.pdf` — z których nie wynika NIC. Klasyfikator nazewniczy
// oznaczył komplet jako „Niesklasyfikowany", a plik niesklasyfikowany wypada
// z warsztatu i z kompletności: analiza patrzy wtedy na puste akta i o tym milczy.
//
// KOLEJNOŚĆ JEST WYMUSZONA: OCR → klasyfikacja z treści → analiza. Bez warstwy
// tekstowej nie ma czego czytać, a klasyfikacja po nazwie skanera zwraca szum.
import type { DocType } from "@/lib/intake/taxonomy";

export type WejscieKlasyfikacji = {
  /** Identyfikator wiersza `documents` — wraca w odpowiedzi, żeby dało się zapisać. */
  id: string;
  nazwa: string;
  /** Początek treści po OCR. */
  tekst: string;
};

export type WynikKlasyfikacji = {
  id: string;
  typ: string;
  /** 0–1. Poniżej progu zostawiamy UNKNOWN — zła etykieta jest gorsza niż jej brak. */
  pewnosc: number;
  /** Czym jest ten dokument — jedno zdanie dla biegłego w liście plików. */
  opis: string;
  /** Data widniejąca na dokumencie (YYYY-MM-DD), gdy jest czytelna. */
  data?: string;
  /** Kto sporządził/podpisał — z nagłówka, pieczęci, podpisu. */
  wytworca?: string;
  /** Numer karty akt, gdy widoczny na skanie. */
  karta?: number;
};

/** Poniżej tej pewności zostawiamy UNKNOWN i oddajemy decyzję biegłemu. */
export const PROG_PEWNOSCI = 0.6;

/** Kontekst sprawy — decyduje o pierwszeństwie typów i o nazewnictwie postępowania. */
export type KontekstKlasyfikacji = {
  /**
   * Kody typów właściwych DZIEDZINIE sprawy. Mają pierwszeństwo przed rdzeniem
   * ogólnoprocesowym — patrz komentarz przy regule (6).
   */
  dziedzinowe?: string[];
  /** Tryb postępowania, żeby prompt nie nazywał sprawy cywilnej karną. */
  tryb?: string | null;
};

export function buildKlasyfikacjaPrompt(
  typy: Record<string, DocType>,
  dokumenty: WejscieKlasyfikacji[],
  kontekst: KontekstKlasyfikacji = {},
): { system: string; user: string } {
  const dziedzinowe = new Set(kontekst.dziedzinowe ?? []);
  const wiersz = ([kod, t]: [string, DocType]) => `- ${kod}: ${t.label} (źródło: ${t.source})`;
  const wpisy = Object.entries(typy).filter(([k]) => k !== "UNKNOWN");
  const dzied = wpisy.filter(([k]) => dziedzinowe.has(k)).map(wiersz);
  const rdzen = wpisy.filter(([k]) => !dziedzinowe.has(k)).map(wiersz);

  // Bez podziału na sekcje model dostaje jedną listę ~54 kodów, w której typ
  // dziedzinowy i ogólnoprocesowy są równorzędne — i wybiera raz jeden, raz drugi.
  const katalog = dzied.length
    ? [
        "TYPY DZIEDZINOWE — mają PIERWSZEŃSTWO:",
        ...dzied,
        "",
        "TYPY OGÓLNOPROCESOWE — wybierz dopiero wtedy, gdy żaden dziedzinowy nie pasuje:",
        ...rdzen,
      ].join("\n")
    : rdzen.join("\n");

  const postepowanie = kontekst.tryb === "cywilne" ? "sprawy cywilnej" : "sprawy karnej";

  const system =
    `Jesteś asystentem biegłego sądowego. Klasyfikujesz dokumenty z akt ${postepowanie} na podstawie ` +
    "ICH TREŚCI — nagłówków, pieczęci, podpisów, formuł urzędowych. Nazwa pliku nie niesie informacji " +
    "(to skany z automatycznymi nazwami) i nie wolno się nią sugerować. " +
    "ZASADY BEZWZGLĘDNE: " +
    "(1) Tekst pochodzi z OCR skanów i bywa zniekształcony — rozpoznawaj mimo literówek, ale NIE zgaduj " +
    "na siłę. (2) Gdy nie masz pewności, zwróć typ UNKNOWN z niską pewnością; błędna etykieta jest gorsza " +
    "niż jej brak, bo dokument trafia wtedy do analizy jako coś, czym nie jest. " +
    "(3) `opis` to JEDNO zdanie mówiące, czym dokument JEST (np. „Uchwała zarządu kasy nr 12/2014 " +
    "o zatwierdzeniu regulaminu kredytowego”), a nie streszczenie treści. " +
    "(4) `data`, `wytworca` i `karta` podawaj WYŁĄCZNIE gdy widnieją w dokumencie — nie wyprowadzaj ich " +
    "z kontekstu ani z innych dokumentów. " +
    // ⚠️ REGUŁA WYPROWADZONA Z BŁĘDU. W sprawie SK Banku wystąpienie pokontrolne NIK
    // dotyczące nadzoru KNF nad bankiem trafiło do KORESPONDENCJI, a fragment TEGO
    // SAMEGO raportu — do NADZOR_KNF. Oba typy pasowały, więc wybór był losowy.
    // Skutek: raport kompletności nie widział materiałów nadzoru, czyli rdzenia akt.
    "(5) FORMA DOKUMENTU NIE PRZESĄDZA TYPU. To, że materiał ma postać pisma, nie czyni go " +
    "korespondencją, jeżeli jego treścią jest ustalenie organu nadzoru, sprawozdanie albo umowa. " +
    "Gdy dokument pasuje jednocześnie do typu dziedzinowego i ogólnoprocesowego, wybierz DZIEDZINOWY. " +
    "(6) Odpowiadasz WYŁĄCZNIE obiektem JSON.";

  const user = [
    "Katalog typów dokumentów tej dziedziny — wybierz kod z tej listy albo UNKNOWN:",
    katalog,
    "",
    `Dokumenty do sklasyfikowania (${dokumenty.length}). Dla KAŻDEGO zwróć jeden wpis.`,
    ...dokumenty.map(
      (d, i) => `\n### ${i + 1}. id=${d.id} (plik: ${d.nazwa})\n${d.tekst}`,
    ),
    "",
    'Zwróć: {"wyniki":[{"id":"","typ":"","pewnosc":0.0,"opis":"","data":"","wytworca":"","karta":0}]}',
    "Pola `data`, `wytworca`, `karta` pomiń, gdy nie widnieją w dokumencie.",
  ].join("\n");

  return { system, user };
}

/**
 * Odsiew wyników niepewnych.
 *
 * Model potrafi zwrócić kod spoza katalogu (np. wymyślony albo z drugiej dziedziny),
 * a wtedy dokument dostałby typ, którego aplikacja nie zna — w liście plików pokazałby
 * się surowy kod, a w warsztacie nie trafiłby nigdzie. Kod spoza katalogu traktujemy
 * jak brak rozpoznania.
 */
export function przefiltruj(
  wyniki: WynikKlasyfikacji[],
  typy: Record<string, DocType>,
): { przyjete: WynikKlasyfikacji[]; odrzucone: { id: string; powod: string }[] } {
  const przyjete: WynikKlasyfikacji[] = [];
  const odrzucone: { id: string; powod: string }[] = [];
  for (const w of wyniki) {
    if (!w?.id) continue;
    if (w.typ === "UNKNOWN" || !typy[w.typ]) {
      odrzucone.push({ id: w.id, powod: typy[w.typ] ? "model nie rozpoznał" : `typ spoza katalogu: ${w.typ}` });
      continue;
    }
    if ((w.pewnosc ?? 0) < PROG_PEWNOSCI) {
      odrzucone.push({ id: w.id, powod: `pewność ${(w.pewnosc ?? 0).toFixed(2)} poniżej progu` });
      continue;
    }
    przyjete.push(w);
  }
  return { przyjete, odrzucone };
}
