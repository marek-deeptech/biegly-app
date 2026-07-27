"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui";

// A3 — Powiązania z danych (Krok 4): korelacja adresów IP z pliku logowań.
// Silnik liczy pary użytkowników dzielących adresy IP (dowód zbieżności).

type Doc = { rel_path: string; doc_type?: string | null; storage_path?: string | null };
type OpTable = { caption: string; head: string[]; rows: string[][] };
type SubRow = { kind: string; body_md: string; data: { table?: unknown; findings?: string[] } | null };

export default function PowiazaniaPanel({
  caseId,
  documents,
  stored,
}: {
  caseId: string;
  documents: Doc[];
  stored: SubRow[];
}) {
  const router = useRouter();
  // Wszystkie pliki logowań (xls/xlsx/txt) — backend łączy je kompleksowo. Dedup po nazwie
  // (te same pliki leżą w kilku TOM-ach) tylko do podglądu/liczby.
  const ipFiles = useMemo(() => {
    const seen = new Set<string>();
    return documents.filter((d) => {
      if (d.doc_type !== "DANE_IP" || !d.storage_path) return false;
      const base = (d.rel_path.split("/").pop() ?? "").toLowerCase();
      if (!/logowania/.test(base) || !/\.(xlsx?|xlsm|txt)$/.test(base)) return false;
      if (seen.has(base)) return false;
      seen.add(base);
      return true;
    });
  }, [documents]);
  const [busy, setBusy] = useState(false);
  const [dlBusy, setDlBusy] = useState(false);
  const [graphBusy, setGraphBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const result = stored.find((s) => s.kind === "powiazania_dane");
  const table = (result?.data?.table ?? null) as OpTable | null;

  async function run() {
    if (ipFiles.length === 0) return;
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/ip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId }), // backend łączy wszystkie pliki logowań sprawy
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setMsg(
        `Policzono łącznie z ${j.files?.length ?? "?"} plików (${j.logins ?? "?"} logowań): ${j.pairs} par, ` +
          `${j.users} podmiotów, ${j.ips} adresów IP${j.skipped?.length ? `; pominięto ${j.skipped.length}` : ""}.`,
      );
      router.refresh();
    } catch (e) {
      setMsg(`Błąd: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  // Pobranie załącznika „Wykaz powiązań IP" (PDF) — renderowany z zapisanej analizy.
  async function downloadIp() {
    setDlBusy(true);
    try {
      const r = await fetch(`/cases/${caseId}/opinion/ip`);
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        throw new Error(j?.reason || `HTTP ${r.status}`);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "Wykaz_powiazan_IP.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setMsg(`PDF: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDlBusy(false);
    }
  }

  // Pobranie załącznika „Graf powiązań kapitałowo-osobowych" (PDF poziomy) — z rostera/KRS/UTP.
  async function downloadGraph() {
    setGraphBusy(true);
    try {
      const r = await fetch(`/cases/${caseId}/opinion/graf`);
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        throw new Error(j?.reason || `HTTP ${r.status}`);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "Graf_powiazan.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setMsg(`Graf: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGraphBusy(false);
    }
  }

  return (
    <section className="border border-ink/60 bg-card p-4">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em]">Powiązania — dane (Krok 4)</h2>
      <p className="mb-3 text-xs leading-relaxed text-inksoft">
        Korelacja logowań z <strong>tych samych adresów IP</strong> — z pliku logowań (<code>Logins_users…xlsx</code>).
        Silnik wskazuje pary użytkowników dzielących adresy IP, każda z liczbą wspólnych adresów (widać, skąd wniosek).
        To dowód zbieżności infrastruktury — weryfikuje tezę o <strong>działaniu wspólnie i w porozumieniu</strong> z
        zawiadomienia KNF; ocenę relewancji przeprowadza biegły.
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-line pb-3">
        <span className="text-xs text-inksoft">
          <strong>Graf powiązań kapitałowo-osobowych</strong> — podmioty Grupy, beneficjenci/organy (KRS) i obrót wewnątrzgrupowy (UTP):
        </span>
        <Button variant="primary" size="sm" onClick={downloadGraph} loading={graphBusy} loadingLabel="Generuję PDF…">
          Pobierz graf powiązań (PDF)
        </Button>
      </div>

      {ipFiles.length === 0 ? (
        <p className="text-xs text-inksoft">
          Brak w aktach plików logowań (typ „Dane IP”, <code>…logowania.xls/xlsx/txt</code> w magazynie).
        </p>
      ) : (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={run}
            loading={busy}
            loadingLabel="Liczę…"
            title={`Złączy ${ipFiles.length} plików logowań: ${ipFiles
              .map((d) => d.rel_path.split("/").pop())
              .join(", ")}`}
          >
            Analizuj powiązania IP (łącznie)
          </Button>
          <span className="text-[11px] text-inksoft">{ipFiles.length} plików logowań w aktach</span>
          {msg && <span className="text-xs text-inksoft">{msg}</span>}
        </div>
      )}

      {result && (
        <>
          <p className="mb-2 text-xs text-inksoft">{result.body_md}</p>
          <Button variant="successSolid" size="sm" onClick={downloadIp} loading={dlBusy} loadingLabel="Generuję PDF…" className="mb-3">
            Pobierz załącznik — Wykaz powiązań IP (PDF)
          </Button>
          {table && (
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-inksoft">
                    {table.head.map((h, i) => (
                      <th key={i} className={i < 2 ? "py-1 text-left" : "py-1 text-right"}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.slice(0, 40).map((row, ri) => (
                    <tr key={ri} className="border-b border-line last:border-0">
                      {row.map((c, ci) => (
                        <td key={ci} className={ci < 2 ? "py-1.5" : "py-1.5 text-right tabular-nums"}>
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
