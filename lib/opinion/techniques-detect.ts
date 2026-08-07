// Propozycja modułów rozdziału IV na podstawie SYGNAŁÓW DOWODOWYCH z metryk silnika.
//
// Zasada: to deterministyczna heurystyka (nie LLM, nie z opinii). Każda propozycja
// niesie swój sygnał liczbowy; biegły potwierdza lub odrzuca w zakładce A2.
// Katalog = techniki MAR + moduł przeglądowy „aktywnosc" (wzorzec-matka KM).

import type { IVKind } from "./chapters";

type Metric = { key: string; value: number | null; unit: string | null; session_day: string | null };
// Wyciąg zdarzeń ESPI (subanaliza `espi_events`) — źródło sygnału manipulacji informacją.
type SubLite = { kind: string; data: { events?: { session?: string; chg?: number | null; date?: string }[] } | null };

export type Proposal = { id: IVKind; auto: boolean; signal: string };

const pl = (n: number) => n.toLocaleString("pl-PL");

function peak(metrics: Metric[], prefix: string): Metric | null {
  return metrics
    .filter((m) => m.key.startsWith(prefix))
    .reduce<Metric | null>((a, b) => ((b.value ?? -1) > (a?.value ?? -1) ? b : a), null);
}

function find(metrics: Metric[], key: string): number | null {
  return metrics.find((m) => m.key === key)?.value ?? null;
}

// Krótkie okno = pełny przegląd aktywności per sesja wykonalny (KM HUBTECH: 12 sesji
// — moduł jest; KM MLM: 101 sesji — modułu brak, przegląd zastępuje analiza per technika).
const AKT_MAX_SESSIONS = 30;

// Koncentracja: sygnał od 30% wolumenu sesji w szczytowym oknie 15-minutowym.
const CONC_MIN_SHARE = 30;
// Manipulacja informacją: sygnał, gdy komunikat ESPI zbiega się z sesją o |zmianie| ≥ 10%.
const INFO_MIN_CHG = 10;

export function proposeTechniques(metrics: Metric[], stored: SubLite[] = []): Proposal[] {
  const gs = metrics.find((m) => m.key === "group_turnover_share") ?? null;
  const wp = peak(metrics, "wash_");
  const cp = peak(metrics, "cancel_");
  const sessions = new Set(metrics.filter((m) => m.session_day).map((m) => m.session_day)).size;
  const imoCount = find(metrics, "imo_count");
  const imoValue = find(metrics, "imo_value");
  const pump = find(metrics, "phase_pump_pct");
  const dump = find(metrics, "phase_dump_pct");
  // Detektory wskaźnikowe zał. I MAR: fixing (g), odwrócenie pozycji (d), koncentracja (e).
  const fx = peak(metrics, "fix_pre_cancel_vol");
  const rv = peak(metrics, "rev_val::");
  const cc = peak(metrics, "conc_peak_share");
  // Rozróżnienie stanów, żeby komunikat nie mówił „policz wskaźniki", gdy JUŻ policzono:
  //  (a) metryk brak w ogóle → policz wskaźniki;
  //  (b) metryki są, ale danego wskaźnika nie da się wyznaczyć z policzonego pliku
  //      (np. brak arkusza zleceń albo kolumny UTP, jak TIME_DIFF w danych TREM).
  const computed = metrics.length > 0;
  const gap = (need: string) =>
    computed
      ? `policzono — brak danych do tego wskaźnika: ${need}`
      : "brak policzonych wskaźników — uruchom krok Wskaźniki";
  // Manipulacja informacją: komunikaty ESPI zbieżne z sesjami o dużej zmianie kursu.
  const events = (stored.find((s) => s.kind === "espi_events")?.data?.events ?? []).filter(
    (e) => e.session && e.chg != null && Math.abs(e.chg) >= INFO_MIN_CHG,
  );
  const espiHits = events;
  const espiTop = events.reduce<(typeof events)[number] | null>(
    (a, b) => (Math.abs(b.chg ?? 0) > Math.abs(a?.chg ?? 0) ? b : a),
    null,
  );
  return [
    {
      id: "aktywnosc",
      auto: sessions > 0 && sessions <= AKT_MAX_SESSIONS,
      signal: !sessions
        ? gap("wymaga transakcji z datą sesji")
        : sessions <= AKT_MAX_SESSIONS
          ? `okno ${sessions} sesji${gs?.value != null ? `, udział Grupy ${gs.value}%` : ""} — pełny przegląd aktywności per sesja wykonalny`
          : `długi okres (${sessions} sesji) — przegląd zastąpi analiza per technika (np. layering sesja-po-sesji)`,
    },
    {
      id: "wash",
      auto: !!(wp && (wp.value ?? 0) > 0),
      signal:
        wp && wp.value != null
          ? `wolumen transakcji wewnątrzgrupowych do ${wp.value}% wolumenu sesji (${wp.session_day})`
          : gap("wymaga transakcji z identyfikacją właścicieli (rachunki wewnątrzgrupowe)"),
    },
    {
      id: "layering",
      auto: !!(cp && (cp.value ?? 0) > 0),
      signal:
        cp && cp.value != null
          ? `anulacje zleceń kupna Grupy do ${cp.value}% zadeklarowanego wolumenu (${cp.session_day})`
          : gap("wymaga arkusza zleceń (Zlecenia BO) w pliku UTP"),
    },
    {
      // Pojedyncze dopasowanie ≈ szum; sygnał od ≥2 dopasowań wewnątrzgrupowych ≤2 s.
      id: "imo",
      auto: (imoCount ?? 0) >= 2,
      signal:
        imoCount == null
          ? gap("wymaga kolumny czasu złożenia zleceń (TIME_DIFF) — nieobecnej w danych TREM")
          : imoCount === 0
            ? "0 dopasowań wzajemnych ≤2 s — brak sygnału"
            : `${imoCount} dopasowań wzajemnych (≤2 s) o wartości ${(imoValue ?? 0).toLocaleString("pl-PL")} zł` +
              (imoCount < 2 ? " — pojedynczy przypadek, sygnał słaby" : ""),
    },
    {
      id: "pumpdump",
      auto: pump != null && dump != null && pump > 0 && dump < 0,
      signal:
        pump != null && dump != null
          ? `faza pump ${pump > 0 ? "+" : ""}${pump}% i dump ${dump}% (detektor faz kursu)`
          : gs && gs.value != null
            ? `udział Grupy w obrocie ${gs.value}% — oceń dynamikę kursu (rozdz. ekon-fin)`
            : "oceń dynamikę kursu i fazę wyprzedaży (rozdz. ekon-fin)",
    },
    // ── Detektory wskaźnikowe zał. I MAR (dodane PO katalogu bazowym) ──
    {
      id: "fixing",
      auto: !!(fx && (fx.value ?? 0) > 0),
      signal:
        fx && fx.value != null
          ? `${pl(fx.value)} szt w zleceniach Grupy 16:50–17:00 niewprowadzonych do obrotu (${fx.session_day})`
          : gap("wymaga arkusza zleceń (Zlecenia BO) w pliku UTP"),
    },
    {
      id: "reversal",
      auto: !!(rv && (rv.value ?? 0) > 0),
      signal:
        rv && rv.value != null
          ? `odwrócenie pozycji do ${pl(rv.value)} zł w jednej sesji — ${rv.key.slice("rev_val::".length)} (${rv.session_day})`
          : computed
            ? "brak odwróceń pozycji ≥ 50 tys. zł w jednej sesji — brak sygnału"
            : "brak policzonych wskaźników — uruchom krok Wskaźniki",
    },
    {
      id: "concentration",
      auto: !!(cc && (cc.value ?? 0) >= CONC_MIN_SHARE),
      signal:
        cc && cc.value != null
          ? `szczytowe okno 15 min sesji ${cc.session_day}: Grupa ${cc.value}% wolumenu sesji` +
            ((cc.value ?? 0) < CONC_MIN_SHARE ? ` — poniżej progu ${CONC_MIN_SHARE}%` : "")
          : computed
            ? "brak koncentracji śróddziennej w policzonym pliku (możliwa do uzupełnienia z danych transakcyjnych)"
            : "brak policzonych wskaźników — uruchom krok Wskaźniki",
    },
    {
      id: "infomanip",
      auto: espiHits.length >= 1,
      signal: espiHits.length
        ? `${espiHits.length} komunikat(ów) ESPI zbieżnych z sesjami o |zmianie kursu| ≥ ${INFO_MIN_CHG}%` +
          (espiTop ? ` (maks. ${espiTop.chg! > 0 ? "+" : ""}${pl(espiTop.chg!)}% — ${espiTop.session})` : "")
        : "brak wyciągu zdarzeń ESPI — uruchom „Zdarzenia ESPI → IV.3” (zakładka Recenzent)",
    },
  ];
}

/**
 * Propozycje technik ODRĘBNIE DLA KAŻDEGO INSTRUMENTU.
 *
 * ⚠️ POWÓD ISTNIENIA — sprawa ZASTAL (CSY S.A. i RSY S.A.). Detekcja na zestawie
 * ŁĄCZNYM odpowiada na pytanie „czy w tej sprawie wystąpiła technika X", podczas
 * gdy postanowienie pyta o obrót KAŻDYM z walorów z osobna. Różnica nie jest
 * teoretyczna: layering wykryto w 6 sesjach obrotu akcjami CSY i w ZERO sesjach
 * obrotu akcjami RSY, a zestaw łączny pokazywał 12 sesji — bo anulacje zleceń
 * jednego waloru zestawiał ze sprzedażą drugiego. Przypisanie techniki niewłaściwemu
 * instrumentowi jest w opinii sądowej zarzutem wobec obrotu, którego nie było.
 *
 * Funkcja NIE rozstrzyga doboru — proponuje. Wybór zatwierdza biegły (zakładka A2),
 * osobno dla każdego instrumentu.
 */
export function proposeTechniquesPerInstrument(
  instrumenty: { ticker: string; label: string }[],
  metrykiDla: (ticker: string) => Metric[],
  stored: SubLite[] = [],
): { label: string; ticker: string; proposals: Proposal[] }[] {
  return instrumenty.map((i) => ({
    ticker: i.ticker,
    label: i.label,
    proposals: proposeTechniques(metrykiDla(i.ticker), stored),
  }));
}

/**
 * Techniki, które wystąpiły w CO NAJMNIEJ jednym instrumencie (suma propozycji).
 *
 * Rozdział opinii poświęcony technice powstaje raz, ale MUSI powiedzieć, którego
 * waloru dotyczy — stąd obok sumy zwracamy przypisanie technika → instrumenty.
 */
export function technikiWgInstrumentow(
  wg: { label: string; proposals: Proposal[] }[],
): { id: IVKind; instrumenty: string[]; sygnaly: string[] }[] {
  const mapa = new Map<IVKind, { instrumenty: string[]; sygnaly: string[] }>();
  for (const { label, proposals } of wg)
    for (const p of proposals.filter((x) => x.auto)) {
      const w = mapa.get(p.id) ?? { instrumenty: [], sygnaly: [] };
      w.instrumenty.push(label);
      w.sygnaly.push(`${label}: ${p.signal}`);
      mapa.set(p.id, w);
    }
  return [...mapa.entries()].map(([id, w]) => ({ id, ...w }));
}
