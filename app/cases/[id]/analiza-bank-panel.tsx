"use client";

// KROK „ANALIZA EKONOMICZNO-FINANSOWA" toru bankowego — PODZAKŁADKI wg wzorca
// rozdziału V finalnej opinii MBR (PO III Ds 84.2020), tak jak krok „Analiza
// IV.1–7" w dziedzinie GPW jest podzakładkami wg finału HubTech.
//
// To WIDOK na istniejące moduły — dane liczą silnik i trasy (/api/bank, warsztat,
// skrypty ocen i chronologii); żadna podzakładka nie liczy sama. Status ✅ mówi
// „moduł ma dane", 🟡 „czeka na wsad albo uruchomienie".
//
// Mapa na wzorzec MBR: sprawozdania i współczynniki ↔ rozdz. V.I–J (analiza
// sprawozdań Glitnira), rubryka 16 wskaźników i oceny zrzeszającego ↔ metodyka
// zrzeszeniowa (sprawa SK), proces/limity/media/sektor ↔ rozdz. V.D–F i warsztat.

import { useMemo, useState } from "react";

import AnalizaEfPanel from "./analiza-ef-panel";
import WarsztatBankPanel from "./warsztat-bank-panel";
import WskaznikiBankPanel from "./wskazniki-bank-panel";

type Doc = { id: string; rel_path: string; doc_type: string; storage_path: string | null };
type Sub = { kind: string; status?: string; body_md?: string; data?: unknown };
type Tabela = { caption?: string; head?: string[]; rows?: string[][] };
type DaneModulu = {
  table?: Tabela;
  tables?: Tabela[];
  findings?: string[];
  uwagi?: string[];
  skala?: string;
  podstawa?: string;
  zastrzezenia?: string[];
};

function Tabelka({ t }: { t?: Tabela }) {
  if (!t?.rows?.length) return null;
  return (
    <div className="mt-3 overflow-x-auto">
      {t.caption ? <p className="text-[11px] font-medium text-inksoft">{t.caption}</p> : null}
      <table className="mt-1 w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-ink/30 text-left">
            {(t.head ?? []).map((h, i) => (
              <th key={i} className="py-1.5 pr-3 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {t.rows.map((r, i) => (
            <tr key={i} className="border-b border-ink/10 align-top">
              {r.map((c, j) => (
                <td key={j} className="py-1.5 pr-3 tabular-nums">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Widok modułu zasilanego skryptem (oceny zrzeszającego, chronologia) — tabele + ustalenia. */
function WidokModulu({ d, gdyBrak }: { d: DaneModulu | null; gdyBrak: string }) {
  if (!d) return <p className="mt-3 text-xs italic text-inksoft">{gdyBrak}</p>;
  const tabele = d.tables?.length ? d.tables : d.table ? [d.table] : [];
  return (
    <div className="mt-2">
      {d.skala ? (
        <p className="border-l-2 border-amber-500 pl-3 text-xs text-inksoft">
          <strong className="font-medium">Skala:</strong> {d.skala}
        </p>
      ) : null}
      {tabele.map((t, i) => (
        <Tabelka key={i} t={t} />
      ))}
      {d.findings?.length ? (
        <ul className="mt-3 space-y-1 border-t border-ink/15 pt-3 text-xs">
          {d.findings.map((f, i) => (
            <li key={i} className="border-l-2 border-ink/40 pl-2">{f}</li>
          ))}
        </ul>
      ) : null}
      {d.zastrzezenia?.length ? (
        <div className="mt-3 border-l-2 border-red-500 pl-3">
          <p className="text-xs font-medium text-red-800">Zastrzeżenia</p>
          <ul className="mt-1 space-y-0.5 text-xs text-inksoft">
            {d.zastrzezenia.map((z, i) => (
              <li key={i}>{z}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {d.podstawa ? <p className="mt-2 text-[11px] italic text-inksoft">Podstawa: {d.podstawa}</p> : null}
    </div>
  );
}

export default function AnalizaBankPanel({
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
  const wg = useMemo(() => new Map(subanalyses.map((s) => [s.kind, s])), [subanalyses]);
  const dane = (kind: string) => (wg.get(kind)?.data ?? null) as DaneModulu | null;

  const ZAKLADKI = [
    { id: "sprawozdania", tytul: "Sprawozdania i współczynniki kapitałowe w czasie (wzorzec: MBR V.I–J)",
      label: "Sprawozdania", gotowe: Boolean(wg.get("wskazniki_bank") || wg.get("sprawozdania")) },
    { id: "rubryka", tytul: "Rubryka 16 wskaźników banku zrzeszającego z rejestrem braków",
      label: "Rubryka EF", gotowe: Boolean(wg.get("analiza_ekonomiczna")) },
    { id: "oceny", tytul: "Oceny zrzeszającego wystawione bankowi — stan wiedzy oceniającego",
      label: "Oceny zrzeszającego", gotowe: Boolean(wg.get("oceny_zrzeszajacego")) },
    { id: "chronologia", tytul: "Chronologia nadzorcza — datowane działania nadzoru i wskaźniki w czasie",
      label: "Chronologia", gotowe: Boolean(wg.get("chronologia_nadzoru")) },
    { id: "warsztat", tytul: "Proces decyzyjny, limity, publikacje i skala sektora (dawny Warsztat dowodowy)",
      label: "Proces i limity", gotowe: Boolean(wg.get("procedury") && wg.get("limity")) },
  ] as const;
  const [akt, setAkt] = useState<(typeof ZAKLADKI)[number]["id"]>("sprawozdania");

  return (
    <section className="border border-ink/60 bg-card p-4">
      <h2 className="text-xs font-semibold uppercase tracking-[0.12em]">
        Analiza ekonomiczno-finansowa — podzakładki wg wzorca MBR
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
            {z.gotowe ? "✅" : "🟡"} {z.label}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-inksoft">{ZAKLADKI.find((z) => z.id === akt)?.tytul}</p>

      {akt === "sprawozdania" && (
        <div className="mt-2 -mx-4 border-t border-ink/10 [&>section]:border-0">
          <WskaznikiBankPanel caseId={caseId} documents={documents} subanalyses={subanalyses} onDone={onDone} />
        </div>
      )}

      {akt === "rubryka" && (
        <div className="mt-2 -mx-4 border-t border-ink/10 [&>section]:border-0">
          <AnalizaEfPanel subanalyses={subanalyses} />
        </div>
      )}

      {akt === "oceny" && (
        <WidokModulu
          d={dane("oceny_zrzeszajacego")}
          gdyBrak={
            "Ocen zrzeszającego nie wczytano. Zasilenie ze skanów ocen: " +
            "python3 scripts/oceny_zrzeszajacego.py <SPRAWA> --zapisz (odczyt, nie interpretacja; " +
            "skala odwrócona: 1 = bardzo dobra, 5 = zagrożenie)."
          }
        />
      )}

      {akt === "chronologia" && (
        <WidokModulu
          d={dane("chronologia_nadzoru")}
          gdyBrak={
            "Chronologii nadzorczej nie zbudowano. Moduł czyta datowane działania nadzoru " +
            "i wielkości bilansowe z narracji nadzorczej (harmonogram działań, wystąpienia " +
            "pokontrolne) — dla pytań „od kiedy dało się rozpoznać”."
          }
        />
      )}

      {akt === "warsztat" && (
        <div className="mt-2 -mx-4 border-t border-ink/10 pt-3 [&>section>div]:border-x-0">
          <WarsztatBankPanel caseId={caseId} subanalyses={subanalyses} onDone={onDone} />
        </div>
      )}
    </section>
  );
}
