// Krok 4 GPW z wiersza poleceń — pobór notowań stooq i przeliczenie ekofin.
//   npx tsx scripts/ekofin_gpw.ts <sprawa> --emitent zst [--nazwa "ZASTAL SA"]
//        [--peers pcr,pce,pwx] [--od 2020-09-09] [--do 2020-10-21]
//        [--baza 2020-01-01] [--pobierz]
// Bez --od/--do okres badany bierze się z metryk silnika (sesje objęte analizą).
import { readFileSync } from "node:fs";
import { join } from "node:path";
const ROOT = join(process.env.HOME ?? "", "biegly-app");
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
import { createClient } from "@supabase/supabase-js";
import { pobierzStooq, wykonajEkofin, type KonfigEkofin } from "@/lib/opinion/ekofin-run";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function arg(nazwa: string): string | null {
  const i = process.argv.indexOf(`--${nazwa}`);
  return i > 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main() {
  const { data } = await sb.from("cases").select("id,name,typ").ilike("name", `%${process.argv[2]}%`);
  if (!data?.length) throw new Error("nie znaleziono sprawy");
  const id = data[0].id as string;

  const emitent = arg("emitent");
  if (!emitent) throw new Error("podaj --emitent <ticker stooq>");
  const cfg: KonfigEkofin = {
    emitent: { ticker: emitent, nazwa: arg("nazwa") ?? undefined },
    peers: (arg("peers") ?? "").split(",").map((t) => t.trim()).filter(Boolean).map((t) => ({ ticker: t })),
    odBadany: arg("od"),
    doBadany: arg("do"),
    bazaIndeksu: arg("baza"),
  };

  if (process.argv.includes("--pobierz")) {
    const w = await pobierzStooq(sb, id, [cfg.emitent.ticker, ...cfg.peers.map((p) => p.ticker)]);
    console.log(`pobrane: ${w.pobrane.join(", ") || "—"}; już były: ${w.istniejace.join(", ") || "—"}`);
    for (const b of w.bledy) console.log(`✗ ${b}`);
    if (w.bledy.length) process.exitCode = 1;
  }

  const w = await wykonajEkofin(sb, id, cfg);
  if (!w.ok) throw new Error(w.powod);
  console.log(`✓ ekofin_dane: tabel ${w.tabel}, wykresów ${w.wykresow}`);
  for (const f of w.findings ?? []) console.log(`   • ${f.slice(0, 130)}`);
  for (const d of w.doPozyskania ?? []) console.log(`   ◐ do pozyskania: ${d.slice(0, 120)}`);
}
main().catch((e) => {
  console.error("BŁĄD:", e.message);
  process.exit(1);
});
