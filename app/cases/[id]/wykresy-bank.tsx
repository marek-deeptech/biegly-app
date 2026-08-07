"use client";

// WYKRESY MODUŁÓW BANKOWYCH W PODZAKŁADKACH — domknięcie luki nr 4 audytu:
// wzorzec MBR ma 14 wykresów w samym rozdziale V, a aplikacja rysowała je dopiero
// przy składaniu opinii. Ten komponent renderuje TE SAME wykresy (ten sam
// generator: lib/opinion/charts-bank → chartSvg, czysty SVG bez zależności)
// w kroku analizy i w kroku makro — podgląd, nie osobne liczenie.

import { useMemo } from "react";

import { chartSvg } from "@/lib/opinion/charts";
import { wykresyBankowe } from "@/lib/opinion/charts-bank";

type Sub = { kind: string; data?: unknown };

export default function WykresyBank({
  subanalyses,
  kinds,
  dzien,
}: {
  subanalyses: Sub[];
  /** Które moduły rysować: "makro" | "wskazniki_bank" | "sprawozdania" | "sygnaly_rynkowe". */
  kinds: string[];
  dzien?: string | null;
}) {
  const wykresy = useMemo(
    () => wykresyBankowe(subanalyses, dzien ?? null).filter((w) => kinds.includes(w.kind)),
    [subanalyses, kinds, dzien],
  );
  if (!wykresy.length) return null;
  return (
    <div className="mt-4 space-y-4 border-t border-ink/15 pt-3">
      <p className="text-xs font-medium">
        Wykresy modułu ({wykresy.length}) — te same, które wejdą do opinii
      </p>
      {wykresy.map((w) => (
        <figure
          key={w.name}
          className="overflow-x-auto [&>svg]:h-auto [&>svg]:min-w-[640px] [&>svg]:max-w-full"
          // Zaufany SVG z własnego, deterministycznego generatora (bez danych obcych).
          dangerouslySetInnerHTML={{ __html: chartSvg(w.spec) }}
        />
      ))}
    </div>
  );
}
