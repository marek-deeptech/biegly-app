import { describe, expect, it } from "vitest";

import { planRedakcji } from "@/lib/opinion/plan-redakcji";
import { buildPlanFromTechniques } from "@/lib/opinion/chapters";

const MODULY_BANK = ["makro", "media", "sprawozdania", "wskazniki_bank", "limity", "procedury"];

describe("plan Kroku 5 — dziedzina bankowa", () => {
  const plan = planRedakcji({
    typ: "ryzyko_bankowe",
    caseName: "SKOK",
    obecne: MODULY_BANK,
    zatwierdzone: [],
  });

  it("nie pokazuje ANI JEDNEGO rozdziału o technikach manipulacji", () => {
    // Widok liczył plan wyłącznie z katalogu GPW, więc sprawa bankowa dostawała
    // „Generuj: IV.4 Wash trades” — rozdział, dla którego nie ma czego policzyć.
    const kindy = plan.map((k) => k.kind);
    for (const gpw of ["wash", "layering", "pumpdump", "imo", "espi", "ekofin", "relacje", "aktywnosc"])
      expect(kindy).not.toContain(gpw);
  });

  it("numeruje wg szkieletu BANKOWEGO: Wnioski III, Wstęp IV", () => {
    // W szkielecie GPW Wnioski są II, a Wstęp III — pokazanie tych numerów w opinii
    // bankowej rozjeżdżało Krok 5 z gotowym dokumentem.
    expect(plan.find((k) => k.kind === "wnioski")?.no).toBe("III");
    expect(plan.find((k) => k.kind === "proza_iii")?.no).toBe("IV");
    expect(plan.some((k) => k.no === "V")).toBe(false); // „Podsumowanie” to rozdział GPW
  });

  it("moduły dostają litery V.A… w kolejności rozdziałów opinii", () => {
    const moduly = plan.filter((k) => k.akcja.typ === "rozwin-modul");
    expect(moduly.map((k) => k.no)).toEqual(["V.A", "V.B", "V.C", "V.D", "V.E", "V.F"]);
    // Kolejność z MODULY_V (jak u biegłego), nie alfabetyczna ani z kolejności zapisu.
    expect(moduly[0].kind).toBe("makro");
    expect(moduly[1].kind).toBe("media");
  });

  it("moduł ma akcję „rozwiń”, nie „generuj” — powstaje w krokach 3–4", () => {
    // „Generuj” sugerowałoby, że rozdział da się zrobić bez odczytu sprawozdań i akt.
    expect(plan.find((k) => k.kind === "sprawozdania")?.akcja.typ).toBe("rozwin-modul");
  });

  it("Wnioski są zablokowane, dopóki moduły nie są zatwierdzone", () => {
    expect(plan.find((k) => k.kind === "wnioski")?.blokada).toContain("rozdziały analizy");
    const poZatwierdzeniu = planRedakcji({
      typ: "ryzyko_bankowe", caseName: "SKOK", obecne: MODULY_BANK, zatwierdzone: MODULY_BANK,
    });
    expect(poZatwierdzeniu.find((k) => k.kind === "wnioski")?.blokada).toBeUndefined();
  });

  it("pokazuje tylko moduły OBECNE w sprawie", () => {
    const p = planRedakcji({ typ: "ryzyko_bankowe", caseName: "X", obecne: ["makro"], zatwierdzone: [] });
    expect(p.filter((k) => k.akcja.typ === "rozwin-modul")).toHaveLength(1);
  });
});

describe("plan Kroku 5 — dziedzina manipulacji bez zmian", () => {
  const plan = planRedakcji({
    typ: "manipulacja_gpw", caseName: "HUBTECH", obecne: [], zatwierdzone: [], techniki: ["wash", "layering"],
  });

  it("zachowuje numerację GPW: Wnioski II, Wstęp III, Podsumowanie V", () => {
    expect(plan.find((k) => k.kind === "wnioski")?.no).toBe("II");
    expect(plan.find((k) => k.kind === "proza_iii")?.no).toBe("III");
    expect(plan.find((k) => k.kind === "proza_v")?.no).toBe("V");
  });

  it("rozdziały IV budowane są z danych („generuj”), nie rozwijane", () => {
    expect(plan.filter((k) => k.akcja.typ === "generuj-iv").length).toBeGreaterThan(0);
    expect(plan.some((k) => k.akcja.typ === "rozwin-modul")).toBe(false);
  });

  it("sprawa bez typu zachowuje się jak GPW — sprawy sprzed migracji 0010", () => {
    const p = planRedakcji({ typ: null, caseName: "HUBTECH", obecne: [], zatwierdzone: [] });
    expect(p.find((k) => k.kind === "wnioski")?.no).toBe("II");
  });
});

describe("blokady", () => {
  it("krok już zatwierdzony nie jest pokazywany jako zablokowany", () => {
    // W sprawie MBR Wnioski były zatwierdzone, a moduły nie — krok świecił się
    // na „zablokowany”, sugerując, że z gotową pracą jest coś nie tak.
    const p = planRedakcji({
      typ: "ryzyko_bankowe", caseName: "MBR",
      obecne: ["makro", "wnioski"], zatwierdzone: ["wnioski"],
    });
    expect(p.find((k) => k.kind === "wnioski")?.blokada).toBeUndefined();
    // Kroki niezatwierdzone blokad nie tracą.
    expect(p.find((k) => k.kind === "proza_iii")?.blokada).toBeUndefined(); // wnioski zatwierdzone
  });

  it("blokada zostaje, dopóki warunek nie jest spełniony", () => {
    const p = planRedakcji({
      typ: "ryzyko_bankowe", caseName: "X", obecne: ["makro"], zatwierdzone: [],
    });
    expect(p.find((k) => k.kind === "wnioski")?.blokada).toBeTruthy();
    expect(p.find((k) => k.kind === "proza_iii")?.blokada).toBeTruthy();
  });
});

describe("szkielet IV jest stały, zmienne są tylko techniki", () => {
  it("aktywność i relacje wchodzą ZAWSZE, choćby nie było ich w doborze technik", () => {
    // Regresja ze sprawy ZASTAL: dobór A2 = [wash, pumpdump, layering] dał plan bez
    // rozdziału o aktywności Grupy (tabele obrotu i atrybucja per podmiot NIE weszły
    // do opinii), a relacje przeskoczyły na IV.3. Wydruk wyglądał na kompletny, bo
    // numeracja była ciągła.
    const plan = buildPlanFromTechniques(["wash", "pumpdump", "layering"]);
    expect(plan.map((c) => `${c.no} ${c.kind}`)).toEqual([
      "IV.1 ekofin",
      "IV.2 espi",
      "IV.3 aktywnosc",
      "IV.4 wash",
      "IV.5 pumpdump",
      "IV.6 layering",
      "IV.7 relacje",
    ]);
  });

  it("nie dubluje rozdziałów strukturalnych, gdy są też w doborze", () => {
    const plan = buildPlanFromTechniques(["aktywnosc", "relacje", "wash"]);
    expect(plan.filter((c) => c.kind === "aktywnosc")).toHaveLength(1);
    expect(plan.filter((c) => c.kind === "relacje")).toHaveLength(1);
    expect(plan[plan.length - 1].kind).toBe("relacje");
  });
});
