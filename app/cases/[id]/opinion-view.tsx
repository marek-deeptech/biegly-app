"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import {
  buildEkofinSubanaliza,
  buildOpinion,
  buildOtcSubanaliza,
  buildPorozumienieSubanaliza,
  buildQuantitativeSubanaliza,
  buildWnioskiSubanaliza,
  type Chapter,
  type Conf,
  type Para,
  type StoredSub,
  type SubResult,
} from "@/lib/opinion/build";
import { REVIEW_CHECKS, reviewOpinion, type Severity } from "@/lib/opinion/review";

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
  const [subtab, setSubtab] = useState<"warsztat" | "recenzent" | "montaz">("warsztat");

  const stored = subanalyses as unknown as StoredSub[];
  const opinion = useMemo(
    () => buildOpinion(caseRow, metrics, documents, stored),
    [caseRow, metrics, documents, stored],
  );
  const ready = opinion.chapters.filter((c) => c.status === "ready").length;
  const review = useMemo(() => reviewOpinion(opinion, metrics, stored), [opinion, metrics, stored]);
  const revIssues = review.filter((r) => r.severity !== "OK").length;
  const hasQuant = subanalyses.some((s) => s.kind === "ilosciowa");
  const hasEkofin = subanalyses.some((s) => s.kind === "ekofin");
  const hasPoroz = subanalyses.some((s) => s.kind === "porozumienie");
  const hasOtc = subanalyses.some((s) => s.kind === "otc");
  const hasWnioski = subanalyses.some((s) => s.kind === "wnioski");
  const canWnioski = subanalyses.some((s) => s.status === "zatwierdzona" && s.chapter_no.startsWith("IV"));
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
  const genPoroz = (ow = false) => saveGenerated(buildPorozumienieSubanaliza(metrics, documents), ow);
  const genOtc = (ow = false) => saveGenerated(buildOtcSubanaliza(metrics, documents), ow);
  const genWnioski = (ow = false) => saveGenerated(buildWnioskiSubanaliza(stored), ow);

  // Redakcja rozdziału miękkiego przez model (Claude API). Model redaguje prozę —
  // liczby i fakty wstrzykiwane są z silnika po stronie serwera.
  async function redact(chapter: "I" | "III" | "V") {
    setBusy("redact-" + chapter);
    setMsg("");
    try {
      const r = await fetch(`/cases/${caseId}/opinion/redact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapter }),
      });
      const j = await r.json();
      if (!j.ok) {
        setMsg(j.reason || "Błąd redakcji.");
        setBusy(null);
        return;
      }
      const supabase = createClient();
      const { error } = await supabase.from("subanalyses").upsert(
        {
          case_id: caseId,
          kind: j.meta.kind,
          chapter_no: j.meta.chapterNo,
          title: j.meta.title,
          body_md: j.text,
          data: { table: null, findings: [], legalRefs: [] },
          status: "szkic",
          approved_at: null,
        },
        { onConflict: "case_id,kind" },
      );
      setBusy(null);
      if (error) setMsg(migrationHint(error.message));
      else router.refresh();
    } catch {
      setBusy(null);
      setMsg("Błąd sieci przy redakcji.");
    }
  }
  const hasKind = (k: string) => subanalyses.some((s) => s.kind === k);

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
      <div className="flex gap-1 border-b border-ink/20">
        {([
          ["warsztat", "Warsztat"],
          ["recenzent", `Recenzent${revIssues ? ` · ${revIssues}` : ""}`],
          ["montaz", `Montaż · ${ready}/${opinion.chapters.length}`],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setSubtab(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-xs uppercase tracking-wider transition-colors ${
              subtab === key
                ? "border-ink font-semibold text-ink"
                : "border-transparent text-inksoft hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Panel subanaliz (warsztat) ── */}
      {subtab === "warsztat" && (
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
            {!hasPoroz && (
              <button
                onClick={() => genPoroz(false)}
                disabled={busy !== null}
                className="border border-ink px-3 py-1.5 text-xs uppercase tracking-wider transition-colors hover:bg-ink hover:text-paper disabled:opacity-40"
              >
                {busy === "gen-porozumienie" ? "Generuję…" : "Generuj: porozumienie"}
              </button>
            )}
            {!hasOtc && (
              <button
                onClick={() => genOtc(false)}
                disabled={busy !== null}
                className="border border-ink px-3 py-1.5 text-xs uppercase tracking-wider transition-colors hover:bg-ink hover:text-paper disabled:opacity-40"
              >
                {busy === "gen-otc" ? "Generuję…" : "Generuj: motyw/OTC"}
              </button>
            )}
            {!hasWnioski && canWnioski && (
              <button
                onClick={() => genWnioski(false)}
                disabled={busy !== null}
                className="border border-emerald-600 bg-emerald-600 px-3 py-1.5 text-xs uppercase tracking-wider text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                title="Synteza z zatwierdzonych subanaliz"
              >
                {busy === "gen-wnioski" ? "Generuję…" : "Generuj: Wnioski"}
              </button>
            )}
            {(["I", "III", "V"] as const).map((ch) =>
              hasKind(`proza_${ch.toLowerCase()}`) ? null : (
                <button
                  key={ch}
                  onClick={() => redact(ch)}
                  disabled={busy !== null}
                  className="border border-ink/60 px-3 py-1.5 text-xs uppercase tracking-wider text-inksoft transition-colors hover:border-ink hover:text-ink disabled:opacity-40"
                  title="Redakcja rozdziału przez model (Claude API)"
                >
                  {busy === "redact-" + ch ? "Redaguję…" : `Proza ${ch} (model)`}
                </button>
              ),
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
                      {["ilosciowa", "ekofin", "porozumienie", "otc", "wnioski"].includes(s.kind) && (
                        <button
                          onClick={() => {
                            if (confirm("Nadpisać treść świeżym wynikiem z danych? Twoje zmiany w tej subanalizie zostaną utracone."))
                              s.kind === "ilosciowa"
                                ? genQuant(true)
                                : s.kind === "ekofin"
                                  ? genEkofin(true)
                                  : s.kind === "porozumienie"
                                    ? genPoroz(true)
                                    : s.kind === "otc"
                                      ? genOtc(true)
                                      : genWnioski(true);
                          }}
                          disabled={busy !== null}
                          className="text-xs uppercase tracking-wider text-inksoft underline-offset-2 hover:underline disabled:opacity-40"
                        >
                          {s.kind === "ilosciowa"
                            ? "Odśwież z silnika"
                            : s.kind === "wnioski"
                              ? "Odśwież z subanaliz"
                              : "Odśwież z inwentarza"}
                        </button>
                      )}
                      {s.kind.startsWith("proza_") && (
                        <button
                          onClick={() => {
                            if (confirm("Ponownie zredagować rozdział modelem? Twoje zmiany zostaną utracone."))
                              redact(s.chapter_no as "I" | "III" | "V");
                          }}
                          disabled={busy !== null}
                          className="text-xs uppercase tracking-wider text-inksoft underline-offset-2 hover:underline disabled:opacity-40"
                        >
                          Odśwież z modelu
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

      )}

      {/* ── Recenzent (QA#2) ── */}
      {subtab === "recenzent" && (
      <section className="border border-ink/60 bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em]">Recenzent (QA#2)</h2>
          <p className="text-xs text-inksoft">
            {review.filter((r) => r.severity === "ERROR").length} błędów ·{" "}
            {review.filter((r) => r.severity === "WARN").length} uwag ·{" "}
            {review.filter((r) => r.severity === "OK").length} OK
          </p>
        </div>
        <ul className="space-y-3">
          {REVIEW_CHECKS.map((name) => {
            const fs = review.filter((r) => r.check === name);
            const worst: Severity = fs.some((f) => f.severity === "ERROR")
              ? "ERROR"
              : fs.some((f) => f.severity === "WARN")
                ? "WARN"
                : "OK";
            return (
              <li key={name} className="border border-line bg-paper p-3">
                <div className="mb-1 flex items-center gap-2">
                  <SevDot s={worst} />
                  <span className="text-sm font-semibold">{name}</span>
                </div>
                <ul className="space-y-1 pl-4">
                  {fs.map((f, i) => (
                    <li key={i} className={`text-sm ${sevText(f.severity)}`}>
                      {f.message}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      </section>

      )}

      {/* ── Montaż opinii ── */}
      {subtab === "montaz" && (
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
      )}
    </div>
  );
}

// Plik notowań pojedynczego instrumentu (CSV), z pominięciem zestawień sektorowych.
function pickNotowania(docs: Doc[]): Doc | undefined {
  const csv = (d: Doc) => !!d.storage_path && d.doc_type === "NOTOWANIA_REF" && /\.csv$/i.test(d.rel_path);
  return docs.find((d) => csv(d) && !/chemia|sektor|branż|peer|indeks/i.test(d.rel_path)) ?? docs.find(csv);
}

function SevDot({ s }: { s: Severity }) {
  const c = s === "ERROR" ? "bg-red-600" : s === "WARN" ? "bg-amber-500" : "bg-emerald-600";
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${c}`} />;
}
function sevText(s: Severity): string {
  return s === "ERROR" ? "text-red-700" : s === "WARN" ? "text-amber-800" : "text-inksoft";
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
