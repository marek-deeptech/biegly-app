// PĘTLA UCZENIA STYLU BIEGŁEGO — przechwytywanie poprawek i ich zwrot do promptów.
//
// Model jest zamrożony: nie uczy się z akt ani z kolejnych spraw. Jedyną wiedzą
// eksperta, którą aplikacja może realnie zakumulować, jest RÓŻNICA między tym, co
// wygenerował model, a tym, co zatwierdził biegły. Ten moduł tę różnicę:
//   1. mierzy (czy zmiana jest istotna, czy to literówka) — `zmianaPct`,
//   2. zapisuje przy każdej ręcznej edycji prozy — `zapiszKorekte`,
//   3. zwraca do kolejnych redakcji jako przykłady few-shot — `buildStyleCorpus`.
//
// Efekt: z każdą poprawioną sprawą kolejne opinie są bliższe stylowi biegłego,
// BEZ trenowania modelu i bez wysyłania czegokolwiek poza dotychczasowy obieg.

import type { SupabaseClient } from "@supabase/supabase-js";

export type Korekta = {
  id?: string;
  kind: string;
  chapter_no: string;
  przed: string;
  po: string;
  zmiana_pct: number | null;
  uwaga?: string | null;
};

/** Udział zmienionej treści (0–100) — miara na słowach, odporna na przeformatowanie. */
export function zmianaPct(przed: string, po: string): number {
  const tok = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const a = tok(przed);
  const b = tok(po);
  if (!a.length && !b.length) return 0;
  // Wielozbiór wspólnych tokenów — ile słów oryginału przetrwało redakcję.
  const licznik = new Map<string, number>();
  for (const w of a) licznik.set(w, (licznik.get(w) ?? 0) + 1);
  let wspolne = 0;
  for (const w of b) {
    const n = licznik.get(w) ?? 0;
    if (n > 0) {
      wspolne++;
      licznik.set(w, n - 1);
    }
  }
  const podobienstwo = (2 * wspolne) / (a.length + b.length); // Dice na tokenach
  return Math.round((1 - podobienstwo) * 100);
}

/** Poniżej tego progu zmiana to literówka/interpunkcja — nie zaśmiecamy korpusu. */
export const PROG_ISTOTNOSCI = 5;

/**
 * Zapisuje parę przed/po, jeśli zmiana jest istotna. Nigdy nie wywraca zapisu
 * subanalizy — brak migracji 0007 czy błąd sieci kończy się cichym pominięciem
 * (uczenie jest dodatkiem, nie warunkiem pracy biegłego).
 */
export async function zapiszKorekte(
  supabase: SupabaseClient,
  caseId: string,
  sub: { kind: string; chapter_no: string; body_md: string },
  po: string,
): Promise<{ zapisano: boolean; pct: number }> {
  const przed = sub.body_md ?? "";
  const pct = zmianaPct(przed, po);
  if (!przed.trim() || !po.trim() || pct < PROG_ISTOTNOSCI) return { zapisano: false, pct };
  try {
    const { error } = await supabase.from("korekty").insert({
      case_id: caseId,
      kind: sub.kind,
      chapter_no: sub.chapter_no ?? "",
      przed,
      po,
      zmiana_pct: pct,
    });
    return { zapisano: !error, pct };
  } catch {
    return { zapisano: false, pct };
  }
}

// ── Sprzężenie zwrotne: korpus stylu do promptu ──────────────────────────────

const MAX_PRZYKLADOW = 3;
const MAX_ZNAKOW_FRAGMENTU = 1200;

/** Fragment o największej gęstości zmian — pokazujemy różnicę, nie cały rozdział. */
function fragment(s: string): string {
  const t = s.trim();
  return t.length <= MAX_ZNAKOW_FRAGMENTU ? t : t.slice(0, MAX_ZNAKOW_FRAGMENTU) + "…";
}

/**
 * Buduje blok promptu z realnych poprawek biegłego. Priorytet: korekty tego samego
 * rodzaju rozdziału (styl bywa różny dla prozy teoretycznej i dla opisu techniki),
 * uzupełnione o najświeższe z innych rozdziałów. Zwraca `null`, gdy brak materiału.
 */
export async function buildStyleCorpus(
  supabase: SupabaseClient,
  kind: string,
): Promise<string | null> {
  let rows: Korekta[] = [];
  try {
    const { data, error } = await supabase
      .from("korekty")
      .select("kind,chapter_no,przed,po,zmiana_pct,uwaga")
      .eq("aktywna", true)
      .order("created_at", { ascending: false })
      .limit(40);
    if (error || !data) return null;
    rows = data as Korekta[];
  } catch {
    return null; // brak migracji 0007 — funkcja jest opcjonalna
  }
  if (!rows.length) return null;

  const tegoRodzaju = rows.filter((r) => r.kind === kind);
  const pozostale = rows.filter((r) => r.kind !== kind);
  const wybrane = [...tegoRodzaju, ...pozostale].slice(0, MAX_PRZYKLADOW);
  if (!wybrane.length) return null;

  const bloki = wybrane.map(
    (r, i) =>
      `PRZYKŁAD ${i + 1} (rozdział: ${r.kind}${r.zmiana_pct != null ? `, zmiana ${r.zmiana_pct}%` : ""}):\n` +
      `--- wersja modelu (ODRZUCONA) ---\n${fragment(r.przed)}\n` +
      `--- wersja biegłego (WZORZEC) ---\n${fragment(r.po)}` +
      (r.uwaga ? `\n--- uwaga biegłego ---\n${r.uwaga}` : ""),
  );

  return (
    `STYL BIEGŁEGO — WZORCE Z JEGO WŁASNYCH POPRAWEK.\n` +
    `Poniżej realne pary: tekst wygenerowany wcześniej przez model oraz jego wersja po redakcji ` +
    `biegłego. Wzoruj się na wersji biegłego: przejmij jej rejestr językowy, długość zdań, sposób ` +
    `formułowania ostrożnościowego i konstrukcję odwołań do dowodów. NIE kopiuj treści merytorycznej ` +
    `ani liczb z przykładów — dotyczą innych spraw; przenoś wyłącznie SPOSÓB pisania.\n\n` +
    bloki.join("\n\n") +
    `\n\n(Koniec wzorców stylu.)`
  );
}
