"use client";

// KROK „LISTA WSKAŹNIKÓW" toru bankowego — katalog wymogów kapitałowych wg typu
// instytucji, z progami obowiązującymi W DACIE ZDARZENIA.
//
// To jest WIDOK NA KATALOG (lib/domain/wskazniki-bank.ts — lustro progów silnika
// pilnowane testem mostu TS↔PY), nie miejsce liczenia. Liczby dla sprawy powstają
// w kroku „Analiza ekonomiczno-finansowa"; tutaj biegły sprawdza, KTÓRE wymogi
// w ogóle obowiązywały instytucję tego typu w badanym okresie — zanim silnik
// cokolwiek policzy.

import { useMemo, useState } from "react";

import {
  OBSZARY_RUBRYKI,
  RUBRYKA_BS,
  TYPY_INSTYTUCJI,
  WYMOGI_KAPITALOWE,
  wymogiNaDzien,
  type TypInstytucji,
} from "@/lib/domain/wskazniki-bank";

type Sub = { kind: string; data?: unknown };

function znanyDzien(subanalyses: Sub[]): string {
  for (const kind of ["otoczenie_prawne", "limity", "chronologia_nadzoru", "makro", "sygnaly_rynkowe"]) {
    const d = (subanalyses.find((s) => s.kind === kind)?.data as { dzienZdarzenia?: string | null } | undefined)
      ?.dzienZdarzenia;
    if (d) return d;
  }
  return "";
}

export default function WskaznikiKatalogPanel({
  subanalyses,
  rolaBankuSpoldzielczego,
}: {
  subanalyses: Sub[];
  /** Sprawy o bank spółdzielczy (SK Bank) startują z właściwym typem instytucji. */
  rolaBankuSpoldzielczego?: boolean;
}) {
  const [typ, setTyp] = useState<TypInstytucji>(rolaBankuSpoldzielczego ? "bank_spoldzielczy" : "bank_komercyjny");
  const [dzien, setDzien] = useState(() => znanyDzien(subanalyses));

  const naDzien = useMemo(() => new Set(wymogiNaDzien(dzien).map((w) => `${w.kod}|${w.od}`)), [dzien]);
  const fmt = (n: number) => String(n).replace(".", ",");

  return (
    <section className="space-y-4">
      <div className="border border-ink/60 bg-card p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Lista wskaźników — wymogi kapitałowe instytucji</h2>
            <p className="mt-0.5 text-xs text-inksoft">
              Katalog progów regulacyjnych DATOWANYCH (lustro silnika, pilnowane testem) oraz rubryka
              16 wskaźników banku zrzeszającego. Data zdarzenia wyróżnia progi, które wtedy
              obowiązywały — pozostałe są w katalogu, ale NIE stanowią podstawy oceny.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs">
              <span className="block text-inksoft">Typ instytucji</span>
              <select
                value={typ}
                onChange={(e) => setTyp(e.target.value as TypInstytucji)}
                className="mt-1 rounded-lg border border-ink/30 px-2 py-1.5 text-sm outline-none focus:border-neutral-500"
              >
                {TYPY_INSTYTUCJI.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className="block text-inksoft">Data ocenianego zdarzenia</span>
              <input
                type="date"
                value={dzien}
                onChange={(e) => setDzien(e.target.value)}
                className="mt-1 rounded-lg border border-ink/30 px-2 py-1.5 text-sm outline-none focus:border-neutral-500"
              />
            </label>
          </div>
        </div>
      </div>

      {typ === "inna" ? (
        <div className="border border-ink/60 bg-card p-4">
          <p className="text-xs text-inksoft">
            Katalog obejmuje wymogi BANKÓW (uchwały KNB → CRR/CRD IV). Instytucje innego typu —
            SKOK-i, firmy inwestycyjne, ubezpieczyciele — działają w odrębnych reżimach
            ostrożnościowych, których ten katalog świadomie NIE udaje. Dobór wymogów dla takiej
            instytucji wymaga rozszerzenia katalogu o właściwy akt, z datami obowiązywania.
          </p>
        </div>
      ) : (
        <div className="border border-ink/60 bg-card p-4">
          <h3 className="text-sm font-semibold">Wymogi regulacyjne (wszystkie banki)</h3>
          <p className="mt-0.5 text-xs text-inksoft">
            {dzien
              ? `Wiersze wyróżnione obowiązywały w dniu ${dzien}; wyszarzone — w innych okresach.`
              : "Podaj datę zdarzenia, żeby wyróżnić progi z właściwego stanu prawnego."}
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-ink/30 text-left">
                  <th className="py-1.5 pr-3 font-medium">Wskaźnik</th>
                  <th className="py-1.5 pr-3 font-medium">Formuła</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Minimum</th>
                  <th className="py-1.5 pr-3 font-medium">Obowiązuje</th>
                  <th className="py-1.5 pr-3 font-medium">Podstawa</th>
                </tr>
              </thead>
              <tbody>
                {WYMOGI_KAPITALOWE.map((w) => {
                  const aktywny = !dzien || naDzien.has(`${w.kod}|${w.od}`);
                  return (
                    <tr
                      key={`${w.kod}-${w.od}`}
                      className={`border-b border-ink/10 align-top ${aktywny ? "" : "text-ink/35"}`}
                    >
                      <td className={`py-1.5 pr-3 ${aktywny && dzien ? "font-semibold" : "font-medium"}`}>
                        {w.nazwa}
                        {aktywny && dzien ? " ✓" : ""}
                      </td>
                      <td className="py-1.5 pr-3">{w.formula}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{fmt(w.minimum)}%</td>
                      <td className="py-1.5 pr-3 tabular-nums">
                        {w.od} – {w.do ?? "nadal"}
                      </td>
                      <td className="py-1.5 pr-3">{w.podstawa}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-inksoft">
            Wszystkie pozycje liczy silnik (engine/bank.py) z pozycji sprawozdawczych — z progiem
            z DNIA sprawozdania, nie z dnia pisania opinii. Wskaźnik, którego składników w aktach
            brakuje, jest w analizie POMIJANY, nie zerowany.
          </p>
        </div>
      )}

      {typ === "bank_spoldzielczy" && (
        <div className="border border-ink/60 bg-card p-4">
          <h3 className="text-sm font-semibold">
            Rubryka 16 wskaźników banku zrzeszającego (uchwała nr 12/14/AB/BS/2002)
          </h3>
          <p className="mt-0.5 text-xs text-inksoft">
            Metodyka, którą bank zrzeszający BYŁ ZOBOWIĄZANY oceniać zrzeszone banki spółdzielcze —
            odczytana ze skanu uchwały (akta SK Banku, k. 162 i nast.). Wagi w każdym obszarze
            sumują się do 1,00. ⚠️ Skala ocen jest ODWRÓCONA: 1 = sytuacja bardzo dobra,
            5 = zagrożenie funkcjonowania banku.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-ink/30 text-left">
                  <th className="py-1.5 pr-3 font-medium">Obszar</th>
                  <th className="py-1.5 pr-3 font-medium">Wskaźnik</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Waga</th>
                </tr>
              </thead>
              <tbody>
                {OBSZARY_RUBRYKI.map((o) => {
                  const wiersze = RUBRYKA_BS.filter((r) => r.obszar === o.id);
                  return wiersze.map((r, i) => (
                    <tr key={r.kod} className={`border-b border-ink/10 align-top ${i === 0 ? "border-t border-t-ink/25" : ""}`}>
                      <td className="py-1.5 pr-3 font-medium">{i === 0 ? o.label : ""}</td>
                      <td className="py-1.5 pr-3">{r.nazwa}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{r.waga.toFixed(2).replace(".", ",")}</td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-inksoft">
            Wartości dla sprawy liczy krok „Analiza ekonomiczno-finansowa": z pozycji sprawozdawczych
            tam, gdzie akta je zawierają, a tam gdzie nie — z wartości WYKAZANYCH przez zrzeszającego
            (z gwiazdką, o innym statusie dowodowym).
          </p>
        </div>
      )}
    </section>
  );
}
