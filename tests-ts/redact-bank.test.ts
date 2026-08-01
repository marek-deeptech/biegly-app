import { describe, expect, it } from "vitest";

import { BANK_REDACT_KINDS, buildBankRedactPrompt, modulDla } from "@/lib/opinion/redact-bank";
import { IV_REDACT_KINDS } from "@/lib/opinion/redact";

const bazowe = {
  title: "Współczynniki kapitałowe w czasie",
  caseName: "MBR",
  signature: "PO III Ds 84.2020",
  tableText: "Wskaźnik | 2008-06-30\nCET1 | 5,47 %",
  findings: [],
  inventory: [],
  przepisy: ["Uchwała nr 1/2007 KNB — wymogi kapitałowe"],
  anachroniczne: ["art. 92 CRR (obowiązuje od 2014-01-01)"],
};

describe("prompt redakcji rozdziałów bankowych", () => {
  it("zakazuje powoływania przepisów późniejszych niż zdarzenie", () => {
    // To jest zabezpieczenie przed błędem, który obrona wytknie natychmiast:
    // CRR do oceny decyzji z 2008 r.
    const { user } = buildBankRedactPrompt({
      ...bazowe, kind: "wskazniki_bank", dzienZdarzenia: "2008-09-11", uwagi: [],
    });
    expect(user).toContain("ZAKAZ POWOŁYWANIA");
    expect(user).toContain("art. 92 CRR");
    expect(user).toContain("Uchwała nr 1/2007 KNB");
  });

  it("wymusza uwzględnienie uwag silnika, zamiast pozwolić je przemilczeć", () => {
    // Wartość dopełniona z tożsamości albo oznaczona jako niewiarygodna musi
    // dostać zastrzeżenie w tekście opinii.
    const { user } = buildBankRedactPrompt({
      ...bazowe, kind: "wskazniki_bank", dzienZdarzenia: "2008-09-11",
      uwagi: ["2008-06-30: kapitał AT1 = 62 824 (Tier 1 − CET1, nie odczytany wprost)"],
    });
    expect(user).toContain("UWAGI SILNIKA");
    expect(user).toContain("nie odczytany wprost");
  });

  it("system zakazuje liczenia i przesądzania o winie", () => {
    const { system } = buildBankRedactPrompt({
      ...bazowe, kind: "limity", dzienZdarzenia: null, uwagi: [],
    });
    expect(system).toContain("NIE LICZYSZ");
    expect(system).toContain("NIE PRZESĄDZASZ");
    // Wnioskowanie wsteczne — ocena z perspektywy późniejszego upadku kontrahenta.
    expect(system).toContain("wnioskowanie wsteczne");
  });

  it("nie miesza się z rodzajami dziedziny GPW", () => {
    // Zbiory muszą być rozłączne — inaczej rozdział jednej dziedziny dałoby się
    // zredagować promptem drugiej.
    const wspolne = (BANK_REDACT_KINDS as readonly string[]).filter((k) =>
      (IV_REDACT_KINDS as readonly string[]).includes(k),
    );
    expect(wspolne).toEqual([]);
  });

  it("wskazniki_bank mapuje się na moduł adekwatności", () => {
    expect(modulDla("wskazniki_bank")).toBe("adekwatnosc");
    expect(modulDla("limity")).toBe("limity");
  });
});
