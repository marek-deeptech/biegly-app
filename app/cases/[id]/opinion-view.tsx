"use client";

import { useMemo } from "react";

import { buildOpinion, type Chapter, type Conf, type Para } from "@/lib/opinion/build";

type Metric = {
  key: string;
  value: number | null;
  unit: string | null;
  session_day: string | null;
};
type Doc = { rel_path: string; provenance: string | null };

const STATUS: Record<Chapter["status"], { label: string; cls: string }> = {
  ready: { label: "gotowe", cls: "bg-emerald-100 text-emerald-800" },
  draft: { label: "szkic", cls: "bg-amber-100 text-amber-800" },
  todo: { label: "do wygenerowania", cls: "bg-ink/10 text-inksoft" },
};

const CONF: Record<Conf, string> = {
  grounded: "border-emerald-400",
  review: "border-amber-400",
  todo: "border-ink/20",
};

export default function OpinionView({
  caseId,
  caseRow,
  metrics,
  documents,
}: {
  caseId: string;
  caseRow: { name: string; signature: string | null };
  metrics: Metric[];
  documents: Doc[];
}) {
  const opinion = useMemo(
    () => buildOpinion(caseRow, metrics, documents),
    [caseRow, metrics, documents],
  );
  const ready = opinion.chapters.filter((c) => c.status === "ready").length;

  return (
    <section className="border border-ink/60 bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em]">Opinia — montaż (projekt roboczy)</h2>
          <p className="mt-1 text-xs text-inksoft">
            Złożona z subanaliz · {ready}/{opinion.chapters.length} rozdziałów gotowych
          </p>
        </div>
        <a
          href={`/cases/${caseId}/opinion/docx`}
          className="border border-ink bg-ink px-3 py-1.5 text-xs uppercase tracking-wider text-paper transition-opacity hover:opacity-90"
        >
          Eksportuj .docx
        </a>
      </div>

      <div className="mb-4 flex flex-wrap gap-3 text-[11px] text-inksoft">
        <Legend cls="border-emerald-400" t="ugruntowane w danych" />
        <Legend cls="border-amber-400" t="do weryfikacji biegłego" />
        <Legend cls="border-ink/20" t="do wygenerowania" />
      </div>

      <div className="mb-4 rounded-lg border border-line bg-paper px-3 py-2 text-xs text-inksoft">
        Podstawa prawna:{" "}
        {opinion.legalBasis.map((l, i) => (
          <span key={i}>
            {i > 0 ? "; " : ""}
            {l}
          </span>
        ))}
      </div>

      <ol className="space-y-4">
        {opinion.chapters.map((ch) => (
          <li key={ch.no} className="border border-line bg-paper p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">
                {ch.no}. {ch.title}
              </h3>
              <span className={`rounded-full px-2 py-0.5 text-[11px] ${STATUS[ch.status].cls}`}>
                {STATUS[ch.status].label}
              </span>
            </div>
            {ch.source && <p className="mb-2 text-[11px] italic text-inksoft">Źródło: {ch.source}</p>}

            <div className="space-y-2">
              {ch.paras.map((p, i) => (
                <ParaLine key={i} p={p} />
              ))}
            </div>

            {ch.table && (
              <div className="mt-3">
                <p className="mb-1 text-[11px] italic text-inksoft">{ch.table.caption}</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-inksoft">
                      {ch.table.head.map((h, i) => (
                        <th key={i} className={i === 0 ? "py-1 text-left" : "py-1 text-right"}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ch.table.rows.map((r, ri) => (
                      <tr key={ri} className="border-b border-line last:border-0">
                        {r.map((c, ci) => (
                          <td
                            key={ci}
                            className={ci === 0 ? "py-1.5" : "py-1.5 text-right tabular-nums"}
                          >
                            {c}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {ch.findings && ch.findings.length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-xs font-semibold">Wnioski cząstkowe</p>
                <ul className="space-y-1">
                  {ch.findings.map((f, i) => (
                    <li key={i} className={`border-l-2 pl-2 text-sm ${CONF[f.conf]}`}>
                      {f.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {ch.attachments && ch.attachments.length > 0 && (
              <ol className="mt-2 space-y-0.5 text-xs text-inksoft">
                {ch.attachments.map((a, i) => (
                  <li key={i}>
                    Zał. {i + 1}. {a}
                  </li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function ParaLine({ p }: { p: Para }) {
  return (
    <p className={`border-l-2 pl-2 text-sm ${CONF[p.conf]}`}>
      {p.conf === "todo" && <span className="text-inksoft">[do uzupełnienia] </span>}
      {p.text}
    </p>
  );
}

function Legend({ cls, t }: { cls: string; t: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block h-3 w-1 border-l-2 ${cls}`} />
      {t}
    </span>
  );
}
