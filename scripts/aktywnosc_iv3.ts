// IV.3 — złożenie rozdziału „Aktywność podmiotów z Grupy" (dziedzina GPW).
//   npx tsx scripts/aktywnosc_iv3.ts <sprawa> [--od RRRR-MM-DD] [--do RRRR-MM-DD] [--maks 20]
//
// ⚠️ LICZBY IDĄ OSOBNO DLA KAŻDEGO INSTRUMENTU. Sprawa ZASTAL obejmuje CSY S.A.
// i RSY S.A.; zestaw łączny sumowałby wolumeny dwóch różnych papierów i podstawiał
// kurs jednego z nich pod oba — patrz komentarz w lib/opinion/instrumenty.ts.
// Tabele: zbiorcza per podmiot, przebieg sesja po sesji i tabele SZCZEGÓŁOWE dla
// sesji istotnych — wszystkie per instrument. Bez modelu.
import { readFileSync } from "node:fs";
import { join } from "node:path";
const ROOT = join(process.env.HOME ?? "", "biegly-app");
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
import { createClient } from "@supabase/supabase-js";
import { stabilny } from "@/lib/json-stabilny";
import { okresBadany, opisOkresu, wOknie as wOknieOkresu } from "@/lib/opinion/okres";
import { instrumentySprawy, metrykiInstrumentu } from "@/lib/opinion/instrumenty";
import {
  PROGI_DOMYSLNE,
  opisProgow,
  sesjeIstotne,
  tabelaPodmiotow,
  tabelaPrzebiegu,
  tabelaSesji,
  wybierzDoTabel,
  type SesjaIstotna,
  type Tabela,
} from "@/lib/opinion/aktywnosc-iv3";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? (process.argv[i + 1] ?? null) : null;
};
/** Podpis tabeli z nazwą instrumentu na początku — czytelnik musi wiedzieć, czego dotyczy. */
const zInstrumentem = (t: Tabela, label: string): Tabela => ({
  ...t,
  caption: t.caption.startsWith(`Tabela. ${label}`) ? t.caption : `Tabela. ${label} — ${t.caption.replace(/^Tabela\.\s*/, "")}`,
});

async function main() {
  const { data: cases } = await sb.from("cases").select("id,name,typ").ilike("name", `%${process.argv[2]}%`);
  if (!cases?.length) throw new Error("nie znaleziono sprawy");
  const c = cases[0];
  if (c.typ !== "manipulacja_gpw") throw new Error("rozdział IV.3 dotyczy spraw o manipulację GPW");

  const { data: subs } = await sb.from("subanalyses").select("kind,data").eq("case_id", c.id);
  const instrumenty = instrumentySprawy((subs ?? []) as never);
  if (!instrumenty.length)
    throw new Error(
      'brak subanaliz trem_<ticker> — rozdział liczbowy wymaga metryk PER INSTRUMENT; uruchom najpierw „Policz z TREM"',
    );

  const od = arg("od");
  const doD = arg("do");
  const maks = Number(arg("maks") ?? 20);
  // Okno z POSTANOWIENIA (konfiguracja kroku 4); flagi --od/--do tylko nadpisują.
  const okres = okresBadany((subs ?? []) as never, { od, do: doD });
  const wOknie = wOknieOkresu(okres);

  const tables: Tabela[] = [];
  const findings: string[] = [];
  const sesjeWgInstrumentu: Record<string, SesjaIstotna[]> = {};
  let pominietych = 0;

  for (const inst of instrumenty) {
    const m = metrykiInstrumentu((subs ?? []) as never, inst.ticker).filter((x) => wOknie(x.session_day));
    if (!m.length) {
      findings.push(`${inst.label}: brak metryk w oknie badania — rozdziału dla tego instrumentu nie sporządzono.`);
      continue;
    }
    const istotne = sesjeIstotne(m, PROGI_DOMYSLNE);
    const wybrane = wybierzDoTabel(istotne, maks);
    const podmioty = tabelaPodmiotow(m);
    const przebieg = tabelaPrzebiegu(m, inst.label);
    const szczegolowe = wybrane
      .map((s) => tabelaSesji(m, s.dzien, s.powody))
      .filter((t): t is Tabela => !!t)
      .map((t) => zInstrumentem(t, inst.label));

    if (podmioty) tables.push(zInstrumentem(podmioty, inst.label));
    if (przebieg) tables.push(przebieg);
    tables.push(...szczegolowe);

    const dni = [...new Set(m.map((x) => x.session_day).filter(Boolean))].length;
    sesjeWgInstrumentu[inst.label] = istotne;
    pominietych += istotne.length - szczegolowe.length;
    findings.push(
      `${inst.label}: ${dni} sesji${od || doD ? ` w oknie ${od ?? "…"}–${doD ?? "…"}` : ""}; kryteria istotności ` +
        `spełniło ${istotne.length}, tabele szczegółowe sporządzono dla ${szczegolowe.length}` +
        (podmioty ? `; w obrocie uczestniczyło ${podmioty.rows.length} podmiotów z Grupy` : "") + ".",
    );
  }

  // ⚠️ TABELE ZE ŹRÓDŁA `obrot_miary` DOKŁADAMY PRZY SKŁADANIU. Liczy je silnik
  // Pythona (engine/obrot_wg_miar.py) w osobnym biegu; trzymanie ich w tej samej
  // subanalizie znaczyłoby, że ponowny bieg jednego skryptu kasuje dorobek drugiego.
  const miary = ((subs ?? []).find((s) => s.kind === "obrot_miary")?.data as { tables?: Tabela[] } | null)?.tables ?? [];
  const doIV3 = miary.filter((t) => /w trzech miarach: liczba transakcji|transakcje kupna i sprzedaży/.test(t.caption));
  tables.push(...doIV3);
  if (doIV3.length)
    findings.push(
      "Obrót Grupy przedstawiono w TRZECH miarach — liczbie transakcji, wartości i wolumenie — bo są " +
        "niezależne: udział w liczbie transakcji odpowiada na pytanie „ile razy”, a udział w wolumenie " +
        "na pytanie „ile akcji”; dominacja w jednej mierze nie przesądza o drugiej.",
    );

  findings.push(`Kryterium doboru sesji do tabel szczegółowych: ${opisProgow(PROGI_DOMYSLNE)}.`);
  findings.push(opisOkresu(okres));
  // Odsiew ponad limit MUSI być powiedziany: milczenie sugerowałoby, że tabele
  // szczegółowe wyczerpują listę sesji istotnych.
  if (pominietych > 0)
    findings.push(
      `${pominietych} sesji spełniających kryteria NIE otrzymało tabeli szczegółowej (limit ${maks} tabel na ` +
        "instrument). Do tabel wybrano sesje o najwyższej liczbie spełnionych kryteriów, a przy równej liczbie — " +
        "o największym przekroczeniu progu; pełny wykaz sesji istotnych wraz z powodami znajduje się w danych " +
        "rozdziału i może zostać dołączony jako załącznik.",
    );
  findings.push(
    "Wszystkie wielkości liczbowe rozdziału ustalono ODRĘBNIE dla każdego instrumentu; zestawień " +
      "obejmujących oba walory łącznie nie sporządzano, ponieważ sumowanie wolumenów różnych papierów " +
      "i zestawianie ich kursów nie daje wielkości o znaczeniu ekonomicznym.",
  );

  // ⚠️ Proza przeżywa przeliczenie — patrz komentarz w scripts/techniki_iv46.ts.
  const { data: stara } = await sb
    .from("subanalyses").select("body_md,data").eq("case_id", c.id).eq("kind", "aktywnosc").maybeSingle();
  const proza = String(stara?.body_md ?? "");
  // Znacznik tylko przy ZMIANIE liczb — patrz komentarz w scripts/techniki_iv46.ts.
  const d0 = (stara?.data ?? {}) as { tables?: unknown; findings?: unknown };
  const bezZmian =
    stabilny(d0.tables ?? null) === stabilny(tables) &&
    stabilny(d0.findings ?? null) === stabilny(findings);
  const { error } = await sb.from("subanalyses").upsert(
    {
      case_id: c.id,
      kind: "aktywnosc",
      chapter_no: "IV.3",
      title: "Aktywność podmiotów z Grupy",
      status: "szkic",
      body_md: proza,
      data: {
        table: tables[0] ?? null,
        tables,
        findings,
        sesjeIstotneWgInstrumentu: sesjeWgInstrumentu,
        instrumenty: instrumenty.map((i) => i.label),
        progi: PROGI_DOMYSLNE,
        proza_sprzed_przeliczenia: proza.length > 0 && !bezZmian,
        okno: { od: okres.od, do: okres.do, zrodlo: okres.zrodlo },
      },
    },
    { onConflict: "case_id,kind" },
  );
  if (error) throw new Error(`zapis: ${error.message}`);

  console.log(`✓ IV.3: ${tables.length} tabel dla ${instrumenty.length} instrumentów (${instrumenty.map((i) => i.label).join(", ")})`);
  for (const f of findings.slice(0, instrumenty.length)) console.log(`   • ${f.slice(0, 135)}`);
}
main().catch((e) => {
  console.error("BŁĄD:", e.message);
  process.exit(1);
});
