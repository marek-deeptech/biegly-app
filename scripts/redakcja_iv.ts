// Redakcja prozy rozdziałów IV (dziedzina GPW) z wiersza poleceń.
//   npx tsx scripts/redakcja_iv.ts <sprawa> aktywnosc,wash,layering
//   npx tsx scripts/redakcja_iv.ts <sprawa>            # wszystkie rozdziały z tabelami
//
// Wejście promptu składa `wejscieIV` — ta sama funkcja, której używa trasa HTTP;
// tutaj różni się wyłącznie klient Supabase (jak w dziedzinie bankowej).
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
import { buildIvRedactPrompt, IV_REDACT_KINDS, type IvRedactKind } from "@/lib/opinion/redact";
import { wejscieIV } from "@/lib/opinion/redact-iv-input";
import { buildStyleCorpus } from "@/lib/opinion/korekty";
import { buildWzorzecBlock } from "@/lib/opinion/wzorce";
import { buildWiedzaBlock } from "@/lib/opinion/wiedza";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data: cases } = await sb
    .from("cases").select("id,name,signature,typ").ilike("name", `%${process.argv[2]}%`);
  if (!cases?.length) throw new Error("nie znaleziono sprawy");
  const c = cases[0];
  if (c.typ !== "manipulacja_gpw") throw new Error("ta redakcja dotyczy spraw o manipulację GPW");

  const { data: subs } = await sb
    .from("subanalyses").select("kind,title,status,chapter_no,body_md,data").eq("case_id", c.id);
  const metrics = await fetchAllMetrics(sb, c.id as string);
  const dni = [...new Set(metrics.map((x) => x.session_day).filter(Boolean))].sort() as string[];
  const period = dni.length ? `${dni[0]} – ${dni[dni.length - 1]}` : null;

  const arg = (process.argv[3] ?? "").trim();
  const zTabelami = (subs ?? [])
    .filter((s) => {
      const d = (s.data ?? {}) as { tables?: unknown[]; table?: unknown };
      return (d.tables?.length ?? 0) > 0 || !!d.table;
    })
    .map((s) => s.kind as string);
  const ktore = (arg ? arg.split(",").map((x) => x.trim()) : zTabelami).filter((k) =>
    (IV_REDACT_KINDS as readonly string[]).includes(k),
  ) as IvRedactKind[];
  if (!ktore.length) throw new Error("brak rozdziałów IV z tabelami do redakcji");

  for (const kind of ktore) {
    const wejscie = await wejscieIV(sb, c.id as string, kind, {
      caseRow: { name: c.name as string, signature: (c.signature as string) ?? null },
      subs: (subs ?? []) as never,
      metrics,
      period,
    });
    if (!wejscie) {
      console.log(`✗ ${kind}: brak subanalizy — najpierw wygeneruj rozdział`);
      continue;
    }
    const p = buildIvRedactPrompt(wejscie);
    const [wiedza, wzorzec, styl] = await Promise.all([
      buildWiedzaBlock(sb, kind, c.typ as string),
      buildWzorzecBlock(sb, kind),
      buildStyleCorpus(sb, kind),
    ]);
    const msg = await klientLLM("redakcja-iv", { sprawa: c.id as string }).messages.create({
      model: "claude-opus-4-8",
      // Rozdziały z rozbiciem per sesja wymagają odrębnego akapitu na sesję —
      // przy 5500 odpowiedź urywała się w połowie i cały rozdział przepadał.
      max_tokens: kind === "aktywnosc" || kind === "layering" ? 16000 : 9000,
      system: [p.system, wiedza, wzorzec, styl].filter(Boolean).join("\n\n"),
      messages: [{ role: "user", content: p.user }],
    });
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (msg.stop_reason === "max_tokens") {
      console.log(`✗ ${kind}: odpowiedź urwana na limicie długości (${text.length} zn.) — NIE zapisano`);
      continue;
    }
    if (!text) {
      console.log(`✗ ${kind}: model nie zwrócił treści`);
      continue;
    }
    const { data, error } = await sb
      .from("subanalyses").update({ body_md: text, status: "szkic" })
      .eq("case_id", c.id).eq("kind", kind).select("id");
    if (error) throw new Error(`zapis ${kind}: ${error.message}`);
    if (!data?.length) {
      console.log(`✗ ${kind}: subanaliza nie istnieje — proza nie została zapisana`);
      continue;
    }
    console.log(`✓ ${kind}: ${text.length.toLocaleString("pl-PL")} zn., ${text.split(/\n\n+/).length} akapitów`);
  }
}
main().catch((e) => {
  console.error("BŁĄD:", e.message);
  process.exit(1);
});
