import { describe, expect, it } from "vitest";

import { buildOpinionDla } from "@/lib/opinion/build-router";

// Regresja: trzy trasy eksportu (.docx, .pdf, audyt) nie pobierały `cases.typ`
// z bazy, więc `packDla(undefined)` spadało do dziedziny GPW. Opinia bankowa
// eksportowała się jako dokument o szkielecie manipulacyjnym — bez ani jednego
// rozdziału bankowego, choć wszystkie były policzone i widoczne w aplikacji.
const sub = (kind: string, chapter_no: string, data: Record<string, unknown> = {}) =>
  ({ kind, chapter_no, title: kind, status: "szkic", body_md: "", data }) as never;

const PUSTE = { name: "X", signature: null, group_roster: null, tryb: null, rola: null };

describe("wybór buildera wg dziedziny", () => {
  it("sprawa bankowa dostaje szkielet I–VIII, nie I–VI", () => {
    const o = buildOpinionDla({ ...PUSTE, typ: "ryzyko_bankowe" }, [], [], []);
    const glowne = o.chapters.filter((c) => !c.no.includes(".")).map((c) => c.no);
    expect(glowne).toEqual(["I", "II", "III", "IV", "V", "VI", "VII", "VIII"]);
  });

  it("sprawa o manipulację dostaje szkielet GPW — bez rozdziałów VII i VIII", () => {
    // Rozdział IV (Analiza) w GPW pojawia się dopiero, gdy ma treść — dlatego
    // porównujemy przynależność, a nie pełną listę.
    const o = buildOpinionDla({ ...PUSTE, typ: "manipulacja_gpw" }, [], [], []);
    const glowne = o.chapters.filter((c) => !c.no.includes(".")).map((c) => c.no);
    expect(glowne.every((n) => ["I", "II", "III", "IV", "V", "VI"].includes(n))).toBe(true);
    expect(glowne).not.toContain("VII");
    expect(glowne).not.toContain("VIII");
  });

  it("moduły bankowe wchodzą do rozdziału V jako podrozdziały literowe", () => {
    const o = buildOpinionDla({ ...PUSTE, typ: "ryzyko_bankowe" }, [], [], [
      sub("makro", "V"),
      sub("wskazniki_bank", "V"),
      sub("otoczenie_prawne", "V"),
    ]);
    expect(o.chapters.filter((c) => c.no.startsWith("V.")).map((c) => c.no)).toEqual(["V.A", "V.B", "V.C"]);
  });

  it("typ nieznany albo null nie wysypuje buildera (sprawy sprzed migracji 0010)", () => {
    // Trzy sprawy założone przed migracją nie mają typu i muszą działać jak dotąd.
    const o = buildOpinionDla({ ...PUSTE, typ: null }, [], [], []);
    const glowne = o.chapters.filter((c) => !c.no.includes(".")).map((c) => c.no);
    expect(glowne).not.toContain("VIII"); // szkielet GPW, nie bankowy
    expect(glowne[0]).toBe("I");
  });
});

describe("rubryka audytu wg dziedziny", () => {
  it("rubryka bankowa nie ocenia technik manipulacji ani MAR", async () => {
    // Rubryka GPW wystawiłaby opinii bankowej „brak" za nieopisanie technik
    // i niewskazanie litery załącznika I do MAR — rzeczy, których w tej dziedzinie
    // być nie może. Niska ocena czytałaby się jak wada opinii.
    const { RUBRYKA_BANK } = await import("@/lib/opinion/audyt-bank");
    const tekst = RUBRYKA_BANK.map((r) => r.opis).join(" ");
    expect(tekst).not.toMatch(/manipulacj|MAR|załącznika I/);
    expect(RUBRYKA_BANK.map((r) => r.id)).toContain("stan_prawny");
    expect(RUBRYKA_BANK.map((r) => r.id)).toContain("wsteczne");
  });

  it("wagi rubryki bankowej sumują się do 100", async () => {
    const { RUBRYKA_BANK } = await import("@/lib/opinion/audyt-bank");
    expect(RUBRYKA_BANK.reduce((a, r) => a + r.waga, 0)).toBe(100);
  });

  it("audytor bankowy ma wykrywać anachroniczny przepis niezależnie od reszty wywodu", async () => {
    const { SYSTEM_AUDYT_BANK } = await import("@/lib/opinion/audyt-bank");
    expect(SYSTEM_AUDYT_BANK).toContain("akt późniejszy");
    expect(SYSTEM_AUDYT_BANK).toContain("niezależnie od tego, jak trafna jest reszta");
  });
});
