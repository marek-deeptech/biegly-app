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

  it("rozróżnia dopełnienie z tożsamości od niewiarygodnego odczytu", () => {
    // Obie kategorie muszą trafić do tekstu, ale z RÓŻNYM skutkiem: wartość doliczona
    // z tożsamości jest użyteczna i wymaga tylko ujawnienia pochodzenia, a odczyt
    // niewiarygodny nie może być podstawą oceny. Wspólny komunikat kazał traktować
    // kilkanaście rutynowych dopełnień jak błędy i topił w nich realne rozjazdy.
    const { user } = buildBankRedactPrompt({
      ...bazowe, kind: "wskazniki_bank", dzienZdarzenia: "2008-09-11",
      uwagi: ["2008-06-30: kapitał AT1 = 62 824 (Tier 1 − CET1, nie odczytany wprost)"],
      zastrzezenia: ["2007-12-31: bilans nie domyka się — różnica 27,5%"],
    });
    expect(user).toContain("ODCZYT NIEWIARYGODNY");
    expect(user).toContain("NIE WOLNO na nich opierać oceny");
    expect(user).toContain("bilans nie domyka");
    expect(user).toContain("WARTOŚCI DOLICZONE Z TOŻSAMOŚCI");
    expect(user).toContain("nie odczytany wprost");
    // Dopełnienie nie może wpaść pod zakaz — to dwie różne sekcje promptu.
    const zakaz = user.slice(user.indexOf("ODCZYT NIEWIARYGODNY"), user.indexOf("WARTOŚCI DOLICZONE"));
    expect(zakaz).not.toContain("nie odczytany wprost");
  });

  it("system zakazuje liczenia i przesądzania o winie", () => {
    const { system } = buildBankRedactPrompt({
      ...bazowe, kind: "limity", dzienZdarzenia: null, uwagi: [],
    });
    expect(system).toContain("NIE LICZYSZ");
    // Granica kompetencji przyszła z bloku trybu — w karnym są to wina, zamiar
    // i kwalifikacja czynu. Wcześniej była wpisana na sztywno w prompt bankowy,
    // przez co sprawa cywilna zastrzegała się co do rzeczy, o które nikt nie pyta.
    expect(system).toContain("POZA TWOJĄ KOMPETENCJĄ");
    expect(system).toContain("kwalifikacja prawna czynu");
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

describe("atrybucja podmiotowa liczb", () => {
  // REGRESJA Z REALNEGO PRZEBIEGU: prompt nie mówił, CZYJE są liczby, więc model
  // przypisał je bankowi z nazwy sprawy. Wygenerowana proza mówiła o „współczynnikach
  // kapitałowych banku MBR" i stosowała do nich Uchwałę nr 1/2007 KNB — a były to
  // współczynniki Glitnira z jego sprawozdań. Opinia przypisywałaby pozycję kapitałową
  // islandzkiego kontrahenta oskarżonemu polskiemu bankowi i osądzała ją polskim prawem.
  const zZrodlami = () =>
    buildBankRedactPrompt({
      ...bazowe, kind: "wskazniki_bank", dzienZdarzenia: "2008-09-11",
      przepisy: ["Uchwała nr 1/2007 KNB — wymogi kapitałowe"],
      zrodla: ["ZALACZNIK 5 - SF-GLITNIR-2008-2q.pdf"],
    }).user;

  it("podaje pliki źródłowe i zakazuje utożsamiania podmiotu z nazwą sprawy", () => {
    const u = zZrodlami();
    expect(u).toContain("SF-GLITNIR-2008-2q.pdf");
    expect(u).toContain("NIE zakładaj, że jest nim bank");
    expect(u).toContain("nazwa sprawy oznacza POSTĘPOWANIE");
  });

  it("każe traktować polski próg jako miarę porównawczą dla podmiotu zagranicznego", () => {
    expect(zZrodlami()).toContain("MIARY PORÓWNAWCZEJ");
  });

  it("nie dokleja bloku o podmiocie tam, gdzie liczb ze sprawozdań nie ma", () => {
    // Moduł `procedury` odtwarza chronologię z dokumentów wewnętrznych banku —
    // ostrzeżenie o wystawcy sprawozdań byłoby tam mylące.
    const { user } = buildBankRedactPrompt({
      ...bazowe, kind: "procedury", dzienZdarzenia: "2008-09-11", przepisy: ["art. 9 Prawa bankowego — system"],
    });
    expect(user).not.toContain("PODMIOT, KTÓREGO DOTYCZĄ WARTOŚCI");
    expect(user).not.toContain("MIARY PORÓWNAWCZEJ");
  });
});
