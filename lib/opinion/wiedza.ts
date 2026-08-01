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

/**
 * PROFIL DOKTRYNY DZIEDZINY BANKOWEJ — OSOBNA mapa, nie dopisek do PROFIL.
 *
 * Rozdzielenie jest celowe i twarde: gdyby profile dzieliły jedną strukturę,
 * dopisanie tagu dla modułu bankowego mogłoby zmienić dobór materiału w sprawach
 * o manipulację. Zmiana w jednej dziedzinie ma NIE MÓC wpłynąć na drugą.
 *
 * Tagi odpowiadają modułom pakietu `ryzyko_bankowe` (lib/domain).
 */
const PROFIL_BANK: Record<string, string[]> = {
  proza_i: ["ogolne_bank"],
  proza_iii: ["ogolne_bank", "ryzyko_kredytowe", "adekwatnosc", "nadzor"],
  proza_v: ["ogolne_bank"],
  wnioski: ["ogolne_bank", "ryzyko_kredytowe"],
  makro: ["makro", "ogolne_bank"],
  sygnaly_rynkowe: ["ryzyko_kredytowe", "rating", "ogolne_bank"],
  media: ["ogolne_bank"],
  ekspozycja_sektor: ["nadzor", "ogolne_bank"],
  sprawozdania: ["sprawozdawczosc", "adekwatnosc", "ogolne_bank"],
  adekwatnosc: ["adekwatnosc", "fundusze_wlasne", "ogolne_bank"],
  limity: ["limity", "ryzyko_kredytowe", "ogolne_bank"],
  procedury: ["zarzadzanie_ryzykiem", "nadzor", "ogolne_bank"],
  otoczenie_prawne: ["nadzor", "zarzadzanie_ryzykiem", "ogolne_bank"],
};

type Fragment = {
  tresc: string;
  strona_od: number | null;
  strona_do: number | null;
  techniki: string[];
  wiedza_zrodla: {
    tytul: string;
    autor: string | null;
    rok: number | null;
    ranga: number;
    dziedzina?: string | null;
  } | null;
};

/**
 * Wybór fragmentów do promptu — ranking trójstopniowy plus limit na źródło.
 *
 * Działa na PEŁNYM zbiorze pasujących fragmentów, nie na oknie zapytania: to
 * właśnie ucięcie przed rankingiem sprawiało, że materiał organu nadzoru nigdy
 * nie docierał do promptu.
 *
 * 1. Trafność tagu przed rangą źródła — fragment o layeringu z artykułu jest dla
 *    rozdziału o layeringu lepszy niż ogólny fragment od organu nadzoru.
 * 2. Przy równej trafności rozstrzyga ranga (przepis i organ przed monografią).
 * 3. Najwyżej 2 fragmenty z jednego źródła — inaczej monografia (335 z 396
 *    fragmentów) wypełniłaby każdy blok sama.
 */
function wybierz<T extends { techniki: string[]; tresc?: string; wiedza_zrodla: Fragment["wiedza_zrodla"] }>(
  rows: T[],
  tagi: string[],
): T[] {
  const trafnosc = (f: T) => {
    const idx = f.techniki.map((t) => tagi.indexOf(t)).filter((i) => i >= 0);
    return idx.length ? Math.min(...idx) : tagi.length;
  };
  const posortowane = [...rows].sort(
    (a, b) =>
      trafnosc(a) - trafnosc(b) ||
      (b.wiedza_zrodla?.ranga ?? 0) - (a.wiedza_zrodla?.ranga ?? 0) ||
      (b.tresc?.length ?? 0) - (a.tresc?.length ?? 0),
  );
  const zeZrodla = new Map<string, number>();
  const wybrane: T[] = [];
  for (const f of posortowane) {
    const klucz = f.wiedza_zrodla?.tytul ?? "?";
    if ((zeZrodla.get(klucz) ?? 0) >= 2) continue;
    zeZrodla.set(klucz, (zeZrodla.get(klucz) ?? 0) + 1);
    wybrane.push(f);
    if (wybrane.length >= MAX_FRAGMENTOW) break;
  }
  return wybrane;
}

/** „Martysz 2015, s. 120–121" — postać, w jakiej przypis ma trafić do opinii. */
function cytat(f: Fragment): string {
  const z = f.wiedza_zrodla;
  // Ostatnie słowo to nazwisko TYLKO przy autorze osobowym („Czesław Martysz" →
  // „Martysz"). Przy autorze instytucjonalnym dawało „Finansowego 2024" zamiast
  // „Urząd Komisji Nadzoru Finansowego 2024" — przypis nie do przyjęcia w opinii.
  const czlony = z?.autor?.trim().split(/\s+/) ?? [];
  const nazwisko =
    czlony.length === 2 ? czlony[1]
    : czlony.length ? czlony.join(" ")
    : z?.tytul?.slice(0, 40) ?? "źródło";
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
  typSprawy?: string | null,
): Promise<string | null> {
  const bankowa = typSprawy === "ryzyko_bankowe";
  const tagi = bankowa
    ? PROFIL_BANK[rodzaj] ?? [rodzaj, "ogolne_bank"]
    : PROFIL[rodzaj as RodzajRozdzialu] ?? [rodzaj, "ogolne"];
  const kolumny = "tresc,strona_od,strona_do,techniki,wiedza_zrodla!inner(tytul,autor,rok,ranga,dziedzina)";
  // SEPARACJA DZIEDZIN — filtr, nie sortowanie. Fragment Prawa bankowego otagowany
  // `ogolne` trafiłby bez tego do rozdziału teoretycznego opinii o manipulacji na
  // GPW, a fragment o wash trades — do opinii o ryzyku kredytowym banku. Dopuszczamy
  // wyłącznie dziedzinę sprawy plus materiały jawnie ponaddziedzinowe.
  const dziedziny = [bankowa ? "ryzyko_bankowe" : "manipulacja_gpw", "wspolna"];
  let rows: Fragment[] = [];

  // DWA PRZEBIEGI, nie jeden z limitem. Pojedyncze zapytanie z `.limit(N)` ucina wynik
  // PRZED rankingiem — a kolejność bez `order` jest fizyczna, więc decyduje o niej to,
  // co wgrano najpierw. Materiał UKNF (ranga 4, najwyższa) wgrany jako trzeci, po 335
  // fragmentach monografii, nie mieścił się w oknie i NIGDY nie trafiał do promptu.
  // Przebieg 1 pobiera same metadane (bez treści) i ustala wybór na pełnym zbiorze;
  // przebieg 2 dociąga treść wyłącznie wybranych fragmentów.
  try {
    const { data, error } = await supabase
      .from("wiedza")
      .select("id,techniki,wiedza_zrodla!inner(tytul,ranga,dziedzina)")
      .overlaps("techniki", tagi)
      .in("wiedza_zrodla.dziedzina", dziedziny)
      .eq("aktywny", true);
    if (error) return null; // brak migracji 0009 — cicho, bez wywracania redakcji
    const meta = (data ?? []) as unknown as (Fragment & { id: string })[];
    if (!meta.length) return null;

    const idy = wybierz(meta, tagi).map((m) => m.id);
    if (!idy.length) return null;

    const { data: pelne, error: e2 } = await supabase
      .from("wiedza")
      .select(kolumny)
      .in("wiedza_zrodla.dziedzina", dziedziny)
      .in("id", idy);
    if (e2) return null;
    rows = (pelne ?? []) as unknown as Fragment[];
  } catch {
    return null;
  }

  if (!rows.length) return null;

  const bloki = wybierz(rows, tagi).map((f) => {
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
