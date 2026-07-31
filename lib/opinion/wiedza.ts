// REPOZYTORIUM WIEDZY — dobór doktryny i przepisów do rozdziału opinii.
//
// Trzecia, najbardziej zewnętrzna warstwa promptu redakcji (obok `wzorce` i `korekty`).
// Tamte dwie uczą, JAK biegły pisze. Ta dostarcza tego, CO wiadomo o technice
// manipulacji poza aktami konkretnej sprawy: definicji, przesłanek, kwalifikacji prawnej.
//
// ⚠️ GRANICA, KTÓREJ NIE WOLNO PRZEKROCZYĆ
// Wiedza jest jedynym kanałem, którym do opinii wchodzi treść spoza materiału
// dowodowego. Dlatego blok promptu jest sformułowany zakazowo: fragment doktryny
// opisujący CUDZY stan faktyczny nie może stać się ustaleniem w tej sprawie, a żadna
// liczba nie może pochodzić z literatury — liczby wychodzą wyłącznie z silnika.
// Bez tego repozytorium wiedzy zamieniłoby się w źródło zmyślonych faktów.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IvRedactKind } from "@/lib/opinion/redact";

/** Ile fragmentów trafia do promptu i jak długi może być każdy. */
const MAX_FRAGMENTOW = 4;
const MAX_ZN_FRAGMENTU = 1400;

/**
 * PROFIL DOKTRYNY — jakich tagów szukać dla danego rozdziału, w kolejności trafności.
 *
 * Bez tego repozytorium obsługiwało wyłącznie rozdziały o nazwie równej nazwie techniki,
 * czyli 7 z 15. Największe zbiory wiedzy (`ogolne` — 137 fragmentów ogólnej teorii
 * manipulacji) nie miały rozdziału, który by o nie zapytał, a rozdział III — u biegłego
 * 20 tys. znaków czystej doktryny i jedyny w całej opinii poświęcony teorii — dostawał zero.
 *
 * Rozdziały techniczne pytają najpierw o swój tag, potem o teorię ogólną: gdy monografia
 * poświęca danej technice mało miejsca (a poświęca — „wash" pada 10 razy na milion znaków),
 * lepszy jest fragment ogólny niż brak materiału.
 */
// Typ WYMUSZA komplet: dodanie techniki do katalogu bez wpisu tutaj nie skompiluje się.
// Dokładnie ten mechanizm — cicha luka zamiast błędu — sprawił, że `infomanip` wypadł
// z listy redakcji, a rozdziały I/III/V nie dostawały wzorca stylu przez wiele tygodni.
type RodzajRozdzialu = IvRedactKind | "proza_i" | "proza_iii" | "proza_v" | "wnioski";

const PROFIL: Record<RodzajRozdzialu, string[]> = {
  // Wstęp teoretyczny — przegląd całej problematyki, od ogółu do technik.
  proza_iii: ["ogolne", "infomanip", "wash", "layering", "pumpdump", "fixing", "concentration"],
  proza_i: ["ogolne"],
  proza_v: ["ogolne"],
  wnioski: ["ogolne"],
  // Moduły przeglądowe — bez własnej techniki MAR.
  ekofin: ["ogolne"],
  relacje: ["ogolne"],
  aktywnosc: ["concentration", "ogolne"],
  espi: ["infomanip", "ogolne"],
  // Techniki: własny tag, potem teoria ogólna jako uzupełnienie.
  wash: ["wash", "ogolne"],
  imo: ["imo", "wash", "ogolne"],
  layering: ["layering", "ogolne"],
  pumpdump: ["pumpdump", "ogolne"],
  fixing: ["fixing", "ogolne"],
  reversal: ["reversal", "concentration", "ogolne"],
  concentration: ["concentration", "ogolne"],
  infomanip: ["infomanip", "ogolne"],
};

type Fragment = {
  tresc: string;
  strona_od: number | null;
  strona_do: number | null;
  techniki: string[];
  wiedza_zrodla: { tytul: string; autor: string | null; rok: number | null; ranga: number } | null;
};

/** „Martysz 2015, s. 120–121" — postać, w jakiej przypis ma trafić do opinii. */
function cytat(f: Fragment): string {
  const z = f.wiedza_zrodla;
  const nazwisko = z?.autor?.split(/\s+/).slice(-1)[0] ?? z?.tytul?.slice(0, 40) ?? "źródło";
  const rok = z?.rok ? ` ${z.rok}` : "";
  const s =
    f.strona_od == null ? ""
    : f.strona_do && f.strona_do !== f.strona_od ? `, s. ${f.strona_od}–${f.strona_do}`
    : `, s. ${f.strona_od}`;
  return `${nazwisko}${rok}${s}`;
}

/**
 * Zwraca blok promptu z fragmentami doktryny właściwymi dla danego rozdziału.
 *
 * `rodzaj` to KLUCZ rozdziału (`proza_iii`, `wash`, `wnioski`…), nie jego numer —
 * profil rozwija go na listę tagów uporządkowaną wg trafności, bo słownictwo technik
 * jest w polskiej literaturze rzadkie i sam tag techniki często nie wystarcza.
 *
 * Zwraca `null`, gdy brak wiedzy dla rozdziału albo brak migracji 0009 — wtedy prompt
 * zostaje bez zmian (degradacja łagodna, tak jak przy `wzorce` i `korekty`).
 */
export async function buildWiedzaBlock(
  supabase: SupabaseClient,
  rodzaj: string,
): Promise<string | null> {
  const tagi = PROFIL[rodzaj as RodzajRozdzialu] ?? [rodzaj, "ogolne"];
  const kolumny = "tresc,strona_od,strona_do,techniki,wiedza_zrodla(tytul,autor,rok,ranga)";
  let rows: Fragment[] = [];

  try {
    const { data, error } = await supabase
      .from("wiedza")
      .select(kolumny)
      .overlaps("techniki", tagi)
      .eq("aktywny", true)
      .limit(60);
    if (error) return null; // brak migracji 0009 — cicho, bez wywracania redakcji
    rows = (data ?? []) as unknown as Fragment[];
  } catch {
    return null;
  }

  if (!rows.length) return null;

  // Ranking trójstopniowy. Trafność tagu PRZED rangą źródła: fragment o layeringu
  // z artykułu jest dla rozdziału o layeringu lepszy niż ogólny fragment z materiału
  // organu nadzoru. Dopiero przy równej trafności rozstrzyga ranga, a na końcu długość.
  const trafnosc = (f: Fragment) => {
    const idx = f.techniki.map((t) => tagi.indexOf(t)).filter((i) => i >= 0);
    return idx.length ? Math.min(...idx) : tagi.length;
  };
  rows.sort(
    (a, b) =>
      trafnosc(a) - trafnosc(b) ||
      (b.wiedza_zrodla?.ranga ?? 0) - (a.wiedza_zrodla?.ranga ?? 0) ||
      b.tresc.length - a.tresc.length,
  );

  // Nie więcej niż 2 fragmenty z jednego źródła — inaczej Martysz (335 z 400 fragmentów)
  // wypełniłby każdy blok sam i stanowisko organu nadzoru nigdy by się nie pokazało.
  const zeZrodla = new Map<string, number>();
  const wybrane: Fragment[] = [];
  for (const f of rows) {
    const klucz = f.wiedza_zrodla?.tytul ?? "?";
    if ((zeZrodla.get(klucz) ?? 0) >= 2) continue;
    zeZrodla.set(klucz, (zeZrodla.get(klucz) ?? 0) + 1);
    wybrane.push(f);
    if (wybrane.length >= MAX_FRAGMENTOW) break;
  }
  const bloki = wybrane.map((f) => {
    const t = f.tresc.length > MAX_ZN_FRAGMENTU ? `${f.tresc.slice(0, MAX_ZN_FRAGMENTU)}…` : f.tresc;
    return `[${cytat(f)}]\n${t}`;
  });

  return [
    "## MATERIAŁ REFERENCYJNY (doktryna i przepisy)",
    "",
    "Poniższe fragmenty pochodzą z literatury przedmiotu i materiałów organu nadzoru.",
    "Służą WYŁĄCZNIE do poprawnego ujęcia definicji, przesłanek i kwalifikacji prawnej techniki.",
    "",
    "ZASADY UŻYCIA — bezwzględne:",
    "1. NIE są materiałem dowodowym w tej sprawie. Stany faktyczne opisane w literaturze",
    "   dotyczą innych spraw i NIE MOGĄ być przedstawiane jako ustalenia w tej opinii.",
    "2. NIE wolno przenosić z nich ŻADNYCH liczb, dat, nazw podmiotów ani nazwisk.",
    "   Wszystkie wartości liczbowe w opinii pochodzą wyłącznie z wykazu metryk silnika.",
    "3. Odwołanie do doktryny formułuj WŁASNYMI SŁOWAMI i opatrz przypisem w postaci",
    "   podanej w nawiasie kwadratowym (autor, rok, strona). Nie przepisuj dłuższych",
    "   fragmentów — to materiały chronione prawem autorskim.",
    "4. Gdy fragment jest nieadekwatny do ustaleń tej sprawy — pomiń go. Lepiej nie",
    "   powołać doktryny niż powołać ją nietrafnie.",
    "",
    bloki.join("\n\n"),
  ].join("\n");
}
