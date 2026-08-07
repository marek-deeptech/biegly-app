// Pozyskanie szeregów tła sprawy bankowej z wiersza poleceń (bez logowania w UI):
//   npx tsx scripts/szeregi_bank.ts <sprawa> [--dzien 2015-03-16] [--obligacje bsw0424]
// Po pozyskaniu przelicz moduły: /api/makro i /api/sygnaly (panel albo curl).
//
// Ta sama logika co trasa app/cases/[id]/bank/szeregi (lib/opinion/szeregi-bank-run) —
// skrypt istnieje, bo trasa wymaga zalogowanej sesji, a pozyskanie bywa robione
// z konsoli przy zasilaniu sprawy (jak scripts/ekofin_gpw.ts w torze GPW).
import { readFileSync } from "node:fs";
import { join } from "node:path";

for (const plik of [join(process.cwd(), ".env.local"), join(process.env.HOME ?? "", "biegly-bankowe", ".env.local")]) {
  try {
    for (const line of readFileSync(plik, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    break;
  } catch {
    /* spróbuj następnej lokalizacji */
  }
}

import { createClient } from "@supabase/supabase-js";

import { pozyskajSzeregiBankowe } from "@/lib/opinion/szeregi-bank-run";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function arg(nazwa: string): string | null {
  const i = process.argv.indexOf(`--${nazwa}`);
  return i > 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main() {
  const szukana = process.argv[2];
  if (!szukana) throw new Error("podaj nazwę sprawy, np.: npx tsx scripts/szeregi_bank.ts SKOK");
  const { data } = await sb.from("cases").select("id,name,typ").ilike("name", `%${szukana}%`);
  if (!data?.length) throw new Error("nie znaleziono sprawy");
  if (data[0].typ !== "ryzyko_bankowe") throw new Error(`sprawa ${data[0].name} nie jest sprawą bankową`);

  const wynik = await pozyskajSzeregiBankowe(sb, data[0].id as string, {
    dzienZdarzenia: arg("dzien"),
    obligacje: arg("obligacje"),
  });
  for (const p of wynik.pobrane) console.log(`✓ pozyskano: ${p}`);
  for (const i of wynik.istniejace) console.log(`= już w aktach: ${i}`);
  for (const b of wynik.bledy) console.log(`✗ ${b}`);
  if (!wynik.pobrane.length && !wynik.istniejace.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`✗ ${(e as Error).message}`);
  process.exitCode = 1;
});
