// IV.4 (wash trades) i IV.6 (layering/spoofing) — złożenie tabel wzorca.
//   npx tsx scripts/techniki_iv46.ts <sprawa> [--od RRRR-MM-DD] [--do RRRR-MM-DD] [--sekwencje 6]
//
// ⚠️ WSZYSTKO PER INSTRUMENT. Zestaw łączny mieszał dwa walory: anulacje zleceń
// jednego zestawiane były ze sprzedażą drugiego, przez co detekcja layeringu dawała
// 12 sesji, podczas gdy per instrument jest ich 6 (CSY) i 0 (RSY). Materiał: metryki
// z subanaliz `trem_<ticker>` oraz `spoofing_<ticker>` (zlecenia KNF filtrowane po ISIN).
import { readFileSync } from "node:fs";
import { join } from "node:path";
const ROOT = join(process.env.HOME ?? "", "biegly-app");
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
import { createClient } from "@supabase/supabase-js";
import { fazyKursu, instrumentySprawy, metrykiInstrumentu, tabelaFaz } from "@/lib/opinion/instrumenty";
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

  const { data: subs } = await sb.from("subanalyses").select("kind,data").eq("case_id", c.id);
  const instrumenty = instrumentySprawy((subs ?? []) as never);
  if (!instrumenty.length) throw new Error("brak subanaliz trem_<ticker> — uruchom najpierw „Policz z TREM”");
  const wOknie = (d?: string | null) => !d || ((!od || d >= od) && (!doD || d <= doD));
  const metrykiLaczne = (await metrykiSprawy(c.id as string)).filter((m) => wOknie(m.session_day));

  const wash4: unknown[] = [];
  const fWash: string[] = [];
  const t6: unknown[] = [];
  const f6: string[] = [];
  const fazy: { label: string; fazy: NonNullable<ReturnType<typeof fazyKursu>> }[] = [];

  for (const inst of instrumenty) {
    const m = metrykiInstrumentu((subs ?? []) as never, inst.ticker).filter((x) => wOknie(x.session_day));
    const f = fazyKursu(m);
    if (f) fazy.push({ label: inst.label, fazy: f });

    // ── IV.4 — wash trades, osobno dla instrumentu ────────────────────────
    const sesjeWash = tabelaSesjiWash(m, 20);
    if (sesjeWash) {
      wash4.push({ ...sesjeWash, caption: `Tabela. ${inst.label} — ${sesjeWash.caption.replace(/^Tabela\.\s*/, "")}` });
      fWash.push(`${inst.label}: obrót wewnątrzgrupowy przekroczył 20 % wolumenu sesji w ${sesjeWash.rows.length} sesjach.`);
    } else {
      fWash.push(`${inst.label}: w żadnej sesji obrót wewnątrzgrupowy nie przekroczył 20 % wolumenu sesji.`);
    }

    // ── IV.6 — layering/spoofing z zestawienia zleceń FILTROWANEGO PO ISIN ──
    const sp = (subs ?? []).find((s) => s.kind === `spoofing_${inst.ticker}`);
    const analiza = (sp?.data as { analysis?: { days?: DzienSpoof[]; totals?: Record<string, number> } } | null)?.analysis;
    if (!analiza) {
      f6.push(`${inst.label}: brak analizy zleceń (subanaliza spoofing_${inst.ticker}) — techniki nie zbadano dla tego instrumentu.`);
      continue;
    }
    const dni = (analiza.days ?? []).filter((d) => wOknie(d.day));
    const manipDni = dni.filter((d) => d.manip).sort((a, b) => (b.cancelled_buy ?? 0) - (a.cancelled_buy ?? 0));
    const tot = analiza.totals ?? {};
    const perPodmiot = tabelaAnulacjiPodmiotow(dni);
    const sesje = tabelaSesjiLayering(dni);
    const sekwencje = manipDni
      .slice(0, ileSekwencji)
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((d) => tabelaSekwencji(d))
      .filter((x): x is NonNullable<typeof x> => !!x)
      .map((x) => ({ ...x, caption: `Tabela. ${inst.label} — ${x.caption.replace(/^Tabela\.\s*/, "")}` }));

    if (perPodmiot) t6.push({ ...perPodmiot, caption: `Tabela. ${inst.label} — ${perPodmiot.caption.replace(/^Tabela\.\s*/, "")}` });
    if (sesje) t6.push({ ...sesje, caption: `Tabela. ${inst.label} — ${sesje.caption.replace(/^Tabela\.\s*/, "")}` });
    t6.push(...sekwencje);

    if (manipDni.length) {
      f6.push(
        `${inst.label}: sesji ze znamionami layeringu ${manipDni.length}; anulowano ` +
          `${(tot.cancelled_buy_total ?? 0).toLocaleString("pl-PL")} szt. zleceń kupna z ${(tot.declared_buy_total ?? 0).toLocaleString("pl-PL")} szt. zleconych; ` +
          `zleceń warstwowych ${tot.layer_orders_total ?? 0}, sprzedaż zrealizowana ${(tot.sell_exec_total ?? 0).toLocaleString("pl-PL")} szt.`,
      );
    } else {
      // Ustalenie NEGATYWNE — musi paść wprost, z progiem, którym badano.
      const zAnulacjami = dni.filter((d) => (d.cancelled_buy ?? 0) > 0).length;
      const maks = Math.max(0, ...dni.map((d) => d.cancelled_buy ?? 0));
      f6.push(
        `${inst.label}: pełnego wzorca layeringu NIE stwierdzono w żadnej sesji. W ${zAnulacjami} sesjach ` +
          `wystąpiły anulacje zleceń kupna (największa ${maks.toLocaleString("pl-PL")} szt.), ale nie towarzyszyła im ` +
          "jednoczesna sprzedaż przy anulowaniu co najmniej połowy zleconego wolumenu.",
      );
    }
    if (perPodmiot)
      f6.push(`${inst.label}: anulacje rozbite na ${perPodmiot.rows.length} podmiotów — atrybucja imienna wymagana pytaniem 1 postanowienia.`);
  }

  // ── IV.4: pary wewnątrzgrupowe (metryka bez wymiaru instrumentu) ─────────
  const pary = tabelaParWewnatrzgrupowych(metrykiLaczne);
  if (pary) {
    wash4.push(pary);
    fWash.push(
      `Zidentyfikowano ${pary.rows.length} par podmiotów występujących po obu stronach tej samej transakcji ` +
        "(zestawienie obejmuje oba instrumenty łącznie — metryka par nie niesie wymiaru instrumentu).",
    );
  }
  fWash.push(
    "Wielkości sesyjne ustalono odrębnie dla każdego instrumentu; zestawień łącznych nie sporządzano, " +
      "ponieważ sumowanie wolumenów różnych papierów nie daje wielkości o znaczeniu ekonomicznym.",
  );

  if (wash4.length) await zapisz(c.id as string, "wash", "IV.4", "Wash trades", wash4, fWash);
  if (t6.length || f6.length) await zapisz(c.id as string, "layering", "IV.6", "Layering and spoofing", t6, f6);

  // ── IV.5 — fazy kursu PER INSTRUMENT (zamiast przeplotu z zestawu łącznego) ──
  const tFaz = tabelaFaz(fazy);
  if (tFaz) {
    const { data: pd } = await sb.from("subanalyses").select("data").eq("case_id", c.id).eq("kind", "pumpdump").maybeSingle();
    const stare = ((pd?.data as { tables?: unknown[] } | null)?.tables ?? []).filter(
      (x) => !String((x as { caption?: string }).caption ?? "").includes("Fazy zmiany kursu w podziale"),
    );
    const fPd = fazy.map(
      ({ label, fazy: f }) =>
        `${label}: faza wzrostowa ${f.pumpPct > 0 ? "+" : ""}${f.pumpPct.toLocaleString("pl-PL")} % ` +
        `(${f.kursPoczatkowy} → ${f.kursSzczyt} zł, szczyt ${f.dzienSzczytu}), faza spadkowa ` +
        `${f.dumpPct.toLocaleString("pl-PL")} % (do ${f.kursKoncowy} zł), zmiana łączna ` +
        `${f.lacznaPct > 0 ? "+" : ""}${f.lacznaPct.toLocaleString("pl-PL")} %.`,
    );
    fPd.push(
      "Fazy policzono odrębnie dla każdego instrumentu z jego własnego szeregu kursów zamknięcia; " +
        "wartości ustalone na zestawie łącznym obu walorów nie opisywały żadnego z nich.",
    );
    await zapisz(c.id as string, "pumpdump", "IV.5", "Pump and dump", [tFaz, ...stare], fPd);
    console.log(`✓ IV.5: fazy per instrument — ${fazy.map((x) => `${x.label} +${x.fazy.pumpPct}%`).join(", ")}`);
  }

  console.log(`✓ IV.4: ${wash4.length} tabel`);
  for (const f of fWash) console.log(`   • ${f.slice(0, 130)}`);
  console.log(`✓ IV.6: ${t6.length} tabel`);
  for (const f of f6) console.log(`   • ${f.slice(0, 150)}`);
}
main().catch((e) => {
  console.error("BŁĄD:", e.message);
  process.exit(1);
});
