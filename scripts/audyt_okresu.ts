// Bramka przed wydrukiem — czy proza mówi o tym samym okresie, co liczby.
//   npx tsx scripts/audyt_okresu.ts <sprawa> [--poboczne 2019-09-27,…]
//
// Zgłasza trzy rzeczy: (1) zdania deklarujące okres z datami spoza okna badania,
// (2) rozdziały, w których liczby przeliczono PO napisaniu prozy, (3) rozdziały IV
// z gotową prozą, które nie wchodzą do opinii (technika spoza zatwierdzonego doboru).
// Bez modelu — sam odczyt i porównanie.
import { readFileSync } from "node:fs";
import { join } from "node:path";
const ROOT = join(process.env.HOME ?? "", "biegly-app");
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
import { createClient } from "@supabase/supabase-js";
import { audytOkresu } from "@/lib/opinion/audyt-okresu";
import { buildPlanFromTechniques } from "@/lib/opinion/chapters";
import { okresBadany } from "@/lib/opinion/okres";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? (process.argv[i + 1] ?? null) : null;
};

async function main() {
  const { data: cases } = await sb.from("cases").select("id,name,typ").ilike("name", `%${process.argv[2]}%`);
  if (!cases?.length) throw new Error("nie znaleziono sprawy");
  const c = cases[0];

  const { data: subs } = await sb
    .from("subanalyses").select("kind,chapter_no,body_md,data").eq("case_id", c.id);
  const okres = okresBadany((subs ?? []) as never);
  const wybrane = (((subs ?? []).find((s) => s.kind === "techniki")?.data as { selected?: string[] } | null)?.selected ?? []) as string[];
  const plan = buildPlanFromTechniques(wybrane as never).map((p) => p.kind as string);
  // Daty poboczne: koniec okresu drugiego instrumentu itp. — biegły wskazuje je jawnie,
  // bo inaczej każde poprawne zdanie o różnych oknach instrumentów byłoby alarmem.
  const poboczne = (arg("poboczne") ?? "").split(",").map((x) => x.trim()).filter(Boolean);

  const zastrzezenia = audytOkresu((subs ?? []) as never, { od: okres.od, do: okres.do }, plan, poboczne);
  console.log(`Sprawa ${c.name} · okres badany ${okres.od}–${okres.do} (${okres.zrodlo}) · plan: ${plan.join(", ")}`);
  if (!zastrzezenia.length) {
    console.log("✓ brak zastrzeżeń — proza, liczby i plan opinii mówią o tym samym okresie");
    return;
  }
  for (const z of zastrzezenia) {
    console.log(`⚠ [${z.chapter_no}] ${z.kind} — ${z.rodzaj}: ${z.opis}`);
    if (z.fragment) console.log(`     „${z.fragment.replace(/\s+/g, " ").trim()}…"`);
  }
  console.log(`\n${zastrzezenia.length} zastrzeżeń — wydruk przed ich zamknięciem będzie niósł te rozbieżności.`);
  process.exitCode = 1;
}
main().catch((e) => {
  console.error("BŁĄD:", e.message);
  process.exit(1);
});
