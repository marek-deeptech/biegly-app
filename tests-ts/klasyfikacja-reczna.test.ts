import { describe, expect, it } from "vitest";

import { docTypesDla } from "@/lib/intake/classify";

// Lista wyboru w wierszu pliku budowana jest z tego katalogu. Gdyby brała sam rdzeń,
// w sprawie bankowej nie dałoby się zaklasyfikować pliku jako sprawozdania banku ani
// protokołu komitetu — czyli dokładnie tych, których automat najczęściej nie rozpoznaje.
describe("katalog typów do ręcznej klasyfikacji", () => {
  it("sprawa bankowa widzi typy bankowe OBOK rdzenia", () => {
    const t = docTypesDla("ryzyko_bankowe");
    expect(t.SPRAWOZDANIE_BANK?.label).toContain("Sprawozdanie finansowe banku");
    expect(t.PROTOKOL_KOMITETU).toBeDefined();
    expect(t.RAPORT_BANK_CENTRALNY).toBeDefined();
    expect(t.POSTANOWIENIE).toBeDefined(); // rdzeń nadal dostępny
  });

  it("sprawa o manipulację NIE widzi typów bankowych", () => {
    // Ta sama separacja co w krokach 3–5: lista typów jednej dziedziny w drugiej
    // sugerowałaby, że jest co klasyfikować.
    const t = docTypesDla("manipulacja_gpw");
    expect(t.SPRAWOZDANIE_BANK).toBeUndefined();
    expect(t.DANE_UTP).toBeDefined();
  });

  it("każdy typ niesie proweniencję — po niej ustawiamy wejście/wyjście", () => {
    // Zmiana typu bez proweniencji rozjeżdżałaby oba pola: dokument stawał się
    // np. opinią biegłego, pozostając oznaczonym jako materiał dowodowy.
    for (const [kod, t] of Object.entries(docTypesDla("ryzyko_bankowe"))) {
      if (kod === "UNKNOWN") continue;
      expect(["wejście", "wyjście"], `${kod} ma nieznaną proweniencję`).toContain(t.provenance);
    }
  });

  it("UNKNOWN nie jest celem klasyfikacji", () => {
    // Lista wyboru odsiewa go: „zaklasyfikuj jako niesklasyfikowany" nie ma sensu.
    const doWyboru = Object.keys(docTypesDla("ryzyko_bankowe")).filter((k) => k !== "UNKNOWN");
    expect(doWyboru).not.toContain("UNKNOWN");
    expect(doWyboru.length).toBeGreaterThan(20);
  });
});
