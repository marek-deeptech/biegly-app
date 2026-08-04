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

/**
 * Ile fragmentów doktryny trafia do promptu i jak długi może być każdy.
 *
 * ⚠️ BUDŻET JEST PER ROZDZIAŁ, NIE GLOBALNY. Rozdział o technice manipulacji
 * potrzebuje czterech cytatów — definicji techniki i jej przesłanek. Rozdział
 * o otoczeniu prawnym jest przeglądem CAŁEGO reżimu ostrożnościowego i przy tych
 * samych czterech dawał 5 665 znaków, podczas gdy wzorzec (opinia MBR, rozdz. L)
 * ma 47 347. Materiału nie brakowało: pasujących fragmentów było 412, do promptu
 * szły cztery.
 *
 * Podniesienie limitu GLOBALNIE rozdęłoby prompty spraw manipulacyjnych, które
 * toczą się w sądzie i mają dostrojone rozdziały — a przy okazji podniosłoby ich
 * koszt. Dlatego wyjątek jest imienny.
 *
 * `naZrodlo` chroni przed monokulturą: bez niego jedna monografia mogłaby obsadzić
 * cały rozdział, co w opinii sądowej wygląda jak streszczenie jednej książki
 * zamiast przeglądu piśmiennictwa.
 */
/**
 * `przegladowy` zmienia ROLĘ materiału referencyjnego w prompcie: w rozdziale
 * przeglądowym doktryna jest treścią wykładu, a nie przypisem kontrolnym.
 *
 * ⚠️ ZMIERZONY EFEKT: ŻADEN. Po podniesieniu budżetu z 4 na 24 fragmenty rozdział
 * urósł z 5 665 na ~10 100 znaków; dodanie tej flagi nie zmieniło ani długości, ani
 * doboru cytatów. Zostaje, bo instrukcja jest merytorycznie poprawna, ale NIE JEST
 * dźwignią — kto będzie szukał dalszego wzrostu, niech nie zaczyna stąd.
 *
 * Właściwe ograniczenia ustalone pomiarem, w kolejności wagi:
 * 1. Do budżetu wchodzą prawie wyłącznie AKTY PRAWNE (ranga 5), bo sortowanie po
 *    randze wypycha monografie (ranga 3). Bloki 2–3 wzorca MBR — teoria Bazylei II,
 *    proces zarządzania ryzykiem, rola komitetu ALCO — stoją właśnie na monografiach,
 *    więc przy obecnym sortowaniu nie mają jak powstać.
 * 2. Teksty aktów w repozytorium są w wersji SKONSOLIDOWANEJ NA DZIŚ (fragment CRR
 *    nosi nagłówek „02013R0575 — PL — 09.07.2024"), a opinia ocenia stan na
 *    2015-03-16. Do rozdziału o stanie prawnym w dacie zdarzenia to materiał
 *    anachroniczny i wymaga wersji na tamten dzień.
 */
type Budzet = {
  fragmentow: number;
  znakow: number;
  naZrodlo: number;
  przegladowy?: boolean;
  /** Ułamek budżetu zarezerwowany dla monografii i artykułów (ranga ≤ 3). */
  piśmiennictwoUdzial?: number;
};
const BUDZET_DOMYSLNY: Budzet = { fragmentow: 4, znakow: 1400, naZrodlo: 2 };
const BUDZET: Record<string, Budzet> = {
  // Przegląd reżimu prawnego: ustrój sektora, ramy ostrożnościowe, teoria ryzyka.
  otoczenie_prawne: {
    fragmentow: 24, znakow: 2200, naZrodlo: 6, przegladowy: true, piśmiennictwoUdzial: 0.5,
  },
  // Wstęp teoretyczny — ta sama rola przeglądowa, rozdział III.
  proza_iii: {
    fragmentow: 16, znakow: 2000, naZrodlo: 5, przegladowy: true, piśmiennictwoUdzial: 0.5,
  },
};
const budzetDla = (rodzaj: string): Budzet => BUDZET[rodzaj] ?? BUDZET_DOMYSLNY;

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
  // ⚠️ `ryzyko_kredytowe` DOPISANE. Blok 3 wzorca (opinia MBR, rozdz. L) to wykład
  // standardu identyfikacji ryzyka kredytowego — czym ono jest, jak wygląda proces
  // zarządzania nim, co odpowiada komitet ALCO. Bez tego tagu do rozdziału trafiały
  // wyłącznie akty prawne i jedna monografia, bo trzy pozostałe pozycje o ryzyku
  // kredytowym (56 fragmentów) są otagowane właśnie nim, a nie `zarzadzanie_ryzykiem`.
  otoczenie_prawne: ["nadzor", "zarzadzanie_ryzykiem", "ryzyko_kredytowe", "ogolne_bank"],
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
  budzet: Budzet = BUDZET_DOMYSLNY,
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
  // `limit` liczy DODANE, nie przejrzane. Wersja obcinająca pulę przez `slice(0, N)`
  // przed nałożeniem limitu na źródło dawała 6 zamiast 12: pierwsze dwanaście pozycji
  // piśmiennictwa pochodziło z jednej monografii, sześć odpadło na `naZrodlo`,
  // a okno było już zużyte.
  const dobierz = (pula: T[], limit = budzet.fragmentow) => {
    let dodane = 0;
    for (const f of pula) {
      if (dodane >= limit || wybrane.length >= budzet.fragmentow) return;
      if (wybrane.includes(f)) continue;
      const klucz = f.wiedza_zrodla?.tytul ?? "?";
      if ((zeZrodla.get(klucz) ?? 0) >= budzet.naZrodlo) continue;
      zeZrodla.set(klucz, (zeZrodla.get(klucz) ?? 0) + 1);
      wybrane.push(f);
      dodane += 1;
    }
  };

  // ⚠️ KWOTA DLA PIŚMIENNICTWA W ROZDZIAŁACH PRZEGLĄDOWYCH.
  // Sortowanie po randze stawia akty prawne (5) przed monografiami (3), więc przy
  // budżecie 24 fragmentów rozdział o otoczeniu prawnym dostawał 24 wyciągi
  // z CRR, CRD IV i Prawa bankowego, a ani jednego z czterech monografii o ryzyku
  // kredytowym. To nie jest usterka rankingu — dla rozdziału o technice manipulacji
  // pierwszeństwo przepisu jest słuszne. Ale wzorzec (opinia MBR, rozdz. L) buduje
  // dwa ze swoich pięciu bloków — teorię ryzyka kredytowego i rolę komitetu ALCO —
  // WYŁĄCZNIE z piśmiennictwa. Bez gwarantowanego udziału nie mają jak powstać,
  // a rozdział zostaje wykazem artykułów zamiast wykładem standardu.
  if (budzet.piśmiennictwoUdzial) {
    const ile = Math.floor(budzet.fragmentow * budzet.piśmiennictwoUdzial);
    dobierz(posortowane.filter((f) => (f.wiedza_zrodla?.ranga ?? 5) <= 3), ile);
  }
  dobierz(posortowane);
  return wybrane;
}

/**
 * Skrót aktu prawnego do przypisu. Akty nie mają autora, więc bez tego przypis
 * brzmiał „Dyrektywa 2013/36/UE w sprawie warunków 2013, s. 1–2" — obcięty tytuł
 * skleja się z rokiem w bełkot. Opinia sądowa powołuje akt skrótem zwyczajowym.
 */
function skrotAktu(tytul: string): string {
  // Skrót zwyczajowy podany w nawiasie na końcu tytułu: „… (CRR)", „… (CRD IV)".
  const wNawiasie = tytul.match(/\(([A-Z][A-Za-z0-9\s]{1,12})\)\s*$/);
  if (wNawiasie) return wNawiasie[1].trim();
  // Ustawa z myślnikiem: „Ustawa z dnia … — Prawo bankowe" → „Prawo bankowe".
  const poMyslniku = tytul.match(/[—–-]\s*([^—–]+)$/);
  if (poMyslniku && poMyslniku[1].length < 40) return poMyslniku[1].trim();
  // Ustawa opisowa: „Ustawa … o funkcjonowaniu banków spółdzielczych …" → „ustawa o …".
  const oCzym = tytul.match(/\bo\s+([^,]{6,44})/);
  if (/^ustawa/i.test(tytul) && oCzym) return `ustawa o ${oCzym[1].trim()}`;
  return tytul.slice(0, 40);
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
    : z?.tytul ? skrotAktu(z.tytul)
    : "źródło";
  // Akt prawny bez autora — rok publikacji pierwotnej w przypisie tylko myli
  // (CRR z 2013 w wersji z 2024). Skrót aktu wystarcza do jednoznacznego wskazania.
  const rok = z?.rok && czlony.length ? ` ${z.rok}` : "";
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
  const budzet = budzetDla(rodzaj);
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

    const idy = wybierz(meta, tagi, budzet).map((m) => m.id);
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

  const bloki = wybierz(rows, tagi, budzet).map((f) => {
    const t = f.tresc.length > budzet.znakow ? `${f.tresc.slice(0, budzet.znakow)}…` : f.tresc;
    return `[${cytat(f)}]\n${t}`;
  });

  return [
    "## MATERIAŁ REFERENCYJNY (doktryna i przepisy)",
    "",
    "Poniższe fragmenty pochodzą z literatury przedmiotu i materiałów organu nadzoru.",
    budzet.przegladowy
      ? "STANOWIĄ TREŚĆ TEGO ROZDZIAŁU. Rozdział przeglądowy referuje reżim prawny i standard "
        + "postępowania, więc doktryna nie jest tu przypisem kontrolnym, lecz materiałem "
        + "wykładu — omów ją, a nie tylko sprawdź się z nią."
      : "Służą WYŁĄCZNIE do poprawnego ujęcia definicji, przesłanek i kwalifikacji prawnej techniki.",
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
