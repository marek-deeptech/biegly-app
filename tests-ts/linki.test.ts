/**
 * Adresy źródeł w tekście ustaleń i tabel.
 *
 * ⚠️ Wzorzec musi być WĄSKI. W tych samych tabelach stoją nazwy spółek („Hub.Tech S.A."),
 * skróty prawne („art. 69 ust. 1") i nazwy plików („UTP TREM CSY.xlsx"); zamiana ich
 * w odnośniki dałaby martwe linki, a odnośnik prowadzący donikąd sugeruje, że coś
 * sprawdzono.
 */
import { describe, expect, it } from "vitest";
import { podzielNaLinki } from "@/lib/linki";

const linki = (s: string) => podzielNaLinki(s).filter((c) => c.link).map((c) => c.link);

describe("podzielNaLinki", () => {
  it("goła domena ze ścieżką dostaje https://", () => {
    expect(linki("Źródło: espiebi.pap.pl/node/372228")).toEqual(["https://espiebi.pap.pl/node/372228"]);
  });

  it("pełny adres zostaje bez zmian, a NAZWA SERWISU obok nie staje się linkiem", () => {
    // „Bankier.pl —" to wzmianka o źródle; linkowanie jej dawało drugi odnośnik
    // prowadzący na stronę główną, obok właściwego adresu w nawiasie.
    const u = "https://www.bankier.pl/gielda/notowania/akcje/HUBTECH/akcjonariat";
    expect(linki(`Bankier.pl — historia (${u}, pobrano 2026-08-07)`)).toEqual([u]);
  });

  it("goła domena BEZ ścieżki nie jest odsyłaczem", () => {
    expect(linki("espiebi.pap.pl broni się CAPTCHA")).toEqual([]);
    expect(linki("Serwis Bankier.pl jest źródłem wtórnym")).toEqual([]);
  });

  it("kropka na końcu zdania nie wchodzi do adresu", () => {
    const cz = podzielNaLinki("Dane z stooq.pl/q/d/?s=csy.");
    expect(cz.find((c) => c.link)!.tekst).toBe("stooq.pl/q/d/?s=csy");
    expect(cz[cz.length - 1].tekst).toBe(".");
  });

  it("nazwa spółki, skrót prawny i nazwa pliku NIE są linkami", () => {
    expect(linki("Hub.Tech S.A. — art. 69 ust. 1; plik UTP TREM CSY.xlsx")).toEqual([]);
    expect(linki("CSY S.A. i RSY S.A.")).toEqual([]);
    expect(linki("espi_espi_2017-10-05_rsy_2-2017_node372228.pdf")).toEqual([]);
  });

  it("tekst bez adresu wraca w całości jako jeden fragment", () => {
    expect(podzielNaLinki("Grupa objęła 47,52 % wolumenu")).toEqual([{ tekst: "Grupa objęła 47,52 % wolumenu" }]);
    expect(podzielNaLinki("")).toEqual([]);
  });

  it("kilka adresów w jednym zdaniu", () => {
    expect(linki("Porównaj espiebi.pap.pl/node/1 z newconnect.pl/notowania")).toEqual([
      "https://espiebi.pap.pl/node/1",
      "https://newconnect.pl/notowania",
    ]);
  });
});
