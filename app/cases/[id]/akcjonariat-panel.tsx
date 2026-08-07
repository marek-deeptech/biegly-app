"use client";

// KROK 5 GPW — HISTORIA ZMIAN W AKCJONARIACIE.
//
// Tabela stanu posiadania na każdy dzień, w którym cokolwiek się zmieniło. Dwa
// źródła o różnej wadze: sprawozdania opisowe zarządu (dokument emitenta, stan na
// koniec roku) i Bankier.pl (opracowanie serwisu, ale dzień po dniu).
//
// Panel POKAZUJE to, co policzył krok — nie liczy sam. Liczby, kwalifikacja zdarzeń
// i rozbieżności między źródłami powstają w lib/opinion/akcjonariat.ts.

import { useMemo, useState } from "react";

type Sub = { kind: string; status?: string; data?: unknown };
type Tabela = { caption?: string; head?: string[]; rows?: string[][] };

const KOLOR: Record<string, string> = {
  nabycie: "text-emerald-700",
  "objęcie emisji": "text-emerald-700",
  zbycie: "text-red-700",
  "rozwodnienie (emisja)": "text-amber-700",
  "do wyjaśnienia": "text-amber-700",
};

function Tabelka({ t, maks }: { t: Tabela; maks: number }) {
  if (!t?.rows?.length) return null;
  const kolKwal = (t.head ?? []).indexOf("Kwalifikacja");
  return (
    <div className="mt-3">
      {t.caption ? <p className="text-[11px] font-medium">{t.caption}</p> : null}
      <div className="mt-1 overflow-x-auto">
        <table className="w-full border-collapse text-xs">
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
                  <td
                    key={j}
                    className={`py-1 pr-2 tabular-nums ${j ? "text-right" : ""} ${
                      j === kolKwal ? (KOLOR[String(v)] ?? "") : ""
                    }`}
                  >
                    {String(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {t.rows.length > maks ? (
        <p className="mt-1 text-[11px] text-inksoft">… i {t.rows.length - maks} kolejnych wierszy.</p>
      ) : null}
    </div>
  );
}

export default function AkcjonariatPanel({
  caseId,
  subanalyses,
  onDone,
}: {
  caseId: string;
  subanalyses: Sub[];
  onDone: () => void;
}) {
  const [ticker, setTicker] = useState("");
  const [emitent, setEmitent] = useState("");
  const [praca, setPraca] = useState<"" | "bankier" | "sprawozdania" | "zawiadomienia">("");
  const [msg, setMsg] = useState("");
  const [pokaz, setPokaz] = useState(15);

  const dane = useMemo(() => {
    const s = subanalyses.find((x) => x.kind === "akcjonariat");
    return (s?.data ?? null) as
      | { tables?: Tabela[]; findings?: string[]; zdarzenia?: unknown[]; zrodla?: string[] }
      | null;
  }, [subanalyses]);
  const spraw = useMemo(() => {
    const s = subanalyses.find((x) => x.kind === "akcjonariat_sprawozdania");
    return (s?.data ?? null) as { zmiany?: unknown[]; zbadane?: string[]; bezTekstu?: string[]; obce?: string[] } | null;
  }, [subanalyses]);

  async function uruchom(co: "bankier" | "sprawozdania" | "zawiadomienia") {
    if (co === "bankier" && !ticker.trim()) {
      setMsg("Podaj symbol spółki w serwisie Bankier.pl (np. HUBTECH).");
      return;
    }
    setPraca(co);
    setMsg("");
    try {
      const res = await fetch(`/cases/${caseId}/akcjonariat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zrodlo: co, ticker: ticker.trim(), emitent: emitent.trim() }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.reason || `HTTP ${res.status}`);
      setMsg(d.podsumowanie ?? "Gotowe.");
      onDone();
    } catch (e) {
      setMsg(`Błąd: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPraca("");
    }
  }

  const tabele = dane?.tables ?? [];

  return (
    <section className="border border-ink/60 bg-card p-4">
      <h2 className="text-xs font-semibold uppercase tracking-[0.12em]">Historia zmian w akcjonariacie</h2>
      <p className="mt-1 text-[11px] text-inksoft">
        Stan posiadania na każdy dzień, w którym odnotowano zmianę. Trzy źródła: zawiadomienia z art. 69
        (dowód — stan przed i po zdarzeniu), sprawozdania opisowe zarządu (stan na dzień bilansowy) oraz
        historia serwisu Bankier.pl. Spadek udziału bez zbycia akcji jest oznaczany jako rozwodnienie emisją,
        nie jako wyjście z akcjonariatu.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-[11px]">
          <span className="block text-inksoft">Symbol w Bankier.pl</span>
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            placeholder="HUBTECH"
            className="mt-0.5 w-36 border border-ink/40 bg-transparent px-2 py-1 text-xs"
          />
        </label>
        <label className="text-[11px]">
          <span className="block text-inksoft">Nazwa emitenta (opcjonalnie, dla podpisów tabel)</span>
          <input
            value={emitent}
            onChange={(e) => setEmitent(e.target.value)}
            placeholder="Hub.Tech S.A."
            className="mt-0.5 w-56 border border-ink/40 bg-transparent px-2 py-1 text-xs"
          />
        </label>
        <button
          onClick={() => uruchom("bankier")}
          disabled={!!praca}
          className="border border-ink/60 px-3 py-1 text-xs hover:bg-ink hover:text-card disabled:opacity-50"
        >
          {praca === "bankier" ? "Pobieram…" : "Pobierz historię (Bankier.pl)"}
        </button>
        <button
          onClick={() => uruchom("zawiadomienia")}
          disabled={!!praca}
          className="border border-ink/60 px-3 py-1 text-xs hover:bg-ink hover:text-card disabled:opacity-50"
        >
          {praca === "zawiadomienia" ? "Czytam…" : "Odczytaj zawiadomienia o stanie posiadania (akta)"}
        </button>
        <button
          onClick={() => uruchom("sprawozdania")}
          disabled={!!praca}
          className="border border-ink/60 px-3 py-1 text-xs hover:bg-ink hover:text-card disabled:opacity-50"
        >
          {praca === "sprawozdania" ? "Czytam…" : "Odczytaj sprawozdania zarządu (akta)"}
        </button>
      </div>
      {msg ? <p className="mt-2 text-[11px]">{msg}</p> : null}

      {spraw?.bezTekstu?.length ? (
        <p className="mt-2 border-l-2 border-amber-600 pl-2 text-[11px]">
          {spraw.bezTekstu.length} sprawozdań w aktach to skany bez warstwy tekstowej — wymagają OCR, zanim
          będzie można je odczytać: {spraw.bezTekstu.slice(0, 3).join(", ")}
          {spraw.bezTekstu.length > 3 ? " …" : ""}
        </p>
      ) : null}
      {spraw?.obce?.length ? (
        <p className="mt-1 border-l-2 border-amber-600 pl-2 text-[11px]">
          Pominięto {spraw.obce.length} dokument(ów) opisujących akcjonariat innej spółki (np. zależnej).
        </p>
      ) : null}

      {!dane ? (
        <p className="mt-3 text-xs text-inksoft">
          Krok jeszcze nie policzony. Dla spółki notowanej zacznij od Bankier.pl; dla spółki WYKLUCZONEJ
          Z OBROTU serwis nie prowadzi strony (CSY, RSY i ZASTAL zwracają błąd 404) i historię trzeba złożyć
          z zawiadomień o stanie posiadania oraz sprawozdań zarządu z akt.
        </p>
      ) : (
        <>
          {dane.findings?.length ? (
            <ul className="mt-3 space-y-1 text-xs">
              {dane.findings.map((f) => (
                <li key={f} className="border-l-2 border-ink/40 pl-2">{f}</li>
              ))}
            </ul>
          ) : null}
          {tabele.map((t, i) => (
            <Tabelka key={t.caption ?? i} t={t} maks={i === 0 ? pokaz : 12} />
          ))}
          {(tabele[0]?.rows?.length ?? 0) > pokaz ? (
            <button onClick={() => setPokaz((p) => p + 25)} className="mt-2 text-[11px] underline">
              Pokaż więcej wierszy
            </button>
          ) : null}
          {dane.zrodla?.length ? (
            <p className="mt-3 text-[11px] text-inksoft">Źródła: {dane.zrodla.join(" · ")}</p>
          ) : null}
        </>
      )}
    </section>
  );
}
