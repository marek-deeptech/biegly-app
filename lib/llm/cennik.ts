/**
 * Cennik modeli — po to, żeby wpis w logu zużycia miał kwotę, a nie same tokeny.
 *
 * POWÓD ISTNIENIA: dopóki koszt nie stoi obok etykiety wywołania, nie da się
 * odpowiedzieć na pytanie „który krok pali budżet". Liczba tokenów tego nie mówi:
 * 100 tys. tokenów wyjścia Opusa kosztuje 25× tyle, co 100 tys. wejścia Haiku.
 *
 * ŹRÓDŁO: platform.claude.com/docs/en/about-claude/models/overview + /pricing.
 * Migawka z 2026-06-24 — cennik zmienia się rzadko, ale zmienia. Przy podejrzeniu
 * rozjazdu sprawdzić w Console → Usage, czy kwota z logu zgadza się z rachunkiem.
 *
 * BLIŹNIACZE W PYTHONIE: scripts/llm_cennik.py. Zgodność obu tablic pilnuje
 * tests/test_cennik_llm.py — rozjazd między nimi znaczyłby, że raport kosztów
 * ze skryptów i z aplikacji podaje różne kwoty za to samo wywołanie.
 */

/** Cena za MILION tokenów, w dolarach. */
export type Cena = { wejscie: number; wyjscie: number };

type Wpis = Cena & {
  /** Cena wprowadzająca — obowiązuje DO podanej daty włącznie, potem wraca cena bazowa. */
  promocja?: Cena & { do: string };
};

export const CENNIK: Record<string, Wpis> = {
  "claude-fable-5": { wejscie: 10, wyjscie: 50 },
  "claude-mythos-5": { wejscie: 10, wyjscie: 50 },
  "claude-opus-4-8": { wejscie: 5, wyjscie: 25 },
  "claude-opus-4-7": { wejscie: 5, wyjscie: 25 },
  "claude-opus-4-6": { wejscie: 5, wyjscie: 25 },
  "claude-sonnet-5": {
    wejscie: 3,
    wyjscie: 15,
    promocja: { wejscie: 2, wyjscie: 10, do: "2026-08-31" },
  },
  "claude-sonnet-4-6": { wejscie: 3, wyjscie: 15 },
  "claude-haiku-4-5": { wejscie: 1, wyjscie: 5 },
};

/**
 * Mnożniki od ceny WEJŚCIA.
 *
 * Odczyt z cache'u kosztuje dziesiątą część, zapis 1,25× (TTL 5 min) albo 2× (TTL 1 h) —
 * dlatego cache prompta zwraca się dopiero od drugiego zapytania z tym samym prefiksem.
 * Batch API to 50% od CAŁEGO rachunku (wejście i wyjście), nie mnożnik wejścia.
 */
export const MNOZNIK = {
  odczytCache: 0.1,
  zapisCache5m: 1.25,
  zapisCache1h: 2,
} as const;

/** Rabat Batch API — ten sam model i prompt, połowa ceny, wynik w ciągu godzin. */
export const RABAT_BATCH = 0.5;

/**
 * Minimalny prefiks, od którego cache prompta w ogóle się zakłada — w tokenach.
 *
 * Poniżej tego progu `cache_control` NIE zgłasza błędu, tylko po cichu nic nie robi.
 * Dlatego to jest tu, a nie w komentarzu: systemy promptów w tym repo mają 400–700
 * tokenów, czyli poniżej progu Opusa. Cache'owanie ich byłoby pracą bez skutku.
 */
export const MIN_PREFIKS_CACHE: Record<string, number> = {
  "claude-opus-4-8": 4096,
  "claude-opus-4-7": 4096,
  "claude-opus-4-6": 4096,
  "claude-haiku-4-5": 4096,
  "claude-fable-5": 2048,
  "claude-mythos-5": 2048,
  "claude-sonnet-5": 2048,
  "claude-sonnet-4-6": 2048,
};

/**
 * Sprowadza ID modelu do klucza cennika.
 *
 * Część wywołań podaje pełne ID z datą wydania (`claude-haiku-4-5-20251001`),
 * a cennik trzyma aliasy. Bez tego kroku takie wywołanie trafiałoby do raportu
 * z kwotą `null` — czyli najtańszy model w repo byłby jedynym, którego kosztu
 * nie znamy.
 */
export function aliasModelu(model: string): string {
  return model in CENNIK ? model : model.replace(/-\d{8}$/, "");
}

/** Cena obowiązująca danego dnia — uwzględnia promocję wprowadzającą, jeśli trwa. */
export function cena(model: string, kiedy: Date = new Date()): Cena | null {
  const w = CENNIK[aliasModelu(model)];
  if (!w) return null;
  if (w.promocja && kiedy.toISOString().slice(0, 10) <= w.promocja.do)
    return { wejscie: w.promocja.wejscie, wyjscie: w.promocja.wyjscie };
  return { wejscie: w.wejscie, wyjscie: w.wyjscie };
}

/** Zużycie tokenów tak, jak raportuje je API (pola opcjonalne — nie każde wywołanie ma cache). */
export type Zuzycie = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

/**
 * Koszt jednego wywołania w dolarach.
 *
 * `input_tokens` to już RESZTA nieobsłużona przez cache — tokeny z cache'u API
 * raportuje osobno, więc sumowanie nie podwaja. Zwraca `null` dla modelu spoza
 * cennika: lepiej pokazać lukę w raporcie niż wpisać zmyśloną kwotę.
 */
export function koszt(
  model: string,
  z: Zuzycie,
  opcje: { kiedy?: Date; batch?: boolean } = {},
): number | null {
  const c = cena(model, opcje.kiedy ?? new Date());
  if (!c) return null;
  const usd =
    ((z.input_tokens ?? 0) * c.wejscie +
      (z.cache_creation_input_tokens ?? 0) * c.wejscie * MNOZNIK.zapisCache5m +
      (z.cache_read_input_tokens ?? 0) * c.wejscie * MNOZNIK.odczytCache +
      (z.output_tokens ?? 0) * c.wyjscie) /
    1_000_000;
  return opcje.batch ? usd * RABAT_BATCH : usd;
}
