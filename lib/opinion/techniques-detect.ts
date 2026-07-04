// Propozycja modułów rozdziału IV na podstawie SYGNAŁÓW DOWODOWYCH z metryk silnika.
//
// Zasada: to deterministyczna heurystyka (nie LLM, nie z opinii). Każda propozycja
// niesie swój sygnał liczbowy; biegły potwierdza lub odrzuca w zakładce A2.
// Katalog = techniki MAR + moduł przeglądowy „aktywnosc" (wzorzec-matka KM).

import type { IVKind } from "./chapters";

type Metric = { key: string; value: number | null; unit: string | null; session_day: string | null };

export type Proposal = { id: IVKind; auto: boolean; signal: string };

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

export function proposeTechniques(metrics: Metric[]): Proposal[] {
  const gs = metrics.find((m) => m.key === "group_turnover_share") ?? null;
  const wp = peak(metrics, "wash_");
  const cp = peak(metrics, "cancel_");
  const sessions = new Set(metrics.filter((m) => m.session_day).map((m) => m.session_day)).size;
  const imoCount = find(metrics, "imo_count");
  const imoValue = find(metrics, "imo_value");
  const pump = find(metrics, "phase_pump_pct");
  const dump = find(metrics, "phase_dump_pct");
  return [
    {
      id: "aktywnosc",
      auto: sessions > 0 && sessions <= AKT_MAX_SESSIONS,
      signal: !sessions
        ? "brak policzonych sesji — policz wskaźniki"
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
          : "brak policzonego wskaźnika wash — policz wskaźniki",
    },
    {
      id: "layering",
      auto: !!(cp && (cp.value ?? 0) > 0),
      signal:
        cp && cp.value != null
          ? `anulacje zleceń kupna Grupy do ${cp.value}% zadeklarowanego wolumenu (${cp.session_day})`
          : "brak policzonego wskaźnika anulacji — policz wskaźniki (UTP ze zleceniami)",
    },
    {
      // Pojedyncze dopasowanie ≈ szum; sygnał od ≥2 dopasowań wewnątrzgrupowych ≤2 s.
      id: "imo",
      auto: (imoCount ?? 0) >= 2,
      signal:
        imoCount == null
          ? "brak policzonego wskaźnika dopasowań — policz wskaźniki"
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
  ];
}
