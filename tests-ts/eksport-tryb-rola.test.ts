import { describe, expect, it } from "vitest";

import { buildOpinionBank, MODULY_V, tytulModulu } from "@/lib/opinion/build-bank";
import { reviewOpinion } from "@/lib/opinion/review";

const SPRAWA = (rola: string, tryb = "cywilne") => ({
  name: "SKOK",
  signature: "II C 595/23",
  typ: "ryzyko_bankowe",
  tryb,
  rola,
});

const SUB = (kind: string, title: string) => ({
  kind,
  chapter_no: "V",
  title,
  status: "szkic",
  body_md: "Treść rozdziału.",
  data: { table: null, findings: [], legalRefs: [] },
});

describe("tryb i rola docierają do dokumentu", () => {
  it("opinia niesie tryb, rolę i dziedzinę", () => {
    // Obie osie domykały się tylko w promptach — do eksportu nie docierały żadnym
    // kanałem, bo trasy wybierały cztery kolumny i kompilator tego nie zgłaszał.
    const op = buildOpinionBank(SPRAWA("nadzor_nad_bankiem"), [], [], []);
    expect(op.tryb).toBe("cywilne");
    expect(op.rola).toBe("nadzor_nad_bankiem");
    expect(op.typ).toBe("ryzyko_bankowe");
  });

  it("tytuł rozdziału o kwotach wynika z roli, nie ze stałej pierwszej sprawy", () => {
    const m = MODULY_V.find((x) => x.kind === "sprawozdania")!;
    expect(tytulModulu(m, "ocena_kontrahenta")).toContain("kontrahenta");
    expect(tytulModulu(m, "nadzor_nad_bankiem")).toBe("Wielkości bilansowe banku w okresach sprawozdawczych");
    // Pozostałe moduły opisują to samo niezależnie od roli.
    const chrono = MODULY_V.find((x) => x.kind === "chronologia_nadzoru")!;
    expect(tytulModulu(chrono, "nadzor_nad_bankiem")).toBe(chrono.tytul);
  });

  it("tytuł z roli trafia do zbudowanego rozdziału", () => {
    const op = buildOpinionBank(
      SPRAWA("nadzor_nad_bankiem"),
      [],
      [],
      [SUB("sprawozdania", "cokolwiek") as never],
    );
    const r = op.chapters.find((c) => c.no.startsWith("V."))!;
    expect(r.title).toBe("Wielkości bilansowe banku w okresach sprawozdawczych");
    expect(r.title).not.toContain("kontrahent");
  });

  it("każdy moduł ma własną literę — dwa miały F", () => {
    const litery = MODULY_V.map((m) => m.litera);
    expect(new Set(litery).size).toBe(litery.length);
  });
});

describe("rozdziały spisowe nie zostają gołym nagłówkiem", () => {
  it("pusty spis tabel dostaje zdanie", () => {
    const op = buildOpinionBank(SPRAWA("nadzor_nad_bankiem"), [], [], []);
    for (const no of ["VII", "VIII"]) {
      const ch = op.chapters.find((c) => c.no === no)!;
      expect(ch.paras.length).toBeGreaterThan(0);
      expect(ch.paras[0].text).toContain("nie zamieszczono");
    }
  });
});

describe("recenzent deterministyczny zna szkielet dziedziny", () => {
  const opinia = (typ: string | null, nrWnioskow: string) => ({
    caseName: "X",
    signature: "1",
    expert: "KM",
    generatedAt: "2026-01-01",
    legalBasis: [],
    typ,
    chapters: [{ no: nrWnioskow, title: "Wnioski", status: "todo" as const, paras: [] }],
  });

  it("w sprawie bankowej pyta o rozdział III, nie II", () => {
    // W szkielecie bankowym II to Podstawa prawna, a Wnioski są w III. Recenzent
    // badał nie ten rozdział i wskazywał biegłemu zły numer.
    const w = reviewOpinion(opinia("ryzyko_bankowe", "III") as never, [], []);
    expect(w.some((f) => f.message.includes("Rozdz. III „Wnioski”"))).toBe(true);
    expect(w.some((f) => f.message.includes("Rozdz. II „Wnioski”"))).toBe(false);
  });

  it("w sprawie o manipulację nadal pyta o rozdział II", () => {
    const w = reviewOpinion(opinia("manipulacja_gpw", "II") as never, [], []);
    expect(w.some((f) => f.message.includes("Rozdz. II „Wnioski”"))).toBe(true);
  });

  it("nie karze opinii bankowej za brak falsyfikacji manipulacji", () => {
    // WARN „nie nosi znamion manipulacji" padał w KAŻDEJ opinii bankowej
    // i odejmował punkty za brak czegoś, czego ta dziedzina nie zna.
    const bank = reviewOpinion(opinia("ryzyko_bankowe", "III") as never, [], []);
    expect(bank.some((f) => f.message.includes("falsyfikacji"))).toBe(false);
    const gpw = reviewOpinion(opinia("manipulacja_gpw", "II") as never, [], []);
    expect(gpw.some((f) => f.message.includes("falsyfikacji"))).toBe(true);
  });
});
