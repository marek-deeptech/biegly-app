// IV.1 — przebudowa liczbowej części rozdziału „Analiza ekonomiczno-finansowa"
// ODRĘBNIE DLA KAŻDEGO INSTRUMENTU (dziedzina GPW).
//   npx tsx scripts/ekofin_iv1.ts <sprawa> [--od RRRR-MM-DD] [--do RRRR-MM-DD]
//
// ⚠️ POWÓD. `buildIVChapter("ekofin", …)` liczy na metrykach CAŁEJ sprawy. W ZASTAL
// dawało to jedną tabelę OHLC, w której ta sama sesja występuje dwa razy (raz z kursem
// CSY, raz RSY), a deduplikacja po dacie cicho zostawiała jeden z nich — oraz ustalenie
// „pump +1050% (undefined → undefined)”: procent policzony na przemieszanych kursach,
// z datami granicznymi, których w metrykach nie było. Tu fazy liczy `fazyKursu` wprost
// z `day_close` jednego waloru, więc daty zawsze są.
//
// Skrypt NIE dotyka `body_md` (proza) ani sekcji z `ekofin_dane` (kontrast obrotu,
// indeks 100, dynamika finansowa) — te już powstają per emitent.
import { readFileSync } from "node:fs";
import { join } from "node:path";
const ROOT = join(process.env.HOME ?? "", "biegly-app");
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
import { createClient } from "@supabase/supabase-js";
import { fazyKursu, instrumentySprawy, metrykiInstrumentu, tabelaFaz, tabelaOhlc, type FazyKursu } from "@/lib/opinion/instrumenty";
import { okresBadany, opisOkresu, wOknie } from "@/lib/opinion/okres";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const pl = (v: number, frac = 2) => v.toLocaleString("pl-PL", { maximumFractionDigits: frac });
const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? (process.argv[i + 1] ?? null) : null;
};

async function main() {
  const { data: cases } = await sb.from("cases").select("id,name,typ").ilike("name", `%${process.argv[2]}%`);
  if (!cases?.length) throw new Error("nie znaleziono sprawy");
  const c = cases[0];
  if (c.typ !== "manipulacja_gpw") throw new Error("rozdział IV.1 dotyczy spraw o manipulację GPW");

  const { data: subs } = await sb.from("subanalyses").select("kind,body_md,data").eq("case_id", c.id);
  const instrumenty = instrumentySprawy((subs ?? []) as never);
  if (!instrumenty.length)
    throw new Error('brak subanaliz trem_<ticker> — uruchom najpierw „Policz z TREM"');

  // Okno z POSTANOWIENIA (konfiguracja kroku 4), nie z zakresu metryk — inaczej
  // IV.1 i IV.5 podają dwie różne fazy wzrostowe tego samego waloru.
  const okres = okresBadany((subs ?? []) as never, { od: arg("od"), do: arg("do") });
  const wOkresie = wOknie(okres);

  const ekofin = (subs ?? []).find((s) => s.kind === "ekofin");
  const stare = (ekofin?.data ?? {}) as Record<string, unknown>;
  // Tabele z kroku 4 (ekofin_dane) zostają — one już są per emitent; wymieniamy tylko
  // te, które powstały na zestawie łącznym: OHLC i fazy.
  const zachowane = ((stare.tables ?? []) as { caption: string }[]).filter(
    (t) => !/kurs \(OHLC\)|Fazy zmiany kursu|OHLC\) i wolumen/i.test(String(t.caption)),
  );

  const tables: { caption: string; head: string[]; rows: string[][] }[] = [];
  const findings: string[] = [];
  const wgFaz: { label: string; fazy: FazyKursu }[] = [];

  for (const inst of instrumenty) {
    const mi = metrykiInstrumentu((subs ?? []) as never, inst.ticker).filter((x) => wOkresie(x.session_day));
    const ohlc = tabelaOhlc(mi, inst.label);
    if (ohlc) tables.push(ohlc);
    const f = fazyKursu(mi);
    if (!f) {
      findings.push(`${inst.label}: w metrykach brak co najmniej dwóch sesji z kursem zamknięcia — faz nie wyznaczono.`);
      continue;
    }
    wgFaz.push({ label: inst.label, fazy: f });
    findings.push(
      `${inst.label}: kurs zamknięcia od ${pl(f.kursPoczatkowy, 4)} zł (${f.odDnia}) do szczytu ` +
        `${pl(f.kursSzczyt, 4)} zł (${f.dzienSzczytu}) — faza wzrostowa ${f.pumpPct > 0 ? "+" : ""}${pl(f.pumpPct)} %; ` +
        `następnie do ${pl(f.kursKoncowy, 4)} zł (${f.doDnia}) — faza spadkowa ${pl(f.dumpPct)} %; ` +
        `zmiana łączna ${f.lacznaPct > 0 ? "+" : ""}${pl(f.lacznaPct)} %; sesji z notowaniem: ` +
        `${ohlc?.rows.length ?? 0}.`,
    );
  }
  const faz = tabelaFaz(wgFaz);
  if (faz) tables.unshift(faz);

  // Zestawienie porównawcze mówi WPROST, że walory zachowały się różnie — inaczej
  // czytelnik przeniesie ustalenie o jednym na drugi.
  if (wgFaz.length > 1) {
    const naj = wgFaz.reduce((a, b) => (b.fazy.pumpPct > a.fazy.pumpPct ? b : a));
    const min = wgFaz.reduce((a, b) => (b.fazy.pumpPct < a.fazy.pumpPct ? b : a));
    findings.push(
      `Fazy wzrostowe obu walorów różnią się co do skali i dat: najsilniejsza dla ${naj.label} ` +
        `(${naj.fazy.pumpPct > 0 ? "+" : ""}${pl(naj.fazy.pumpPct)} %, szczyt ${naj.fazy.dzienSzczytu}), ` +
        `najsłabsza dla ${min.label} (${min.fazy.pumpPct > 0 ? "+" : ""}${pl(min.fazy.pumpPct)} %, szczyt ` +
        `${min.fazy.dzienSzczytu}) — ustaleń dotyczących jednego instrumentu nie wolno przenosić na drugi.`,
    );
  }
  findings.push(opisOkresu(okres));
  findings.push(
    "Kursy i wolumeny ustalono ODRĘBNIE dla każdego instrumentu; zestawienia obejmującego oba walory " +
      "łącznie nie sporządzano, ponieważ suma wolumenów różnych papierów i zestawienie ich kursów nie " +
      "dają wielkości o znaczeniu ekonomicznym.",
  );
  // Ustalenia z kroku 4 (kontrast obrotu, indeks 100, dynamika finansowa) zostają.
  //
  // ⚠️ IDEMPOTENCJA. Poprzedni bieg zostawiał SWOJE ustalenia jako „stare", więc po
  // zmianie okresu rozdział niósł dwie fazy wzrostowe CSY naraz (+1175 % liczone od
  // 4.12.2017 i +920 % od daty z postanowienia). Model opisał obie jako „zależne od
  // punktu odniesienia" — czyli wprowadził do opinii wielkość spoza okresu badanego.
  // Odejmujemy DOKŁADNIE to, co skrypt zapisał ostatnio (`findingsSilnika`), a nie
  // to, co zgadnie wyrażenie regularne.
  const poprzednie = new Set(((stare.findingsSilnika ?? []) as string[]).map(String));
  const stareUst = ((stare.findings ?? []) as string[]).filter(
    (f) => !poprzednie.has(String(f)) && !/^Fazy kursu \(zamknięcia\)|^Kurs wzrósł o/.test(String(f)),
  );

  const proza = String(ekofin?.body_md ?? "");
  const { error } = await sb.from("subanalyses").upsert(
    {
      case_id: c.id,
      kind: "ekofin",
      chapter_no: "IV.1",
      title: "Analiza ekonomiczno-finansowa emitentów",
      status: "szkic",
      body_md: proza,
      data: {
        ...stare,
        table: tables[0] ?? null,
        tables: [...tables, ...zachowane],
        findings: [...findings, ...stareUst],
        instrumenty: instrumenty.map((i) => i.label),
        fazyWgInstrumentu: wgFaz,
        findingsSilnika: findings,
        okno: { od: okres.od, do: okres.do, zrodlo: okres.zrodlo },
        // Proza powstała przed przeliczeniem — po zmianie liczb wymaga ponownej redakcji.
        proza_sprzed_przeliczenia: proza.length > 0,
      },
    },
    { onConflict: "case_id,kind" },
  );
  if (error) throw new Error(`zapis: ${error.message}`);

  console.log(`✓ IV.1 per instrument (okres ${okres.od}–${okres.do}, ${okres.zrodlo}): ${tables.length} tabel (+${zachowane.length} zachowanych z kroku 4)`);
  for (const f of findings.slice(0, instrumenty.length + 1)) console.log(`   • ${f.slice(0, 150)}`);
  if (proza.length) console.log(`   ⚠ proza (${proza.length} zn.) opisuje POPRZEDNIE liczby — wymaga re-redakcji`);
}
main().catch((e) => {
  console.error("BŁĄD:", e.message);
  process.exit(1);
});
