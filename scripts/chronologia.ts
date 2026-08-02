// Moduł „Chronologia nadzorcza" dla sprawy bankowej.
//   npx tsx scripts/chronologia.ts <sprawa> <dzień> <nazwa podmiotu>[,alias,...]
import { readFileSync } from "node:fs";
import { join } from "node:path";
const ROOT = join(process.env.HOME ?? "", "biegly-app");
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
import { createClient } from "@supabase/supabase-js";
import { wykonajChronologie } from "@/lib/opinion/chronologia-run";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function main() {
  const { data } = await sb.from("cases").select("id,name").ilike("name", `%${process.argv[2]}%`);
  if (!data?.length) throw new Error("nie znaleziono sprawy");
  const podmiot = (process.argv[4] ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const r = await wykonajChronologie(sb, data[0].id, process.argv[3] ?? "", podmiot);
  console.log(JSON.stringify(r, null, 1));
}
main();
