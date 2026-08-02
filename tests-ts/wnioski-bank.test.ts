import { describe, expect, it } from "vitest";

import { buildWnioskiBank, buildBankWnioskiPrompt, materialWnioskow } from "@/lib/opinion/wnioski-bank";

const DZIEN = "2008-09-11";
const sub = (kind: string, data: Record<string, unknown>) =>
  ({ kind, chapter_no: "V", title: kind, status: "szkic", body_md: "", data }) as never;

const STORED = [
  sub("wskazniki_bank", {
    findings: ["2008-06-30: CET1 = 5,47% — poniżej progu"],
    uwagi: ["2008-06-30: kapitał AT1 = 62 824 (Tier 1 − CET1, nie odczytany wprost)"],
    zastrzezenia: ["2007-12-31: bilans nie domyka się — różnica 27,5%"],
  }),
  sub("sygnaly_rynkowe", { findings: [], braki: ["Notowania CDS nie występują w aktach jako dane."] }),
  sub("makro", { findings: ["ICEX: 682 notowania"] }),
];

describe("materiał wniosków bankowych", () => {
  it("nie miesza dopełnień z tożsamości z niewiarygodnym odczytem", () => {
    // Zlane w jedną listę osłabiały się nawzajem: kilkanaście rutynowych dopełnień
    // topiło kilka realnych błędów odczytu, a prompt mówił o wszystkich „nie opieraj się".
    const m = materialWnioskow(STORED, DZIEN);
    expect(m.zastrzezenia).toHaveLength(1);
    expect(m.zastrzezenia[0]).toContain("bilans nie domyka");
    expect(m.dopelnienia).toHaveLength(1);
    expect(m.dopelnienia[0]).toContain("nie odczytany wprost");
  });

  it("każde ustalenie ma wskazany moduł źródłowy", () => {
    const m = materialWnioskow(STORED, DZIEN);
    expect(m.rejestr.every((r) => r.zrodlo.length > 0)).toBe(true);
    expect(m.rejestr.find((r) => r.ustalenie.includes("CET1"))?.zrodlo).toBe("Współczynniki kapitałowe");
  });

  it("moduł niewykonany jest wymieniony, a nie pominięty milczeniem", () => {
    // Wniosek o procesie decyzyjnym bez wykonanego modułu `procedury` byłby wnioskiem
    // bez podstawy — model musi wiedzieć, w jakim zakresie nie wolno mu wnioskować.
    const m = materialWnioskow(STORED, DZIEN);
    expect(m.nieWykonane).toContain("Proces decyzyjny");
    expect(m.nieWykonane).toContain("Metodyka limitów");
  });

  it("bez daty zdarzenia nie dobiera przepisów", () => {
    expect(materialWnioskow(STORED, null).przepisy).toHaveLength(0);
    expect(materialWnioskow(STORED, DZIEN).przepisy.length).toBeGreaterThan(0);
  });

  it("dla 2008 r. nie podsuwa CRR jako przepisu do powołania", () => {
    // Sprawdzamy POWOŁYWANY przepis (część przed „—"), nie jego opis: art. 71 Prawa
    // bankowego ma w opisie historyczną wzmiankę „przed przeniesieniem materii do CRR"
    // i to jest poprawne — pokazuje ciągłość regulacji.
    const refy = materialWnioskow(STORED, DZIEN).przepisy.map((x) => x.split(" — ")[0]);
    expect(refy.join(" ")).not.toMatch(/CRR|575\/2013/);
    expect(refy.join(" ")).toContain("Uchwała");
  });
});

describe("szkielet wniosków", () => {
  it("brak pytań organu jest powiedziany wprost", () => {
    expect(buildWnioskiBank([], STORED, DZIEN).bodyMd).toContain("Brak pytań organu");
  });

  it("bez daty zdarzenia mówi, że stanu prawnego nie da się ustalić", () => {
    expect(buildWnioskiBank(["Pytanie?"], STORED, null).bodyMd).toContain("Nie podano dnia ocenianego zdarzenia");
  });

  it("rejestr trafia do tabeli z kolumną źródła", () => {
    const w = buildWnioskiBank(["Pytanie?"], STORED, DZIEN);
    expect(w.data.table?.head).toEqual(["Ustalenie", "Źródło ustalenia"]);
    expect(w.data.table?.rows.length).toBe(2);
  });
});

describe("prompt wniosków bankowych", () => {
  const p = buildBankWnioskiPrompt({
    caseName: "MBR",
    signature: "PO III Ds 84.2020",
    dzienZdarzenia: DZIEN,
    pytania: ["Czy sposób identyfikacji ryzyka był dostateczny?"],
    material: materialWnioskow(STORED, DZIEN),
  });

  it("zakazuje wnioskowania wstecznego", () => {
    expect(p.system).toContain("wnioskowaniem wstecznym");
  });

  it("odróżnia obowiązek odpowiedzi od zakazu przesądzania o winie", () => {
    // Audyt wykazał, że zakaz sformułowany szeroko („NIE PRZESĄDZASZ o winie, zamiarze
    // ani kwalifikacji") model rozciągał na CAŁĄ ocenę i uchylał się od odpowiedzi na
    // pytanie organu — a to pytanie mieści się w kompetencji biegłego i jest sednem opinii.
    expect(p.system).toContain("MUSISZ je rozstrzygnąć jednoznacznie");
    expect(p.system).toContain("uchylenie");
    // Poza kompetencją zostają WYŁĄCZNIE trzy rzeczy.
    expect(p.system).toContain("wina, zamiar i kwalifikacja prawna czynu");
    expect(p.user).toContain("zdania rozstrzygającego");
  });

  it("zakaz opierania się dotyczy TYLKO niewiarygodnego odczytu", () => {
    const zakaz = p.user.slice(p.user.indexOf("ODCZYT NIEWIARYGODNY"));
    expect(zakaz).toContain("bilans nie domyka");
    // Dopełnienie z tożsamości nie może wpaść pod ten sam zakaz — jest użyteczne.
    expect(zakaz.slice(0, zakaz.indexOf("WARTOŚCI DOLICZONE"))).not.toContain("nie odczytany wprost");
    expect(p.user).toContain("WARTOŚCI DOLICZONE Z TOŻSAMOŚCI");
  });

  it("przekazuje ustalenia negatywne jako granice opinii", () => {
    expect(p.user).toContain("USTALENIA NEGATYWNE");
    expect(p.user).toContain("Notowania CDS");
  });
});
