import { describe, expect, it } from "vitest";

import { rozdzialyDoZatwierdzenia, sprawdzFinalna } from "@/lib/opinion/bramka-finalna";
import { ponumerujElementy, type Chapter, type Opinion } from "@/lib/opinion/build";

const tab = (caption: string) => ({ caption, head: ["A"], rows: [["1"]] });
const ROZDZIALY: Chapter[] = [
  { no: "III", title: "Wnioski", status: "ready", paras: [], table: tab("Tabela. Rejestr ustaleń") },
  {
    no: "V.A",
    title: "Analiza",
    status: "draft",
    paras: [],
    tables: [tab("Tabela. Wskaźniki w czasie"), tab("Tabela. Pozycje bilansowe")],
    placeholders: [{ kind: "wykres" as const, name: "adekwatnosc_2", label: "Współczynnik wypłacalności" }],
  },
  { no: "VII", title: "Spis tabel", status: "draft", paras: [] },
];

describe("numeracja ciągła tabel i wykresów", () => {
  it("numer trafia do PODPISU, nie tylko do spisu", () => {
    // Numery istniały wyłącznie w spisach: spis odsyłał do „Tabeli 3", a w treści
    // każda tabela nosiła podpis „Tabela. …", bez numeru.
    const w = ponumerujElementy(ROZDZIALY, ["VII"]);
    expect(w.chapters[0].table!.caption).toBe("Tabela 1. Rejestr ustaleń");
    expect(w.chapters[1].tables![0].caption).toBe("Tabela 2. Wskaźniki w czasie");
    expect(w.chapters[1].tables![1].caption).toBe("Tabela 3. Pozycje bilansowe");
  });

  it("liczy przez WSZYSTKIE rozdziały, nie tylko moduły analizy", () => {
    // Spis skanował wyłącznie moduły V.x — tabele z rozdziałów III i IV nie trafiały
    // do niego wcale.
    const w = ponumerujElementy(ROZDZIALY, ["VII"]);
    expect(w.tabele.map((t) => t.rozdzial)).toEqual(["III", "V.A", "V.A"]);
    expect(w.tabele).toHaveLength(3);
  });

  it("podpis wykresu nie zawiera identyfikatora generatora", () => {
    // W dokumencie widniało „Współczynnik wypłacalności. adekwatnosc_2".
    const w = ponumerujElementy(ROZDZIALY, ["VII"]);
    const ph = w.chapters[1].placeholders![0];
    expect(ph.label).toBe("Wykres 1. Współczynnik wypłacalności");
    expect(ph.label).not.toContain("adekwatnosc_2");
  });

  it("rozdział spisowy nie numeruje sam siebie", () => {
    const zeSpisem: Chapter[] = [...ROZDZIALY.slice(0, 2),
      { no: "VII", title: "Spis tabel", status: "draft", paras: [], table: tab("Tabela. Spis") }];
    const w = ponumerujElementy(zeSpisem, ["VII"]);
    expect(w.tabele).toHaveLength(3);
    expect(w.chapters[2].table!.caption).toBe("Tabela. Spis");
  });

  it("ponowne przeliczenie nie dokłada numeru do numeru", () => {
    const raz = ponumerujElementy(ROZDZIALY, ["VII"]);
    const dwa = ponumerujElementy(raz.chapters, ["VII"]);
    expect(dwa.chapters[0].table!.caption).toBe("Tabela 1. Rejestr ustaleń");
  });
});

describe("bramka wersji finalnej", () => {
  const opinia = (statusy: [string, string, Chapter["status"]][]): Opinion => ({
    caseName: "X", signature: "1", expert: "KM", generatedAt: "2026-01-01", legalBasis: [],
    chapters: statusy.map(([no, title, status]) => ({ no, title, status, paras: [] })),
  });

  it("odmawia, gdy rozdział merytoryczny jest szkicem", () => {
    // `?final=1` był zwykłym parametrem w adresie: dawało się pobrać „opinię
    // finalną" złożoną wyłącznie ze szkiców, bez adnotacji „(projekt roboczy)".
    const w = sprawdzFinalna(opinia([["III", "Wnioski", "draft"], ["V.A", "Analiza", "ready"]]));
    expect(w.ok).toBe(false);
    if (!w.ok) {
      expect(w.rozdzialy).toEqual(["III"]);
      expect(w.powod).toContain("zatwierdzenia");
    }
  });

  it("spisy i załączniki nie blokują — powstają mechanicznie", () => {
    const w = sprawdzFinalna(
      opinia([["III", "Wnioski", "ready"], ["VI", "Załączniki", "draft"], ["VII", "Spis tabel", "draft"]]),
    );
    expect(w.ok).toBe(true);
  });

  it("interfejs i serwer liczą to samo", () => {
    const op = opinia([["III", "Wnioski", "draft"], ["VII", "Spis tabel", "draft"]]);
    const z = sprawdzFinalna(op);
    expect(rozdzialyDoZatwierdzenia(op)).toEqual(z.ok ? [] : z.rozdzialy);
  });
});
