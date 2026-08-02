"use client";

import { useState } from "react";

import { Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

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
/** Uwaga silnika wraz z miejscem w aktach — plik i strona, do której prowadzi odnośnik. */
type UwagaZrodlo = { tekst: string; dzien?: string; pole?: string; plik?: string; sciezka?: string; strona?: number | null };
type DaneWskaznikow = {
  table?: { caption?: string; head?: string[]; rows?: string[][] };
  uwagi?: string[];
  /** Te same uwagi w postaci danych — starsze sprawy mają tylko `uwagi`. */
  uwagi_zrodla?: UwagaZrodlo[];
  zastrzezenia?: string[];
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
  // Diagnoza per plik i podpowiedź, co zrobić — silnik odsyła je przy nieudanym
  // odczycie. Samo jedno zdanie błędu zostawiało biegłego z pytaniem, KTÓRY plik
  // zawiódł i dlaczego, choć odpowiedź była w tej samej odpowiedzi serwera.
  const [diagnoza, setDiagnoza] = useState<{ uwagi?: string[]; podpowiedz?: string } | null>(null);

  /** Otwiera sprawozdanie NA WSKAZANEJ STRONIE — `#page=` rozumie czytnik PDF przeglądarki.
   *  Bez tego biegły dostawał numer strony w zdaniu i musiał sam znaleźć plik w aktach. */
  async function otworzZrodlo(u: UwagaZrodlo) {
    if (!u.sciezka) return;
    const { data } = await createClient().storage.from("case-files").createSignedUrl(u.sciezka, 300);
    if (data?.signedUrl) window.open(u.strona ? `${data.signedUrl}#page=${u.strona}` : data.signedUrl, "_blank");
  }

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
      if (!j.ok) {
        setBlad(j.error ?? "Nie udało się policzyć wskaźników.");
        setDiagnoza({ uwagi: j.uwagi, podpowiedz: j.podpowiedz });
      } else {
        setDiagnoza(null);
        onDone();
      }
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

      {blad && (
        <div className="mt-3 border border-red-300 bg-red-50 p-2 text-xs text-red-800">
          <p className="font-semibold">{blad}</p>
          {diagnoza?.uwagi?.length ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {diagnoza.uwagi.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          ) : null}
          {diagnoza?.podpowiedz ? <p className="mt-2 italic">{diagnoza.podpowiedz}</p> : null}
        </div>
      )}

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

      {dane?.zastrzezenia?.length ? (
        <div className="mt-4 border-l-2 border-red-500 pl-3">
          <p className="text-xs font-medium text-red-800">Odczyt niewiarygodny — nie opieraj na nim wniosku</p>
          <ul className="mt-1 space-y-0.5 text-xs text-inksoft">
            {dane.zastrzezenia.map((z, i) => (
              <li key={i}>{z}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {dane?.uwagi?.length ? (
        <div className="mt-4 border-t border-ink/15 pt-3">
          <p className="text-xs font-medium">Uwagi silnika do odczytu</p>
          {/* Uwaga z odnośnikiem otwiera sprawozdanie na tej stronie, z której wartość
              pochodzi. Starsze sprawy nie mają `uwagi_zrodla` — wtedy sam tekst. */}
          <ul className="mt-1 space-y-1 text-xs text-inksoft">
            {(dane.uwagi_zrodla?.length ? dane.uwagi_zrodla : dane.uwagi.map((t) => ({ tekst: t }) as UwagaZrodlo)).map(
              (u, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                  <span>{u.tekst}</span>
                  {u.sciezka ? (
                    <button
                      onClick={() => otworzZrodlo(u)}
                      title={`${u.plik ?? "plik"}${u.strona ? `, str. ${u.strona}` : ""}`}
                      className="shrink-0 rounded border border-ink/25 px-1.5 py-0.5 text-[11px] text-ink/80 transition-colors hover:border-ink/50 hover:text-ink"
                    >
                      sprawdź w oryginale{u.strona ? ` — str. ${u.strona}` : ""}
                    </button>
                  ) : null}
                </li>
              ),
            )}
          </ul>
          <p className="mt-2 text-[11px] text-inksoft">
            Wartości dopełnione z tożsamości odtwarzają sumy podane w sprawozdaniu — Tier 1 wychodzi
            z nich identyczny jak odczytany z wiersza, a Tier 2 nie wchodzi do żadnego wskaźnika.
            Uważnie sprawdź natomiast pozycje „wywnioskowane z układu strony”: to one zasilają marżę
            odsetkową i udział depozytów.
          </p>
        </div>
      ) : null}
    </section>
  );
}
