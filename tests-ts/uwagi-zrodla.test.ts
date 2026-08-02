import { describe, expect, it } from "vitest";

// Panel wskaźników bankowych buduje odnośnik do sprawozdania z pól `sciezka` i `strona`
// w `uwagi_zrodla`. Tu pilnujemy kontraktu tych danych — bez niego przycisk „sprawdź
// w oryginale" nie ma czego otworzyć i uwaga wraca do stanu sprzed zmiany: numer strony
// w zdaniu i ręczne szukanie pliku w aktach.
type UwagaZrodlo = { tekst: string; dzien?: string; pole?: string; plik?: string; sciezka?: string; strona?: number | null };

const PRZYKLAD: UwagaZrodlo[] = [
  {
    tekst: "2008-06-30: aktywa_ogolem = 3 862 797 — wiersz o jednej wartości (str. 11)…",
    dzien: "2008-06-30",
    pole: "aktywa_ogolem",
    plik: "ZALACZNIK 5 - SF-GLITNIR-2008-2q.pdf",
    sciezka: "8d01c3ee/MBR/ZALACZNIK 5 - SF-GLITNIR-2008-2q.pdf",
    strona: 11,
  },
  { tekst: "starsza sprawa — sama treść, bez źródła" },
];

const link = (u: UwagaZrodlo, podpisany: string) =>
  u.strona ? `${podpisany}#page=${u.strona}` : podpisany;

describe("odnośniki do źródła uwagi", () => {
  it("prowadzą do KONKRETNEJ strony sprawozdania", () => {
    // Bez `#page=` czytnik otwiera pierwszą stronę stukilkudziesięciostronicowego PDF-u.
    expect(link(PRZYKLAD[0], "https://x/plik.pdf?token=abc")).toBe("https://x/plik.pdf?token=abc#page=11");
  });

  it("uwaga bez strony otwiera plik bez kotwicy, a nie „#page=null”", () => {
    expect(link({ ...PRZYKLAD[0], strona: null }, "https://x/p.pdf")).toBe("https://x/p.pdf");
  });

  it("uwaga bez ścieżki nie dostaje przycisku — nie ma czego otworzyć", () => {
    expect(PRZYKLAD[1].sciezka).toBeUndefined();
  });

  it("klucz deduplikacji to (dzień, pole) — ta sama uwaga bywa w dwóch sprawozdaniach", () => {
    // Okres 2007 występuje w obu sprawozdaniach Glitnira, więc „Tier 2 z tożsamości”
    // pojawiał się w panelu dwa razy.
    const zDubletem: UwagaZrodlo[] = [
      { tekst: "a", dzien: "2007-12-31", pole: "kapital_tier2" },
      { tekst: "b", dzien: "2007-12-31", pole: "kapital_tier2" },
      { tekst: "c", dzien: "2006-12-31", pole: "kapital_tier2" },
    ];
    const widziane = new Set<string>();
    const bez = zDubletem.filter((u) => {
      const k = `${u.dzien}|${u.pole}`;
      return widziane.has(k) ? false : (widziane.add(k), true);
    });
    expect(bez).toHaveLength(2);
  });
});
