import Anthropic from "@anthropic-ai/sdk";

import { buildRedactPrompt, REDACT_META, type RedactChapter } from "@/lib/opinion/redact";
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
  const chapter = body.chapter as RedactChapter;
  if (!chapter || !REDACT_META[chapter])
    return Response.json({ ok: false, reason: "Nieznany rozdział." }, { status: 400 });

  const { data: caseRow } = await supabase.from("cases").select("name,signature").eq("id", id).single();
  if (!caseRow) return Response.json({ ok: false, reason: "not found" }, { status: 404 });

  const { data: metricsData } = await supabase
    .from("metrics")
    .select("key,value,unit,session_day")
    .eq("case_id", id);
  const { data: subs } = await supabase
    .from("subanalyses")
    .select("title,status,data,chapter_no")
    .eq("case_id", id);

  const m: MetricRow[] = metricsData ?? [];
  const find = (k: string) => m.find((x) => x.key === k);
  const peak = (p: string) =>
    m.filter((x) => x.key.startsWith(p)).reduce<MetricRow | null>((a, b) => ((b.value ?? -1) > (a?.value ?? -1) ? b : a), null);
  const days = [...new Set(m.filter((x) => x.session_day).map((x) => x.session_day as string))].sort();
  const period = days.length ? `od ${days[0]} do ${days[days.length - 1]}` : null;
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

  const { system, user: userPrompt } = buildRedactPrompt({
    chapter,
    caseName: caseRow.name,
    signature: caseRow.signature,
    period,
    facts,
    approved,
    legalBasis,
  });

  try {
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 2500,
      system,
      messages: [{ role: "user", content: userPrompt }],
    });
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (!text) return Response.json({ ok: false, reason: "Model nie zwrócił treści." });
    return Response.json({ ok: true, text, meta: REDACT_META[chapter] });
  } catch (e) {
    return Response.json({ ok: false, reason: "Błąd modelu: " + (e as Error).message });
  }
}
