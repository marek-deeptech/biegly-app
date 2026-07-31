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

/** Ile fragmentów trafia do promptu i jak długi może być każdy. */
const MAX_FRAGMENTOW = 4;
const MAX_ZN_FRAGMENTU = 1400;

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
 * Zwraca blok promptu z fragmentami doktryny dotyczącymi danej techniki.
 *
 * Dobór jest DWUSTOPNIOWY, bo sama zgodność tagów nie wystarcza: słownictwo technik
 * jest w polskiej literaturze rzadkie („wash" pada 10 razy na milion znaków), więc
 * po dopasowaniu tagów uzupełniamy wynik wyszukiwaniem pełnotekstowym po nazwie
 * techniki. Kolejność wewnątrz wyniku wyznacza ranga źródła — przy rozbieżności
 * doktryny z przepisem lub stanowiskiem organu nadzoru pierwszeństwo ma ten drugi.
 *
 * Zwraca `null`, gdy brak wiedzy dla techniki albo brak migracji 0009 — wtedy prompt
 * zostaje bez zmian (degradacja łagodna, tak jak przy `wzorce` i `korekty`).
 */
export async function buildWiedzaBlock(
  supabase: SupabaseClient,
  technika: string,
  fraza?: string,
): Promise<string | null> {
  const kolumny = "tresc,strona_od,strona_do,techniki,wiedza_zrodla(tytul,autor,rok,ranga)";
  let rows: Fragment[] = [];

  try {
    const { data, error } = await supabase
      .from("wiedza")
      .select(kolumny)
      .contains("techniki", [technika])
      .eq("aktywny", true)
      .limit(24);
    if (error) return null; // brak migracji 0009 — cicho, bez wywracania redakcji
    rows = (data ?? []) as unknown as Fragment[];
  } catch {
    return null;
  }

  // Uzupełnienie pełnotekstowe, gdy tagów jest mało. `fraza` pozwala zawęzić do
  // terminu z rozdziału (np. „marking the close"), gdy sam tag daje zbyt szeroki wynik.
  if (rows.length < MAX_FRAGMENTOW && fraza) {
    try {
      const { data } = await supabase
        .from("wiedza")
        .select(kolumny)
        .eq("aktywny", true)
        .ilike("tresc", `%${fraza}%`)
        .limit(12);
      const znane = new Set(rows.map((r) => r.tresc.slice(0, 80)));
      for (const r of (data ?? []) as unknown as Fragment[]) {
        if (!znane.has(r.tresc.slice(0, 80))) rows.push(r);
      }
    } catch {
      /* uzupełnienie jest opcjonalne — brak wyniku nie jest błędem */
    }
  }

  if (!rows.length) return null;

  // Ranga malejąco, a przy równej randze dłuższy fragment (więcej kontekstu).
  rows.sort(
    (a, b) =>
      (b.wiedza_zrodla?.ranga ?? 0) - (a.wiedza_zrodla?.ranga ?? 0) ||
      b.tresc.length - a.tresc.length,
  );

  const wybrane = rows.slice(0, MAX_FRAGMENTOW);
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
