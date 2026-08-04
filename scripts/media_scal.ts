// Ponowne ZŁOŻENIE rozdziału „Publikacje prasowe i komunikaty" — bez modelu.
//   npx tsx scripts/media_scal.ts <fragment nazwy sprawy>
//
// KIEDY UŻYĆ: po zmianie kompozycji findings w zbudujMedia (np. promocja tez
// publikacji do rejestru wniosków). Pełny warsztat czytałby wszystkie dokumenty
// modelem od nowa; tutaj publikacje odtwarzamy z zapisanych tabel — wiersz
// [Data, Tytuł, Źródło, Teza, Plik] niesie komplet pól Publikacji — i składamy
// tym samym kodem co Krok 4 (zbudujMedia), więc logika ma jedno źródło.
import { readFileSync } from "node:fs";
import { join } from "node:path";
const ROOT = join(process.env.HOME ?? "", "biegly-app");
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
import { createClient } from "@supabase/supabase-js";
import { zbudujMedia, type Publikacja, type Tabela } from "@/lib/opinion/warsztat-bank";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data: cases } = await sb.from("cases").select("id,name").ilike("name", `%${process.argv[2]}%`);
  if (!cases?.length) throw new Error("nie znaleziono sprawy");
  const { data: sub } = await sb
    .from("subanalyses")
    .select("id,body_md,data")
    .eq("case_id", cases[0].id)
    .eq("kind", "media")
    .single();
  if (!sub) throw new Error("brak subanalizy media — wykonaj Krok 4");

  const d = sub.data as Record<string, unknown>;
  const dzien = (d.dzienZdarzenia as string | null) ?? "";
  const publikacje: Publikacja[] = ((d.tables ?? []) as Tabela[])
    .filter((t) => t.head?.[0] === "Data" && t.head?.[3]?.startsWith("Teza"))
    .flatMap((t) => t.rows)
    .map((r) => ({ data: r[0], tytul: r[1], zrodlo: r[2], teza: r[3], plik: r[4] }));
  if (!publikacje.length) throw new Error("w danych nie ma tabel publikacji — pełny bieg wymagany");

  const w = zbudujMedia(publikacje, dzien);
  const { error } = await sb
    .from("subanalyses")
    .update({
      data: {
        ...w.data,
        findings: w.findings,
        ...(d.uwagi ? { uwagi: d.uwagi } : {}),
        ...((sub.body_md ?? "").trim() ? { proza_sprzed_przeliczenia: true } : {}),
      },
    })
    .eq("id", sub.id);
  if (error) throw new Error(`zapis: ${error.message}`);
  console.log(`✓ publikacji: ${publikacje.length}; findings: ${w.findings.length}`);
  for (const f of w.findings) console.log(`   • ${f.slice(0, 120)}`);
}
main();
