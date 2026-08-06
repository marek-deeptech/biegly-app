// IV.3 — złożenie rozdziału „Aktywność podmiotów z Grupy" (dziedzina GPW).
//   npx tsx scripts/aktywnosc_iv3.ts <sprawa> [--od RRRR-MM-DD] [--do RRRR-MM-DD] [--maks 20]
//
// Tabele: zbiorcza per podmiot za cały okres, przebieg sesja po sesji oraz tabele
// SZCZEGÓŁOWE dla sesji istotnych (progi w lib/opinion/aktywnosc-iv3.ts; kryterium
// doboru trafia do podpisu, bo dobór materiału musi być jawny). Bez modelu.
import { readFileSync } from "node:fs";
import { join } from "node:path";
const ROOT = join(process.env.HOME ?? "", "biegly-app");
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
import { createClient } from "@supabase/supabase-js";
import {
  PROGI_DOMYSLNE,
  opisProgow,
  sesjeIstotne,
  tabelaPodmiotow,
  tabelaPrzebiegu,
  tabelaSesji,
  wybierzDoTabel,
  type Metryka,
} from "@/lib/opinion/aktywnosc-iv3";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? (process.argv[i + 1] ?? null) : null;
};

/** Wszystkie metryki sprawy — PostgREST tnie do 1000 wierszy, więc stronicujemy. */
async function metrykiSprawy(id: string): Promise<Metryka[]> {
  const out: Metryka[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb
      .from("metrics")
      .select("key,value,session_day")
      .eq("case_id", id)
      .range(off, off + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as Metryka[]));
    if ((data?.length ?? 0) < 1000) return out;
  }
}

async function main() {
  const { data: cases } = await sb.from("cases").select("id,name,typ").ilike("name", `%${process.argv[2]}%`);
  if (!cases?.length) throw new Error("nie znaleziono sprawy");
  const c = cases[0];
  if (c.typ !== "manipulacja_gpw") throw new Error("rozdział IV.3 dotyczy spraw o manipulację GPW");

  const wszystkie = await metrykiSprawy(c.id as string);
  const od = arg("od");
  const doD = arg("do");
  // Okno badania z postanowienia — poza nim sesje do rozdziału NIE wchodzą.
  const metryki = wszystkie.filter(
    (m) => !m.session_day || ((!od || m.session_day >= od) && (!doD || m.session_day <= doD)),
  );
  const maks = Number(arg("maks") ?? 20);

  const istotne = sesjeIstotne(metryki, PROGI_DOMYSLNE);
  const przebieg = tabelaPrzebiegu(metryki);
  const podmioty = tabelaPodmiotow(metryki);
  const wybrane = wybierzDoTabel(istotne, maks);
  const szczegolowe = wybrane
    .map((s) => tabelaSesji(metryki, s.dzien, s.powody))
    .filter((t): t is NonNullable<typeof t> => !!t);

  const tables = [podmioty, przebieg, ...szczegolowe].filter((t): t is NonNullable<typeof t> => !!t);
  const dni = [...new Set(metryki.map((m) => m.session_day).filter(Boolean))] as string[];
  const findings = [
    `Rozdział obejmuje ${dni.length} sesji${od || doD ? ` w oknie ${od ?? "…"}–${doD ?? "…"}` : ""}; ` +
      `kryteria istotności spełniło ${istotne.length} sesji, tabele szczegółowe sporządzono dla ${szczegolowe.length}.`,
    `Kryterium doboru sesji do tabel szczegółowych: ${opisProgow(PROGI_DOMYSLNE)}.`,
    ...(podmioty
      ? [`Zestawienie obejmuje ${podmioty.rows.length} podmiotów z Grupy aktywnych w badanym okresie.`]
      : []),
    // Odsiew ponad limit MUSI być powiedziany: milczenie sugerowałoby, że tabele
    // szczegółowe wyczerpują listę sesji istotnych.
    ...(istotne.length > szczegolowe.length
      ? [
          `${istotne.length - szczegolowe.length} sesji spełniających kryteria NIE otrzymało tabeli szczegółowej ` +
            `(limit ${maks} tabel na rozdział). Do tabel wybrano sesje o najwyższej liczbie spełnionych kryteriów, ` +
            "a przy równej liczbie — o największym przekroczeniu progu; pełny wykaz sesji istotnych wraz z powodami " +
            "znajduje się w danych rozdziału i może zostać dołączony jako załącznik.",
        ]
      : []),
  ];

  const { error } = await sb.from("subanalyses").upsert(
    {
      case_id: c.id,
      kind: "aktywnosc",
      chapter_no: "IV.3",
      title: "Aktywność podmiotów z Grupy",
      status: "szkic",
      body_md: "",
      data: {
        table: tables[0] ?? null,
        tables,
        findings,
        sesjeIstotne: istotne,
        progi: PROGI_DOMYSLNE,
        okno: { od, do: doD },
      },
    },
    { onConflict: "case_id,kind" },
  );
  if (error) throw new Error(`zapis: ${error.message}`);

  console.log(`✓ IV.3: ${tables.length} tabel (podmioty + przebieg ${przebieg?.rows.length ?? 0} sesji + ${szczegolowe.length} sesji szczegółowych)`);
  console.log(`  sesji spełniających kryteria: ${istotne.length} z ${dni.length}`);
  for (const s of wybrane.slice(0, 8)) console.log(`   • ${s.dzien}: ${s.powody.join("; ").slice(0, 110)}`);
}
main().catch((e) => {
  console.error("BŁĄD:", e.message);
  process.exit(1);
});
