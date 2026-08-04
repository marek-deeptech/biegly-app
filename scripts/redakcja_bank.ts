// Redakcja rozdziałów bankowych z wiersza poleceń — ta sama logika co trasa.
//   npx tsx scripts/redakcja_bank.ts <sprawa> wnioski
//   npx tsx scripts/redakcja_bank.ts <sprawa> chronologia_nadzoru,media,limity
//   npx tsx scripts/redakcja_bank.ts <sprawa>            # wszystkie rozdziały V
import { readFileSync } from "node:fs";
import { join } from "node:path";
const ROOT = join(process.env.HOME ?? "", "biegly-app");
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
import { createClient } from "@supabase/supabase-js";
import {
  ROZDZIALY_BANKOWE,
  zredagujRozdzialyBankowe,
  zredagujWnioskiBankowe,
  type WynikRedakcji,
} from "@/lib/opinion/redact-bank-run";
import type { BankRedactKind } from "@/lib/opinion/redact-bank";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data } = await sb.from("cases").select("id,name").ilike("name", `%${process.argv[2]}%`);
  if (!data?.length) throw new Error("nie znaleziono sprawy");
  const id = data[0].id as string;
  const arg = (process.argv[3] ?? "").trim();

  let wyniki: WynikRedakcji[];
  if (arg === "wnioski") {
    wyniki = [await zredagujWnioskiBankowe(sb, id)];
  } else {
    const ktore = arg
      ? (arg.split(",").map((x) => x.trim()).filter(Boolean) as BankRedactKind[])
      : [...ROZDZIALY_BANKOWE];
    const zle = ktore.filter((k) => !(ROZDZIALY_BANKOWE as readonly string[]).includes(k));
    if (zle.length) throw new Error(`nieznane rozdziały: ${zle.join(", ")}`);
    wyniki = await zredagujRozdzialyBankowe(sb, id, ktore);
  }
  for (const w of wyniki)
    console.log(
      w.ok
        ? `✓ ${w.kind}: ${w.znakow.toLocaleString("pl-PL")} zn., ${w.akapitow} akapitów`
        : `✗ ${w.kind}: ${w.powod}`,
    );
  if (wyniki.some((w) => !w.ok)) process.exitCode = 1;
}
main();
