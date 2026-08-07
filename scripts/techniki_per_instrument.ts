// Dobór technik manipulacji ODRĘBNIE DLA KAŻDEGO INSTRUMENTU (krok 3/A2, tor GPW).
//   npx tsx scripts/techniki_per_instrument.ts <sprawa>
//
// ⚠️ POWÓD: detekcja na zestawie łącznym odpowiada na pytanie „czy w sprawie
// wystąpiła technika X", a postanowienie pyta o obrót KAŻDYM walorem osobno.
// W sprawie ZASTAL layering wykryto w 6 sesjach obrotu akcjami CSY i w ZERO
// sesjach obrotu akcjami RSY — zestaw łączny pokazywał 12, bo zestawiał anulacje
// jednego waloru ze sprzedażą drugiego.
//
// Skrypt NIE nadpisuje `selected` — dobór zatwierdza biegły. Dopisuje rozbicie
// per instrument obok zatwierdzonej decyzji i mówi, gdzie się z nią rozchodzi.
import { readFileSync } from "node:fs";
import { join } from "node:path";
const ROOT = join(process.env.HOME ?? "", "biegly-app");
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
import { createClient } from "@supabase/supabase-js";
import { instrumentySprawy, metrykiInstrumentu } from "@/lib/opinion/instrumenty";
import { proposeTechniquesPerInstrument, technikiWgInstrumentow } from "@/lib/opinion/techniques-detect";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data: cases } = await sb.from("cases").select("id,name,typ").ilike("name", `%${process.argv[2]}%`);
  if (!cases?.length) throw new Error("nie znaleziono sprawy");
  const c = cases[0];
  if (c.typ !== "manipulacja_gpw") throw new Error("dobór technik dotyczy spraw o manipulację GPW");

  const { data: subs } = await sb.from("subanalyses").select("kind,status,data").eq("case_id", c.id);
  const instrumenty = instrumentySprawy((subs ?? []) as never);
  if (!instrumenty.length) throw new Error("brak subanaliz trem_<ticker> — uruchom najpierw „Policz z TREM”");

  const wg = proposeTechniquesPerInstrument(
    instrumenty.map((i) => ({ ticker: i.ticker, label: i.label })),
    (t) => metrykiInstrumentu((subs ?? []) as never, t) as never,
    (subs ?? []) as never,
  );
  const zbiorczo = technikiWgInstrumentow(wg);

  const techniki = (subs ?? []).find((s) => s.kind === "techniki");
  const zatwierdzone = ((techniki?.data as { selected?: string[] } | null)?.selected ?? []) as string[];
  const wykryte = zbiorczo.map((x) => x.id as string);
  const tylkoWZatwierdzonych = zatwierdzone.filter((k) => !wykryte.includes(k));
  const tylkoWykryte = wykryte.filter((k) => !zatwierdzone.includes(k));

  const rows = zbiorczo.map((x) => [
    x.id,
    x.instrumenty.join(", "),
    instrumenty.filter((i) => !x.instrumenty.includes(i.label)).map((i) => i.label).join(", ") || "—",
    x.sygnaly.join(" | ").slice(0, 200),
  ]);
  const table = {
    caption:
      "Tabela. Techniki manipulacji wykryte w podziale na instrumenty — sygnał liczbowy osobno dla " +
      "każdego waloru (detekcja deterministyczna z metryk silnika)",
    head: ["Technika", "Instrumenty z sygnałem", "Instrumenty bez sygnału", "Sygnał"],
    rows,
  };

  const findings = [
    ...wg.map(
      (x) =>
        `${x.label}: sygnał dowodowy dla technik — ${
          x.proposals.filter((p) => p.auto).map((p) => p.id).join(", ") || "żadna technika nie osiągnęła progu sygnału"
        }.`,
    ),
    ...zbiorczo
      .filter((x) => x.instrumenty.length < instrumenty.length)
      .map(
        (x) =>
          `Technika „${x.id}" ma sygnał WYŁĄCZNIE dla: ${x.instrumenty.join(", ")}; ` +
          `dla pozostałych instrumentów (${instrumenty.filter((i) => !x.instrumenty.includes(i.label)).map((i) => i.label).join(", ")}) ` +
          "sygnału nie stwierdzono — rozdział poświęcony tej technice musi to powiedzieć wprost.",
      ),
    ...(tylkoWZatwierdzonych.length
      ? [
          `Techniki w zatwierdzonym doborze biegłego, dla których detekcja per instrument NIE daje sygnału: ` +
            `${tylkoWZatwierdzonych.join(", ")} — do rozstrzygnięcia przez biegłego (dobór pozostaje jego decyzją).`,
        ]
      : []),
    ...(tylkoWykryte.length
      ? [`Techniki z sygnałem, których nie ma w zatwierdzonym doborze: ${tylkoWykryte.join(", ")}.`]
      : []),
  ];

  // ⚠️ NIE RUSZAMY `selected` — to zatwierdzona decyzja biegłego (status „zatwierdzona").
  const dane = { ...((techniki?.data as Record<string, unknown>) ?? {}) };
  dane.perInstrument = wg;
  dane.technikiWgInstrumentow = zbiorczo;
  dane.tables = [table];
  dane.table = table;
  dane.findings = findings;

  const { error } = await sb
    .from("subanalyses")
    .update({ data: dane })
    .eq("case_id", c.id)
    .eq("kind", "techniki");
  if (error) throw new Error(`zapis: ${error.message}`);

  console.log(`✓ techniki per instrument (${instrumenty.map((i) => i.label).join(", ")}); zatwierdzony dobór NIETKNIĘTY: ${zatwierdzone.join(", ") || "—"}`);
  for (const r of rows) console.log(`   • ${r[0]}: sygnał ${r[1]}; bez sygnału ${r[2]}`);
  for (const f of findings.filter((x) => x.includes("WYŁĄCZNIE") || x.includes("NIE daje"))) console.log(`   ⚠ ${f.slice(0, 150)}`);
}
main().catch((e) => {
  console.error("BŁĄD:", e.message);
  process.exit(1);
});
