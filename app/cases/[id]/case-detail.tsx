"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { classify } from "@/lib/intake/classify";
import { DOC_TYPES } from "@/lib/intake/taxonomy";
import { createClient } from "@/lib/supabase/client";

type CaseRow = { id: string; name: string; signature: string | null };
type Doc = {
  id: string;
  rel_path: string;
  size_bytes: number | null;
  doc_type: string;
  source: string | null;
  provenance: string | null;
};
type Check = { label: string; present: boolean };

export default function CaseDetail({
  caseRow,
  documents,
  checklist,
  recommended,
}: {
  caseRow: CaseRow;
  documents: Doc[];
  checklist: Check[];
  recommended: Check[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState("");

  const stats = useMemo(() => {
    const wej = documents.filter((d) => d.provenance === "wejście").length;
    const wyj = documents.filter((d) => d.provenance === "wyjście").length;
    const byType = new Map<string, number>();
    for (const d of documents) byType.set(d.doc_type, (byType.get(d.doc_type) ?? 0) + 1);
    const rows = [...byType.entries()].sort((a, b) => b[1] - a[1]);
    return { wej, wyj, rows };
  }, [documents]);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setBusy(true);
    setError("");
    const supabase = createClient();
    const files = Array.from(fileList);
    setProgress({ done: 0, total: files.length });
    const rows: {
      case_id: string;
      rel_path: string;
      size_bytes: number;
      doc_type: string;
      source: string | null;
      provenance: string;
      storage_path: string | null;
    }[] = [];

    for (const f of files) {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      const storagePath = `${caseRow.id}/${rel}`;
      const { error: upErr } = await supabase.storage
        .from("case-files")
        .upload(storagePath, f, { upsert: true });
      const { code, source, provenance } = classify(rel);
      rows.push({
        case_id: caseRow.id,
        rel_path: rel,
        size_bytes: f.size,
        doc_type: code,
        source,
        provenance,
        storage_path: upErr ? null : storagePath,
      });
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }

    const { error: insErr } = await supabase.from("documents").insert(rows);
    if (insErr) setError(insErr.message);
    setBusy(false);
    router.refresh();
  }

  const checklistOk = checklist.every((c) => c.present);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-800">
        ← Sprawy
      </Link>
      <header className="mb-8 mt-2">
        <h1 className="text-2xl font-semibold tracking-tight">{caseRow.name}</h1>
        {caseRow.signature && <p className="mt-1 text-sm text-neutral-500">{caseRow.signature}</p>}
      </header>

      <section className="mb-8 rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-medium">Wgraj akta sprawy</h2>
        <p className="mb-3 text-xs text-neutral-500">
          Możesz wskazać cały katalog. Pliki trafiają do prywatnego magazynu i są klasyfikowane.
        </p>
        <input
          type="file"
          multiple
          {...({ webkitdirectory: "" } as Record<string, string>)}
          disabled={busy}
          onChange={(e) => handleFiles(e.target.files)}
          className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white"
        />
        {busy && (
          <p className="mt-3 text-sm text-neutral-600">
            Przetwarzam… {progress.done}/{progress.total}
          </p>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </section>

      <section className="mb-8 grid grid-cols-3 gap-3">
        <Stat n={documents.length} label="dokumentów" />
        <Stat n={stats.wej} label="wejście (dowody)" color="text-emerald-700" />
        <Stat n={stats.wyj} label="wyjście (biegły)" color="text-amber-700" />
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-xl border border-neutral-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-medium">
            Checklista kanonu{" "}
            <span
              className={`ml-1 rounded-full px-2 py-0.5 text-xs ${
                checklistOk ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
              }`}
            >
              {checklistOk ? "komplet" : "braki"}
            </span>
          </h2>
          {checklist.map((c) => (
            <Row key={c.label} label={c.label} present={c.present} strongMissing />
          ))}
          <h2 className="mb-2 mt-4 text-sm font-medium">Zalecane</h2>
          {recommended.map((c) => (
            <Row key={c.label} label={c.label} present={c.present} />
          ))}
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-medium">Inwentarz wg typu</h2>
          {stats.rows.length === 0 ? (
            <p className="text-sm text-neutral-400">Brak dokumentów — wgraj akta powyżej.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {stats.rows.map(([code, n]) => (
                  <tr key={code} className="border-b border-neutral-100 last:border-0">
                    <td className="py-1.5">{DOC_TYPES[code]?.label ?? code}</td>
                    <td className="py-1.5 text-right tabular-nums font-medium">{n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </main>
  );
}

function Stat({ n, label, color = "" }: { n: number; label: string; color?: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
      <div className={`text-2xl font-semibold ${color}`}>{n}</div>
      <div className="text-xs text-neutral-500">{label}</div>
    </div>
  );
}

function Row({
  label,
  present,
  strongMissing = false,
}: {
  label: string;
  present: boolean;
  strongMissing?: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-neutral-100 py-1.5 last:border-0">
      <span className="text-sm">{label}</span>
      <span
        className={`rounded-full px-2 py-0.5 text-xs ${
          present
            ? "bg-emerald-100 text-emerald-800"
            : strongMissing
              ? "bg-red-100 text-red-800"
              : "bg-neutral-100 text-neutral-500"
        }`}
      >
        {present ? "obecny" : "brak"}
      </span>
    </div>
  );
}
