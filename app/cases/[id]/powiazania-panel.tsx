"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

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

  return (
    <section className="border border-ink/60 bg-card p-4">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em]">Powiązania — dane (Krok 4)</h2>
      <p className="mb-3 text-xs leading-relaxed text-inksoft">
        Korelacja logowań z <strong>tych samych adresów IP</strong> — z pliku logowań (<code>Logins_users…xlsx</code>).
        Silnik wskazuje pary użytkowników dzielących adresy IP, każda z liczbą wspólnych adresów (widać, skąd wniosek).
        To dowód zbieżności infrastruktury — weryfikuje tezę o <strong>działaniu wspólnie i w porozumieniu</strong> z
        zawiadomienia KNF; ocenę relewancji przeprowadza biegły.
      </p>

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
          <button
            onClick={run}
            disabled={!active || busy}
            className="border border-ink bg-ink px-3 py-1.5 text-xs uppercase tracking-wider text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "Liczę…" : "Analizuj powiązania IP"}
          </button>
          {msg && <span className="text-xs text-inksoft">{msg}</span>}
        </div>
      )}

      {result && (
        <>
          <p className="mb-2 text-xs text-inksoft">{result.body_md}</p>
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
