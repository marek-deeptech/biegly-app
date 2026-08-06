"use client";

// KROK „OTOCZENIE PRAWNE" toru bankowego (wzorzec: opinia MBR, rozdz. V.L, s. 93 —
// „Otoczenie prawne i standardy identyfikacji ryzyka kredytowego w bankach").
//
// Odpowiada wprost na pytanie: GDZIE w przepisach obowiązujących W DACIE ZDARZENIA
// jest mowa o adekwatności kapitałowej, płynności i kondycji finansowej banku.
// Indeks tematyczny jest RĘCZNY (katalog datowany w lib/domain/prawo-bankowe.ts),
// nie po słowach kluczowych — przepis o płynności podpięty pod adekwatność to błąd,
// którego w dokumencie sądowym nikt nie zauważy do rozprawy.
//
// Data zdarzenia rozstrzyga o WSZYSTKIM: przepisy późniejsze lądują w osobnej,
// czerwonej sekcji „nie powoływać" (CRR do decyzji z 2008 r. to błąd merytoryczny).

import { useMemo, useState } from "react";

import { Button } from "@/components/ui";
import {
  przepisyAnachroniczne,
  przepisyWgTematu,
  TEMATY_PRAWNE,
} from "@/lib/domain/prawo-bankowe";

type Sub = { kind: string; data?: unknown };

/** Dzień zdarzenia zapamiętany w którejkolwiek subanalizie sprawy — bez zgadywania. */
function znanyDzien(subanalyses: Sub[]): string {
  for (const kind of ["otoczenie_prawne", "limity", "chronologia_nadzoru", "makro", "sygnaly_rynkowe"]) {
    const d = (subanalyses.find((s) => s.kind === kind)?.data as { dzienZdarzenia?: string | null } | undefined)
      ?.dzienZdarzenia;
    if (d) return d;
  }
  return "";
}

export default function PrawoPanel({
  caseId,
  subanalyses,
  onDone,
}: {
  caseId: string;
  subanalyses: Sub[];
  onDone: () => void;
}) {
  const [dzien, setDzien] = useState(() => znanyDzien(subanalyses));
  const [busy, setBusy] = useState(false);
  const [blad, setBlad] = useState<string | null>(null);
  const zapisane = subanalyses.some((s) => s.kind === "otoczenie_prawne");

  const wgTematu = useMemo(() => (dzien ? przepisyWgTematu(dzien) : []), [dzien]);
  const anachroniczne = useMemo(() => (dzien ? przepisyAnachroniczne(dzien) : []), [dzien]);

  async function zapisz() {
    setBusy(true);
    setBlad(null);
    try {
      const r = await fetch(`/cases/${caseId}/bank/prawo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dzienZdarzenia: dzien }),
      });
      const j = await r.json();
      if (!j.ok) setBlad(j.reason ?? "Nie udało się zapisać otoczenia prawnego.");
      else onDone();
    } catch {
      setBlad("Błąd sieci przy zapisie otoczenia prawnego.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="border border-ink/60 bg-card p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Otoczenie prawne w dacie zdarzenia</h2>
            <p className="mt-0.5 text-xs text-inksoft">
              Przepisy, w jakich funkcjonowała instytucja, z indeksem tematycznym: adekwatność
              kapitałowa, płynność, kondycja finansowa, limity koncentracji. Wzorzec: opinia MBR,
              rozdz. V.L („Otoczenie prawne i standardy identyfikacji ryzyka kredytowego w bankach").
            </p>
          </div>
          <div className="flex items-end gap-2">
            <label className="text-xs">
              <span className="block text-inksoft">Data ocenianego zdarzenia</span>
              <input
                type="date"
                value={dzien}
                onChange={(e) => setDzien(e.target.value)}
                className="mt-1 rounded-lg border border-ink/30 px-2 py-1.5 text-sm outline-none focus:border-neutral-500"
              />
            </label>
            <Button onClick={zapisz} loading={busy} loadingLabel="Zapisuję…" disabled={!dzien}>
              {zapisane ? "Przelicz moduł opinii" : "Zapisz jako moduł opinii"}
            </Button>
          </div>
        </div>
        {!dzien && (
          <p className="mt-3 border-l-2 border-amber-500 pl-3 text-xs text-inksoft">
            Bez daty zdarzenia stanu prawnego nie da się ustalić — stan zmieniał się w czasie
            (CRR od 2014 r., LCR od X 2015 r., wcześniej uchwały KNB z 2007 r.). Podaj datę
            ocenianej decyzji, nie datę sporządzania opinii.
          </p>
        )}
        {blad && <p className="mt-3 border border-red-300 bg-red-50 p-2 text-xs text-red-800">{blad}</p>}
        {zapisane && (
          <p className="mt-3 text-[11px] text-inksoft">
            Moduł <code className="rounded bg-ink/5 px-1">otoczenie_prawne</code> jest zapisany —
            wejdzie do opinii jako rozdział o otoczeniu prawnym; redakcja prozy w zakładce Opinia.
          </p>
        )}
      </div>

      {dzien &&
        wgTematu.map(({ temat, przepisy }) => (
          <div key={temat.id} className="border border-ink/60 bg-card p-4">
            <h3 className="text-sm font-semibold">{temat.label}</h3>
            <p className="mt-0.5 text-xs text-inksoft">{temat.opis}</p>
            {przepisy.length ? (
              <ul className="mt-2 space-y-2">
                {przepisy.map((p) => (
                  <li key={p.ref} className="border-l-2 border-ink/40 pl-3 text-xs">
                    <p className="font-medium">{p.ref}</p>
                    <p className="text-inksoft">{p.akt}</p>
                    <p className="mt-0.5">{p.zakres}</p>
                    <p className="mt-0.5 text-[11px] text-inksoft">
                      obowiązuje {p.od} – {p.do ?? "nadal"}
                      {p.zastapil ? ` · zastąpił: ${p.zastapil}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs italic text-inksoft">
                W dniu {dzien} żaden przepis katalogu nie regulował tego obszaru — to ustalenie,
                nie brak danych (np. LCR wszedł dopiero od X 2015 r.).
              </p>
            )}
          </div>
        ))}

      {dzien && anachroniczne.length ? (
        <div className="border border-red-300 bg-card p-4">
          <h3 className="text-sm font-semibold text-red-800">
            Nie powoływać — przepisy późniejsze niż zdarzenie
          </h3>
          <p className="mt-0.5 text-xs text-inksoft">
            Weszły w życie PO dniu {dzien}. Ocena zachowania według przepisu późniejszego jest
            wadliwa — audytor opinii wychwytuje takie powołania jako błąd.
          </p>
          <ul className="mt-2 space-y-1 text-xs">
            {anachroniczne.map((p) => (
              <li key={p.ref} className="border-l-2 border-red-400 pl-3">
                <span className="font-medium">{p.ref}</span> — {p.zakres}{" "}
                <span className="text-inksoft">(od {p.od})</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {dzien && (
        <p className="text-[11px] text-inksoft">
          Katalog obejmuje {TEMATY_PRAWNE.length} obszarów tematycznych; przypisania przepis→temat są
          ręczne i datowane (lib/domain/prawo-bankowe.ts). Pozycje spoza katalogu (uchwały wewnętrzne
          banku, umowa zrzeszenia) odtwarza podzakładka „Proces, limity i otoczenie" w kroku Analiza.
        </p>
      )}
    </section>
  );
}
