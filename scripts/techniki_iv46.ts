// IV.4 (wash trades) i IV.6 (layering/spoofing) — złożenie tabel wzorca.
//   npx tsx scripts/techniki_iv46.ts <sprawa> [--od RRRR-MM-DD] [--do RRRR-MM-DD] [--sekwencje 6]
//
// Materiał: metryki silnika (wash_*, pair_intra) oraz subanaliza `spoofing_analysis`
// (arkusz zleceń KNF, poziom pojedynczego zlecenia z podmiotem). Bez modelu.
import { readFileSync } from "node:fs";
import { join } from "node:path";
const ROOT = join(process.env.HOME ?? "", "biegly-app");
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
import { createClient } from "@supabase/supabase-js";
import {
  tabelaAnulacjiPodmiotow,
  tabelaParWewnatrzgrupowych,
  tabelaSekwencji,
  tabelaSesjiLayering,
  tabelaSesjiWash,
  type DzienSpoof,
  type Metryka,
} from "@/lib/opinion/techniki-iv46";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? (process.argv[i + 1] ?? null) : null;
};

async function metrykiSprawy(id: string): Promise<Metryka[]> {
  const out: Metryka[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb.from("metrics").select("key,value,session_day").eq("case_id", id).range(off, off + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as Metryka[]));
    if ((data?.length ?? 0) < 1000) return out;
  }
}

async function zapisz(id: string, kind: string, chapter_no: string, title: string, tables: unknown[], findings: string[]) {
  const { error } = await sb.from("subanalyses").upsert(
    { case_id: id, kind, chapter_no, title, status: "szkic", body_md: "", data: { table: tables[0] ?? null, tables, findings } },
    { onConflict: "case_id,kind" },
  );
  if (error) throw new Error(`zapis ${kind}: ${error.message}`);
}

async function main() {
  const { data: cases } = await sb.from("cases").select("id,name,typ").ilike("name", `%${process.argv[2]}%`);
  if (!cases?.length) throw new Error("nie znaleziono sprawy");
  const c = cases[0];
  if (c.typ !== "manipulacja_gpw") throw new Error("rozdziały IV.4/IV.6 dotyczą spraw o manipulację GPW");
  const od = arg("od");
  const doD = arg("do");
  const ileSekwencji = Number(arg("sekwencje") ?? 6);

  const metryki = (await metrykiSprawy(c.id as string)).filter(
    (m) => !m.session_day || ((!od || m.session_day >= od) && (!doD || m.session_day <= doD)),
  );

  // ── IV.4 ────────────────────────────────────────────────────────────────
  const pary = tabelaParWewnatrzgrupowych(metryki);
  const sesjeWash = tabelaSesjiWash(metryki, 20);
  const wash4 = [pary, sesjeWash].filter(Boolean) as unknown[];
  const fWash = [
    ...(sesjeWash ? [`Obrót wewnątrzgrupowy przekroczył 20 % wolumenu sesji w ${(sesjeWash as { rows: string[][] }).rows.length} sesjach.`] : []),
    ...(pary ? [`Zidentyfikowano ${(pary as { rows: string[][] }).rows.length} par podmiotów występujących po obu stronach tej samej transakcji.`] : []),
  ];
  if (wash4.length) await zapisz(c.id as string, "wash", "IV.4", "Wash trades", wash4, fWash);

  // ── IV.6 ────────────────────────────────────────────────────────────────
  const { data: sp } = await sb
    .from("subanalyses").select("data").eq("case_id", c.id).eq("kind", "spoofing_analysis").maybeSingle();
  const analiza = (sp?.data as { analysis?: { days?: DzienSpoof[]; totals?: Record<string, number> } } | null)?.analysis;
  let dni = (analiza?.days ?? []) as DzienSpoof[];
  if (od || doD) dni = dni.filter((d) => (!od || d.day >= od) && (!doD || d.day <= doD));

  if (dni.length) {
    const perPodmiot = tabelaAnulacjiPodmiotow(dni);
    const perPodmiotManip = tabelaAnulacjiPodmiotow(dni, true);
    const sesje = tabelaSesjiLayering(dni);
    const manipDni = dni.filter((d) => d.manip).sort((a, b) => (b.cancelled_buy ?? 0) - (a.cancelled_buy ?? 0));
    const sekwencje = manipDni
      .slice(0, ileSekwencji)
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((d) => tabelaSekwencji(d))
      .filter(Boolean) as unknown[];
    const t6 = [perPodmiot, perPodmiotManip, sesje, ...sekwencje].filter(Boolean) as unknown[];
    const tot = analiza?.totals ?? {};
    const f6 = [
      `Sesji oznaczonych jako manipulacyjne: ${manipDni.length}; łączny wolumen anulowanych zleceń kupna: ` +
        `${(tot.cancelled_buy_total ?? 0).toLocaleString("pl-PL")} szt. wobec ${(tot.declared_buy_total ?? 0).toLocaleString("pl-PL")} szt. zleconych ` +
        `(${tot.declared_buy_total ? ((100 * (tot.cancelled_buy_total ?? 0)) / tot.declared_buy_total).toFixed(2).replace(".", ",") : "—"} %).`,
      `Zleceń warstwowych: ${tot.layer_orders_total ?? 0}; sprzedaż zrealizowana w tych sesjach: ${(tot.sell_exec_total ?? 0).toLocaleString("pl-PL")} szt.`,
      ...(perPodmiot ? [`Rozbicie anulacji na ${(perPodmiot as { rows: string[][] }).rows.length} podmiotów — atrybucja imienna wymagana pytaniem 1 postanowienia.`] : []),
      ...(manipDni.length > sekwencje.length
        ? [`Sekwencje zleceń przedstawiono dla ${sekwencje.length} sesji o największym wolumenie anulacji z ${manipDni.length} oznaczonych; pozostałe pozostają w danych rozdziału.`]
        : []),
    ];
    if (t6.length) await zapisz(c.id as string, "layering", "IV.6", "Layering and spoofing", t6, f6);
    console.log(`✓ IV.6: ${t6.length} tabel (${manipDni.length} sesji manipulacyjnych, ${sekwencje.length} sekwencji)`);
    if (perPodmiot)
      for (const r of (perPodmiot as { rows: string[][] }).rows.slice(0, 6))
        console.log(`   • ${r[0]}: zlecone ${r[2]}, anulowane ${r[3]} (${r[4]}), warstw ${r[6]}`);
  } else {
    console.log("⚠ brak danych zleceń (spoofing_analysis) — IV.6 nie zbudowane");
  }
  console.log(`✓ IV.4: ${wash4.length} tabel`);
  for (const f of fWash) console.log(`   • ${f}`);
}
main().catch((e) => {
  console.error("BŁĄD:", e.message);
  process.exit(1);
});
