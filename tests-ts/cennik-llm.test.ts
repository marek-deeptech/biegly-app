/**
 * Arytmetyka cennika po stronie TS — bliźniacza do tests/test_cennik_llm.py.
 *
 * Te same wejścia i te same kwoty co w teście pythonowym. Tamten test porównuje
 * TABLICE (parsuje cennik.ts i zestawia z llm_cennik.py); ten pilnuje, że wzór
 * liczący z tych tablic daje po stronie TS identyczny wynik.
 *
 * Kwoty wpisane ręcznie z cennika, nie wyliczone z tablic — inaczej test
 * potwierdzałby wyłącznie sam siebie.
 */
import { describe, expect, it } from "vitest";
import { CENNIK, MIN_PREFIKS_CACHE, aliasModelu, cena, koszt } from "@/lib/llm/cennik";

const D = (s: string) => new Date(`${s}T12:00:00Z`);

describe("koszt wywołania", () => {
  it("Opus bez cache'u: 150k wejścia + 48k wyjścia = $1,95", () => {
    const z = { input_tokens: 150_000, output_tokens: 48_000 };
    expect(koszt("claude-opus-4-8", z, { kiedy: D("2026-08-03") })).toBeCloseTo(1.95, 10);
  });

  it("Opus z cache'em: zapis 1,25×, odczyt 0,1× ceny wejścia", () => {
    const z = {
      input_tokens: 1_000,
      cache_creation_input_tokens: 20_000,
      cache_read_input_tokens: 100_000,
      output_tokens: 500,
    };
    // 1 000×$5 + 20 000×$5×1,25 + 100 000×$5×0,1 + 500×$25 = $0,1925
    expect(koszt("claude-opus-4-8", z, { kiedy: D("2026-08-03") })).toBeCloseTo(0.1925, 10);
  });

  it("Batch API to połowa rachunku", () => {
    const z = { input_tokens: 150_000, output_tokens: 48_000 };
    expect(koszt("claude-opus-4-8", z, { kiedy: D("2026-08-03"), batch: true })).toBeCloseTo(0.975, 10);
  });

  it("pełne ID z datą wydania też ma cenę", () => {
    // lib/intake/classify-content.ts woła Haiku jako claude-haiku-4-5-20251001.
    // Bez normalizacji jedyny już zoptymalizowany krok w repo byłby też jedynym,
    // którego kosztu raport nie zna.
    const z = { input_tokens: 1_000_000, output_tokens: 100_000 }; // 1M×$1 + 100k×$5
    expect(koszt("claude-haiku-4-5-20251001", z, { kiedy: D("2026-08-03") })).toBeCloseTo(1.5, 10);
    expect(koszt("claude-haiku-4-5", z, { kiedy: D("2026-08-03") })).toBeCloseTo(1.5, 10);
  });

  it("sufiks obcinamy tylko wtedy, gdy wygląda jak data", () => {
    expect(aliasModelu("claude-opus-4-8")).toBe("claude-opus-4-8");
    expect(aliasModelu("claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5");
    expect(aliasModelu("model-bez-daty-123")).toBe("model-bez-daty-123");
  });

  it("model spoza cennika daje lukę (null), a nie zero", () => {
    // Zero udawałoby wywołanie darmowe. null jest widoczny w raporcie jako „nie wiem".
    expect(koszt("claude-nieistniejacy-9", { input_tokens: 1_000 })).toBeNull();
  });

  it("brak pól zużycia nie wywala liczenia", () => {
    expect(koszt("claude-opus-4-8", {}, { kiedy: D("2026-08-03") })).toBe(0);
  });
});

describe("promocja wprowadzająca Sonneta 5", () => {
  const z = { input_tokens: 1_000_000, output_tokens: 100_000 };

  it("do 2026-08-31 liczy po cenie promocyjnej", () => {
    expect(koszt("claude-sonnet-5", z, { kiedy: D("2026-08-03") })).toBeCloseTo(3.0, 10);
    // Ostatni dzień promocji wciąż promocyjny.
    expect(koszt("claude-sonnet-5", z, { kiedy: D("2026-08-31") })).toBeCloseTo(3.0, 10);
  });

  it("po 2026-08-31 wraca cena bazowa — rachunek rośnie o połowę", () => {
    expect(koszt("claude-sonnet-5", z, { kiedy: D("2026-09-01") })).toBeCloseTo(4.5, 10);
  });

  it("cena() zwraca stawkę obowiązującą danego dnia", () => {
    expect(cena("claude-sonnet-5", D("2026-08-03"))).toEqual({ wejscie: 2, wyjscie: 10 });
    expect(cena("claude-sonnet-5", D("2026-09-01"))).toEqual({ wejscie: 3, wyjscie: 15 });
  });
});

describe("relacje cen — to, na czym opiera się dobór modelu", () => {
  it("Haiku jest 5× tańszy od Opusa po obu stronach", () => {
    expect(CENNIK["claude-opus-4-8"].wejscie / CENNIK["claude-haiku-4-5"].wejscie).toBe(5);
    expect(CENNIK["claude-opus-4-8"].wyjscie / CENNIK["claude-haiku-4-5"].wyjscie).toBe(5);
  });

  it("wyjście kosztuje 5× tyle co wejście — dlatego max_tokens jest kosztowny", () => {
    for (const [model, w] of Object.entries(CENNIK)) {
      expect(w.wyjscie / w.wejscie, `${model}`).toBe(5);
    }
  });
});

describe("próg cache'owania prompta", () => {
  it("Opus 4.8 wymaga 4096 tokenów prefiksu", () => {
    // Utrwala ustalenie, przez które NIE cache'ujemy systemów promptów: mają
    // 400–700 tokenów, więc `cache_control` po cichu nic by nie zrobił.
    expect(MIN_PREFIKS_CACHE["claude-opus-4-8"]).toBe(4096);
  });
});
