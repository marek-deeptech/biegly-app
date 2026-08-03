import { DOC_TYPES, RULES, type DocType } from "./taxonomy";
import { DOC_TYPES_BANK, RULES_BANK } from "@/lib/domain/taxonomy-bank";

// Klasyfikacja ścieżki/nazwy pliku. Normalizujemy do NFC (macOS trzyma nazwy
// w NFD — bez tego polskie 'ł'/'ą' nie pasują do reguł).
//
// Zestaw reguł zależy od dziedziny sprawy. Domyślny (brak typu) to GPW — trzy
// sprawy założone przed migracją 0010 nie mają typu, a ich klasyfikacja działa
// i nie wolno jej ruszyć. Reguły bankowe są OSOBNĄ listą, nie dopiskiem do
// wspólnej: doklejanie fraz ryzykowałoby regresję na działających sprawach.
export function classifyPath(relpath: string, typ?: string | null): string {
  const low = relpath.normalize("NFC").toLowerCase();
  if (typ === "ryzyko_bankowe") {
    // Nazwy w aktach bankowych mieszają separatory („Ryzyko_kredytowe",
    // „zarządzanie-ryzykiem-kredytowym"), więc dopasowujemy też wariant
    // z ujednoliconymi separatorami. Reguły GPW celowo tego NIE robią — opierają
    // się na podkreśleniach (utp_, _zlec, ip_all) i takie spłaszczenie by je zepsuło.
    const plaski = low.replace(/[_-]+/g, " ");
    for (const { phrases, code } of RULES_BANK) {
      if (phrases.some((p) => low.includes(p) || plaski.includes(p))) return code;
    }
    return "UNKNOWN";
  }
  for (const { phrases, code } of RULES) {
    if (phrases.some((p) => low.includes(p))) return code;
  }
  return "UNKNOWN";
}

/** Etykiety typów — rdzeń wspólny plus typy dziedzinowe. */
export function docTypesDla(typ?: string | null): Record<string, DocType> {
  return typ === "ryzyko_bankowe" ? { ...DOC_TYPES, ...DOC_TYPES_BANK } : DOC_TYPES;
}

/**
 * Kody typów WŁAŚCIWYCH dziedzinie — reszta katalogu to rdzeń ogólnoprocesowy.
 *
 * Potrzebne klasyfikacji z treści: sprawa bankowa dostaje oba katalogi naraz (~54 kody),
 * w których „pismo organu nadzoru" pasuje i do NADZOR_KNF, i do KORESPONDENCJI. Bez
 * wskazania, który zestaw jest właściwy dziedzinie, wybór bywał losowy — w aktach
 * SK Banku wystąpienie pokontrolne NIK i fragment tego samego raportu dostały różne typy.
 *
 * Dla dziedziny GPW zwraca pustą listę: jej katalog JEST rdzeniem, więc prompt
 * zostaje jednolisty i klasyfikacja trzech spraw sprzed migracji 0010 się nie zmienia.
 */
/**
 * Kody dokumentów, które POZYSKUJE BIEGŁY, a nie przynoszą akta.
 *
 * Ich brak nie jest luką dowodową: w opinii MBR artykuły prasowe i raporty banku
 * centralnego weszły jako załączniki nr 1–4, bo biegły je wyszukał w źródłach
 * powszechnie dostępnych. Rozdział o publikacjach prasowych ma więc dwa różne
 * stany pustki — „nie ma i nie będzie" oraz „jeszcze nie pozyskano".
 */
export function typyPozyskiwanePrzezBieglego(typ?: string | null): string[] {
  return Object.entries(typyKlasyfikacji(typ))
    .filter(([, d]) => d.pozyskanie === "biegly")
    .map(([kod]) => kod);
}

export function typyDziedzinowe(typ?: string | null): string[] {
  return typ === "ryzyko_bankowe" ? Object.keys(DOC_TYPES_BANK) : [];
}

/**
 * Kody z rdzenia, których sprawie bankowej NIE WOLNO podsuwać — bo albo dublują typ
 * bankowy, albo opisują dane z rynku instrumentów, których w takich aktach nie ma.
 *
 * ⚠️ POWÓD EMPIRYCZNY. Zaświadczenie banku o stanie środków na rachunku depozytowym
 * dostało typ DANE_BROKERSKIE („Dane z firm inwestycyjnych"), a informacja dodatkowa
 * do sprawozdania SK Banku — SPRAWOZDANIE_FIN zamiast SPRAWOZDANIE_BANK. Sama reguła
 * pierwszeństwa w promptcie tego nie domyka: jeżeli kod bliźniaczy w ogóle jest na
 * liście, model po niego sięga. Wymóg kompletności pyta o typ bankowy i przestaje
 * widzieć dokument, który w aktach leży.
 */
const OBCE_BANKOWI = new Set([
  "SPRAWOZDANIE_FIN", "DANE_UTP", "DANE_TREM", "DANE_BROKERSKIE", "STOR", "SPEC_TECHNICZNA",
  "NOTOWANIA_REF", "RAPORT_ESPI_EBI", "ZAWIAD_STAN_POSIADANIA", "ANALIZA_OSINT", "DANE_IP",
  "OPINIA_UKNF", "OPINIA_BIEGLY_PROK",
]);

/**
 * Katalog PODSUWANY MODELOWI przy klasyfikacji z treści — węższy niż `docTypesDla`.
 *
 * Rozdzielenie jest celowe: etykiety muszą pozostać kompletne (dokument oznaczony
 * kiedyś kodem spoza tej listy dalej ma się wyświetlać poprawnie), a biegły w liście
 * plików wybiera z pełnego katalogu — to model potrzebuje listy bez pułapek.
 */
export function typyKlasyfikacji(typ?: string | null): Record<string, DocType> {
  const pelny = docTypesDla(typ);
  if (typ !== "ryzyko_bankowe") return pelny;
  return Object.fromEntries(Object.entries(pelny).filter(([k]) => !OBCE_BANKOWI.has(k)));
}

export function classify(relpath: string, typ?: string | null): { code: string } & DocType {
  const code = classifyPath(relpath, typ);
  return { code, ...docTypesDla(typ)[code] };
}
