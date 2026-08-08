"use client";

// ZAKŁADKA „WSKAŹNIKI DODATKOWE" w kroku Wskaźniki.
//
// Siedem wskaźników ze specyfikacji biegłego (Wskazniki.docx): NMaxC, WNKSumaSesja,
// WNKSumaSesja%, Taker/Maker, WNK VWAP, WT%, ŚczasT. Liczy je silnik Pythona
// (engine/wskazniki_dodatkowe.py) — panel wyłącznie pokazuje wynik.
//
// Uwagi metodyczne wchodzą do widoku razem z liczbami, bo dwa z siedmiu wskaźników
// są ograniczone dostępnymi plikami: Taker/Maker rozstrzyga tylko część zleceń,
// a ŚczasT nie da się policzyć bez powiązania zlecenia z transakcją.

import { useMemo, useState } from "react";
import { Button } from "@/components/ui";
import { ZeZrodlami } from "./ui-analizy";

type Sub = { kind: string; data?: unknown };
type Tabela = { caption?: string; head?: string[]; rows?: string[][] };

function Tabelka({ t }: { t: Tabela }) {
  const [wszystkie, setWszystkie] = useState(false);
  if (!t?.rows?.length) return null;
  const widoczne = wszystkie ? t.rows : t.rows.slice(0, 12);
  return (
    <div className="mt-8">
      {t.caption ? <p className="mb-1.5 text-xs font-medium text-inksoft">{t.caption}</p> : null}
      <div className="mt-1 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink/30 text-left">
              {(t.head ?? []).map((h, i) => (
                <th key={i} className={`py-2 pr-3 text-xs font-semibold uppercase tracking-wide text-inksoft ${i ? "text-right" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {widoczne.map((r, i) => (
              <tr key={i} className="border-b border-ink/10">
                {r.map((v, j) => (
                  <td key={j} className={`py-1.5 pr-3 tabular-nums ${j ? "text-right" : ""}`}>
                    <ZeZrodlami tekst={String(v)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {t.rows.length > widoczne.length ? (
        <button onClick={() => setWszystkie(true)} className="mt-1 text-[11px] underline">
          Pokaż wszystkie wiersze ({t.rows.length})
        </button>
      ) : null}
    </div>
  );
}

export default function WskaznikiDodatkowePanel({
  caseId,
  subanalyses,
  onDone,
}: {
  caseId: string;
  subanalyses: Sub[];
  onDone: () => void;
}) {
  const [praca, setPraca] = useState(false);
  const [msg, setMsg] = useState("");

  const dane = useMemo(() => {
    const s = subanalyses.find((x) => x.kind === "wskazniki_dodatkowe");
    return (s?.data ?? null) as { tables?: Tabela[]; findings?: string[]; instrumenty?: string[]; pliki?: string[] } | null;
  }, [subanalyses]);

  async function policz() {
    setPraca(true);
    setMsg("");
    try {
      const res = await fetch("/api/wskazniki", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || `HTTP ${res.status}`);
      setMsg(
        `Policzono dla ${d.instrumenty?.join(", ") || "instrumentu"} — ${d.transakcji?.toLocaleString("pl-PL")} transakcji, ${d.tabel} tabel.`,
      );
      onDone();
    } catch (e) {
      setMsg(`Błąd: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPraca(false);
    }
  }

  // Ustalenia dzielimy na liczbowe i metodyczne — te drugie są zastrzeżeniami
  // do wyniku, więc mieszanie ich z odczytami zacierałoby, co jest ustaleniem,
  // a co ograniczeniem danych.
  const wszystkie = dane?.findings ?? [];
  const metodyczne = wszystkie.filter((f) => /^Zmianę ceny|^Pierwsza transakcja|^Taker\/Maker|^ŚczasT|^Wszystkie wielkości/.test(f));
  const liczbowe = wszystkie.filter((f) => !metodyczne.includes(f));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-sm text-inksoft">
          Siedem wskaźników ze specyfikacji biegłego: nowe maksima cenowe (NMaxC), wpływ na kurs w złotych
          i procentach (WNKSumaSesja, WNKSumaSesja%), Taker/Maker, VWAP Grupy wobec VWAP sesji, udział
          transakcji wzajemnych (WT%) oraz średni czas zawarcia transakcji (ŚczasT). Liczone z arkusza
          transakcji TREM, odrębnie dla każdego instrumentu.
        </p>
        <Button variant="outline" size="md" onClick={policz} loading={praca} loadingLabel="Liczę…">
          {dane ? "Przelicz wskaźniki dodatkowe" : "Policz wskaźniki dodatkowe"}
        </Button>
      </div>
      {msg ? <p className="mt-2 text-[11px]">{msg}</p> : null}

      {!dane ? (
        <p className="mt-4 text-sm text-inksoft">
          Wskaźniki jeszcze nie policzone. Wymagają arkusza transakcji TREM w aktach oraz zdefiniowanego
          składu Grupy (zakładka Sprawa) — bez rostera atrybucja maksimów i wpływu na kurs byłaby zmyślona.
        </p>
      ) : (
        <>
          {liczbowe.length > 0 && (
            <ul className="mt-6 space-y-2.5 text-sm leading-relaxed">
              {liczbowe.map((f) => (
                <li key={f} className="border-l-2 border-ink/40 pl-3">
                  <ZeZrodlami tekst={f} />
                </li>
              ))}
            </ul>
          )}
          {(dane.tables ?? []).map((t, i) => (
            <Tabelka key={t.caption ?? i} t={t} />
          ))}
          {metodyczne.length > 0 && (
            <div className="mt-10 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
              <h4 className="text-base font-semibold">
                Założenia i ograniczenia danych
              </h4>
              <ul className="mt-3 space-y-2.5 text-sm text-inksoft">
                {metodyczne.map((f) => (
                  <li key={f} className="border-l-2 border-amber-600 pl-2">{f}</li>
                ))}
              </ul>
            </div>
          )}
          {dane.pliki?.length ? (
            <p className="mt-8 text-xs text-inksoft">Źródło: {dane.pliki.join(", ")}</p>
          ) : null}
        </>
      )}
    </div>
  );
}
