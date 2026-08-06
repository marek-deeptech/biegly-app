/**
 * IV.4 (wash trades) i IV.6 (layering/spoofing) — tabele wzorca.
 *
 * ⚠️ SEDNO: atrybucja PER PODMIOT. Pytanie 1 postanowienia wymienia osoby z imienia
 * i nazwiska, więc zbiorcze „Grupa anulowała 74 %" nie jest odpowiedzią. Te testy
 * pilnują, że rozbicie po podmiotach powstaje i że liczy WYŁĄCZNIE zlecenia kupna —
 * technika polega na wystawianiu popytu, który nie ma dojść do skutku, a wciągnięcie
 * sprzedaży zatarłoby różnicę między wystawiającym warstwy a sprzedającym.
 */
import { describe, expect, it } from "vitest";
import {
  tabelaAnulacjiPodmiotow,
  tabelaParWewnatrzgrupowych,
  tabelaSekwencji,
  tabelaSesjiLayering,
  tabelaSesjiWash,
  type DzienSpoof,
  type Metryka,
} from "@/lib/opinion/techniki-iv46";

const norm = (s: string) => s.replace(/[\s ]/g, " ");

const DNI: DzienSpoof[] = [
  {
    day: "2017-12-12", manip: true, declared_buy: 12000, cancelled_buy: 10000, cancel_ratio: 0.8329,
    layer_orders: 4, price_levels: 6, sell_exec_vol: 900, entities: ["omegia", "wieczorek"],
    orders: [
      { entity: "omegia", side: "K", vol: 6000, cancelled: 6000, realised: 0, entry: "08:53:40", cancel: "10:02:44", limit: 1.0, cls: "layer" },
      { entity: "wieczorek", side: "K", vol: 4000, cancelled: 4000, realised: 0, entry: "09:10:00", cancel: "10:03:00", limit: 0.99, cls: "layer" },
      { entity: "wieczorek", side: "K", vol: 2000, cancelled: 0, realised: 2000, entry: "09:30:00", cancel: null, limit: 0.98 },
      // sprzedaż NIE wchodzi do wskaźnika anulacji kupna
      { entity: "omegia", side: "S", vol: 900, cancelled: 0, realised: 900, entry: "10:05:00", cancel: null, limit: 1.0 },
    ],
  },
  {
    day: "2018-01-05", manip: false, declared_buy: 1000, cancelled_buy: 100, cancel_ratio: 0.1,
    layer_orders: 0, price_levels: 1, sell_exec_vol: 0, entities: ["sroka"],
    orders: [{ entity: "sroka", side: "K", vol: 1000, cancelled: 100, realised: 900, entry: "09:00:00", cancel: "09:30:00", limit: 1.1 }],
  },
];

describe("IV.6 — anulacje per podmiot", () => {
  it("liczy wyłącznie zlecenia KUPNA i sortuje po wolumenie anulowanym", () => {
    const t = tabelaAnulacjiPodmiotow(DNI)!;
    expect(t.rows[0][0]).toBe("omegia"); // 6 000 anulowanych
    const om = t.rows.find((r) => r[0] === "omegia")!;
    // sprzedaż 900 szt. NIE powiększa wolumenu zleconego
    expect(norm(om[2])).toBe("6000");
    expect(om[4]).toBe("100 %");
    const wi = t.rows.find((r) => r[0] === "wieczorek")!;
    expect(norm(wi[2])).toBe("6000"); // 4 000 + 2 000
    expect(wi[4]).toBe("66,67 %");
    expect(wi[6]).toBe("1"); // jedno zlecenie warstwowe
  });

  it("filtr sesji manipulacyjnych zawęża materiał i mówi o tym w podpisie", () => {
    const t = tabelaAnulacjiPodmiotow(DNI, true)!;
    expect(t.rows.some((r) => r[0] === "sroka")).toBe(false);
    expect(t.caption).toMatch(/manipulacyjne/);
  });

  it("brak zleceń kupna daje null, a nie pustą tabelę", () => {
    expect(tabelaAnulacjiPodmiotow([{ ...DNI[0], orders: [] }])).toBeNull();
  });
});

describe("IV.6 — sesje i sekwencje", () => {
  it("przegląd sesji pomija dni bez anulacji, a filtr manip zostawia oznaczone", () => {
    const wszystkie = tabelaSesjiLayering(DNI)!;
    expect(wszystkie.rows).toHaveLength(2);
    const manip = tabelaSesjiLayering(DNI, true)!;
    expect(manip.rows.map((r) => r[0])).toEqual(["2017-12-12"]);
  });

  it("sekwencja jest chronologiczna po czasie złożenia i znaczy warstwy", () => {
    const t = tabelaSekwencji(DNI[0])!;
    expect(t.rows.map((r) => r[0])).toEqual(["08:53:40", "09:10:00", "09:30:00", "10:05:00"]);
    expect(t.rows[0][8]).toBe("warstwa");
    expect(t.rows[3][2]).toBe("sprzedaż");
    expect(t.caption).toContain("2017-12-12");
  });

  it("ucięcie długiej sekwencji jest POWIEDZIANE w podpisie", () => {
    const duzo: DzienSpoof = {
      ...DNI[0],
      orders: Array.from({ length: 50 }, (_, i) => ({
        entity: "omegia", side: "K", vol: 10, cancelled: 10, realised: 0,
        entry: `09:${String(i).padStart(2, "0")}:00`, cancel: "10:00:00", limit: 1,
      })),
    };
    const t = tabelaSekwencji(duzo, 40)!;
    expect(t.rows).toHaveLength(40);
    expect(t.caption).toMatch(/pokazano 40 z 50/);
  });
});

describe("IV.4 — wash trades", () => {
  const M: Metryka[] = [
    { key: "pair_intra::omegia|wieczorek", value: 30000 },
    { key: "pair_intra::sroka|zalewski", value: 10000 },
    { key: "wash_2017-12-12", value: 45.5 },
    { key: "wash_2018-01-05", value: 3 },
    { key: "day_sess_vol", value: 8000, session_day: "2017-12-12" },
    { key: "day_intra_vol", value: 3640, session_day: "2017-12-12" },
    { key: "day_close", value: 1.02, session_day: "2017-12-12" },
    { key: "day_change_pct", value: 12.5, session_day: "2017-12-12" },
  ];

  it("pary liczą udział w obrocie wewnątrzgrupowym", () => {
    const t = tabelaParWewnatrzgrupowych(M)!;
    expect(t.rows[0].slice(0, 2)).toEqual(["omegia", "wieczorek"]);
    expect(t.rows[0][3]).toBe("75 %");
    expect(t.rows[1][3]).toBe("25 %");
  });

  it("sesje wash wchodzą od progu i niosą kurs oraz zmianę", () => {
    const t = tabelaSesjiWash(M, 20)!;
    expect(t.rows.map((r) => r[0])).toEqual(["2017-12-12"]); // 3 % odpada
    expect(t.rows[0][5]).toBe("+12,5 %");
    expect(t.caption).toMatch(/co najmniej 20 %/);
  });

  it("brak par i brak sesji ponad próg dają null", () => {
    expect(tabelaParWewnatrzgrupowych([])).toBeNull();
    expect(tabelaSesjiWash(M, 99)).toBeNull();
  });
});
