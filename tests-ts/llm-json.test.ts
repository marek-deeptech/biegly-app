/**
 * Odczyt JSON z odpowiedzi modelu.
 *
 * ⚠️ REGRESJA: przy czytaniu sprawozdania RSY S.A. model zwrócił obiekt, po nim
 * akapit wyjaśnienia, a po nim POPRAWIONY obiekt. Sklejenie „od pierwszego { do
 * ostatniego }" dało SyntaxError i cały bieg przepadał, choć poprawna odpowiedź
 * była w treści.
 */
import { describe, expect, it } from "vitest";
import { ostatniJson } from "@/lib/llm/json";

describe("ostatniJson", () => {
  it("bierze POPRAWKĘ, gdy model dopisze drugą odpowiedź", () => {
    const raw =
      '{"spolka":"RSY S.A.","pozycje":[{"akcjonariusz":"X"}]}\n' +
      "Uwaga: powyższy fragment dotyczy udziałów posiadanych PRZEZ RSY S.A. Poprawna odpowiedź:\n" +
      '{"spolka":null,"pozycje":[]}';
    expect(ostatniJson(raw)).toEqual({ spolka: null, pozycje: [] });
  });

  it("radzi sobie z płotkiem ```json i tekstem dookoła", () => {
    expect(ostatniJson('Oto wynik:\n```json\n{"a":1}\n```\nGotowe.')).toEqual({ a: 1 });
  });

  it("nie gubi nawiasów w wartościach tekstowych", () => {
    const raw = '{"cytat":"stan {przed} 25,96% i po } 32,98%","akcje":3661291}';
    expect(ostatniJson<{ cytat: string; akcje: number }>(raw)!.akcje).toBe(3661291);
  });

  it("obiekty zagnieżdżone wracają w całości", () => {
    expect(ostatniJson('{"a":{"b":{"c":2}}}')).toEqual({ a: { b: { c: 2 } } });
  });

  it("gdy ostatni kandydat jest uszkodzony, wraca wcześniejszy poprawny", () => {
    expect(ostatniJson('{"ok":1}\nteraz urwane: {"ok":')).toEqual({ ok: 1 });
  });

  it("brak JSON-a daje null, nie wyjątek", () => {
    expect(ostatniJson("model odmówił odpowiedzi")).toBeNull();
    expect(ostatniJson("")).toBeNull();
  });
});
