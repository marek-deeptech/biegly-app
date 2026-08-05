"use client";

// KROK 4 GPW — analiza ekonomiczno-finansowa emitenta i otoczenia rynkowego.
//
// Wzorzec: rozdz. IV.1 finalnej opinii HubTech. Panel konfiguruje tickery
// (emitent + spółki porównawcze), pobiera notowania ze stooq jako materiał
// POZYSKANY sprawy i uruchamia deterministyczne przeliczenie (lib/opinion/ekofin).
// LLM nie liczy — liczby powstają w silniku; rejestr „do pozyskania" jest treścią
// kroku, nie ostrzeżeniem: mówi biegłemu, czego jeszcze nie ma w materiale.

import { useMemo, useState } from "react";
import { Button } from "@/components/ui";

type Tabela = { caption: string; head: string[]; rows: string[][] };
type Dane = {
  config?: {
    emitent?: { ticker?: string; nazwa?: string };
    emitenci?: { ticker: string; nazwa?: string }[];
    peers?: { ticker: string }[];
    odBadany?: string | null;
    doBadany?: string | null;
    bazaIndeksu?: string | null;
  };
  tables?: Tabela[];
  charts?: { title: string }[];
  findings?: string[];
  doPozyskania?: string[];
  uwagi?: string[];
};

export default function EkofinPanel({
  caseId,
  subanalyses,
  onDone,
}: {
  caseId: string;
  subanalyses: { kind: string; data?: unknown }[];
  onDone: () => void;
}) {
  const dane = useMemo(
    () => subanalyses.find((s) => s.kind === "ekofin_dane")?.data as Dane | undefined,
    [subanalyses],
  );
  const cfg = dane?.config;
  const cfgEmitenci = cfg?.emitenci?.length ? cfg.emitenci : cfg?.emitent?.ticker ? [cfg.emitent as { ticker: string; nazwa?: string }] : [];
  const [emitent, setEmitent] = useState(cfgEmitenci.map((e) => e.ticker).join(", "));
  const [nazwa, setNazwa] = useState(cfgEmitenci.map((e) => e.nazwa ?? "").join("; "));
  const [peers, setPeers] = useState((cfg?.peers ?? []).map((p) => p.ticker).join(", "));
  const [od, setOd] = useState(cfg?.odBadany ?? "");
  const [do_, setDo] = useState(cfg?.doBadany ?? "");
  const [baza, setBaza] = useState(cfg?.bazaIndeksu ?? "");
  const [busy, setBusy] = useState<"" | "pobierz" | "przelicz">("");
  const [msg, setMsg] = useState("");

  const config = () => {
    // Wiele instrumentów po przecinku (ZASTAL: „csy, rsy”); nazwy po średniku.
    const nazwy = nazwa.split(";").map((x) => x.trim());
    return {
      emitenci: emitent.split(",").map((t, i) => ({ ticker: t.trim(), nazwa: nazwy[i] || undefined })).filter((e) => e.ticker),
      peers: peers.split(",").map((t) => t.trim()).filter(Boolean).map((ticker) => ({ ticker })),
      odBadany: od.trim() || null,
      doBadany: do_.trim() || null,
      bazaIndeksu: baza.trim() || null,
    };
  };

  async function wykonaj(action: "pobierz" | "przelicz") {
    if (!emitent.trim()) {
      setMsg("Podaj ticker emitenta (stooq), np. zst.");
      return;
    }
    setBusy(action);
    setMsg("");
    try {
      const r = await fetch(`/cases/${caseId}/gpw/ekofin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, config: config() }),
      });
      const j = await r.json();
      if (action === "pobierz")
        setMsg(
          j.bledy?.length
            ? `Błędy poboru: ${j.bledy.join("; ")}`
            : `Pobrano: ${j.pobrane?.join(", ") || "—"}; już były: ${j.istniejace?.join(", ") || "—"}.`,
        );
      else setMsg(j.ok ? `Przeliczono: ${j.tabel} tabel, ${j.wykresow} wykresów.` : `Nie przeliczono: ${j.powod ?? j.reason}`);
      if (j.ok || j.pobrane?.length) onDone();
    } catch (e) {
      setMsg(`Błąd: ${(e as Error).message}`);
    } finally {
      setBusy("");
    }
  }

  const pole = "w-full rounded-lg border border-ink/30 px-2 py-1.5 text-xs";
  return (
    <section className="border border-ink/60 bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em]">
          Ekonomia emitenta (krok 4 — wzorzec IV.1)
        </h2>
        {dane ? (
          <p className="text-xs text-inksoft">
            {dane.tables?.length ?? 0} tabel · {dane.charts?.length ?? 0} wykresów
          </p>
        ) : null}
      </div>
      <p className="mt-1 text-[11px] text-inksoft">
        Kontrast obrotu od debiutu, tło branżowe (=100, mediana), dynamika pozycji sprawozdawczych
        i wskaźniki WYKAZANE przez portale. Notowania pobierane ze stooq.pl trafiają do materiału
        pozyskanego sprawy (typ NOTOWANIA_REF) z URL-em źródła.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-[11px] text-inksoft">
          Ticker(y) instrumentów — po przecinku
          <input className={pole} value={emitent} onChange={(e) => setEmitent(e.target.value)} placeholder="np. csy, rsy" />
        </label>
        <label className="text-[11px] text-inksoft">
          Nazwy (po średniku, w tej samej kolejności)
          <input className={pole} value={nazwa} onChange={(e) => setNazwa(e.target.value)} placeholder="np. CSY S.A.; RSY S.A." />
        </label>
        <label className="text-[11px] text-inksoft">
          Spółki porównawcze (tickery po przecinku)
          <input className={pole} value={peers} onChange={(e) => setPeers(e.target.value)} placeholder="np. pcr, pce, pwx" />
        </label>
        <label className="text-[11px] text-inksoft">
          Okres badany od (puste = z metryk)
          <input className={pole} value={od} onChange={(e) => setOd(e.target.value)} placeholder="RRRR-MM-DD" />
        </label>
        <label className="text-[11px] text-inksoft">
          Okres badany do
          <input className={pole} value={do_} onChange={(e) => setDo(e.target.value)} placeholder="RRRR-MM-DD" />
        </label>
        <label className="text-[11px] text-inksoft">
          Baza indeksu =100 (puste = początek okresu)
          <input className={pole} value={baza} onChange={(e) => setBaza(e.target.value)} placeholder="np. 2020-01-01" />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="md" onClick={() => wykonaj("pobierz")} loading={busy === "pobierz"} loadingLabel="Pobieram…">
          Pobierz notowania (stooq)
        </Button>
        <Button variant="primary" size="md" onClick={() => wykonaj("przelicz")} loading={busy === "przelicz"} loadingLabel="Liczę…">
          {dane ? "Przelicz krok 4" : "Policz krok 4"}
        </Button>
        {msg && <p className="text-xs text-inksoft">{msg}</p>}
      </div>

      {dane?.findings?.length ? (
        <ul className="mt-4 space-y-1 text-xs">
          {dane.findings.map((f) => (
            <li key={f} className="border-l-2 border-ink/40 pl-2">{f}</li>
          ))}
        </ul>
      ) : null}

      {dane?.doPozyskania?.length ? (
        <div className="mt-3 border-l-2 border-amber-500 pl-3">
          <p className="text-xs font-medium">Do pozyskania przez biegłego</p>
          <ul className="mt-1 space-y-0.5 text-xs text-inksoft">
            {dane.doPozyskania.map((d) => (
              <li key={d}>◐ {d}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {(dane?.tables ?? []).slice(0, 2).map((t) => (
        <div key={t.caption} className="mt-4 overflow-x-auto">
          <p className="text-[11px] font-medium">{t.caption}</p>
          <table className="mt-1 w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-ink/30 text-left">
                {t.head.map((h, i) => (
                  <th key={h} className={`py-1 pr-2 font-medium ${i ? "text-right" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t.rows.slice(0, 8).map((r, i) => (
                <tr key={i} className="border-b border-ink/10">
                  {r.map((v, j) => (
                    <td key={j} className={`py-1 pr-2 tabular-nums ${j ? "text-right" : ""}`}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {t.rows.length > 8 ? (
            <p className="mt-0.5 text-[11px] text-inksoft">… i {t.rows.length - 8} kolejnych wierszy (całość w rozdziale IV.1).</p>
          ) : null}
        </div>
      ))}

      {dane?.uwagi?.length ? (
        <ul className="mt-3 space-y-0.5 text-[11px] text-inksoft">
          {dane.uwagi.map((u) => (
            <li key={u}>⚠ {u}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
