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

export function classify(relpath: string, typ?: string | null): { code: string } & DocType {
  const code = classifyPath(relpath, typ);
  return { code, ...docTypesDla(typ)[code] };
}
