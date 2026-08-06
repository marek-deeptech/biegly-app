// Regeneracja POJEDYNCZEGO rozdziału IV (dziedzina GPW) z wiersza poleceń.
//   npx tsx scripts/rozdzial_iv.ts <fragment nazwy sprawy> <kind>
//   np.: npx tsx scripts/rozdzial_iv.ts ZASTAL espi
//
// KIEDY UŻYĆ: rozdział IV.x liczy się z dokumentów i metryk Z CHWILI generacji.
// Po dograniu materiału (np. utrwaleń raportów ESPI/EBI do IV.2) stary rozdział
// twierdzi „w aktach 0 raportów" — o AKTACH, nie o swojej dacie. Pełny bieg
// wszystkich rozdziałów (fullrun) nadpisałby także te, których nikt nie zmieniał.
import { readFileSync } from "node:fs";
import { join } from "node:path";
const ROOT = join(process.env.HOME ?? "", "biegly-app");
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
import { createClient } from "@supabase/supabase-js";
import { buildIVChapter } from "@/lib/opinion/build";
import type { IVKind } from "@/lib/opinion/chapters";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const [fraza, kind] = [process.argv[2], process.argv[3] as IVKind];
  if (!fraza || !kind) throw new Error("użycie: npx tsx scripts/rozdzial_iv.ts <sprawa> <kind>");
  const { data: cases } = await sb.from("cases").select("id,name,typ").ilike("name", `%${fraza}%`);
  if (!cases?.length) throw new Error("nie znaleziono sprawy");
  const c = cases[0];
  if (c.typ !== "manipulacja_gpw") throw new Error("rozdziały IV dotyczą spraw o manipulację GPW");

  const { data: metrics } = await sb
    .from("metrics")
    .select("key,label,value,unit,session_day")
    .eq("case_id", c.id)
    .limit(20000);
  const { data: documents } = await sb
    .from("documents")
    .select("rel_path,doc_type,provenance")
    .eq("case_id", c.id)
    .limit(3000);

  const w = buildIVChapter(kind, c.name, (metrics ?? []) as never, (documents ?? []) as never);
  const { error } = await sb.from("subanalyses").upsert(
    {
      case_id: c.id,
      kind: w.kind,
      chapter_no: w.chapterNo,
      title: w.title,
      status: "szkic",
      body_md: w.bodyMd,
      data: w.data,
    },
    { onConflict: "case_id,kind" },
  );
  if (error) throw new Error(`zapis: ${error.message}`);
  const f = (w.data as { findings?: string[] }).findings ?? [];
  console.log(`✓ ${w.kind} (${w.chapterNo} ${w.title}) — ${w.bodyMd.length} zn. szkieletu`);
  for (const x of f.slice(0, 4)) console.log(`   • ${x.slice(0, 130)}`);
}
main().catch((e) => {
  console.error("BŁĄD:", e.message);
  process.exit(1);
});
