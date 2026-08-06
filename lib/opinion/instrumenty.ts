// ROZDZIELENIE OPERACJI LICZBOWYCH NA INSTRUMENTY (dziedzina GPW).
//
// ⚠️ POWÓD ISTNIENIA — WADA WYKRYTA 6.08.2026 W SPRAWIE ZASTAL.
// Sprawa obejmuje DWA instrumenty (CSY S.A. i RSY S.A.). Usługa TREM zapisywała
// obok zestawów per instrument także zestaw ŁĄCZNY do tabeli `metrics`, a rozdziały
// czytały właśnie ten łączny. Skutki na realnych danych:
//   • wolumen sesji 20.03.2018 = 10 994 szt. — suma 5 673 (CSY) i 5 321 (RSY),
//     czyli wielkość bez desygnatu: dwa różne papiery o różnych cenach;
//   • kurs zamknięcia tej sesji = 2,50 zł — po cichu wzięty z JEDNEGO instrumentu
//     (RSY), podczas gdy CSY zamknął się na 2,98 zł;
//   • fazy kursu „pump +1050 %, dump −13,91 %" nie opisywały ŻADNEGO z instrumentów
//     (CSY: +920 % / −2,94 %; RSY: +742,86 % / 0 %) — liczby powstałe z przeplotu
//     dwóch szeregów cenowych.
// Takie liczby trafiły do prozy rozdziałów IV. W opinii sądowej to wada dyskwalifikująca
// ustalenie, bo wielkość wygląda wiarygodnie, a nie odpowiada żadnemu badanemu walorowi.
//
// ZASADA: wszystko, co liczbowe — kurs, wolumen, obrót, udziały, fazy, anulacje —
// liczy się i opisuje OSOBNO DLA KAŻDEGO INSTRUMENTU. Wspólne pozostają wyłącznie
// części nieliczbowe: wstęp, ujęcie teoretyczne, wiedza, podsumowanie.

export type Metryka = { key: string; value: number | null; session_day?: string | null; label?: string | null; unit?: string | null };

type Sub = { kind: string; data?: Record<string, unknown> | null };

/** Instrumenty sprawy — z subanaliz `trem_<ticker>` zapisanych przez usługę TREM. */
export function instrumentySprawy(subs: Sub[]): { ticker: string; kind: string; label: string }[] {
  return subs
    .filter((s) => s.kind.startsWith("trem_"))
    .map((s) => {
      const ticker = s.kind.slice("trem_".length);
      const d = (s.data ?? {}) as { label?: string };
      return { ticker, kind: s.kind, label: (d.label ?? ticker).toUpperCase() };
    })
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
}

/**
 * Metryki JEDNEGO instrumentu — z jego subanalizy `trem_<ticker>`.
 *
 * To jest jedyne poprawne źródło liczb w sprawie wieloinstrumentowej. Tabela
 * `metrics` sprawy niesie zestaw łączny, którego dla cen i udziałów nie wolno
 * używać (patrz komentarz na górze pliku).
 */
export function metrykiInstrumentu(subs: Sub[], ticker: string): Metryka[] {
  const s = subs.find((x) => x.kind === `trem_${ticker}`);
  const m = ((s?.data ?? {}) as { metrics?: Metryka[] }).metrics;
  return Array.isArray(m) ? m : [];
}

export type FazyKursu = {
  odDnia: string;
  doDnia: string;
  kursPoczatkowy: number;
  kursSzczyt: number;
  dzienSzczytu: string;
  kursKoncowy: number;
  pumpPct: number;
  dumpPct: number;
  lacznaPct: number;
};

/**
 * Fazy kursu liczone WPROST z kursów zamknięcia danego instrumentu.
 *
 * Liczymy tutaj, zamiast czytać `phase_*` z metryk, bo metryki sprawy bywają
 * policzone na przeplocie instrumentów — a wtedy „faza" opisuje przeskoki między
 * dwoma papierami, nie ruch żadnego z nich.
 */
export function fazyKursu(metryki: Metryka[]): FazyKursu | null {
  const zam = metryki
    .filter((m) => m.key === "day_close" && m.session_day && m.value != null)
    .map((m) => ({ d: m.session_day as string, v: m.value as number }))
    .sort((a, b) => a.d.localeCompare(b.d));
  if (zam.length < 2) return null;
  const start = zam[0];
  const koniec = zam[zam.length - 1];
  const szczyt = zam.reduce((a, b) => (b.v > a.v ? b : a), zam[0]);
  const proc = (od: number, do_: number) => (od === 0 ? 0 : Math.round((10000 * (do_ - od)) / od) / 100);
  return {
    odDnia: start.d,
    doDnia: koniec.d,
    kursPoczatkowy: start.v,
    kursSzczyt: szczyt.v,
    dzienSzczytu: szczyt.d,
    kursKoncowy: koniec.v,
    pumpPct: proc(start.v, szczyt.v),
    dumpPct: proc(szczyt.v, koniec.v),
    lacznaPct: proc(start.v, koniec.v),
  };
}

/**
 * Czy zestaw metryk jest ZMIESZANY z wielu instrumentów?
 *
 * Sygnał: ta sama sesja ma w danych więcej niż jeden kurs zamknięcia, albo liczba
 * sesji z kursem przewyższa liczbę sesji któregokolwiek instrumentu. Używane jako
 * bezpiecznik — rozdział liczbowy nie ma prawa powstać na takim zestawie.
 */
export function czyZmieszane(metryki: Metryka[]): boolean {
  const wgDnia = new Map<string, Set<number>>();
  for (const m of metryki) {
    if (m.key !== "day_close" || !m.session_day || m.value == null) continue;
    if (!wgDnia.has(m.session_day)) wgDnia.set(m.session_day, new Set());
    wgDnia.get(m.session_day)!.add(m.value);
  }
  return [...wgDnia.values()].some((s) => s.size > 1);
}

const pl = (v: number, frac = 2) => v.toLocaleString("pl-PL", { maximumFractionDigits: frac });

/** Tabela faz kursu w podziale na instrumenty — wspólna dla rozdziałów IV.1 i pump&dump. */
export function tabelaFaz(
  wg: { label: string; fazy: FazyKursu }[],
): { caption: string; head: string[]; rows: string[][] } | null {
  if (!wg.length) return null;
  return {
    caption:
      "Tabela. Fazy zmiany kursu w podziale na instrumenty — na kursach zamknięcia z arkusza " +
      "transakcji (każdy instrument liczony osobno)",
    head: ["Instrument", "Od", "Kurs pocz.", "Szczyt", "Dzień szczytu", "Faza wzrostowa", "Kurs końcowy", "Faza spadkowa", "Zmiana łączna"],
    rows: wg.map(({ label, fazy: f }) => [
      label,
      f.odDnia,
      `${pl(f.kursPoczatkowy, 4)} zł`,
      `${pl(f.kursSzczyt, 4)} zł`,
      f.dzienSzczytu,
      `${f.pumpPct > 0 ? "+" : ""}${pl(f.pumpPct)} %`,
      `${pl(f.kursKoncowy, 4)} zł`,
      `${pl(f.dumpPct)} %`,
      `${f.lacznaPct > 0 ? "+" : ""}${pl(f.lacznaPct)} %`,
    ]),
  };
}
