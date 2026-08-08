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
import { stabilny } from "@/lib/json-stabilny";
import { okresBadany, opisOkresu, wOknie as wOknieOkresu } from "@/lib/opinion/okres";
import { fazyKursu, instrumentySprawy, metrykiInstrumentu, tabelaFaz } from "@/lib/opinion/instrumenty";
import {
  tabelaAnulacjiPodmiotow,
  tabelaParWewnatrzgrupowych,
  tabelaSekwencji,
  tabelaSesjiLayering,
  tabelaFixingu,
  tabelaKoncentracji,
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

async function zapisz(
  id: string, kind: string, chapter_no: string, title: string, tables: unknown[], findings: string[], oOkresie?: string,
) {
  // ⚠️ PROZA PRZEŻYWA PRZELICZENIE. `body_md: ""` w upsercie kasował gotowe rozdziały
  // przy każdym powtórzeniu biegu — tak zniknęła zredagowana treść IV.4 i IV.6.
  // Prozę zachowujemy i ZNACZAMY jako opisującą poprzednie liczby, żeby biegły
  // wiedział, że wymaga ponownej redakcji.
  const { data: stara } = await sb
    .from("subanalyses").select("body_md,data").eq("case_id", id).eq("kind", kind).maybeSingle();
  const proza = String(stara?.body_md ?? "");
  // Znacznik reaguje na ZMIANĘ liczb, nie na sam fakt przeliczenia. Inaczej każdy bieg
  // (także powtórzony bez zmian) kazałby redagować rozdziały od nowa — a bramka przed
  // wydrukiem tonęłaby w alarmach, które nic nie znaczą.
  const d0 = (stara?.data ?? {}) as { tables?: unknown; findings?: unknown };
  const bezZmian =
    stabilny(d0.tables ?? null) === stabilny(tables) &&
    stabilny(d0.findings ?? null) === stabilny(oOkresie ? [...findings, oOkresie] : findings);
  const { error } = await sb.from("subanalyses").upsert(
    {
      case_id: id, kind, chapter_no, title, status: "szkic", body_md: proza,
      // Okres badany dopisujemy do KAŻDEGO rozdziału: liczby bez odcinka czasu,
      // którego dotyczą, nie dają się zweryfikować.
      data: {
        table: tables[0] ?? null, tables,
        findings: oOkresie ? [...findings, oOkresie] : findings,
        proza_sprzed_przeliczenia: proza.length > 0 && !bezZmian,
      },
    },
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
  // Okno z POSTANOWIENIA (konfiguracja kroku 4); flagi --od/--do tylko nadpisują.
  const okres = okresBadany((subs ?? []) as never, { od, do: doD });
  const wOknie = wOknieOkresu(okres);
  const metrykiLaczne = (await metrykiSprawy(c.id as string)).filter((m) => wOknie(m.session_day));

  const wash4: unknown[] = [];
  const fWash: string[] = [];
  const t6: unknown[] = [];
  const f6: string[] = [];
  const tFix: unknown[] = [];
  const fFix: string[] = [];
  const tKonc: unknown[] = [];
  const fKonc: string[] = [];
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

    // ── Fixing (zał. I lit. g) i koncentracja (lit. e) — też per instrument ──
    const tf = tabelaFixingu(m, 50);
    if (tf) {
      tFix.push({ ...tf, caption: `Tabela. ${inst.label} — ${tf.caption.replace(/^Tabela\.\s*/, "")}` });
      fFix.push(`${inst.label}: w ${tf.rows.length} sesjach podmioty z Grupy objęły co najmniej połowę wolumenu fixingu.`);
    } else {
      fFix.push(`${inst.label}: w żadnej sesji udział Grupy w wolumenie fixingu nie osiągnął 50 %.`);
    }
    const tk = tabelaKoncentracji(m, 50);
    if (tk) {
      tKonc.push({ ...tk, caption: `Tabela. ${inst.label} — ${tk.caption.replace(/^Tabela\.\s*/, "")}` });
      fKonc.push(`${inst.label}: w ${tk.rows.length} sesjach zlecenia Grupy skupiły się w oknie 15 minut na poziomie co najmniej 50 % wolumenu sesji.`);
    } else {
      fKonc.push(`${inst.label}: koncentracja zleceń w oknie 15 minut nie osiągnęła 50 % wolumenu w żadnej sesji.`);
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

  // Tabele ze źródła `obrot_miary` — patrz komentarz w scripts/aktywnosc_iv3.ts.
  const miary = ((subs ?? []).find((s) => s.kind === "obrot_miary")?.data as { tables?: unknown[] } | null)?.tables ?? [];
  const doIV4 = (miary as { caption: string }[]).filter((t) =>
    /obrót MIĘDZY podmiotami z Grupy w trzech miarach|średni odstęp między kolejnymi transakcjami/.test(t.caption),
  );
  wash4.push(...doIV4);
  if (doIV4.some((t) => /średni odstęp/.test(t.caption)))
    fWash.push(
      "Odstęp między kolejnymi transakcjami tej samej pary kupujący–sprzedający liczony jest w obrębie sesji " +
        "z arkusza transakcji; wartości poniżej sekundy oznaczają transakcje zawarte w tej samej sekundzie zegara. " +
        "Nie jest to czas realizacji zlecenia — tego z dostępnych plików ustalić się nie da.",
    );

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

  const wspolne =
    "Wielkości ustalono odrębnie dla każdego instrumentu; zestawień łącznych nie sporządzano, ponieważ " +
    "sumowanie wolumenów różnych papierów nie daje wielkości o znaczeniu ekonomicznym.";
  if (wash4.length) await zapisz(c.id as string, "wash", "IV.4", "Wash trades", wash4, fWash, opisOkresu(okres));
  if (tFix.length || fFix.length)
    await zapisz(c.id as string, "fixing", "IV", "Manipulacja na fixingu (marking the close)", tFix, [...fFix, wspolne], opisOkresu(okres));
  if (tKonc.length || fKonc.length)
    await zapisz(c.id as string, "concentration", "IV", "Koncentracja zleceń w krótkim odcinku sesji", tKonc, [...fKonc, wspolne], opisOkresu(okres));
  if (t6.length || f6.length) await zapisz(c.id as string, "layering", "IV.6", "Layering and spoofing", t6, f6, opisOkresu(okres));

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
    await zapisz(c.id as string, "pumpdump", "IV.5", "Pump and dump", [tFaz, ...stare], fPd, opisOkresu(okres));
    console.log(`✓ IV.5: fazy per instrument — ${fazy.map((x) => `${x.label} +${x.fazy.pumpPct}%`).join(", ")}`);
  }

  console.log(`✓ IV.4: ${wash4.length} tabel`);
  for (const f of fWash) console.log(`   • ${f.slice(0, 130)}`);
  console.log(`✓ fixing: ${tFix.length} tabel; koncentracja: ${tKonc.length} tabel`);
  for (const f of [...fFix, ...fKonc]) console.log(`   • ${f.slice(0, 130)}`);
  console.log(`✓ IV.6: ${t6.length} tabel`);
  for (const f of f6) console.log(`   • ${f.slice(0, 150)}`);
}
main().catch((e) => {
  console.error("BŁĄD:", e.message);
  process.exit(1);
});
