// Wybór buildera opinii wg dziedziny sprawy.
//
// Jedno miejsce rozgałęzienia, żeby cztery trasy (widok, PDF, DOCX, audyt) nie
// powtarzały tego warunku — i żeby dodanie trzeciej dziedziny było zmianą w jednym
// pliku, a nie polowaniem na `if` po całej aplikacji.
import { buildOpinion, type Doc, type Metric, type Opinion, type StoredSub } from "./build";
import { buildOpinionBank } from "./build-bank";

export function buildOpinionDla(
  // ⚠️ `typ` JEST WYMAGANY, choć wartość może być null — i to celowo.
  // Gdy pole było opcjonalne, trzy trasy (.docx, .pdf, audyt) nie pobierały go
  // z bazy i kompilator tego nie zgłaszał. Efekt: eksport opinii bankowej cicho
  // spadał do buildera GPW i dawał dokument o szkielecie manipulacyjnym, bez ani
  // jednego rozdziału bankowego. Wymagalność zamienia ten błąd w błąd kompilacji.
  caseRow: { name: string; signature: string | null; typ: string | null; group_roster?: unknown },
  metrics: Metric[],
  documents: Doc[],
  stored: StoredSub[] = [],
): Opinion {
  if (caseRow.typ === "ryzyko_bankowe") {
    // Data zdarzenia pochodzi z warsztatu (Krok 4) — tam biegły ją podaje.
    const dzien =
      (stored.find((s) => s.kind === "limity")?.data as { dzienZdarzenia?: string | null } | undefined)
        ?.dzienZdarzenia ?? null;
    return buildOpinionBank(caseRow, metrics, documents, stored, dzien);
  }
  return buildOpinion(caseRow, metrics, documents, stored);
}
