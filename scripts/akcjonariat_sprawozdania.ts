// Stan akcjonariatu ze SPRAWOZDAŃ OPISOWYCH ZARZĄDU (CLI).
//   npx tsx scripts/akcjonariat_sprawozdania.ts <sprawa> --emitent "Hub.Tech" [--maks 8]
//
// Logika w lib/opinion/akcjonariat-run.ts (ta sama, co za przyciskiem w panelu).
import { readFileSync } from "node:fs";
import { join } from "node:path";
const ROOT = join(process.env.HOME ?? "", "biegly-app");
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["\']|["\']$/g, "");
}
import { createClient } from "@supabase/supabase-js";
import { wykonajSprawozdania } from "@/lib/opinion/akcjonariat-run";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? (process.argv[i + 1] ?? null) : null;
};

async function main() {
  const { data: cases } = await sb.from("cases").select("id,name,typ").ilike("name", `%${process.argv[2]}%`);
  if (!cases?.length) throw new Error("nie znaleziono sprawy");
  const c = cases[0];
  if (c.typ !== "manipulacja_gpw") throw new Error("krok dotyczy spraw o manipulację GPW");
  const w = await wykonajSprawozdania(sb, c.id as string, {
    emitent: arg("emitent") ?? (c.name as string),
    maks: Number(arg("maks") ?? 8),
    log: (s) => console.log("   " + s),
  });
  if (!w.ok) throw new Error(w.powod ?? "bieg nieudany");
  console.log(`✓ ${w.podsumowanie}`);
}
main().catch((e) => {
  console.error("BŁĄD:", e.message);
  process.exit(1);
});
