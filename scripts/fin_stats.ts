// Ekstrakcja danych finansowych emitentów ze sprawozdań w aktach (IV.1) — CLI.
//   npx tsx scripts/fin_stats.ts <fragment nazwy sprawy>
// Ta sama logika co trasa /opinion/extract-fin (lib/opinion/fin-stats.ts).
import { readFileSync } from "node:fs";
import { join } from "node:path";
const ROOT = join(process.env.HOME ?? "", "biegly-app");
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
import { createClient } from "@supabase/supabase-js";
import { wykonajFinStats } from "@/lib/opinion/fin-stats";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data } = await sb.from("cases").select("id,name").ilike("name", `%${process.argv[2]}%`);
  if (!data?.length) throw new Error("nie znaleziono sprawy");
  const w = await wykonajFinStats(sb, data[0].id as string);
  if (!w.ok) throw new Error(w.powod);
  console.log(`✓ fin_stats: ${w.pozycji} pozycji z ${w.plikow} plików`);
  for (const it of (w.items ?? []).slice(0, 12))
    console.log(`   • ${it.issuer ?? "—"} | ${it.position} | ${it.period}: ${it.value} ${it.unit}`);
}
main().catch((e) => {
  console.error("BŁĄD:", e.message);
  process.exit(1);
});
