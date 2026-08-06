"use client";

// KROK 4 GPW — rozdział IV opinii w SIEDMIU pod-zakładkach (wymóg klienta,
// sprawa ZASTAL): IV.1 ekonomia emitenta, IV.2 ESPI/EBI, IV.3 aktywność Grupy,
// IV.4 wash trades, IV.5 improper matched orders, IV.6 layering/spoofing,
// IV.7 relacje podmiotów. Wzorzec zawartości: rozdz. IV finalnej opinii HubTech.
//
// To WIDOK na istniejące moduły — dane liczą silnik i kroki (żadna pod-zakładka
// nie liczy sama). Status ✅ oznacza „moduł ma dane", 🟡 „czeka na wsad/decyzję";
// szczegół każdej pod-zakładki mówi, skąd dane pochodzą i czego brakuje.

import { useMemo, useState } from "react";
import EkofinPanel from "./ekofin-panel";

type Sub = { kind: string; status?: string; body_md?: string; data?: unknown };
type Metric = { key: string; value: number | null };
type Tabela = { caption?: string; head?: string[]; rows?: string[][] };

function TabelaSkrot({ t, maks = 6 }: { t: Tabela; maks?: number }) {
  if (!t?.rows?.length) return null;
  return (
    <div className="mt-2 overflow-x-auto">
      {t.caption ? <p className="text-[11px] font-medium">{t.caption}</p> : null}
      <table className="mt-1 w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-ink/30 text-left">
            {(t.head ?? []).map((h, i) => (
              <th key={i} className={`py-1 pr-2 font-medium ${i ? "text-right" : ""}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {t.rows.slice(0, maks).map((r, i) => (
            <tr key={i} className="border-b border-ink/10">
              {r.map((v, j) => (
                <td key={j} className={`py-1 pr-2 tabular-nums ${j ? "text-right" : ""}`}>{String(v).slice(0, 60)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {t.rows.length > maks ? (
        <p className="mt-0.5 text-[11px] text-inksoft">… i {t.rows.length - maks} kolejnych wierszy.</p>
      ) : null}
    </div>
  );
}

function Findings({ xs }: { xs?: unknown }) {
  const lista = Array.isArray(xs) ? (xs as string[]).slice(0, 6) : [];
  if (!lista.length) return null;
  return (
    <ul className="mt-2 space-y-1 text-xs">
      {lista.map((f) => (
        <li key={f} className="border-l-2 border-ink/40 pl-2">{String(f).slice(0, 240)}</li>
      ))}
    </ul>
  );
}

export default function AnalizaIVPanel({
  caseId,
  subanalyses,
  metrics,
  onDone,
}: {
  caseId: string;
  subanalyses: Sub[];
  metrics: Metric[];
  onDone: () => void;
}) {
  const wg = useMemo(() => new Map(subanalyses.map((s) => [s.kind, s])), [subanalyses]);
  const dane = (kind: string) => (wg.get(kind)?.data ?? null) as Record<string, unknown> | null;
  const maMetryke = (pfx: string) => metrics.some((m) => m.key.startsWith(pfx));
  const imoCount = metrics.find((m) => m.key === "imo_count")?.value ?? null;
  const tremy = subanalyses.filter((s) => s.kind.startsWith("trem_"));

  const ZAKLADKI = [
    {
      id: "Wstęp",
      tytul: "Wstęp rozdziału IV (przedmiot, emitenci, system notowań, kontekst)",
      gotowe: Boolean(wg.get("proza_iv")),
    },
    {
      id: "IV.1",
      tytul: "Ekonomia i otoczenie rynkowe",
      gotowe: Boolean((dane("ekofin_dane")?.charts as unknown[] | undefined)?.length),
    },
    { id: "IV.2", tytul: "Raporty ESPI i EBI", gotowe: Boolean(wg.get("espi_events")) },
    { id: "IV.3", tytul: "Aktywność Grupy", gotowe: tremy.length > 0 || maMetryke("day_grp_") },
    { id: "IV.4", tytul: "Wash trades", gotowe: maMetryke("wash_") },
    { id: "IV.5", tytul: "Improper matched orders", gotowe: imoCount != null },
    { id: "IV.6", tytul: "Layering i spoofing", gotowe: maMetryke("cancel_") || Boolean(wg.get("spoofing_analysis")) },
    { id: "IV.7", tytul: "Relacje podmiotów", gotowe: Boolean(wg.get("powiazania_dane") || wg.get("relacje")) },
  ] as const;
  const [akt, setAkt] = useState<(typeof ZAKLADKI)[number]["id"]>("IV.1");

  const espi = dane("espi");
  const wash = dane("wash");
  const layering = dane("layering");
  const spoof = dane("spoofing_analysis");
  const relacje = dane("relacje");
  const powiazania = dane("powiazania_dane");
  const aktywnosc = dane("aktywnosc");

  return (
    <section className="border border-ink/60 bg-card p-4">
      <h2 className="text-xs font-semibold uppercase tracking-[0.12em]">
        Krok 4 — rozdział IV opinii (wzorzec: finał HubTech)
      </h2>
      <div className="mt-3 flex flex-wrap gap-1">
        {ZAKLADKI.map((z) => (
          <button
            key={z.id}
            onClick={() => setAkt(z.id)}
            className={`rounded-full border px-2.5 py-1 text-[11px] ${
              akt === z.id ? "border-ink bg-ink text-card" : "border-ink/30 hover:border-ink/60"
            }`}
            title={z.tytul}
          >
            {z.gotowe ? "✅" : "🟡"} {z.id}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-inksoft">
        {ZAKLADKI.find((z) => z.id === akt)?.tytul}
      </p>

      {/* REJESTR BRAKÓW — widoczny przy KAŻDEJ pod-zakładce, przefiltrowany do niej.
          Braki wyliczają się ze stanu sprawy (lib/opinion/braki-iv.ts), więc pozycja
          znika sama, gdy materiał trafi do akt — lista wpisana ręcznie kłamałaby
          po pierwszym ingeście. */}
      {(() => {
        const bd = dane("braki_iv");
        const wszystkie = (bd?.braki ?? []) as { podrozdzial: string; czego: string; doCzego: string; skad: string; kto: string }[];
        const moje = wszystkie.filter((b) => (akt === "Wstęp" ? b.podrozdzial.includes("wstęp") : b.podrozdzial.startsWith(akt)));
        if (!moje.length) return null;
        return (
          <div className="mt-3 border-l-2 border-amber-500 pl-3">
            <p className="text-xs font-medium">Brakujący materiał ({moje.length})</p>
            <ul className="mt-1 space-y-1.5 text-[11px] text-inksoft">
              {moje.map((b) => (
                <li key={b.czego}>
                  <span className="text-ink">◐ {b.czego}</span>
                  <br />→ potrzebne do: {b.doCzego}
                  <br />⇐ {b.skad} · <em>{b.kto}</em>
                </li>
              ))}
            </ul>
          </div>
        );
      })()}

      {akt === "Wstęp" && (
        <div className="mt-2 text-xs">
          {wg.get("proza_iv") ? (
            <>
              <p className="text-[11px] text-inksoft">
                Szkic wstępu rozdziału IV (wzorzec: finał HubTech). Fragmenty w nawiasach
                kwadratowych to jawne luki do uzupełnienia ze wskazanych źródeł — redakcja
                i zatwierdzenie w zakładce „Opinia”.
              </p>
              <div className="mt-2 whitespace-pre-wrap border-l-2 border-ink/30 pl-3 leading-relaxed">
                {wg.get("proza_iv")?.body_md ?? ""}
              </div>
            </>
          ) : (
            <p className="text-inksoft">Brak szkicu wstępu — zostanie zaproponowany przy pracy nad rozdziałem IV.</p>
          )}
        </div>
      )}

      {akt === "IV.1" && (
        <div className="mt-2 -m-4 border-t border-ink/10 pt-0 [&>section]:border-0">
          <EkofinPanel caseId={caseId} subanalyses={subanalyses} onDone={onDone} />
        </div>
      )}

      {akt === "IV.2" && (
        <div className="mt-2 text-xs">
          {/* NAJPIERW rejestr espi_events (świeży — rośnie z każdym ingestem utrwaleń),
              dopiero potem ustalenia rozdziału `espi`, które są migawką z chwili jego
              generacji. Odwrotna kolejność pokazywała „0 raportów" przy 9 w aktach. */}
          <Findings xs={dane("espi_events")?.findings} />
          <TabelaSkrot t={(dane("espi_events")?.table ?? null) as Tabela} maks={9} />
          <div className="mt-3 border-t border-ink/10 pt-2 text-inksoft">
            <p className="text-[11px] font-medium text-ink">Rozdział IV.2 (szkielet do redakcji)</p>
            <Findings xs={espi?.findings} />
          </div>
          <TabelaSkrot t={(espi?.table ?? null) as Tabela} />
          {!wg.get("espi_events") && (
            <div className="mt-3 border-l-2 border-amber-500 pl-3 text-inksoft">
              <p className="font-medium text-ink">Do pozyskania: rejestr raportów ESPI/EBI (CSY, RSY)</p>
              <p className="mt-1">
                espiebi.pap.pl broni się CAPTCHA, a newconnect.pl blokuje pobór automatyczny — zapisz w swojej
                przeglądarce listy raportów obu spółek za okres badany (espiebi.pap.pl → spółka → zakres dat →
                zapisz stronę/PDF) i wgraj przez „Materiał pozyskany” (typ RAPORT_ESPI_EBI). Parser espi_events
                zostanie dopięty do formatu pierwszego pliku.
              </p>
            </div>
          )}
        </div>
      )}

      {akt === "IV.3" && (
        <div className="mt-2 text-xs">
          {tremy.length ? (
            <p className="text-inksoft">
              Instrumenty (TREM): {tremy.map((t) => t.kind.replace("trem_", "").toUpperCase()).join(", ")} — pełne
              rozbicia per sesja×podmiot w zakładce „Analiza liczbowa”; tabele zbiorcze wchodzą do rozdziału IV
              automatycznie przy montażu opinii.
            </p>
          ) : null}
          <Findings xs={aktywnosc?.findings} />
          <TabelaSkrot t={(aktywnosc?.table ?? null) as Tabela} />
        </div>
      )}

      {akt === "IV.4" && (
        <div className="mt-2 text-xs">
          <Findings xs={wash?.findings} />
          <TabelaSkrot t={(wash?.table ?? null) as Tabela} />
        </div>
      )}

      {akt === "IV.5" && (
        <div className="mt-2 text-xs">
          {imoCount === 0 ? (
            <div className="border-l-2 border-ink/40 pl-3">
              <p className="font-medium">Ustalenie negatywne (jawne zero)</p>
              <p className="mt-1 text-inksoft">
                Silnik zbadał zlecenia wewnątrzgrupowe progiem ≤2 s i nie stwierdził żadnych dopasowań — dla
                żadnego z instrumentów. W opinii weryfikacyjnej to ustalenie wchodzi do rozdziału IV.5 wprost
                (z progiem badania). Technika pozostaje POZA zatwierdzonym doborem (A2) — rozszerzenie doboru
                to decyzja biegłego w zakładce „Techniki”.
              </p>
            </div>
          ) : imoCount != null ? (
            <Findings xs={dane("imo")?.findings ?? [`Dopasowane zlecenia (≤2s): ${imoCount}`]} />
          ) : (
            <p className="text-inksoft">Brak biegu IMO — uruchom „Policz z TREM” w Analizie liczbowej.</p>
          )}
        </div>
      )}

      {akt === "IV.6" && (
        <div className="mt-2 text-xs">
          <Findings xs={(layering?.findings ?? spoof?.findings) as unknown} />
          <TabelaSkrot t={((layering?.table ?? spoof?.table) ?? null) as Tabela} />
        </div>
      )}

      {akt === "IV.7" && (
        <div className="mt-2 text-xs">
          <Findings xs={(relacje?.findings ?? powiazania?.findings) as unknown} />
          <TabelaSkrot t={((powiazania?.table ?? relacje?.table) ?? null) as Tabela} />
        </div>
      )}
    </section>
  );
}
