import { DOC_TYPES, RULES, type DocType } from "./taxonomy";

// Klasyfikacja ścieżki/nazwy pliku. Normalizujemy do NFC (macOS trzyma nazwy
// w NFD — bez tego polskie 'ł'/'ą' nie pasują do reguł).
export function classifyPath(relpath: string): string {
  const low = relpath.normalize("NFC").toLowerCase();
  for (const { phrases, code } of RULES) {
    if (phrases.some((p) => low.includes(p))) return code;
  }
  return "UNKNOWN";
}

export function classify(relpath: string): { code: string } & DocType {
  const code = classifyPath(relpath);
  return { code, ...DOC_TYPES[code] };
}
