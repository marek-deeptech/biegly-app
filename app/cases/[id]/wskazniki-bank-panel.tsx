"use client";

import { useState } from "react";

import { Button } from "@/components/ui";

// Krok 3 dziedziny bankowej — odpowiednik „Policz wskaźniki" z dziedziny manipulacji,
// ale liczy co innego i z czego innego: współczynniki kapitałowe ze sprawozdań
// finansowych, a nie wskaźniki obrotu z arkusza zleceń.
//
// Wynik jest PROPOZYCJĄ: odczyt pozycji ze sprawozdania bywa niepełny (wiersze
// składnikowe tracą etykiety w ekstrakcji PDF), więc panel pokazuje wprost uwagi
// silnika — co dopełniono z tożsamości i gdzie składniki nie zgadzają się z sumą.

type Doc = { id: string; rel_path: string; doc_type: string; storage_path: string | null };
// `data` jest w bazie luźnym jsonb i różne subanalizy trzymają tam różne kształty —
// przyjmujemy je jako nieznane i zawężamy dopiero przy odczycie tej jednej subanalizy.
type Sub = { kind: string; data?: unknown };
type DaneWskaznikow = {
  table?: { caption?: string; head?: string[]; rows?: string[][] };
  uwagi?: string[];
  findings?: string[];
};

export default function WskaznikiBankPanel({
  caseId,
  documents,
  subanalyses,
  onDone,
}: {
  caseId: string;
  documents: Doc[];
  subanalyses: Sub[];
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [blad, setBlad] = useState<string | null>(null);

  const sprawozdania = documents.filter((d) => d.doc_type === "SPRAWOZDANIE_BANK" && d.storage_path);
  const dane = (subanalyses.find((s) => s.kind === "wskazniki_bank")?.data ?? null) as DaneWskaznikow | null;
  const tabela = dane?.table;

  async function policz() {
    setBusy(true);
    setBlad(null);
    try {
      const r = await fetch("/api/bank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId }),
      });
      const j = await r.json();
      if (!j.ok) setBlad(j.error ?? "Nie udało się policzyć wskaźników.");
      else onDone();
    } catch {
      setBlad("Błąd sieci przy liczeniu wskaźników.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border border-ink/60 bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Wskaźniki finansowe</h2>
          <p className="mt-0.5 text-xs text-inksoft">
            Sprawozdań w aktach: {sprawozdania.length}
            {sprawozdania.length < 2 && " — do szeregu czasowego potrzebne są co najmniej dwa okresy"}
          </p>
        </div>
        <Button onClick={policz} loading={busy} loadingLabel="Liczę…" disabled={!sprawozdania.length}>
          {tabela ? "Przelicz ponownie" : "Policz wskaźniki"}
        </Button>
      </div>

      {blad && <p className="mt-3 border border-red-300 bg-red-50 p-2 text-xs text-red-800">{blad}</p>}

      {tabela?.rows?.length ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-ink/30 text-left">
                {(tabela.head ?? []).map((h) => (
                  <th key={h} className="py-1.5 pr-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tabela.rows.map((r, i) => (
                <tr key={i} className="border-b border-ink/10">
                  {r.map((c, j) => (
                    <td key={j} className={`py-1.5 pr-3 ${j === 0 ? "font-medium" : "tabular-nums"}`}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {dane?.findings?.length ? (
        <div className="mt-4 border-l-2 border-red-400 pl-3">
          <p className="text-xs font-medium">Wartości poniżej progu obowiązującego w danym okresie</p>
          <ul className="mt-1 space-y-0.5 text-xs text-inksoft">
            {dane.findings.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {dane?.uwagi?.length ? (
        <div className="mt-4 border-t border-ink/15 pt-3">
          <p className="text-xs font-medium">Uwagi silnika do odczytu</p>
          <ul className="mt-1 space-y-0.5 text-xs text-inksoft">
            {dane.uwagi.map((u, i) => (
              <li key={i}>{u}</li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-inksoft">
            Pozycje oznaczone jako dopełnione pochodzą z odejmowania sum podanych w sprawozdaniu,
            nie z odczytanego wiersza — przed powołaniem ich w opinii sprawdź w oryginale.
          </p>
        </div>
      ) : null}
    </section>
  );
}
