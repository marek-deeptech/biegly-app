/**
 * Rozróżnienie: LUKA W AKTACH vs MATERIAŁ DO POZYSKANIA PRZEZ BIEGŁEGO.
 *
 * ⚠️ POWÓD ISTNIENIA: rozdziały o publikacjach prasowych i o skali sektora
 * bankowego stały w opinii SK Banku puste, a aplikacja opisywała to jako brak
 * w aktach — sugerując lukę, o którą trzeba wystąpić do organu. Zmierzenie
 * opinii wzorcowej MBR pokazało, że to nieprawda: SZEŚĆ z ośmiu modułów analizy
 * powstało tam z materiału, którego w aktach nigdy nie było. Biegły wyszukał go
 * w źródłach powszechnie dostępnych i dołączył jako załączniki nr 1–6 (biuletyn
 * i raport stabilności Banku Centralnego Islandii, artykuły z Wyborcza.biz
 * i Financial Times, sprawozdania Glitnir).
 *
 * Konsekwencja praktyczna: wystąpienie do organu o artykuł prasowy jest pismem
 * bezprzedmiotowym — organ takich rzeczy nie gromadzi. Ten test pilnuje, żeby
 * takie pozycje nie trafiały na listę żądań do organu.
 */
import { describe, expect, it } from "vitest";
import { typyPozyskiwanePrzezBieglego } from "@/lib/intake/classify";
import { WYMOGI_BANK } from "@/lib/domain/taxonomy-bank";
import { buildCompleteness, pozyskujeBiegly } from "@/lib/intake/completeness";

const KODY = typyPozyskiwanePrzezBieglego("ryzyko_bankowe");

describe("typy dokumentów pozyskiwane przez biegłego", () => {
  it("obejmują dokładnie źródła spoza akt", () => {
    expect(new Set(KODY)).toEqual(
      new Set(["PRASA", "RAPORT_BANK_CENTRALNY", "DANE_RYNKOWE_SZEREG", "RATING_AGENCJA"]),
    );
  });

  it("NIE obejmują dokumentów banku ani organu", () => {
    // Protokół komitetu i materiał nadzoru przychodzą z aktami — o nie WOLNO
    // wystąpić do organu i trzeba, gdy ich brak.
    for (const kod of ["PROTOKOL_KOMITETU", "NADZOR_KNF", "UCHWALA_WEWNETRZNA", "SPRAWOZDANIE_BANK"])
      expect(KODY, `${kod} nie jest materiałem biegłego`).not.toContain(kod);
  });

  it("w dziedzinie manipulacji giełdowych nie ma takich typów", () => {
    // Pakiet GPW nie zna tych kodów — rozróżnienie jest bankowe i nie może
    // wyciec do spraw manipulacyjnych, które toczą się w sądzie.
    expect(typyPozyskiwanePrzezBieglego("manipulacja_gpw")).toEqual([]);
    expect(typyPozyskiwanePrzezBieglego(null)).toEqual([]);
  });
});

describe("wymogi kompletności dziedzą rozróżnienie po typach", () => {
  const wg = (id: string) => WYMOGI_BANK.find((w) => w.id === id)!;

  it("prasa, raporty banku centralnego i szeregi rynkowe należą do biegłego", () => {
    for (const id of ["prasa", "raporty_bc", "szeregi_rynkowe"])
      expect(pozyskujeBiegly(wg(id)), id).toBe(true);
  });

  it("metodyka limitów i protokoły należą do organu", () => {
    for (const id of ["metodyka_limitow", "protokoly", "uchwaly", "nadzor"])
      expect(pozyskujeBiegly(wg(id)), id).toBe(false);
  });

  it("wymóg spełniany TAKŻE dokumentem z akt należy do organu", () => {
    // `chronologia` zasila się z NADZOR_KNF — to materiał organu, nawet jeśli
    // biegły potrafiłby część odtworzyć samodzielnie. Koniunkcja, nie alternatywa.
    expect(pozyskujeBiegly(wg("chronologia"))).toBe(false);
  });
});

describe("raport kompletności rozdziela obie listy", () => {
  const PUSTE: never[] = [];

  it("bez żadnych dokumentów prasa idzie do pozyskania, a nie do zamówienia", () => {
    const r = buildCompleteness(PUSTE, "ryzyko_bankowe", "cywilne", "nadzor_nad_bankiem");
    const wszystko = [...r.doZamowienia, ...r.doPozyskania].join(" ");
    expect(wszystko).toMatch(/prasow|prasy/i);
    // Kluczowe: żądanie do organu NIE MOŻE zawierać pozycji prasowych.
    expect(r.doZamowienia.join(" "), "prasa trafiła do żądania wobec organu").not.toMatch(/publikacj\w* prasow/i);
    expect(r.doPozyskania.length).toBeGreaterThan(0);
  });

  it("listy się nie pokrywają", () => {
    const r = buildCompleteness(PUSTE, "ryzyko_bankowe", "cywilne", "nadzor_nad_bankiem");
    const wspolne = r.doZamowienia.filter((x) => r.doPozyskania.includes(x));
    expect(wspolne, `pozycje w obu listach: ${wspolne.join("; ")}`).toEqual([]);
  });
});
