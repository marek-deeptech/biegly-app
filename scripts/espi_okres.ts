// IV.2 — przeliczenie rejestru ESPI/EBI na OKRES BADANY z postanowienia.
//   npx tsx scripts/espi_okres.ts <sprawa> [--od RRRR-MM-DD] [--do RRRR-MM-DD]
//
// ⚠️ POWÓD. Rejestr `espi_events` zapamiętał okno wyprowadzone z zakresu metryk
// (2017-12-04–2018-03-21 — niecałe cztery miesiące zamiast prawie dwóch lat)
// i dwa ustalenia zaczynały się od „W okresie badanym (2017-12-04–2018-03-21)".
// Zdania te weszły do prozy rozdziału IV.2 jako twierdzenie o zakresie badania.
// Liczby raportów przeliczamy z tabeli rejestru — nie przepisujemy ich z narracji.
import { readFileSync } from "node:fs";
import { join } from "node:path";
const ROOT = join(process.env.HOME ?? "", "biegly-app");
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
import { createClient } from "@supabase/supabase-js";
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
  if (c.typ !== "manipulacja_gpw") throw new Error("rozdział IV.2 dotyczy spraw o manipulację GPW");

  const { data: subs } = await sb.from("subanalyses").select("kind,data").eq("case_id", c.id);
  const okres = okresBadany((subs ?? []) as never, { od: arg("od"), do: arg("do") });
  const ev = (subs ?? []).find((s) => s.kind === "espi_events");
  if (!ev) throw new Error("brak rejestru espi_events — uruchom najpierw pobór raportów");
  const dane = (ev.data ?? {}) as Record<string, unknown>;
  const tabela = dane.table as { head: string[]; rows: string[][] } | undefined;
  if (!tabela?.rows?.length) throw new Error("rejestr espi_events nie ma tabeli raportów");

  const stareOkno = dane.okresBadany as { od?: string; do?: string } | undefined;
  const zakres = `${okres.od}–${okres.do}`;
  const wOkresie = tabela.rows.filter((r) => r[0] >= okres.od && r[0] <= okres.do);
  const wgEmitenta = new Map<string, number>();
  for (const r of wOkresie) wgEmitenta.set(r[3], (wgEmitenta.get(r[3]) ?? 0) + 1);
  const rozbicie = [...wgEmitenta.entries()].map(([e, n]) => `${e}: ${n}`).join(", ") || "brak";

  // Podmiana ZAKRESU w istniejących ustaleniach — treść merytoryczna zostaje.
  const stareUst = (dane.findings ?? []) as string[];
  const stareZakresy = [
    stareOkno?.od && stareOkno?.do ? `${stareOkno.od}–${stareOkno.do}` : null,
    "2017-12-04–2018-03-21",
  ].filter((x): x is string => !!x);
  let podmian = 0;
  const findings = stareUst.map((f) => {
    let t = String(f);
    for (const z of stareZakresy)
      if (t.includes(z)) {
        t = t.split(z).join(zakres);
        podmian += 1;
      }
    return t;
  });
  // Liczba raportów w oknie jest teraz inna niż w zdaniach pisanych pod stare okno —
  // dopisujemy ustalenie policzone z tabeli, żeby proza miała czym je zastąpić.
  findings.push(
    `W okresie badanym (${zakres}) rejestr obejmuje ${wOkresie.length} z ${tabela.rows.length} ` +
      `zidentyfikowanych raportów ESPI/EBI (${rozbicie}); pozostałe przypadają przed początkiem albo ` +
      "po końcu okresu i mają znaczenie wyłącznie kontekstowe.",
  );

  const { error } = await sb
    .from("subanalyses")
    .update({ data: { ...dane, findings, okresBadany: { od: okres.od, do: okres.do, zrodlo: okres.zrodlo } } })
    .eq("case_id", c.id)
    .eq("kind", "espi_events");
  if (error) throw new Error(`zapis: ${error.message}`);

  console.log(
    `✓ IV.2: okres ${zakres} (${okres.zrodlo}); w oknie ${wOkresie.length}/${tabela.rows.length} raportów (${rozbicie})` +
      (podmian ? `; poprawiono zakres w ${podmian} ustaleniach` : ""),
  );
  if (stareOkno?.od && stareOkno.od !== okres.od)
    console.log(`   ⚠ poprzednio rejestr niósł okno ${stareOkno.od}–${stareOkno.do} — wyprowadzone z metryk, nie z postanowienia`);
}
main().catch((e) => {
  console.error("BŁĄD:", e.message);
  process.exit(1);
});
