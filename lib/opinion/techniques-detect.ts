// Propozycja technik manipulacji na podstawie SYGNAŁÓW DOWODOWYCH z metryk silnika.
//
// Zasada: to deterministyczna heurystyka (nie LLM, nie z opinii). Każda propozycja
// niesie swój sygnał liczbowy; biegły potwierdza lub odrzuca w zakładce A2.

import type { TechniqueId } from "./legal";

type Metric = { key: string; value: number | null; unit: string | null; session_day: string | null };

export type Proposal = { id: TechniqueId; auto: boolean; signal: string };

function peak(metrics: Metric[], prefix: string): Metric | null {
  return metrics
    .filter((m) => m.key.startsWith(prefix))
    .reduce<Metric | null>((a, b) => ((b.value ?? -1) > (a?.value ?? -1) ? b : a), null);
}

export function proposeTechniques(metrics: Metric[]): Proposal[] {
  const gs = metrics.find((m) => m.key === "group_turnover_share") ?? null;
  const wp = peak(metrics, "wash_");
  const cp = peak(metrics, "cancel_");
  return [
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
          : "brak policzonego wskaźnika anulacji — policz wskaźniki",
    },
    {
      id: "imo",
      auto: false,
      signal: "silnik nie liczy jeszcze czasu dopasowań zleceń — dodaj ręcznie (Faza 4)",
    },
    {
      id: "pumpdump",
      auto: false,
      signal:
        gs && gs.value != null
          ? `udział Grupy w obrocie ${gs.value}% — oceń dynamikę kursu (rozdz. ekon-fin)`
          : "oceń dynamikę kursu i fazę wyprzedaży (rozdz. ekon-fin)",
    },
  ];
}
