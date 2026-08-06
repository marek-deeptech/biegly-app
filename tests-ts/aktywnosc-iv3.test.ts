/**
 * IV.3 — dobór sesji istotnych i tabele aktywności Grupy.
 *
 * ⚠️ SEDNO: dobór sesji do tabel szczegółowych jest DOBOREM MATERIAŁU DOWODOWEGO.
 * Musi być deterministyczny (te same dane → ta sama lista), progowy (a nie „top N",
 * bo top N zawsze coś wybierze, także gdy nic się nie działo) i musi nieść POWÓD,
 * bo w opinii trzeba powiedzieć, czym dana sesja się wyróżniła.
 */
import { describe, expect, it } from "vitest";
import {
  PROGI_DOMYSLNE,
  opisProgow,
  sesjeIstotne,
  tabelaPodmiotow,
  tabelaPrzebiegu,
  tabelaSesji,
  wybierzDoTabel,
  type Metryka,
} from "@/lib/opinion/aktywnosc-iv3";

const m = (key: string, value: number | null, session_day?: string): Metryka => ({ key, value, session_day });

// Formatowanie polskie używa TWARDEJ spacji (U+00A0) jako separatora tysięcy,
// a liczb czterocyfrowych w ogóle nie grupuje (minimumGroupingDigits=2 w CLDR).
// Asercje porównują liczby, nie znaki białe — inaczej test pękałby przy zmianie
// wersji ICU, nie przy zmianie logiki.
const norm = (s: string) => s.replace(/[\s  ]/g, " ");

const SESJE: Metryka[] = [
  // sesja spokojna — nic nie przekracza progów
  m("day_sess_vol", 10000, "2018-01-02"), m("day_grp_vol", 1000, "2018-01-02"),
  m("day_intra_vol", 100, "2018-01-02"), m("day_close", 2.5, "2018-01-02"), m("day_change_pct", 1.2, "2018-01-02"),
  // sesja z dominacją Grupy i obrotem wewnątrzgrupowym
  m("day_sess_vol", 8000, "2018-01-03"), m("day_grp_vol", 7200, "2018-01-03"),
  m("day_intra_vol", 4000, "2018-01-03"), m("day_close", 2.9, "2018-01-03"), m("day_change_pct", 16, "2018-01-03"),
  m("cancel_2018-01-03", 100, undefined),
  // sesja wyróżniona samą koncentracją
  m("day_sess_vol", 5000, "2018-02-15"), m("day_grp_vol", 500, "2018-02-15"),
  m("conc_peak_share", 71.5, "2018-02-15"), m("day_close", 2.7, "2018-02-15"), m("day_change_pct", -3, "2018-02-15"),
];

const PODMIOTY: Metryka[] = [
  m("ede_bvol::zalewski", 5000, "2018-01-03"), m("ede_bval::zalewski", 14500, "2018-01-03"),
  m("ede_svol::zalewski", 1000, "2018-01-03"), m("ede_sval::zalewski", 2900, "2018-01-03"),
  m("ede_bvol::sroka", 200, "2018-01-03"), m("ede_bval::sroka", 580, "2018-01-03"),
  m("ede_svol::sroka", 4200, "2018-01-03"), m("ede_sval::sroka", 12180, "2018-01-03"),
  m("ede_bvol::zalewski", 300, "2018-02-15"), m("ede_bval::zalewski", 810, "2018-02-15"),
];

describe("sesjeIstotne", () => {
  it("pomija sesję bez przekroczeń i wybiera te z przekroczeniem — z powodem", () => {
    const s = sesjeIstotne(SESJE);
    expect(s.map((x) => x.dzien)).toEqual(["2018-01-03", "2018-02-15"]);
    const styczen = s[0];
    expect(styczen.powody.join(" | ")).toMatch(/udział Grupy/);
    expect(styczen.powody.join(" | ")).toMatch(/wewnątrzgrupowy/);
    expect(styczen.powody.join(" | ")).toMatch(/anulowany wolumen kupna/);
    expect(styczen.powody.join(" | ")).toMatch(/zmiana kursu \+/);
    expect(s[1].powody.join(" ")).toMatch(/koncentracja/);
  });

  it("jest deterministyczny i progowy — nie wybiera nic, gdy nic nie przekracza progu", () => {
    const spokojne = SESJE.filter((x) => x.session_day === "2018-01-02");
    expect(sesjeIstotne(spokojne)).toEqual([]);
    // ta sama lista przy dwóch przebiegach (bez sortowania po wartościach losowych)
    expect(sesjeIstotne(SESJE)).toEqual(sesjeIstotne(SESJE));
  });

  it("progi da się zaostrzyć — wtedy zostają tylko sesje najsilniejsze", () => {
    const s = sesjeIstotne(SESJE, { ...PROGI_DOMYSLNE, koncentracja: 99, zmianaKursu: 99, wewnatrzgrupowy: 99, anulacje: 99 });
    expect(s.map((x) => x.dzien)).toEqual(["2018-01-03"]); // zostaje po samym udziale Grupy (90%)
  });

  it("opis progów wchodzi do podpisu — dobór materiału musi być jawny", () => {
    expect(opisProgow(PROGI_DOMYSLNE)).toMatch(/udział Grupy w wolumenie sesji ≥ 50 %/);
  });
});

describe("tabele IV.3", () => {
  it("przebieg sesji liczy udział Grupy z ilorazu, nie przepisuje", () => {
    const t = tabelaPrzebiegu(SESJE, "CSY S.A.")!;
    const w = t.rows.find((r) => r[0] === "2018-01-03")!;
    expect(w[5]).toBe("90 %"); // 7200 / 8000
    expect(t.caption).toContain("CSY S.A.");
  });

  it("zestawienie podmiotów sumuje sesje i liczy saldo gotówki", () => {
    const t = tabelaPodmiotow(PODMIOTY)!;
    const zal = t.rows.find((r) => r[0] === "zalewski")!;
    expect(zal[1]).toBe("2"); // dwie sesje z aktywnością
    // saldo gotówki = sprzedaż − kupno = 2 900 − (14 500 + 810)
    expect(norm(zal[7])).toBe("-12 410");
    const sro = t.rows.find((r) => r[0] === "sroka")!;
    expect(norm(sro[6])).toBe("-4000"); // saldo wolumenu 200 − 4 200
  });

  it("tabela sesji obejmuje tylko wskazany dzień i niesie powód w podpisie", () => {
    const t = tabelaSesji(PODMIOTY, "2018-01-03", ["udział Grupy w wolumenie sesji 90 %"])!;
    expect(t.rows).toHaveLength(2);
    expect(t.caption).toContain("2018-01-03");
    expect(t.caption).toContain("udział Grupy");
    // dane z 15.02 nie wchodzą do tabeli sesji z 03.01
    expect(norm(t.rows.find((r) => r[0] === "zalewski")![1])).toBe("5000");
  });

  it("brak danych podmiotowych daje null, a nie pustą tabelę", () => {
    expect(tabelaSesji(PODMIOTY, "2019-01-01", [])).toBeNull();
    expect(tabelaPodmiotow([])).toBeNull();
    expect(tabelaPrzebiegu([])).toBeNull();
  });
});

describe("wybierzDoTabel", () => {
  it("bierze sesje o największej liczbie kryteriów, ale zwraca chronologicznie", () => {
    // Regresja: „pierwsze N chronologicznie" dałoby w sprawie ZASTAL rozdział
    // o samym grudniu 2017 i milczenie o dwóch latach — cięcie arbitralne.
    const s = sesjeIstotne(SESJE);
    const w = wybierzDoTabel(s, 1);
    expect(w.map((x) => x.dzien)).toEqual(["2018-01-03"]); // 4 kryteria vs 1
    const dwa = wybierzDoTabel(s, 2).map((x) => x.dzien);
    expect(dwa).toEqual(["2018-01-03", "2018-02-15"]); // porządek dat, nie rankingu
  });

  it("waga to liczba kryteriów, szczyt to największe przekroczenie progu", () => {
    const s = sesjeIstotne(SESJE);
    const styczen = s.find((x) => x.dzien === "2018-01-03")!;
    expect(styczen.waga).toBe(styczen.powody.length);
    expect(styczen.waga).toBeGreaterThan(1);
    // anulacje 100 % przy progu 50 % → dwukrotne przekroczenie
    expect(styczen.szczyt).toBeGreaterThanOrEqual(2);
  });
});
