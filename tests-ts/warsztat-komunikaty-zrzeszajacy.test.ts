/**
 * Dwa filtry opisowe warsztatu bankowego — pułapki z realnych akt SK Banku.
 *
 * (1) Rozdział „Publikacje prasowe i KOMUNIKATY" czytał wyłącznie typ PRASA,
 *     a komunikaty KNF i raport bieżący emitenta leżą pod NADZOR_KNF / UPADLOSC_SYNDYK.
 * (2) Rozdział limitów przemilczał metodykę monitorowania zrzeszającego (k. 407–428),
 *     twierdząc „brak metodyki w aktach" — o metodyce DRUGIEJ strony relacji.
 */
import { describe, expect, it } from "vitest";
import { czyKomunikatUrzedowy, wierszeMetodykiZrzeszajacego } from "@/lib/opinion/warsztat-bank";

describe("czyKomunikatUrzedowy", () => {
  it("wpuszcza komunikat KNF i raport bieżący emitenta", () => {
    expect(czyKomunikatUrzedowy("NADZOR_KNF", "Komunikat KNF o ustanowieniu zarządu komisarycznego")).toBe(true);
    expect(czyKomunikatUrzedowy("UPADLOSC_SYNDYK", "Załącznik nr 18 - komunikat KNF o zawieszeniu działalności")).toBe(true);
    expect(czyKomunikatUrzedowy("UPADLOSC_SYNDYK", "Pismo syndyka z raportem bieżącym nr 7/2015 emitenta")).toBe(true);
  });

  it("NIE wpuszcza materiału nadzorczego niebędącego komunikatem ani prasy", () => {
    // BION i harmonogram to materiał nadzorczy do chronologii, nie komunikat publiczny.
    expect(czyKomunikatUrzedowy("NADZOR_KNF", "Ocena BION za 2014 r.")).toBe(false);
    expect(czyKomunikatUrzedowy("NADZOR_KNF", "Harmonogram działań UKNF wobec SBRiR")).toBe(false);
    // PRASA wchodzi własną ścieżką typową — filtr nie może jej liczyć drugi raz.
    expect(czyKomunikatUrzedowy("PRASA", "Komunikat prasowy banku")).toBe(false);
    expect(czyKomunikatUrzedowy("NADZOR_KNF", null)).toBe(false);
  });
});

describe("wierszeMetodykiZrzeszajacego", () => {
  const D = (opis: string, karta: number | null, doc_type = "UCHWALA_WEWNETRZNA") => ({
    doc_type,
    opis,
    karta_start: karta,
    rel_path: `akta/${opis.slice(0, 18)}.pdf`,
  });

  it("zbiera uchwałę 12/14, zasady monitorowania i metodykę oceny — po kartach", () => {
    const rows = wierszeMetodykiZrzeszajacego([
      D("Ocena sytuacji ekonomiczno-finansowej SBRiR według stanu na 31 marca 2014 r.", 445),
      D("Załącznik nr 1 do Zarządzenia nr 1/2012/BS/BPS - Metodyka oceny sytuacji zrzeszonych banków", 415),
      D("Uchwała Nr 12/14/AB/BS/2002 Zarządu Banku BPS S.A. w sprawie zasad monitorowania zrzeszonych banków spółdzielczych", 407),
      D("Załącznik do Uchwały Nr 12/14/AB/BS/2002 - Zasady monitorowania banków spółdzielczych zrzeszonych z BPS S.A.", 409),
    ]);
    expect(rows.map((r) => r[0])).toEqual(["k. 407", "k. 409", "k. 415"]);
    // kwartalna OCENA nie jest metodyką — ma własny moduł (oceny_zrzeszajacego)
    expect(rows.some((r) => r[1].includes("31 marca 2014"))).toBe(false);
  });

  it("dedupuje skan zdublowany i pomija inne typy dokumentów", () => {
    const dwa = [
      D("Uchwała Nr 12/14/AB/BS/2002 Zarządu Banku BPS S.A. w sprawie zasad monitorowania zrzeszonych banków spółdzielczych", 407),
      D("Uchwała Nr 12/14/AB/BS/2002 Zarządu Banku BPS S.A. w sprawie zasad monitorowania zrzeszonych banków spółdzielczych", 407),
      D("Zasady monitorowania banków spółdzielczych — omówienie w piśmie procesowym", 12, "PISMO_PROCESOWE"),
    ];
    expect(wierszeMetodykiZrzeszajacego(dwa)).toHaveLength(1);
  });
});
