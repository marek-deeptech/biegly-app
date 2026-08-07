/**
 * Porównanie danych rozdziału z tym, co wróciło z bazy.
 *
 * ⚠️ REGRESJA: `jsonb` w PostgreSQL przechowuje klucze we WŁASNYM porządku (najpierw
 * krótsze, potem bajtowo). Porównanie gołym `JSON.stringify` uznawało identyczne dane
 * za różne, więc każdy powtórzony bieg skryptu rozdziału zapalał znacznik „proza
 * starsza od liczb" i bramka przed wydrukiem tonęła w pustych alarmach.
 */
import { describe, expect, it } from "vitest";
import { stabilny } from "@/lib/json-stabilny";

describe("stabilny zapis JSON", () => {
  it("kolejność kluczy nie ma znaczenia (tak wraca jsonb)", () => {
    expect(stabilny({ b: 1, a: 2 })).toBe(stabilny({ a: 2, b: 1 }));
    expect(stabilny({ x: { z: 1, y: [{ q: 1, p: 2 }] } })).toBe(stabilny({ x: { y: [{ p: 2, q: 1 }], z: 1 } }));
  });

  it("kolejność w tablicach ZNACZY — wiersze tabel opinii", () => {
    expect(stabilny([1, 2])).not.toBe(stabilny([2, 1]));
    expect(stabilny({ rows: [["a"], ["b"]] })).not.toBe(stabilny({ rows: [["b"], ["a"]] }));
  });

  it("różnica wartości nadal jest różnicą", () => {
    expect(stabilny({ a: 1 })).not.toBe(stabilny({ a: 2 }));
    expect(stabilny(null)).not.toBe(stabilny([]));
  });
});
