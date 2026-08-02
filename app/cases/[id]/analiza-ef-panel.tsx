"use client";

// ANALIZA EKONOMICZNO-FINANSOWA BANKU — rubryka 16 wskaźników w 4 obszarach.
//
// Osobny panel od „Wskaźników finansowych", bo odpowiada na inne pytanie. Tamten
// pokazuje szereg czasowy wybranych współczynników z progami regulacyjnymi. Ten
// odtwarza METODYKĘ, którą bank zrzeszający był zobowiązany stosować do SK Banku
// (uchwała nr 12/14/AB/BS/2002), wraz z wagami istotności i punktacją.
//
// ⚠️ REJESTR BRAKÓW JEST TU TREŚCIĄ, NIE OSTRZEŻENIEM. Dziesięciu z szesnastu
// wskaźników nie da się policzyć, bo akta nie zawierają wymaganych pozycji
// sprawozdawczych. Tabela pokazująca sześć bez powiedzenia, że brakuje dziesięciu,
// sugerowałaby, że analiza jest kompletna — a lista brakujących pozycji jest
// gotową treścią wniosku do sądu.

import { useMemo, useState } from "react";

type Obszar = { obszar: string; policzone: number; wszystkie: number; waga_pokryta: number; ocena: number | null };
type Brak = { pozycja: string; wskazniki: string[]; brak_zupelny: boolean; okresow_bez: number };
type Dane = {
  table?: { caption?: string; head?: string[]; rows?: string[][] };
  obszary?: Obszar[];
  policzonych?: number;
  wszystkich?: number;
  ocena_globalna?: number | null;
  opis_oceny?: string | null;
  braki?: Brak[];
  rwa?: { caption?: string; head?: string[]; rows?: string[][] };
  uwagi?: string[];
};

export default function AnalizaEfPanel({
  subanalyses,
}: {
  subanalyses: { kind: string; data?: unknown }[];
}) {
  const [pokazBraki, setPokazBraki] = useState(false);
  const dane = useMemo(
    () => subanalyses.find((s) => s.kind === "analiza_ekonomiczna")?.data as Dane | undefined,
    [subanalyses],
  );

  if (!dane?.table?.rows?.length)
    return (
      <section className="border border-ink/60 bg-card p-4">
        <h2 className="text-sm font-semibold">Analiza ekonomiczno-finansowa</h2>
        <p className="mt-2 text-xs text-inksoft">
          Uruchom „Przelicz ponownie” we Wskaźnikach finansowych — rubryka liczy się z tych samych pozycji.
        </p>
      </section>
    );

  const { table, obszary = [], braki = [] } = dane;
  const okresy = (table.head ?? []).slice(3);
  const zupelne = braki.filter((b) => b.brak_zupelny);
  const czesciowe = braki.filter((b) => !b.brak_zupelny);

  return (
    <section className="border border-ink/60 bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Analiza ekonomiczno-finansowa banku</h2>
        <p className="text-xs text-inksoft">
          policzone {dane.policzonych} z {dane.wszystkich} wskaźników · {okresy.length} okresów
        </p>
      </div>
      <p className="mt-1 text-[11px] text-inksoft">
        Rubryka banku zrzeszającego: 16 wskaźników w 4 obszarach, z wagami istotności. Skala ocen jest
        odwrócona — 1 oznacza sytuację bardzo dobrą, 5 zagrożenie funkcjonowania banku.
      </p>

      {/* Pokrycie obszarów — pierwsza rzecz do zobaczenia, bo mówi, ile z analizy
          w ogóle da się przeprowadzić na tym materiale. */}
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {obszary.map((o) => (
          <div key={o.obszar} className="border border-ink/20 p-2">
            <p className="text-xs font-medium">{o.obszar}</p>
            <p className="mt-1 text-xs text-inksoft">
              {o.policzone}/{o.wszystkie} wskaźników · waga {o.waga_pokryta.toFixed(2).replace(".", ",")} z 1,00
            </p>
            <div className="mt-1 h-1.5 w-full bg-ink/10">
              <div
                className={o.waga_pokryta >= 0.7 ? "h-1.5 bg-emerald-600" : "h-1.5 bg-amber-500"}
                style={{ width: `${Math.round(o.waga_pokryta * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-inksoft">
              {o.ocena !== null ? `ocena cząstkowa: ${o.ocena}` : "oceny nie da się wystawić — niepełny obszar"}
            </p>
          </div>
        ))}
      </div>

      {dane.ocena_globalna ? (
        <p className="mt-3 border-l-2 border-ink/40 pl-3 text-xs">
          Ocena globalna: <strong>{dane.ocena_globalna}</strong> — {dane.opis_oceny}
        </p>
      ) : (
        <p className="mt-3 border-l-2 border-amber-500 pl-3 text-xs text-inksoft">
          Oceny globalnej nie wystawiono: wymaga kompletu czterech obszarów, a uchwała podaje przedziały
          punktowe tylko dla jednego wskaźnika. Sama punktacja bez przedziałów byłaby zmyśleniem.
        </p>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-ink/30 text-left">
              <th className="py-1 pr-2 font-medium">Wskaźnik</th>
              <th className="py-1 pr-2 font-medium">Waga</th>
              {okresy.map((d) => (
                <th key={d} className="py-1 pr-2 text-right font-medium">{d}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(table.rows ?? []).map((r, i) => {
              const brak = r.slice(3).every((v) => v === "—");
              const nowyObszar = i === 0 || (table.rows ?? [])[i - 1][0] !== r[0];
              return (
                <tr key={i} className={`border-b border-ink/10 ${brak ? "text-inksoft" : ""}`}>
                  <td className="py-1 pr-2">
                    {nowyObszar && <span className="mr-1 font-semibold">{r[0]}:</span>}
                    {r[1]}
                  </td>
                  <td className="py-1 pr-2">{r[2]}</td>
                  {r.slice(3).map((v, j) => (
                    <td key={j} className="py-1 pr-2 text-right tabular-nums">{v}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Odtworzone RWA — jedyna droga do współczynnika wypłacalności, gdy akta
          nie zawierają aktywów ważonych ryzykiem. Bufor mówi, o ile mogłyby spaść
          fundusze własne, zanim bank przestałby spełniać normę. */}
      {dane.rwa?.rows?.length ? (
        <div className="mt-5 border-t border-ink/15 pt-3">
          <p className="text-xs font-medium">Odtworzone aktywa ważone ryzykiem i bufor do progu</p>
          <p className="mt-0.5 text-[11px] text-inksoft">
            Współczynnika nie da się z akt policzyć — nie ma w nich RWA. Mianownik odtworzono z funduszy
            własnych i współczynnika WYKAZANEGO przez bank; odtworzenie dziedziczy wiarygodność tych
            wartości i nie jest pomiarem niezależnym.
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-ink/30 text-left">
                  {(dane.rwa.head ?? []).map((h, i) => (
                    <th key={h} className={`py-1 pr-2 font-medium ${i ? "text-right" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(dane.rwa.rows ?? []).map((r) => (
                  <tr key={r[0]} className="border-b border-ink/10">
                    {r.map((v, j) => (
                      <td key={j} className={`py-1 pr-2 tabular-nums ${j ? "text-right" : ""}`}>{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {braki.length > 0 && (
        <div className="mt-4 border-t border-ink/15 pt-3">
          <button
            onClick={() => setPokazBraki((v) => !v)}
            className="text-xs font-medium underline-offset-2 hover:underline"
          >
            {pokazBraki ? "▾" : "▸"} Czego nie da się policzyć i dlaczego ({zupelne.length} pozycji nieobecnych
            w aktach{czesciowe.length ? `, ${czesciowe.length} niekompletnych` : ""})
          </button>
          {pokazBraki && (
            <div className="mt-2 space-y-3 text-xs">
              {zupelne.length > 0 && (
                <div>
                  <p className="font-medium">Pozycje nieobecne w aktach</p>
                  <ul className="mt-1 space-y-0.5 text-inksoft">
                    {zupelne.map((b) => (
                      <li key={b.pozycja}>
                        <span className="font-mono text-[11px]">{b.pozycja}</span> — blokuje:{" "}
                        {b.wskazniki.join("; ")}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {czesciowe.length > 0 && (
                <div>
                  <p className="font-medium">Pozycje niekompletne</p>
                  <ul className="mt-1 space-y-0.5 text-inksoft">
                    {czesciowe.map((b) => (
                      <li key={b.pozycja}>
                        <span className="font-mono text-[11px]">{b.pozycja}</span> — brak w {b.okresow_bez}{" "}
                        z {okresy.length} okresów
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {dane.uwagi?.length ? (
        <ul className="mt-3 space-y-0.5 text-[11px] text-inksoft">
          {dane.uwagi.map((u) => (
            <li key={u}>⚠ {u}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
