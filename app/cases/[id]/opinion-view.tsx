"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import {
  buildEkofinSubanaliza,
  buildOpinion,
  buildQuantitativeSubanaliza,
  type Chapter,
  type Conf,
  type Para,
  type StoredSub,
  type SubResult,
} from "@/lib/opinion/build";

type Metric = {
  key: string;
  value: number | null;
  unit: string | null;
  session_day: string | null;
};
type Doc = {
  rel_path: string;
  provenance: string | null;
  doc_type?: string | null;
  storage_path?: string | null;
};
type SubRow = {
  id: string;
  kind: string;
  chapter_no: string;
  title: string;
  status: string;
  body_md: string;
  data: { table?: unknown; findings?: string[]; legalRefs?: string[] } | null;
  updated_at?: string | null;
};

const KIND_LABEL: Record<string, string> = {
  ilosciowa: "Analiza ilościowa (silnik faktów)",
  ekofin: "Analiza ekonomiczno-finansowa",
  porozumienie: "Porozumienie (IP / OSINT)",
  otc: "Obrót pozagiełdowy / motyw",
};

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
  subanalyses,
}: {
  caseId: string;
  caseRow: { name: string; signature: string | null };
  metrics: Metric[];
  documents: Doc[];
  subanalyses: SubRow[];
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const stored = subanalyses as unknown as StoredSub[];
  const opinion = useMemo(
    () => buildOpinion(caseRow, metrics, documents, stored),
    [caseRow, metrics, documents, stored],
  );
  const ready = opinion.chapters.filter((c) => c.status === "ready").length;
  const hasQuant = subanalyses.some((s) => s.kind === "ilosciowa");
  const hasEkofin = subanalyses.some((s) => s.kind === "ekofin");
  const draftFor = (s: SubRow) => drafts[s.id] ?? s.body_md;

  async function saveGenerated(result: SubResult | null, overwrite = false) {
    if (!result) {
      setMsg("Brak danych do wygenerowania — najpierw policz wskaźniki na zakładce Sprawa.");
      return;
    }
    setBusy("gen-" + result.kind);
    setMsg("");
    const supabase = createClient();
    const { error } = await supabase.from("subanalyses").upsert(
      {
        case_id: caseId,
        kind: result.kind,
        chapter_no: result.chapterNo,
        title: result.title,
        body_md: result.bodyMd,
        data: result.data,
        ...(overwrite ? { status: "szkic", approved_at: null } : {}),
      },
      { onConflict: "case_id,kind" },
    );
    setBusy(null);
    if (error) {
      setMsg(migrationHint(error.message));
    } else {
      const ex = subanalyses.find((s) => s.kind === result.kind);
      if (ex) setDrafts((d) => { const n = { ...d }; delete n[ex.id]; return n; });
      router.refresh();
    }
  }
  const genQuant = (ow = false) => saveGenerated(buildQuantitativeSubanaliza(metrics), ow);

  async function genEkofin(ow = false) {
    // Policz dynamikę kursu z pliku notowań (NOTOWANIA_REF) w oknie analizy.
    let quotes = null;
    const nf = pickNotowania(documents);
    if (nf?.storage_path) {
      const days = [...new Set(metrics.filter((m) => m.session_day).map((m) => m.session_day))].sort();
      const win = days.length ? `&from=${days[0]}&to=${days[days.length - 1]}` : "";
      try {
        const r = await fetch(`/cases/${caseId}/quotes?path=${encodeURIComponent(nf.storage_path)}${win}`);
        const j = await r.json();
        if (j.ok) quotes = j.dynamics;
      } catch {
        /* brak notowań — sekcja zostanie z [do uzupełnienia] */
      }
    }
    await saveGenerated(buildEkofinSubanaliza(metrics, documents, quotes), ow);
  }

  async function saveBody(s: SubRow) {
    setBusy(s.id);
    setMsg("");
    const supabase = createClient();
    const { error } = await supabase.from("subanalyses").update({ body_md: draftFor(s) }).eq("id", s.id);
    setBusy(null);
    if (error) setMsg(migrationHint(error.message));
    else router.refresh();
  }

  async function setStatus(s: SubRow, status: "szkic" | "zatwierdzona") {
    setBusy(s.id);
    setMsg("");
    const supabase = createClient();
    const patch =
      status === "zatwierdzona"
        ? { status, approved_at: new Date().toISOString() }
        : { status, approved_at: null };
    const { error } = await supabase.from("subanalyses").update(patch).eq("id", s.id);
    setBusy(null);
    if (error) setMsg(migrationHint(error.message));
    else router.refresh();
  }

  return (
    <div className="space-y-6">
      {/* ── Panel subanaliz (warsztat) ── */}
      <section className="border border-ink/60 bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em]">Subanalizy (warsztat)</h2>
          <div className="flex flex-wrap gap-2">
            {!hasQuant && (
              <button
                onClick={() => genQuant(false)}
                disabled={busy !== null || metrics.length === 0}
                className="border border-ink bg-ink px-3 py-1.5 text-xs uppercase tracking-wider text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {busy === "gen-ilosciowa" ? "Generuję…" : "Generuj: ilościowa"}
              </button>
            )}
            {!hasEkofin && (
              <button
                onClick={() => genEkofin(false)}
                disabled={busy !== null}
                className="border border-ink px-3 py-1.5 text-xs uppercase tracking-wider transition-colors hover:bg-ink hover:text-paper disabled:opacity-40"
              >
                {busy === "gen-ekofin" ? "Generuję…" : "Generuj: eko-fin"}
              </button>
            )}
          </div>
        </div>

        {msg && <p className="mb-3 text-sm text-red-600">{msg}</p>}

        {subanalyses.length === 0 && !msg && (
          <p className="text-xs text-inksoft">
            Brak subanaliz. Wygeneruj subanalizę ilościową z policzonych wskaźników — następnie możesz
            ją edytować i zatwierdzić. Opinia montuje się wyłącznie z zatwierdzonych subanaliz.
          </p>
        )}

        <div className="space-y-4">
          {subanalyses.map((s) => {
            const approved = s.status === "zatwierdzona";
            return (
              <div key={s.id} className="border border-line bg-paper p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold">{KIND_LABEL[s.kind] ?? s.title}</h3>
                    <p className="text-[11px] text-inksoft">
                      Rozdział {s.chapter_no}
                      {s.updated_at ? ` · zmieniono ${new Date(s.updated_at).toLocaleString("pl-PL")}` : ""}
                    </p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${approved ? STATUS.ready.cls : STATUS.draft.cls}`}>
                    {approved ? "zatwierdzona" : "szkic"}
                  </span>
                </div>

                <textarea
                  value={draftFor(s)}
                  onChange={(e) => setDrafts((d) => ({ ...d, [s.id]: e.target.value }))}
                  disabled={approved}
                  rows={Math.min(14, Math.max(6, draftFor(s).split("\n").length + 1))}
                  className="w-full resize-y border border-ink/20 bg-card px-3 py-2 text-sm leading-relaxed outline-none focus:border-ink disabled:opacity-70"
                />

                {(s.data?.findings?.length ?? 0) > 0 && (
                  <ul className="mt-2 space-y-1">
                    {s.data!.findings!.map((f, i) => (
                      <li key={i} className="border-l-2 border-emerald-400 pl-2 text-xs text-inksoft">{f}</li>
                    ))}
                  </ul>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {!approved ? (
                    <>
                      <button
                        onClick={() => saveBody(s)}
                        disabled={busy !== null || draftFor(s) === s.body_md}
                        className="border border-ink px-3 py-1.5 text-xs uppercase tracking-wider transition-colors hover:bg-ink hover:text-paper disabled:opacity-40"
                      >
                        {busy === s.id ? "Zapisuję…" : "Zapisz"}
                      </button>
                      <button
                        onClick={() => setStatus(s, "zatwierdzona")}
                        disabled={busy !== null}
                        className="border border-emerald-600 bg-emerald-600 px-3 py-1.5 text-xs uppercase tracking-wider text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                      >
                        Zatwierdź
                      </button>
                      {(s.kind === "ilosciowa" || s.kind === "ekofin") && (
                        <button
                          onClick={() => {
                            if (confirm("Nadpisać treść świeżym wynikiem z danych? Twoje zmiany w tej subanalizie zostaną utracone."))
                              s.kind === "ilosciowa" ? genQuant(true) : genEkofin(true);
                          }}
                          disabled={busy !== null}
                          className="text-xs uppercase tracking-wider text-inksoft underline-offset-2 hover:underline disabled:opacity-40"
                        >
                          {s.kind === "ilosciowa" ? "Odśwież z silnika" : "Odśwież z inwentarza"}
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      onClick={() => setStatus(s, "szkic")}
                      disabled={busy !== null}
                      className="border border-ink px-3 py-1.5 text-xs uppercase tracking-wider transition-colors hover:bg-ink hover:text-paper disabled:opacity-40"
                    >
                      Cofnij zatwierdzenie
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Montaż opinii ── */}
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
          <Legend cls="border-emerald-400" t="ugruntowane / zatwierdzone" />
          <Legend cls="border-amber-400" t="szkic — do weryfikacji" />
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
                            <td key={ci} className={ci === 0 ? "py-1.5" : "py-1.5 text-right tabular-nums"}>
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
    </div>
  );
}

// Plik notowań pojedynczego instrumentu (CSV), z pominięciem zestawień sektorowych.
function pickNotowania(docs: Doc[]): Doc | undefined {
  const csv = (d: Doc) => !!d.storage_path && d.doc_type === "NOTOWANIA_REF" && /\.csv$/i.test(d.rel_path);
  return docs.find((d) => csv(d) && !/chemia|sektor|branż|peer|indeks/i.test(d.rel_path)) ?? docs.find(csv);
}

function migrationHint(m: string): string {
  if (/relation|does not exist|schema cache|subanalyses/i.test(m))
    return "Tabela subanalyses nie istnieje — uruchom migrację 0004_subanalyses.sql w Supabase SQL Editor.";
  return m;
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
