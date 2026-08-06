// Redakcja rozdziałów STAŁYCH sprawy manipulacyjnej: I, III, V oraz Wnioski (II).
//   npx tsx scripts/redakcja_gpw.ts <sprawa> wnioski
//   npx tsx scripts/redakcja_gpw.ts <sprawa> V,I
//
// Rozdziały IV.x mają własny skrypt (scripts/redakcja_iv.ts) — tam wejście składa
// `wejscieIV`. Tutaj korzystamy z tych samych budowniczych promptu co trasa HTTP.
import { readFileSync } from "node:fs";
import { join } from "node:path";
const ROOT = join(process.env.HOME ?? "", "biegly-app");
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { klientLLM } from "@/lib/llm/klient";
import { fetchAllMetrics } from "@/lib/metrics-fetch";
import { buildWnioskiSubanaliza, type StoredSub } from "@/lib/opinion/build";
import { PROSECUTOR_QUESTIONS, TECHNIQUES } from "@/lib/opinion/legal";
import {
  REDACT_META,
  buildRedactPrompt,
  buildWnioskiRedactPrompt,
  type RedactChapter,
} from "@/lib/opinion/redact";
import { buildStyleCorpus } from "@/lib/opinion/korekty";
import { buildWzorzecBlock } from "@/lib/opinion/wzorce";
import { buildWiedzaBlock } from "@/lib/opinion/wiedza";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data: cases } = await sb.from("cases").select("id,name,signature,typ").ilike("name", `%${process.argv[2]}%`);
  if (!cases?.length) throw new Error("nie znaleziono sprawy");
  const c = cases[0];
  if (c.typ !== "manipulacja_gpw") throw new Error("ta redakcja dotyczy spraw o manipulację GPW");
  const ktore = (process.argv[3] ?? "wnioski").split(",").map((x) => x.trim()).filter(Boolean);

  const { data: subs } = await sb
    .from("subanalyses").select("kind,title,status,chapter_no,body_md,data").eq("case_id", c.id);
  const m = await fetchAllMetrics(sb, c.id as string);
  const dni = [...new Set(m.map((x) => x.session_day).filter(Boolean))].sort() as string[];
  const period = dni.length ? `${dni[0]} – ${dni[dni.length - 1]}` : null;
  const caseQuestions =
    ((subs ?? []).find((s) => s.kind === "pytania_organu")?.data as { questions?: string[] } | null)?.questions
      ?.map((q) => String(q).trim()).filter(Boolean) ?? [];

  for (const chapter of ktore) {
    let system: string;
    let user: string;
    let kind: string;

    if (chapter === "wnioski") {
      const questions = caseQuestions.length ? caseQuestions : [...PROSECUTOR_QUESTIONS];
      // Szkielet ze SILNIKA, nie z body_md — odporny na wcześniejsze rozwinięcia prozy.
      const skeleton = buildWnioskiSubanaliza(
        c.name as string, m, (subs ?? []) as unknown as StoredSub[],
        caseQuestions.length ? caseQuestions : undefined,
      ).bodyMd;
      // Do Wniosków wchodzą ustalenia rozdziałów IV — także tych jeszcze
      // niezatwierdzonych: inaczej synteza powstawałaby na pustce, dopóki biegły
      // nie klika „zatwierdź" w każdym rozdziale z osobna.
      const iv = (subs ?? [])
        .filter((s) => String(s.chapter_no ?? "").startsWith("IV") && ((s.data as { findings?: string[] })?.findings?.length ?? 0) > 0)
        .map((s) => ({
          title: `${s.title} (rozdz. ${s.chapter_no}${s.status === "zatwierdzona" ? "" : ", szkic"})`,
          findings: ((s.data as { findings?: string[] })?.findings ?? []) as string[],
        }));
      const ipRows = (((subs ?? []).find((s) => s.kind === "powiazania_dane")?.data as { table?: { rows?: string[][] } } | null)?.table?.rows ?? []).slice(0, 6);
      const relations = ipRows.map((r) => `Wspólne IP: ${r[0]} ↔ ${r[1]} (${r[2]} adresów)`);
      const evRows = (((subs ?? []).find((s) => s.kind === "espi_events")?.data as { table?: { rows?: string[][] } } | null)?.table?.rows ?? []).slice(0, 12);
      const events = evRows.map((r) => `${r[0]} — ${r[1]} ${r[2]}: ${r[4]}`);
      const p = buildWnioskiRedactPrompt({
        caseName: c.name as string, signature: (c.signature as string) ?? null, period,
        caseIntro: String((subs ?? []).find((s) => s.kind === "proza_i")?.body_md ?? "").slice(0, 600) || null,
        questions, skeleton, techniques: iv, relations, events,
      });
      system = p.system; user = p.user; kind = "wnioski";
    } else {
      const meta = REDACT_META[chapter as RedactChapter];
      if (!meta) { console.log(`✗ ${chapter}: nieznany rozdział (I, III, V albo wnioski)`); continue; }
      const find = (k: string) => m.find((x) => x.key === k);
      const peak = (pfx: string) =>
        m.filter((x) => x.key.startsWith(pfx)).reduce<(typeof m)[number] | null>((a, b) => ((b.value ?? -1) > (a?.value ?? -1) ? b : a), null);
      const facts: string[] = [];
      const gs = find("group_turnover_share");
      if (gs?.value != null) facts.push(`Udział Grupy w wartości obrotu: ${gs.value}%.`);
      const wp = peak("wash_");
      if (wp?.value != null) facts.push(`Maksymalny udział transakcji wzajemnych w wolumenie sesji: ${wp.value}% (sesja ${wp.session_day}).`);
      const cp = peak("cancel_");
      if (cp?.value != null) facts.push(`Maksymalny udział anulacji zleceń kupna Grupy: ${cp.value}% (sesja ${cp.session_day}).`);
      const approved = (subs ?? [])
        .filter((s) => String(s.chapter_no ?? "").startsWith("IV") && ((s.data as { findings?: string[] })?.findings?.length ?? 0) > 0)
        .map((s) => ({ title: s.title as string, findings: ((s.data as { findings?: string[] })?.findings ?? []) as string[] }));
      const p = buildRedactPrompt({
        chapter: chapter as RedactChapter,
        caseName: c.name as string, signature: (c.signature as string) ?? null, period,
        facts: chapter === "III" ? [] : facts,
        approved: chapter === "III" ? [] : approved,
        legalBasis: [
          "art. 12 rozporządzenia MAR (UE) 596/2014",
          "rozporządzenie delegowane (UE) 2016/522, załącznik II",
          "art. 183 ustawy o obrocie instrumentami finansowymi",
        ],
        library: chapter === "III" ? Object.values(TECHNIQUES).map((t) => `${t.label} (${t.mar}; ${t.rd}): ${t.definicja}`) : undefined,
      });
      system = p.system; user = p.user; kind = meta.kind;
    }

    const [wiedza, wzorzec, styl] = await Promise.all([
      buildWiedzaBlock(sb, kind, c.typ as string),
      buildWzorzecBlock(sb, kind),
      buildStyleCorpus(sb, kind),
    ]);
    const msg = await klientLLM("redakcja-gpw", { sprawa: c.id as string }).messages.create({
      model: "claude-opus-4-8",
      max_tokens: kind === "wnioski" ? 14000 : 9000,
      system: [system, wiedza, wzorzec, styl].filter(Boolean).join("\n\n"),
      messages: [{ role: "user", content: user }],
    });
    const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
    if (msg.stop_reason === "max_tokens") { console.log(`✗ ${chapter}: odpowiedź urwana (${text.length} zn.) — NIE zapisano`); continue; }
    if (!text) { console.log(`✗ ${chapter}: model nie zwrócił treści`); continue; }

    const meta = REDACT_META[chapter as RedactChapter];
    const { error } = await sb.from("subanalyses").upsert(
      {
        case_id: c.id, kind,
        chapter_no: kind === "wnioski" ? "II" : meta.chapterNo,
        title: kind === "wnioski" ? "Wnioski" : meta.title,
        status: "szkic", body_md: text,
        data: { findings: [], legalRefs: [] },
      },
      { onConflict: "case_id,kind" },
    );
    if (error) throw new Error(`zapis ${chapter}: ${error.message}`);
    console.log(`✓ ${chapter} (${kind}): ${text.length.toLocaleString("pl-PL")} zn., ${text.split(/\n\n+/).length} akapitów`);
  }
}
main().catch((e) => { console.error("BŁĄD:", e.message); process.exit(1); });
