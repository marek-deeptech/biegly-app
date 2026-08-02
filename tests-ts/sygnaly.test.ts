import { describe, expect, it } from "vitest";

// Moduł sygnałów rynkowych jest w Pythonie (engine/uslugi/sygnaly.py) — tu sprawdzamy tylko
// to, co decyduje o jego wpięciu: rodzaj rozdziału musi być znany redakcji prozy
// i mieć profil doktryny, inaczej rozdział powstanie bez materiału referencyjnego.
import { BANK_REDACT_KINDS } from "@/lib/opinion/redact-bank";
import { packDla } from "@/lib/domain";

describe("wpięcie modułów analizy bankowej", () => {
  it("każdy moduł pakietu ma odpowiednik w redakcji prozy", () => {
    // Bez tego moduł policzy dane, ale nie da się go rozwinąć w tekst — dokładnie
    // ta luka sprawiła, że opinia MBR miała 16 tys. znaków zamiast 194 tys.
    const moduly = packDla("ryzyko_bankowe").moduly.map((m) => m.id);
    const redakcja = BANK_REDACT_KINDS as readonly string[];
    const bez = moduly.filter((m) => !redakcja.includes(m) && m !== "adekwatnosc");
    expect(bez).toEqual([]);
  });

  it("adekwatność jest redagowana pod kluczem subanalizy, nie modułu", () => {
    // Subanaliza nazywa się `wskazniki_bank`, moduł pakietu `adekwatnosc` —
    // rozjazd nazw jest świadomy i obsłużony przez modulDla().
    expect(BANK_REDACT_KINDS as readonly string[]).toContain("wskazniki_bank");
    expect(packDla("ryzyko_bankowe").moduly.map((m) => m.id)).toContain("adekwatnosc");
  });
});
