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
import { NaglowekSekcji, TabelaDanych, TrescZakladki, Ustalenia, Zastrzezenia, type Tabela } from "./ui-analizy";

type Sub = { kind: string; status?: string; body_md?: string; data?: unknown };
type Metric = { key: string; value: number | null };
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
          <div className="mt-5 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
            <p className="text-base font-semibold">Brakujący materiał ({moje.length})</p>
            <ul className="mt-3 space-y-3 text-sm text-inksoft">
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
        <TrescZakladki>
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
        </TrescZakladki>
      )}

      {akt === "IV.1" && (
        <div className="mt-2 -m-4 border-t border-ink/10 pt-0 [&>section]:border-0">
          <EkofinPanel caseId={caseId} subanalyses={subanalyses} onDone={onDone} />
        </div>
      )}

      {akt === "IV.2" && (
        <TrescZakladki>
          {/* NAJPIERW rejestr espi_events (świeży — rośnie z każdym ingestem utrwaleń),
              dopiero potem ustalenia rozdziału `espi`, które są migawką z chwili jego
              generacji. Odwrotna kolejność pokazywała „0 raportów" przy 9 w aktach. */}
          <section>
            <NaglowekSekcji opis="Rejestr rośnie z każdym ingestem utrwaleń — to stan bieżący akt, nie migawka.">
              Rejestr raportów ESPI i EBI
            </NaglowekSekcji>
            <Ustalenia xs={dane("espi_events")?.findings} />
            <div className="mt-5">
              <TabelaDanych t={(dane("espi_events")?.table ?? null) as Tabela} maks={9} uwagaPonad="pełny wykaz w rozdziale IV.2" />
            </div>
          </section>
          <section className="border-t border-line pt-6">
            <NaglowekSekcji opis="Ustalenia wygenerowane przy ostatnim montażu rozdziału — mogą być starsze od rejestru powyżej.">
              Rozdział IV.2 — szkielet do redakcji
            </NaglowekSekcji>
            <Ustalenia xs={espi?.findings} />
            <div className="mt-5">
              <TabelaDanych t={(espi?.table ?? null) as Tabela} />
            </div>
          </section>
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
        </TrescZakladki>
      )}

      {akt === "IV.3" && (
        <TrescZakladki>
          {tremy.length ? (
            <p className="text-inksoft">
              Instrumenty (TREM): {tremy.map((t) => t.kind.replace("trem_", "").toUpperCase()).join(", ")} — pełne
              rozbicia per sesja×podmiot w kroku „Wskaźniki”; tabele zbiorcze wchodzą do rozdziału IV
              automatycznie przy montażu opinii.
            </p>
          ) : null}
          <NaglowekSekcji>Aktywność podmiotów z Grupy</NaglowekSekcji>
          <Ustalenia xs={aktywnosc?.findings} />
          <TabelaDanych t={(aktywnosc?.table ?? null) as Tabela} />
        </TrescZakladki>
      )}

      {akt === "IV.4" && (
        <TrescZakladki>
          <NaglowekSekcji>Transakcje wzajemne (wash trades)</NaglowekSekcji>
          <Ustalenia xs={wash?.findings} />
          <TabelaDanych t={(wash?.table ?? null) as Tabela} />
        </TrescZakladki>
      )}

      {akt === "IV.5" && (
        <TrescZakladki>
          {imoCount === 0 ? (
            <div className="border-l-2 border-ink/40 pl-3">
              <p className="text-base font-semibold">Ustalenie negatywne (jawne zero)</p>
              <p className="mt-2 text-inksoft">
                Silnik zbadał zlecenia wewnątrzgrupowe progiem ≤2 s i nie stwierdził żadnych dopasowań — dla
                żadnego z instrumentów. W opinii weryfikacyjnej to ustalenie wchodzi do rozdziału IV.5 wprost
                (z progiem badania). Technika pozostaje POZA zatwierdzonym doborem (A2) — rozszerzenie doboru
                to decyzja biegłego w zakładce „Techniki”.
              </p>
            </div>
          ) : imoCount != null ? (
            <Ustalenia xs={dane("imo")?.findings ?? [`Dopasowane zlecenia (≤2 s): ${imoCount}`]} />
          ) : (
            <p className="text-inksoft">Brak biegu IMO — uruchom „Policz z TREM” w Analizie liczbowej.</p>
          )}
        </TrescZakladki>
      )}

      {akt === "IV.6" && (
        <TrescZakladki>
          <NaglowekSekcji>Layering i spoofing — warstwy zleceń</NaglowekSekcji>
          <Ustalenia xs={(layering?.findings ?? spoof?.findings) as unknown} />
          <TabelaDanych t={((layering?.table ?? spoof?.table) ?? null) as Tabela} />
        </TrescZakladki>
      )}

      {akt === "IV.7" && (
        <TrescZakladki>
          <NaglowekSekcji>Relacje kapitałowe, osobowe i techniczne</NaglowekSekcji>
          <Ustalenia xs={(relacje?.findings ?? powiazania?.findings) as unknown} />
          <TabelaDanych t={((powiazania?.table ?? relacje?.table) ?? null) as Tabela} />
        </TrescZakladki>
      )}
    </section>
  );
}
