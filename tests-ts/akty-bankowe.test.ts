/**
 * Rejestr regulacji bankowych (krok „Baza wiedzy") — testy pilnują trzech rzeczy,
 * które w narzędziu okołosądowym są groźne: linków do tekstów urzędowych (martwy
 * odnośnik = brak dostępu do źródła), DAT (MiFID II powołany do zdarzenia z 2015 r.
 * to anachronizm) i zakresu podmiotowego (co naprawdę dotyczy banku spółdzielczego).
 */
import { describe, expect, it } from "vitest";

import {
  AKTY_BANKOWE,
  rejestrWgRodzaju,
  RODZAJE_AKTOW,
  statusNaDzien,
} from "@/lib/domain/akty-bankowe";

const akt = (id: string) => AKTY_BANKOWE.find((a) => a.id === id)!;

describe("rejestr aktów bankowych", () => {
  it("każdy wpis ma poprawne daty, znany rodzaj, zakres BS i unikalny identyfikator", () => {
    const rodzaje = new Set(RODZAJE_AKTOW.map((r) => r.id));
    const idki = new Set<string>();
    for (const a of AKTY_BANKOWE) {
      expect(a.od, a.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (a.do) expect(a.do >= a.od, `${a.id}: do < od`).toBe(true);
      expect(rodzaje.has(a.rodzaj), `${a.id}: rodzaj ${a.rodzaj}`).toBe(true);
      expect(["wprost", "posrednio", "warunkowo"]).toContain(a.dotyczyBS);
      expect(a.zakres.length, `${a.id}: pusty zakres`).toBeGreaterThan(20);
      expect(idki.has(a.id), `${a.id}: duplikat`).toBe(false);
      idki.add(a.id);
    }
  });

  it("każdy link prowadzi do serwisu urzędowego w znanym formacie", () => {
    // ISAP: identyfikator WDU; EUR-Lex: permalink CELEX; KNF/BIS: strony instytucji.
    const wzorce = [
      /^https:\/\/isap\.sejm\.gov\.pl\/isap\.nsf\/DocDetails\.xsp\?id=WDU\d{11}$/,
      /^https:\/\/eur-lex\.europa\.eu\/legal-content\/PL\/TXT\/\?uri=CELEX:3\d{4}[LR]\d{4}$/,
      /^https:\/\/www\.knf\.gov\.pl\//,
      /^https:\/\/www\.bis\.org\//,
    ];
    for (const a of AKTY_BANKOWE) {
      expect(wzorce.some((w) => w.test(a.link)), `${a.id}: nieznany format linku ${a.link}`).toBe(true);
    }
  });

  it("MiFID II jest w rejestrze, ale dla zdarzeń MBR i SK Banku jest ANACHRONIZMEM", () => {
    // Odpowiedź na pytanie klienta wprost: MiFID II należy do bazy wiedzy jako
    // krajobraz, lecz stosuje się od 3.01.2018 — po obu badanych zdarzeniach.
    const m2 = akt("mifid2");
    expect(m2.od).toBe("2018-01-03");
    expect(statusNaDzien(m2, "2008-09-11")).toBe("po_zdarzeniu");
    expect(statusNaDzien(m2, "2015-03-16")).toBe("po_zdarzeniu");
    // W dacie zdarzenia MBR właściwa czasowo była MiFID I (od 1.11.2007)…
    expect(statusNaDzien(akt("mifid1"), "2008-09-11")).toBe("obowiazywal");
    // …a przed listopadem 2007 – żadna z nich.
    expect(statusNaDzien(akt("mifid1"), "2007-06-30")).toBe("po_zdarzeniu");
    // Po 3.01.2018 MiFID I jest z kolei uchylona — rejestr nie podsunie jej do 2020 r.
    expect(statusNaDzien(akt("mifid1"), "2020-01-01")).toBe("uchylony_przed");
    // MiFID dotyczy BS tylko WARUNKOWO — lokata międzybankowa nie jest instrumentem.
    expect(m2.dotyczyBS).toBe("warunkowo");
  });

  it("epoki reżimu ostrożnościowego nie mieszają się: KNB 2007 ↔ CRR", () => {
    expect(statusNaDzien(akt("uchwaly_knb_2007"), "2008-09-11")).toBe("obowiazywal");
    expect(statusNaDzien(akt("crr"), "2008-09-11")).toBe("po_zdarzeniu");
    expect(statusNaDzien(akt("uchwaly_knb_2007"), "2015-03-16")).toBe("uchylony_przed");
    expect(statusNaDzien(akt("crr"), "2015-03-16")).toBe("obowiazywal");
  });

  it("rozporządzenie o rezerwach celowych (sedno SK) obowiązywało w 2015 r.", () => {
    expect(statusNaDzien(akt("rezerwy_celowe"), "2015-03-16")).toBe("obowiazywal");
    expect(akt("rezerwy_celowe").dotyczyBS).toBe("wprost");
  });

  it("filary ustroju banku spółdzielczego dotyczą go WPROST", () => {
    for (const id of ["prawo_bankowe", "prawo_spoldzielcze", "ustawa_bs", "bfg_1994", "rachunkowosc"]) {
      expect(akt(id).dotyczyBS, id).toBe("wprost");
    }
    // MAR — tylko warunkowo (bank jako emitent, np. obligacje SK Banku na Catalyst),
    // i dopiero od 3.07.2016: dla zdarzeń SK (2012–2015) anachronizm.
    expect(akt("mar").dotyczyBS).toBe("warunkowo");
    expect(statusNaDzien(akt("mar"), "2015-03-16")).toBe("po_zdarzeniu");
  });

  it("rekomendacje KNF są oznaczone jako wersjonowane — bez udawanej precyzji dat", () => {
    const rekomendacje = AKTY_BANKOWE.filter((a) => a.id.startsWith("rekomendacja_"));
    expect(rekomendacje.length).toBeGreaterThanOrEqual(6);
    for (const r of rekomendacje) expect(r.wersjonowany, r.id).toBe(true);
  });

  it("grupowanie po rodzaju obejmuje cały rejestr, posortowany datami", () => {
    const grupy = rejestrWgRodzaju();
    expect(grupy.flatMap((g) => g.akty).length).toBe(AKTY_BANKOWE.length);
    for (const g of grupy) {
      const dni = g.akty.map((a) => a.od);
      expect(dni).toEqual([...dni].sort());
    }
  });
});
