"use client";

import type { DomainPack } from "@/lib/domain";

/**
 * Opis kroku dla dziedziny, która nie ma jeszcze własnego panelu roboczego.
 *
 * Świadomie NIE pokazujemy tu paneli drugiej dziedziny: sprawa bankowa nie ma
 * arkusza zleceń UTP ani technik MAR, a wyświetlenie przycisków „Policz wskaźniki
 * manipulacji" sugerowałoby, że jest co liczyć. Lepszy jest jawny opis zakresu
 * niż narzędzie, które nie pasuje do materiału.
 */
export default function KrokDziedzinowy({
  pakiet,
  klucz,
}: {
  pakiet: DomainPack;
  klucz: "analysis" | "warsztat";
}) {
  const krok = pakiet.kroki.find((k) => k.klucz === klucz);
  if (!krok) return null;
  // Moduły analizy, których ten krok dotyczy — dla „analysis" liczbowe,
  // dla „warsztat" proceduralne i prawne.
  const moduly =
    klucz === "analysis"
      ? pakiet.moduly.filter((m) => ["adekwatnosc", "sprawozdania", "makro"].includes(m.id))
      : pakiet.moduly.filter((m) =>
          ["procedury", "limity", "sygnaly_rynkowe", "ekspozycja_sektor", "media", "otoczenie_prawne"].includes(m.id),
        );

  return (
    <section className="border border-ink/60 bg-card p-4">
      <h2 className="text-sm font-semibold">{krok.label}</h2>
      <p className="mt-1 text-sm text-inksoft">{krok.opis}</p>
      <ul className="mt-4 space-y-3">
        {moduly.map((m) => (
          <li key={m.id} className="border-l-2 border-ink/20 pl-3">
            <p className="text-sm font-medium">{m.tytul}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-inksoft">{m.opis}</p>
          </li>
        ))}
      </ul>
      <p className="mt-4 border-t border-ink/15 pt-3 text-xs text-inksoft">
        Panel roboczy tego kroku dla spraw bankowych jest w budowie. Silnik wskaźników
        (fundusze własne, współczynniki kapitałowe, dźwignia, LCR, struktura finansowania)
        oraz datowany katalog przepisów są gotowe — brakuje wpięcia ich w interfejs.
      </p>
    </section>
  );
}
