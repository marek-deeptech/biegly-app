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
  const ipFiles = useMemo(
    () => documents.filter((d) => d.doc_type === "DANE_IP" && d.storage_path && /\.(xlsx|xls)$/i.test(d.rel_path)),
    [documents],
  );
  const [sel, setSel] = useState("");
  const [busy, setBusy] = useState(false);
  const [dlBusy, setDlBusy] = useState(false);
  const [graphBusy, setGraphBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const active = sel || ipFiles[0]?.storage_path || "";
  const result = stored.find((s) => s.kind === "powiazania_dane");
  const table = (result?.data?.table ?? null) as OpTable | null;

  async function run() {
    if (!active) return;
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/ip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId, storagePath: active }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setMsg(`Policzono: ${j.pairs} par (${j.users} użytkowników, ${j.ips} adresów IP).`);
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
          Brak w aktach pliku logowań (typ „Dane IP”, <code>Logins_users…xlsx</code> w magazynie).
        </p>
      ) : (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select
            value={active}
            onChange={(e) => setSel(e.target.value)}
            className="max-w-[260px] rounded-lg border border-ink/30 px-2 py-1.5 text-xs"
          >
            {ipFiles.map((d) => (
              <option key={d.storage_path} value={d.storage_path ?? ""}>
                {d.rel_path.split("/").pop()}
              </option>
            ))}
          </select>
          <Button variant="primary" size="sm" onClick={run} disabled={!active} loading={busy} loadingLabel="Liczę…">
            Analizuj powiązania IP
          </Button>
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
