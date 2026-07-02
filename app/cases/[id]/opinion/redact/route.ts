import Anthropic from "@anthropic-ai/sdk";

import {
  buildIvRedactPrompt,
  buildRedactPrompt,
  IV_REDACT_KINDS,
  REDACT_META,
  type IvRedactKind,
  type RedactChapter,
} from "@/lib/opinion/redact";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type MetricRow = { key: string; value: number | null; unit: string | null; session_day: string | null };

// POST { chapter: "I" | "III" | "V" } → { ok, text, meta } | { ok:false, reason }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, reason: "unauthorized" }, { status: 401 });

  if (!process.env.ANTHROPIC_API_KEY)
    return Response.json({
      ok: false,
      reason: "Brak klucza ANTHROPIC_API_KEY — dodaj go w .env.local oraz w zmiennych środowiskowych Vercel.",
    });

  let body: { chapter?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* puste ciało */
  }
  const chapter = (body.chapter || "") as string;
  const isIv = (IV_REDACT_KINDS as readonly string[]).includes(chapter);
  if (!chapter || (!REDACT_META[chapter as RedactChapter] && !isIv))
    return Response.json({ ok: false, reason: "Nieznany rozdział." }, { status: 400 });

  const { data: caseRow } = await supabase.from("cases").select("name,signature").eq("id", id).single();
  if (!caseRow) return Response.json({ ok: false, reason: "not found" }, { status: 404 });

  const { data: metricsData } = await supabase
    .from("metrics")
    .select("key,value,unit,session_day")
    .eq("case_id", id);
  const { data: subs } = await supabase
    .from("subanalyses")
    .select("kind,title,status,data,chapter_no")
    .eq("case_id", id);

  const m: MetricRow[] = metricsData ?? [];
  const days = [...new Set(m.filter((x) => x.session_day).map((x) => x.session_day as string))].sort();
  const period = days.length ? `od ${days[0]} do ${days[days.length - 1]}` : null;

  let system: string;
  let userPrompt: string;
  let meta: unknown;

  if (isIv) {
    const sub = (subs ?? []).find((s) => s.kind === chapter);
    if (!sub)
      return Response.json({ ok: false, reason: "Najpierw wygeneruj ten rozdział (Generuj), potem rozwiń prozą." });
    type Tbl = { caption?: string; head?: string[]; rows?: string[][] };
    const many = (sub.data?.tables as Tbl[] | undefined) ?? [];
    const tbls: Tbl[] = many.length ? many : sub.data?.table ? [sub.data.table as Tbl] : [];
    const asText = (t: Tbl) =>
      t.head && t.rows?.length
        ? `${t.caption ? t.caption.replace(/^Tabela\.\s*/, "") + ":\n" : ""}${t.head.join(" | ")}\n` +
          t.rows.slice(0, 120).map((r) => r.join(" | ")).join("\n")
        : null;
    const blocks = tbls.map(asText).filter((s): s is string => !!s);
    const tableText = blocks.length ? blocks.join("\n\n") : null;
    const { data: docsData } = await supabase.from("documents").select("doc_type,rel_path").eq("case_id", id);
    const counts: Record<string, number> = {};
    for (const d of docsData ?? []) counts[d.doc_type as string] = (counts[d.doc_type as string] ?? 0) + 1;
    const inventory = Object.entries(counts).map(([k, v]) => `${v} × ${k}`);
    // Aktywność/ESPI: dołącz zdarzenia ESPI/EBI do cross-linku czasowego. Jeśli wyciągnięto
    // datowane zdarzenia z PDF (subanaliza espi_events) — użyj ich; inaczej same nazwy plików.
    if (chapter === "aktywnosc" || chapter === "espi") {
      const ev = (subs ?? []).find((s) => s.kind === "espi_events");
      const events =
        (ev?.data?.events as { date?: string; type?: string; subject?: string; session?: string }[] | undefined) ?? [];
      if (events.length) {
        inventory.push(
          ...events
            .slice(0, 15)
            .map(
              (e) =>
                `ESPI zdarzenie: ${e.date || "—"} — ${(e.type || "").trim()}${e.subject ? " — " + e.subject : ""}` +
                (e.session ? ` (zbieżne z sesją ${e.session})` : ""),
            ),
        );
      } else {
        inventory.push(
          ...(docsData ?? [])
            .filter((d) => d.doc_type === "RAPORT_ESPI_EBI")
            .map((d) => "ESPI/EBI: " + String(d.rel_path).split("/").pop())
            .slice(0, 15),
        );
      }
    }
    // Relacje: dołącz osoby pełniące funkcje w wielu podmiotach (z wyciągu KRS).
    if (chapter === "relacje") {
      const kb = (subs ?? []).find((s) => s.kind === "krs_boards");
      const shared = (kb?.data?.shared as { name?: string; entities?: string[] }[] | undefined) ?? [];
      inventory.push(
        ...shared
          .slice(0, 15)
          .map((sh) => `KRS — osoba w wielu podmiotach: ${sh.name} (${(sh.entities || []).join(", ")})`),
      );
    }
    const p = buildIvRedactPrompt({
      kind: chapter as IvRedactKind,
      title: (sub.title as string) || chapter,
      caseName: caseRow.name,
      signature: caseRow.signature,
      period,
      tableText,
      findings: (sub.data?.findings ?? []) as string[],
      inventory,
      legalRefs: (sub.data?.legalRefs ?? []) as string[],
    });
    system = p.system;
    userPrompt = p.user;
    meta = { kind: chapter };
  } else {
    const find = (k: string) => m.find((x) => x.key === k);
    const peak = (pfx: string) =>
      m.filter((x) => x.key.startsWith(pfx)).reduce<MetricRow | null>((a, b) => ((b.value ?? -1) > (a?.value ?? -1) ? b : a), null);
    const num = (v: number | null | undefined, u: string) => (v == null ? "—" : u === "%" ? `${v}%` : `${v} ${u}`);
    const facts: string[] = [];
    const gs = find("group_turnover_share");
    if (gs) facts.push(`Udział Grupy w wartości obrotu: ${num(gs.value, "%")}.`);
    const wp = peak("wash_");
    if (wp) facts.push(`Maksymalny udział transakcji wzajemnych w wolumenie sesji: ${num(wp.value, "%")} (sesja ${wp.session_day}).`);
    const cp = peak("cancel_");
    if (cp) facts.push(`Maksymalny udział anulacji zleceń kupna Grupy: ${num(cp.value, "%")} (sesja ${cp.session_day}).`);
    const approved = (subs ?? [])
      .filter((s) => s.status === "zatwierdzona" && String(s.chapter_no).startsWith("IV"))
      .map((s) => ({ title: s.title as string, findings: ((s.data?.findings ?? []) as string[]) }));
    const legalBasis = [
      "art. 12 rozporządzenia MAR (UE) 596/2014",
      "rozporządzenie delegowane (UE) 2016/522, załącznik II",
      "art. 183 ustawy o obrocie instrumentami finansowymi",
    ];
    const p = buildRedactPrompt({
      chapter: chapter as RedactChapter,
      caseName: caseRow.name,
      signature: caseRow.signature,
      period,
      facts,
      approved,
      legalBasis,
    });
    system = p.system;
    userPrompt = p.user;
    meta = REDACT_META[chapter as RedactChapter];
  }

  try {
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: isIv ? 4000 : 2500,
      system,
      messages: [{ role: "user", content: userPrompt }],
    });
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (!text) return Response.json({ ok: false, reason: "Model nie zwrócił treści." });
    return Response.json({ ok: true, text, meta });
  } catch (e) {
    return Response.json({ ok: false, reason: "Błąd modelu: " + (e as Error).message });
  }
}
