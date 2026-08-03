/**
 * Szczelność rejestrów modułów bankowych.
 *
 * ⚠️ POWÓD ISTNIENIA: moduł `oceny_zrzeszajacego` miał wiersz w `subanalyses`,
 * własny skrypt zasilający i tytuł — ale nie było go w `MODULY_V`, więc NIE POJAWIAŁ
 * SIĘ W OPINII W OGÓLE. Nic tego nie zgłaszało: dane leżały w bazie, panel je pokazywał,
 * a rozdział po prostu nie istniał. Osobno `analiza_ekonomiczna` nie była wpisana do
 * `ZRODLA` wniosków — jej ustalenia i rejestr `braki` (pozycje sprawozdawcze, których
 * w aktach nie ma) nie docierały do konkluzji, i nie trafiała nawet na listę modułów
 * niewykonanych. Oba błędy to ta sama klasa: moduł istnieje w jednym rejestrze,
 * a w drugim go nie ma, i milczenie wygląda jak poprawne działanie.
 *
 * Moduł bankowy żyje w PIĘCIU miejscach naraz. Ten test wymusza, żeby dodanie go
 * do jednego zmusiło do dopisania w pozostałych.
 */
import { describe, expect, it } from "vitest";
import { packDla } from "@/lib/domain";
import { TECH_LABEL } from "@/lib/intake/completeness";
import { MODULY_V } from "@/lib/opinion/build-bank";
import { BANK_REDACT_KINDS, CEL, modulDla, type BankRedactKind } from "@/lib/opinion/redact-bank";
import { ZRODLA } from "@/lib/opinion/wnioski-bank";

const KINDY_V = MODULY_V.map((m) => m.kind);

describe("rejestry modułów bankowych są zgodne", () => {
  it("każdy moduł rozdziału V da się zredagować", () => {
    // Bez wpisu w BANK_REDACT_KINDS rozdział pojawi się w opinii jako nagłówek,
    // którego nie ma czym wypełnić.
    const brak = KINDY_V.filter((k) => !BANK_REDACT_KINDS.includes(k as BankRedactKind));
    expect(brak, `moduły bez obsługi w redakcji: ${brak.join(", ")}`).toEqual([]);
  });

  it("każdy moduł rozdziału V ma opisany cel rozdziału", () => {
    // Pusty cel = model redaguje rozdział, nie wiedząc, co ma rozstrzygnąć.
    for (const k of KINDY_V) {
      expect(CEL[k as BankRedactKind]?.length ?? 0, `${k}: brak celu`).toBeGreaterThan(80);
    }
  });

  it("każdy moduł rozdziału V wchodzi do rejestru wniosków", () => {
    // To jest dokładnie ta usterka, przez którą rubryka 16 wskaźników nie docierała
    // do konkluzji — ani jako ustalenia, ani jako moduł niewykonany.
    const kindyWnioskow = ZRODLA.map((z) => z.kind);
    const brak = KINDY_V.filter((k) => !kindyWnioskow.includes(k));
    expect(brak, `moduły niewidzialne dla wniosków: ${brak.join(", ")}`).toEqual([]);
  });

  it("każdy moduł rozdziału V ma etykietę w raporcie kompletności", () => {
    // Bez etykiety kompletność pokazuje surowy klucz techniczny zamiast nazwy.
    const brak = KINDY_V.filter((k) => !TECH_LABEL[modulDla(k as BankRedactKind)] && !TECH_LABEL[k]);
    expect(brak, `moduły bez etykiety: ${brak.join(", ")}`).toEqual([]);
  });

  it("każdy moduł rozdziału V jest opisany w katalogu dziedzinowym", () => {
    // Katalog zasila listę „co ta dziedzina potrafi" pokazywaną biegłemu.
    // `modulDla` tłumaczy `wskazniki_bank` → `adekwatnosc`: to świadoma różnica
    // nazw (adekwatność jest też nazwą jednego z czterech obszarów rubryki),
    // a nie rozjazd — dlatego porównujemy PO tym tłumaczeniu.
    const wKatalogu = new Set(packDla("ryzyko_bankowe").moduly.map((m) => m.id));
    const brak = KINDY_V.filter((k) => !wKatalogu.has(modulDla(k as BankRedactKind)));
    expect(brak, `moduły spoza katalogu dziedzinowego: ${brak.join(", ")}`).toEqual([]);
  });

  it("litery modułów są unikalne i idą bez dziur", () => {
    // Dwa moduły z literą F przeżyły do trzeciej sprawy, bo renumeracja przy
    // składaniu opinii to maskowała.
    const litery = MODULY_V.map((m) => m.litera);
    expect(new Set(litery).size, "powtórzona litera modułu").toBe(litery.length);
    expect(litery).toEqual(
      Array.from({ length: litery.length }, (_, i) => String.fromCharCode(65 + i)),
    );
  });

  it("moduł oceny_zrzeszajacego jest w komplecie rejestrów", () => {
    // Regresja wprost: to jego brak w MODULY_V ukrył cały rozdział.
    expect(KINDY_V).toContain("oceny_zrzeszajacego");
    expect(BANK_REDACT_KINDS).toContain("oceny_zrzeszajacego");
    expect(ZRODLA.map((z) => z.kind)).toContain("oceny_zrzeszajacego");
  });
});
