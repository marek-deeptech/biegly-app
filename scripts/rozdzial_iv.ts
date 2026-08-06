// Regeneracja POJEDYNCZEGO rozdziału IV (dziedzina GPW) z wiersza poleceń.
//   npx tsx scripts/rozdzial_iv.ts <fragment nazwy sprawy> <kind>
//   np.: npx tsx scripts/rozdzial_iv.ts ZASTAL espi
//
// KIEDY UŻYĆ: rozdział IV.x liczy się z dokumentów i metryk Z CHWILI generacji.
// Po dograniu materiału (np. utrwaleń raportów ESPI/EBI do IV.2) stary rozdział
// twierdzi „w aktach 0 raportów" — o AKTACH, nie o swojej dacie. Pełny bieg
// wszystkich rozdziałów (fullrun) nadpisałby także te, których nikt nie zmieniał.
import { readFileSync } from "node:fs";
import { join } from "node:path";
const ROOT = join(process.env.HOME ?? "", "biegly-app");
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
import { createClient } from "@supabase/supabase-js";
import { buildIVChapter } from "@/lib/opinion/build";
import { fetchAllMetrics } from "@/lib/metrics-fetch";
import type { IVKind } from "@/lib/opinion/chapters";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const [fraza, kind] = [process.argv[2], process.argv[3] as IVKind];
  if (!fraza || !kind) throw new Error("użycie: npx tsx scripts/rozdzial_iv.ts <sprawa> <kind>");
  const { data: cases } = await sb.from("cases").select("id,name,typ").ilike("name", `%${fraza}%`);
  if (!cases?.length) throw new Error("nie znaleziono sprawy");
  const c = cases[0];
  if (c.typ !== "manipulacja_gpw") throw new Error("rozdziały IV dotyczą spraw o manipulację GPW");

  // ⚠️ fetchAllMetrics, a NIE `.limit(20000)`. PostgREST tnie odpowiedź do swojego
  // `max-rows` (u nas 1000) niezależnie od limitu w zapytaniu i robi to CICHO.
  // Rozdziały budowały się na 1/6 metryk sprawy ZASTAL (1000 z 5862) i pisały
  // „[Do uzupełnienia: dynamika kursu]", choć metryki faz (pump +1050 %) leżały
  // w bazie — czyli twierdziły nieprawdę o materiale.
  const metrics = await fetchAllMetrics(sb, c.id as string, "key,label,value,unit,session_day");
  const { data: documents } = await sb
    .from("documents")
    .select("rel_path,doc_type,provenance")
    .eq("case_id", c.id)
    .limit(3000);

  const w = buildIVChapter(kind, c.name, metrics as never, (documents ?? []) as never);

  // ⚠️ NIE KASUJEMY ZREDAGOWANEJ PROZY ANI WZBOGACONYCH TABEL.
  // Upsert szkieletem nadpisywał `body_md` i `data`, więc ponowne przeliczenie
  // rozdziału zabierało prozę biegłego oraz tabele dołożone przez skrypty
  // wzbogacające (aktywnosc_iv3, techniki_iv46) — bez ostrzeżenia. Ta sama klasa
  // awarii, przed którą chroni się warsztat bankowy. Prozę zachowujemy i znaczymy
  // jako opisującą WCZEŚNIEJSZY odczyt: tekst o nieaktualnych liczbach jest gorszy
  // niż jego brak, bo wygląda na aktualny.
  const { data: stara } = await sb
    .from("subanalyses").select("body_md,data").eq("case_id", c.id).eq("kind", w.kind).maybeSingle();
  const prozaByla = String(stara?.body_md ?? "").trim();
  const stareTabele = ((stara?.data as { tables?: unknown[] } | null)?.tables ?? []) as unknown[];
  const noweTabele = ((w.data as { tables?: unknown[] })?.tables ?? []) as unknown[];
  const bogatsze = stareTabele.length > noweTabele.length;

  const { error } = await sb.from("subanalyses").upsert(
    {
      case_id: c.id,
      kind: w.kind,
      chapter_no: w.chapterNo,
      title: w.title,
      status: "szkic",
      body_md: prozaByla || w.bodyMd,
      data: {
        ...w.data,
        // Bogatszy zestaw tabel (ze skryptów wzbogacających) wygrywa ze szkieletem.
        ...(bogatsze ? { tables: stareTabele, table: (stareTabele[0] ?? null) as never } : {}),
        ...(prozaByla ? { proza_sprzed_przeliczenia: true } : {}),
      },
    },
    { onConflict: "case_id,kind" },
  );
  if (error) throw new Error(`zapis: ${error.message}`);
  const f = (w.data as { findings?: string[] }).findings ?? [];
  console.log(
    `✓ ${w.kind} (${w.chapterNo} ${w.title}) — ${w.bodyMd.length} zn. szkieletu` +
      (prozaByla ? `; zachowano prozę ${prozaByla.length} zn. (opisuje wcześniejszy odczyt)` : "") +
      (bogatsze ? `; zachowano ${stareTabele.length} tabel ze wzbogacenia` : ""),
  );
  for (const x of f.slice(0, 4)) console.log(`   • ${x.slice(0, 130)}`);
}
main().catch((e) => {
  console.error("BŁĄD:", e.message);
  process.exit(1);
});
