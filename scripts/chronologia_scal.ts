// Ponowne ZŁOŻENIE rozdziału chronologii nadzorczej — bez modelu, bez kosztu.
//   npx tsx scripts/chronologia_scal.ts <fragment nazwy sprawy>
//
// KIEDY UŻYĆ: po `python3 scripts/zdarzenia_pism.py`, który dopisuje zdarzenia
// uzupełniające do `data.zdarzenia_uzupelniajace`. Pełny bieg chronologii
// (scripts/chronologia.ts) czytałby akta modelem od nowa — kilka minut i kilka
// dolarów po to, żeby dokleić wiersze, które już mamy. Tutaj składamy rozdział
// z CZĘŚCI SUROWYCH zapisanych w subanalizie: okresy (data.okresy), zdarzenia
// (odtworzone z tabeli działań — wiersz niesie komplet pól), zastrzeżenia.
// Składanie idzie DOKŁADNIE tym samym kodem co pełny bieg (zbudujChronologie),
// więc nie ma drugiej kopii logiki, która mogłaby się rozjechać.
import { readFileSync } from "node:fs";
import { join } from "node:path";
const ROOT = join(process.env.HOME ?? "", "biegly-app");
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
import { createClient } from "@supabase/supabase-js";
import {
  scalUzupelniajace,
  zbudujChronologie,
  type OkresNadzorczy,
  type ZdarzenieNadzorcze,
  type ZdarzenieUzupelniajace,
} from "@/lib/opinion/chronologia-nadzoru";
import type { Tabela } from "@/lib/opinion/warsztat-bank";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data: cases } = await sb.from("cases").select("id,name").ilike("name", `%${process.argv[2]}%`);
  if (!cases?.length) throw new Error("nie znaleziono sprawy");
  const id = cases[0].id as string;

  const { data: sub } = await sb
    .from("subanalyses")
    .select("id,body_md,data")
    .eq("case_id", id)
    .eq("kind", "chronologia_nadzoru")
    .single();
  if (!sub) throw new Error("brak subanalizy chronologia_nadzoru — wykonaj najpierw jej pełny bieg");

  const d = sub.data as Record<string, unknown>;
  const okresy = (d.okresy ?? []) as OkresNadzorczy[];
  const dzien = (d.dzienZdarzenia as string | null) ?? "";
  const zastrzezenia = (d.zastrzezenia ?? []) as string[];
  const uzup = (d.zdarzenia_uzupelniajace ?? []) as ZdarzenieUzupelniajace[];

  // Zdarzenia odtwarzamy z tabeli działań — wiersz [Data, Organ, Ustalenie, Źródło]
  // niesie komplet pól ZdarzenieNadzorcze, niczego nie trzeba zgadywać.
  const tabDzialan = ((d.tables ?? []) as Tabela[]).find(
    (t) => t.head?.[0] === "Data" && t.head?.[2] === "Ustalenie",
  );
  if (!tabDzialan) throw new Error("w danych nie ma tabeli działań nadzorczych — pełny bieg wymagany");
  const zdarzenia: ZdarzenieNadzorcze[] = tabDzialan.rows.map((r) => ({
    data: r[0], organ: r[1], opis: r[2], plik: r[3] === "—" ? undefined : r[3],
  }));

  const scalone = scalUzupelniajace(zdarzenia, uzup);
  const w = zbudujChronologie(okresy, scalone, dzien, zastrzezenia);

  const { error } = await sb
    .from("subanalyses")
    .update({
      data: {
        ...w.data,
        findings: w.findings,
        // Części surowe i metadane biegu — bez nich kolejne scalenie nie miałoby z czego składać.
        okresy,
        zdarzenia_uzupelniajace: uzup,
        ...(d.uwagi ? { uwagi: d.uwagi } : {}),
        ...(d.zrodla ? { zrodla: d.zrodla } : {}),
        ...(d.podmiot ? { podmiot: d.podmiot } : {}),
        // Proza sprzed scalenia opisuje starszy stan tabel — oznaczamy, nie kasujemy.
        ...((sub.body_md ?? "").trim() ? { proza_sprzed_przeliczenia: true } : {}),
      },
    })
    .eq("id", sub.id);
  if (error) throw new Error(`zapis nie powiódł się: ${error.message}`);

  const kluczowe = w.findings.filter((f) => f.startsWith("Zdarzenie kluczowe"));
  console.log(`✓ zdarzeń po scaleniu: ${scalone.length} (uzupełniających: ${uzup.length})`);
  console.log(`✓ findings: ${w.findings.length}, w tym kluczowych: ${kluczowe.length}`);
  for (const f of kluczowe) console.log(`   • ${f.slice(0, 110)}…`);
}
main();
