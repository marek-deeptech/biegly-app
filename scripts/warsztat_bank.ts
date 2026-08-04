// Krok 4 dziedziny bankowej (warsztat dowodowy) z wiersza poleceń.
//   npx tsx scripts/warsztat_bank.ts <fragment nazwy sprawy> <dzień zdarzenia>
//
// Trasa HTTP wymaga serwera i zalogowania; weryfikacja na realnych aktach idzie
// tym samym kodem (wykonajWarsztatBankowy), różni się wyłącznie klientem Supabase.
import { readFileSync } from "node:fs";
import { join } from "node:path";
const ROOT = join(process.env.HOME ?? "", "biegly-app");
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
import { createClient } from "@supabase/supabase-js";
import { wykonajWarsztatBankowy } from "@/lib/opinion/warsztat-bank-run";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data } = await sb.from("cases").select("id,name,typ").ilike("name", `%${process.argv[2]}%`);
  if (!data?.length) throw new Error("nie znaleziono sprawy");
  const dzien = process.argv[3] ?? "";
  if (!dzien) throw new Error("podaj dzień zdarzenia (YYYY-MM-DD) — bez niego podział przed/po nie istnieje");
  const r = await wykonajWarsztatBankowy(sb, data[0].id, dzien);
  console.log(JSON.stringify(r, null, 1));
}
main();
