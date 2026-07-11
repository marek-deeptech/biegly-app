"use client";

import { useMemo, useState } from "react";

import { type IVKind } from "@/lib/opinion/chapters";
import OsintPanel from "./osint-panel";
import PowiazaniaPanel from "./powiazania-panel";
import TechniquesPanel from "./techniques-panel";

// Warsztat dowodowy (Kroki 3–5) jako osobny krok procesu, między Analizą liczbową
// a Opinią: Techniki · Powiązania (dane) · OSINT. Podmioty są w zakładce Sprawa,
// analiza liczbowa w zakładce Analiza liczbowa.

type Metric = { key: string; value: number | null; unit: string | null; session_day: string | null };
type Doc = { rel_path: string; doc_type?: string | null; storage_path?: string | null };
type SubRow = {
  kind: string;
  body_md: string;
  data: {
    table?: unknown;
    findings?: string[];
    legalRefs?: string[];
    // wyciąg zdarzeń ESPI (espi_events) — sygnał manipulacji informacją w Krok 3
    events?: { session?: string; chg?: number | null }[];
  } | null;
};

export default function WarsztatView({
  caseId,
  metrics,
  documents,
  subanalyses,
}: {
  caseId: string;
  metrics: Metric[];
  documents: Doc[];
  subanalyses: SubRow[];
}) {
  const [sub, setSub] = useState<"techniki" | "powiazania" | "osint">("techniki");
  const selectedTech = useMemo(() => {
    const t = subanalyses.find((s) => s.kind === "techniki");
    return ((t?.data as { selected?: string[] } | null)?.selected ?? []) as IVKind[];
  }, [subanalyses]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-line">
        {([
          ["techniki", "Techniki"],
          ["powiazania", "Powiązania (dane)"],
          ["osint", "OSINT"],
        ] as const).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setSub(k)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-xs transition-colors ${
              sub === k ? "border-ink font-medium text-ink" : "border-transparent text-inksoft hover:text-ink"
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      {sub === "techniki" && <TechniquesPanel caseId={caseId} metrics={metrics} selected={selectedTech} stored={subanalyses} />}
      {sub === "powiazania" && <PowiazaniaPanel caseId={caseId} documents={documents} stored={subanalyses} />}
      {sub === "osint" && <OsintPanel caseId={caseId} metrics={metrics} stored={subanalyses} />}
    </div>
  );
}
