"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import {
  buildIVChapter,
  buildOpinion,
  buildWnioskiSubanaliza,
  type Chapter,
  type Conf,
  type Para,
  type QuoteDyn,
  type StoredSub,
  type SubResult,
} from "@/lib/opinion/build";
import { resolvePlan, type IVKind } from "@/lib/opinion/chapters";
import { REVIEW_CHECKS, reviewOpinion, type Severity } from "@/lib/opinion/review";
import PowiazaniaPanel from "./powiazania-panel";
import RosterPanel from "./roster-panel";
import TechniquesPanel from "./techniques-panel";

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
  ekofin: "Analiza ekonomiczno-finansowa",
  espi: "Raporty bieżące ESPI/EBI",
  aktywnosc: "Aktywność podmiotów z Grupy",
  relacje: "Relacje / porozumienie (IP, OSINT)",
  wash: "Wash trades",
  imo: "Improper matched orders",
  layering: "Layering & spoofing",
  pumpdump: "Pump and dump",
  wnioski: "Wnioski (synteza)",
  proza_i: "Rozdział I (model)",
  proza_iii: "Rozdział III — ujęcie teoretyczne (model)",
  proza_v: "Rozdział V (model)",
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
  const [section, setSection] = useState<"warsztat" | "rozdzialy" | "montaz" | "recenzent">("warsztat");
  const [wsub, setWsub] = useState<"podmioty" | "techniki" | "powiazania" | "osint" | "liczby">("podmioty");

  const stored = subanalyses as unknown as StoredSub[];
  const opinion = useMemo(
    () => buildOpinion(caseRow, metrics, documents, stored),
    [caseRow, metrics, documents, stored],
  );
  const ready = opinion.chapters.filter((c) => c.status === "ready").length;
  const review = useMemo(() => reviewOpinion(opinion, metrics, stored), [opinion, metrics, stored]);
  const revIssues = review.filter((r) => r.severity !== "OK").length;
  const selectedTech = useMemo(() => {
    const t = subanalyses.find((s) => s.kind === "techniki");
    return ((t?.data as { selected?: string[] } | null)?.selected ?? []) as IVKind[];
  }, [subanalyses]);
  const plan = useMemo(() => resolvePlan(caseRow.name, selectedTech), [caseRow.name, selectedTech]);
  const generated = useMemo(() => new Set(subanalyses.map((s) => s.kind)), [subanalyses]);
  const hasWnioski = generated.has("wnioski");
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
  // Dynamika kursu z pliku notowań (NOTOWANIA_REF) w oknie analizy — dla eko-fin i pump&dump.
  async function fetchQuotes(): Promise<QuoteDyn | null> {
    const nf = pickNotowania(documents);
    if (!nf?.storage_path) return null;
    const days = [...new Set(metrics.filter((m) => m.session_day).map((m) => m.session_day))].sort();
    const win = days.length ? `&from=${days[0]}&to=${days[days.length - 1]}` : "";
    try {
      const r = await fetch(`/cases/${caseId}/quotes?path=${encodeURIComponent(nf.storage_path)}${win}`);
      const j = await r.json();
      return j.ok ? (j.dynamics as QuoteDyn) : null;
    } catch {
      return null;
    }
  }
  async function genIV(kind: IVKind, ow = false) {
    const quotes = kind === "ekofin" || kind === "pumpdump" ? await fetchQuotes() : null;
    await saveGenerated(buildIVChapter(kind, caseRow.name, metrics, documents, quotes), ow);
  }
  const genWnioski = (ow = false) => saveGenerated(buildWnioskiSubanaliza(caseRow.name, metrics, stored), ow);

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

  // Stepper montażu — kroki w kolejności PISANIA z bramkami zależności.
  const isApproved = (kind: string) => subanalyses.some((s) => s.kind === kind && s.status === "zatwierdzona");
  const bodyOf = (kind: string) => subanalyses.find((s) => s.kind === kind)?.body_md ?? "";
  const ivAllApproved = plan.length > 0 && plan.every((p) => isApproved(p.kind));
  const wnioskiApproved = isApproved("wnioski");
  const steps: {
    no: string;
    label: string;
    kind: string;
    gen: () => void;
    busyKey: string;
    locked: boolean;
    lockReason?: string;
    note?: string;
  }[] = [
    ...plan.map((p) => ({
      no: p.no,
      label: p.title,
      kind: p.kind,
      gen: () => void genIV(p.kind),
      busyKey: "gen-" + p.kind,
      locked: false,
    })),
    {
      no: "II",
      label: "Wnioski",
      kind: "wnioski",
      gen: () => void genWnioski(),
      busyKey: "gen-wnioski",
      locked: !ivAllApproved,
      lockReason: "Najpierw zatwierdź wszystkie rozdziały IV",
    },
    {
      no: "III",
      label: "Wstęp — ujęcie teoretyczne",
      kind: "proza_iii",
      gen: () => void redact("III"),
      busyKey: "redact-III",
      locked: !wnioskiApproved,
      lockReason: "Najpierw zatwierdź Wnioski",
      note: "III powstaje też automatycznie z biblioteki prawnej — regeneracja modelem jest opcjonalna.",
    },
    {
      no: "V",
      label: "Podsumowanie",
      kind: "proza_v",
      gen: () => void redact("V"),
      busyKey: "redact-V",
      locked: !wnioskiApproved,
      lockReason: "Najpierw zatwierdź Wnioski",
    },
  ];
  const stepsApproved = steps.filter((s) => isApproved(s.kind)).length;

  return (
    <div className="space-y-6">
      <div className="flex gap-1 border-b border-ink/20">
        {([
          ["warsztat", "Warsztat dowodowy"],
          ["rozdzialy", "Rozdziały"],
          ["montaz", `Montaż · ${ready}/${opinion.chapters.length}`],
          ["recenzent", `Recenzent${revIssues ? ` · ${revIssues}` : ""}`],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setSection(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-xs uppercase tracking-wider transition-colors ${
              section === key
                ? "border-ink font-semibold text-ink"
                : "border-transparent text-inksoft hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Warsztat dowodowy (Kroki 2–6) — pod-zakładki A1–A5 ── */}
      {section === "warsztat" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1 border-b border-line">
            {([
              ["podmioty", "1 · Podmioty"],
              ["techniki", "2 · Techniki"],
              ["powiazania", "3 · Powiązania (dane)"],
              ["osint", "4 · OSINT"],
              ["liczby", "5 · Liczby"],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setWsub(key)}
                className={`-mb-px border-b-2 px-3 py-1.5 text-xs transition-colors ${
                  wsub === key ? "border-ink font-medium text-ink" : "border-transparent text-inksoft hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {wsub === "podmioty" && <RosterPanel caseId={caseId} />}
          {wsub === "techniki" && (
            <TechniquesPanel caseId={caseId} metrics={metrics} selected={selectedTech} />
          )}
          {wsub === "powiazania" && (
            <PowiazaniaPanel caseId={caseId} documents={documents} stored={subanalyses} />
          )}
          {wsub === "osint" && (
            <WarsztatStub
              title="Powiązania — OSINT (Krok 5)"
              body="Miękkie powiązania z publicznie dostępnych źródeł: rejestry KRS i wspólne zarządy/rady, umowy cywilnoprawne, media społecznościowe, powiązania właścicielskie. Aplikacja przeszukuje otwarte zasoby i każde ustalenie opatruje cytowanym źródłem (link/rejestr) oraz datą — nic bez provenance, bo opinia dla prokuratury nie może stać na niezweryfikowanym powiązaniu; biegły zatwierdza każde. Uzupełnia obraz z zawiadomienia KNF o powiązania osobowo-biznesowe, których w nim nie podniesiono. (Web/KRS — Faza 5.)"
            />
          )}
          {wsub === "liczby" && <LiczbyView metrics={metrics} />}
        </div>
      )}

      {/* ── Rozdziały — drafty subanaliz ── */}
      {section === "rozdzialy" && (
      <section className="border border-ink/60 bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em]">Rozdziały — drafty</h2>
          <div className="flex flex-wrap gap-2">
            {plan.map((p) =>
              generated.has(p.kind) ? null : (
                <button
                  key={p.kind}
                  onClick={() => genIV(p.kind, false)}
                  disabled={
                    busy !== null ||
                    (["aktywnosc", "wash", "layering"].includes(p.kind) && metrics.length === 0)
                  }
                  className="border border-ink px-3 py-1.5 text-xs uppercase tracking-wider transition-colors hover:bg-ink hover:text-paper disabled:opacity-40"
                  title={KIND_LABEL[p.kind] ?? p.title}
                >
                  {busy === "gen-" + p.kind ? "Generuję…" : `Generuj: ${p.no}`}
                </button>
              ),
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
            Brak rozdziałów. Wygeneruj rozdziały z policzonych wskaźników i dowodów — następnie możesz je
            edytować i zatwierdzić. Opinia montuje się wyłącznie z zatwierdzonych rozdziałów.
          </p>
        )}

        <div className="space-y-4">
          {subanalyses.filter((s) => !["techniki", "powiazania_dane"].includes(s.kind)).map((s) => {
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
                      {["ekofin", "espi", "aktywnosc", "relacje", "wash", "imo", "layering", "pumpdump", "wnioski"].includes(s.kind) && (
                        <button
                          onClick={() => {
                            if (!confirm("Nadpisać treść świeżym wynikiem z danych? Twoje zmiany w tej subanalizie zostaną utracone.")) return;
                            if (s.kind === "wnioski") genWnioski(true);
                            else genIV(s.kind as IVKind, true);
                          }}
                          disabled={busy !== null}
                          className="text-xs uppercase tracking-wider text-inksoft underline-offset-2 hover:underline disabled:opacity-40"
                        >
                          {s.kind === "wnioski" ? "Odśwież z subanaliz" : "Odśwież z danych"}
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
      {section === "recenzent" && (
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
      {section === "montaz" && (
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

        {/* Stepper — kolejność pisania, bramki zależności */}
        <div className="mb-6">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-[0.12em]">Kroki — kolejność pisania</h3>
            <span className="text-xs text-inksoft">{stepsApproved}/{steps.length} zatwierdzonych</span>
          </div>
          <p className="mb-3 text-xs text-inksoft">
            Rozdziały powstają „od środka”: najpierw analiza (IV), potem Wnioski, na końcu Wstęp i Podsumowanie.
            Kroki są bramkowane zależnościami; montaż składa całość w kolejność dokumentu (I–VI) poniżej.
          </p>
          <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-ink/10">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${Math.round((stepsApproved / Math.max(1, steps.length)) * 100)}%` }}
            />
          </div>
          <ol className="space-y-2">
            {steps.map((st, i) => {
              const row = subanalyses.find((s) => s.kind === st.kind);
              const approved = !!row && row.status === "zatwierdzona";
              const generated = !!row;
              const state = st.locked
                ? "zablokowany"
                : approved
                  ? "zatwierdzony"
                  : generated
                    ? "szkic"
                    : "do wygenerowania";
              const badge = st.locked
                ? "bg-ink/10 text-inksoft"
                : approved
                  ? "bg-emerald-100 text-emerald-800"
                  : generated
                    ? "bg-amber-100 text-amber-800"
                    : "bg-ink/10 text-inksoft";
              return (
                <li key={st.kind} className={`border border-line bg-paper p-3 ${st.locked ? "opacity-60" : ""}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-ink/10 text-[11px] font-medium">
                        {i + 1}
                      </span>
                      <span className="text-sm font-medium">
                        {st.no}. {st.label}
                      </span>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] ${badge}`}>{state}</span>
                  </div>
                  {st.locked ? (
                    <p className="mt-1 pl-7 text-xs text-inksoft">Zablokowane: {st.lockReason}.</p>
                  ) : (
                    <>
                      {generated && (
                        <p className="mt-1 pl-7 text-xs text-inksoft">
                          {bodyOf(st.kind).slice(0, 200)}
                          {bodyOf(st.kind).length > 200 ? "…" : ""}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2 pl-7">
                        <button
                          onClick={st.gen}
                          disabled={busy !== null}
                          className="border border-ink px-3 py-1 text-xs uppercase tracking-wider transition-colors hover:bg-ink hover:text-paper disabled:opacity-40"
                        >
                          {busy === st.busyKey ? "Pracuję…" : generated ? "Regeneruj" : "Generuj"}
                        </button>
                        {generated && !approved && row && (
                          <button
                            onClick={() => setStatus(row, "zatwierdzona")}
                            disabled={busy !== null}
                            className="border border-emerald-600 bg-emerald-600 px-3 py-1 text-xs uppercase tracking-wider text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                          >
                            Zatwierdź
                          </button>
                        )}
                        {approved && row && (
                          <button
                            onClick={() => setStatus(row, "szkic")}
                            disabled={busy !== null}
                            className="border border-ink px-3 py-1 text-xs uppercase tracking-wider transition-colors hover:bg-ink hover:text-paper disabled:opacity-40"
                          >
                            Cofnij
                          </button>
                        )}
                        {generated && (
                          <button
                            onClick={() => setSection("rozdzialy")}
                            className="text-xs uppercase tracking-wider text-inksoft underline-offset-2 hover:underline"
                          >
                            Edytuj tekst
                          </button>
                        )}
                      </div>
                      {st.note && <p className="mt-1 pl-7 text-[11px] italic text-inksoft">{st.note}</p>}
                    </>
                  )}
                </li>
              );
            })}
          </ol>
        </div>

        <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em]">Podgląd dokumentu (kolejność I–VI)</h3>
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

// Zaślepka pod-zakładki warsztatu (A2–A4) — opis tego, co powstanie w danej fazie.
function WarsztatStub({ title, body }: { title: string; body: string }) {
  return (
    <section className="border border-ink/60 bg-card p-4">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em]">{title}</h2>
      <p className="text-sm text-inksoft">{body}</p>
    </section>
  );
}

// A5 Liczby — podgląd policzonych wskaźników (read-only; przelicznik jest na „Sprawa").
function LiczbyView({ metrics }: { metrics: Metric[] }) {
  if (!metrics.length)
    return (
      <WarsztatStub
        title="Analiza liczbowa (Krok 6)"
        body="Deterministyczna analiza danych transakcyjnych z UTP (GPW), docelowo także TREM (UKNF) — liczbowy fundament wszystkich wniosków, którym weryfikujemy ilościowe tezy z zawiadomienia KNF. Brak policzonych wskaźników: wgraj główny plik UTP i kliknij „Policz wskaźniki” na zakładce Sprawa."
      />
    );
  const find = (k: string) => metrics.find((m) => m.key === k) ?? null;
  const peak = (p: string) =>
    metrics.filter((m) => m.key.startsWith(p)).reduce<Metric | null>((a, b) => ((b.value ?? -1) > (a?.value ?? -1) ? b : a), null);
  const fmtv = (m: Metric | null) =>
    m && m.value != null ? (m.unit === "%" ? `${m.value}%` : m.value.toLocaleString("pl-PL")) : "—";
  const gs = find("group_turnover_share");
  const wp = peak("wash_");
  const cp = peak("cancel_");
  return (
    <section className="border border-ink/60 bg-card p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em]">Analiza liczbowa — podgląd (silnik faktów)</h2>
      <p className="mb-3 text-xs leading-relaxed text-inksoft">
        Deterministyczna analiza danych transakcyjnych (Krok 6) z UTP (GPW), docelowo także TREM (UKNF). To liczbowy
        fundament wszystkich wniosków — liczy silnik (LLM nigdy), a każda liczba jest odtwarzalna co do sztuki i grosza
        z pliku źródłowego. Tu potwierdzasz lub obalasz ilościowe tezy z zawiadomienia KNF: udział Grupy w obrocie,
        wolumen transakcji wewnątrzgrupowych (wash), skalę anulacji zleceń (layering), tabele per podmiot. Wyniki mogą
        rozszerzać ustalenia KNF (dodatkowe dni czy podmioty) albo się z nimi rozmijać, gdy dane pokazują co innego.
      </p>
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg bg-card px-3 py-2">
          <div className="text-xs text-inksoft">Udział Grupy w obrocie</div>
          <div className="text-lg font-semibold tabular-nums">{fmtv(gs)}</div>
        </div>
        <div className="rounded-lg bg-card px-3 py-2">
          <div className="text-xs text-inksoft">Wash — szczyt</div>
          <div className="text-lg font-semibold tabular-nums">{fmtv(wp)}</div>
          <div className="text-xs text-inksoft">{wp?.session_day ?? ""}</div>
        </div>
        <div className="rounded-lg bg-card px-3 py-2">
          <div className="text-xs text-inksoft">Anulacje — szczyt</div>
          <div className="text-lg font-semibold tabular-nums">{fmtv(cp)}</div>
          <div className="text-xs text-inksoft">{cp?.session_day ?? ""}</div>
        </div>
      </div>
      <p className="mt-3 text-xs text-inksoft">
        Pełny przelicznik i wybór pliku UTP — na zakładce „Sprawa”. TREM (UKNF) w planie (Faza 4).
      </p>
    </section>
  );
}
