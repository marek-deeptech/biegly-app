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

/**
 * Wyrównanie kolumny do prawej TYLKO wtedy, gdy niesie liczby.
 *
 * ⚠️ Wcześniej do prawej szło wszystko poza pierwszą kolumną, więc tytuły raportów
 * ESPI („Zmiana stanu posiadania akcji…") uciekały na prawą krawędź i czytało się je
 * gorzej niż kolumnę liczbową. Liczbą nazywamy komórkę, w której poza cyframi,
 * separatorami i jednostką (%, zł, szt., p.p.) nie ma liter.
 */
function kolumnyLiczbowe(t: Tabela): boolean[] {
  const rows = t.rows ?? [];
  const ile = Math.max(0, ...rows.map((r) => r.length));
  return Array.from({ length: ile }, (_, j) => {
    const wartosci = rows.map((r) => String(r[j] ?? "").trim()).filter((v) => v && v !== "—");
    if (!wartosci.length) return false;
    const liczbowe = wartosci.filter((v) => /^[+-]?[\d\s\u00a0.,]+(%|zł|szt\.?|p\.p\.)?$/.test(v));
    return liczbowe.length / wartosci.length >= 0.8;
  });
}

function TabelaSkrot({ t, maks = 6 }: { t: Tabela; maks?: number }) {
  if (!t?.rows?.length) return null;
  const doPrawej = kolumnyLiczbowe(t);
  return (
    <div className="mt-4">
      {t.caption ? <p className="mb-1.5 text-xs font-medium text-inksoft">{t.caption}</p> : null}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink/40 text-left">
              {(t.head ?? []).map((h, i) => (
                <th key={i} className={`py-2 pr-3 text-xs font-semibold uppercase tracking-wide text-inksoft ${doPrawej[i] ? "text-right" : "text-left"}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {t.rows.slice(0, maks).map((r, i) => (
              <tr key={i} className="border-b border-ink/10">
                {r.map((v, j) => (
                  // Pełna wartość w tytule — skrót w komórce nie może być jedynym,
                  // co biegły zobaczy; tabele mają kolumny na 100+ znaków.
                  <td key={j} title={String(v)} className={`py-1.5 pr-3 ${doPrawej[j] ? "text-right tabular-nums" : "text-left"}`}>
                    {String(v).length > 90 ? `${String(v).slice(0, 90)}…` : String(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {t.rows.length > maks ? (
        <p className="mt-1.5 text-xs text-inksoft">… i {t.rows.length - maks} kolejnych wierszy (pełne tabele w opinii).</p>
      ) : null}
    </div>
  );
}

function Findings({ xs, maks = 8 }: { xs?: unknown; maks?: number }) {
  const wszystkie = Array.isArray(xs) ? (xs as string[]) : [];
  const lista = wszystkie.slice(0, maks);
  if (!lista.length) return null;
  return (
    <>
      <ul className="mt-3 space-y-2 text-sm leading-relaxed">
        {lista.map((f) => (
          <li key={f} className="border-l-2 border-ink/40 pl-3">{String(f)}</li>
        ))}
      </ul>
      {wszystkie.length > lista.length ? (
        <p className="mt-1.5 text-xs text-inksoft">… i {wszystkie.length - lista.length} dalszych ustaleń.</p>
      ) : null}
    </>
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
      krotki: "Przedmiot i emitenci",
      tytul: "Wstęp rozdziału IV (przedmiot, emitenci, system notowań, kontekst)",
      gotowe: Boolean(wg.get("proza_iv")),
    },
    {
      id: "IV.1",
      krotki: "Ekonomia emitenta",
      tytul: "Analiza ekonomiczno-finansowa i otoczenie rynkowe",
      gotowe: Boolean((dane("ekofin_dane")?.charts as unknown[] | undefined)?.length),
    },
    { id: "IV.2", krotki: "Raporty ESPI i EBI", tytul: "Analiza raportów bieżących w systemach ESPI i EBI", gotowe: Boolean(wg.get("espi_events")) },
    { id: "IV.3", krotki: "Aktywność Grupy", tytul: "Aktywność podmiotów z Grupy w obrocie", gotowe: tremy.length > 0 || maMetryke("day_grp_") },
    { id: "IV.4", krotki: "Wash trades", tytul: "Transakcje wzajemne (wash trades)", gotowe: maMetryke("wash_") },
    { id: "IV.5", krotki: "Dopasowane zlecenia", tytul: "Improper matched orders — zlecenia dopasowane", gotowe: imoCount != null },
    { id: "IV.6", krotki: "Layering i spoofing", tytul: "Layering i spoofing — warstwy zleceń", gotowe: maMetryke("cancel_") || subanalyses.some((s) => /^spoofing_/.test(s.kind)) },
    { id: "IV.7", krotki: "Relacje podmiotów", tytul: "Identyfikacja relacji pomiędzy podmiotami z Grupy", gotowe: Boolean(wg.get("powiazania_dane") || wg.get("relacje")) },
  ] as const;
  const [akt, setAkt] = useState<(typeof ZAKLADKI)[number]["id"]>("IV.1");

  const espi = dane("espi");
  const wash = dane("wash");
  const layering = dane("layering");
  // Analizy zleceń per instrument (`spoofing_<ticker>`); zbiorcza tylko dla spraw
  // jednoinstrumentowych — patrz lib/opinion/instrumenty.ts.
  const spoofy = subanalyses.filter((s) => /^spoofing_/.test(s.kind) && s.kind !== "spoofing_analysis");
  const spoof = (spoofy.length ? spoofy[0].data : dane("spoofing_analysis")) as Record<string, unknown> | null;
  const relacje = dane("relacje");
  const powiazania = dane("powiazania_dane");
  const aktywnosc = dane("aktywnosc");

  return (
    <section className="border border-ink/60 bg-card p-5">
      <h2 className="text-sm font-semibold uppercase tracking-[0.12em]">
        Krok 4 — rozdział IV opinii (wzorzec: finał HubTech)
      </h2>
      {/* ⚠️ NAZWA NA PRZYCISKU, NIE POD SPODEM. Wcześniej przycisk niósł sam numer
          („IV.2"), a tytuł stał w szarej linijce 11 px pod paskiem — żeby wiedzieć,
          gdzie są raporty ESPI/EBI, trzeba było przeklikać zakładki albo najechać
          myszą. Numer został jako kotwica do opinii, nazwa mówi, co jest w środku. */}
      <div className="mt-4 flex flex-wrap gap-2">
        {ZAKLADKI.map((z) => (
          <button
            key={z.id}
            onClick={() => setAkt(z.id)}
            className={`flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm transition-colors ${
              akt === z.id
                ? "border-ink bg-ink text-card"
                : "border-ink/30 hover:border-ink/70 hover:bg-ink/5"
            }`}
            title={z.tytul}
          >
            <span aria-hidden>{z.gotowe ? "✅" : "🟡"}</span>
            <span className="font-semibold">{z.id}</span>
            <span className={akt === z.id ? "opacity-90" : "text-inksoft"}>{z.krotki}</span>
          </button>
        ))}
      </div>
      <div className="mt-4 border-b border-line pb-2">
        <h3 className="text-lg font-semibold leading-tight">
          {ZAKLADKI.find((z) => z.id === akt)?.id} · {ZAKLADKI.find((z) => z.id === akt)?.tytul}
        </h3>
        <p className="mt-1 text-xs text-inksoft">
          <span aria-hidden>✅</span> moduł ma dane · <span aria-hidden>🟡</span> czeka na wsad albo decyzję biegłego
        </p>
      </div>

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
          <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
            <p className="text-sm font-semibold">Brakujący materiał ({moje.length})</p>
            <ul className="mt-2 space-y-2 text-sm text-inksoft">
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
        <div className="mt-4 text-sm leading-relaxed">
          {wg.get("proza_iv") ? (
            <>
              <p className="text-sm text-inksoft">
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
        <div className="mt-4 text-sm leading-relaxed">
          {/* NAJPIERW rejestr espi_events (świeży — rośnie z każdym ingestem utrwaleń),
              dopiero potem ustalenia rozdziału `espi`, które są migawką z chwili jego
              generacji. Odwrotna kolejność pokazywała „0 raportów" przy 9 w aktach. */}
          <Findings xs={dane("espi_events")?.findings} />
          <TabelaSkrot t={(dane("espi_events")?.table ?? null) as Tabela} maks={9} />
          <div className="mt-3 border-t border-ink/10 pt-2 text-inksoft">
            <p className="text-sm font-semibold text-ink">Rozdział IV.2 (szkielet do redakcji)</p>
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
        <div className="mt-4 text-sm leading-relaxed">
          {tremy.length ? (
            <p className="text-inksoft">
              Instrumenty (TREM): {tremy.map((t) => t.kind.replace("trem_", "").toUpperCase()).join(", ")} — pełne
              rozbicia per sesja×podmiot w kroku „Wskaźniki”; tabele zbiorcze wchodzą do rozdziału IV
              automatycznie przy montażu opinii.
            </p>
          ) : null}
          <Findings xs={aktywnosc?.findings} />
          <TabelaSkrot t={(aktywnosc?.table ?? null) as Tabela} />
        </div>
      )}

      {akt === "IV.4" && (
        <div className="mt-4 text-sm leading-relaxed">
          <Findings xs={wash?.findings} />
          <TabelaSkrot t={(wash?.table ?? null) as Tabela} />
        </div>
      )}

      {akt === "IV.5" && (
        <div className="mt-4 text-sm leading-relaxed">
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
        <div className="mt-4 text-sm leading-relaxed">
          <Findings xs={(layering?.findings ?? spoof?.findings) as unknown} />
          <TabelaSkrot t={((layering?.table ?? spoof?.table) ?? null) as Tabela} />
        </div>
      )}

      {akt === "IV.7" && (
        <div className="mt-4 text-sm leading-relaxed">
          <Findings xs={(relacje?.findings ?? powiazania?.findings) as unknown} />
          <TabelaSkrot t={((powiazania?.table ?? relacje?.table) ?? null) as Tabela} />
        </div>
      )}
    </section>
  );
}
