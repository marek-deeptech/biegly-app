// Wykonanie KROKU 4 GPW: pobór notowań (stooq) do materiału pozyskanego
// i deterministyczne przeliczenie analizy ekonomiczno-finansowej emitenta.
//
// PODZIAŁ PRACY: liczy lib/opinion/ekofin.ts (czyste funkcje z testami parytetu
// wobec finału KM); tutaj jest wyłącznie I/O — pobór CSV, odczyt z Storage,
// zapis subanalizy `ekofin_dane`. Trasa HTTP i skrypt CLI wołają TE SAME funkcje.
//
// ⚠️ SEPARACJA DZIEDZIN: krok odmawia pracy poza sprawą `manipulacja_gpw` —
// tak jak warsztat bankowy odmawia poza `ryzyko_bankowe`.
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  dynamikaFin,
  indeks100,
  kontrastObrotu,
  mnoznikiWykazane,
  parsujStooqCsv,
  type NotowanieDzienne,
  type PozycjaFin,
} from "./ekofin";

export type KonfigEkofin = {
  /** Jeden instrument (wzorzec HubTech) — zachowane dla wstecznej zgodności. */
  emitent?: { ticker: string; nazwa?: string };
  /**
   * WIELE instrumentów — sprawa ZASTAL dotyczy CSY S.A. i RSY S.A.: rozdział IV.1
   * dostaje wtedy sekcję per spółka (kontrast, wykresy, indeks), jak tabele TREM.
   */
  emitenci?: { ticker: string; nazwa?: string }[];
  peers: { ticker: string; nazwa?: string }[];
  /** Okres badany (postanowienie); pusty → z metryk silnika (min/max session_day). */
  odBadany?: string | null;
  doBadany?: string | null;
  /** Data bazowa indeksu porównawczego (wzorzec KM: 1.01.2020 = 100). */
  bazaIndeksu?: string | null;
};

const BUCKET = "case-files";
const sciezkaStooq = (t: string) => `pozyskane/stooq_${t.toLowerCase()}_d.csv`;
const SCIEZKA_MNOZNIKI = "pozyskane/mnozniki_portali.csv";

/** Ticker bezpieczny dla URL/ścieżki — stooq używa małych liter i kropek (np. `zst`, `06n`). */
function czystyTicker(t: string): string {
  const c = t.trim().toLowerCase();
  if (!/^[a-z0-9.^-]{1,12}$/.test(c)) throw new Error(`niepoprawny ticker: „${t}”`);
  return c;
}

/**
 * Pobiera dzienne CSV ze stooq i zapisuje jako materiał POZYSKANY sprawy
 * (`pozyskane/stooq_<ticker>_d.csv`, documents: NOTOWANIA_REF z URL-em źródła).
 * Idempotentne po rel_path; plik jest walidowany parserem PRZED zapisem —
 * stooq przy przekroczeniu limitu zwraca stronę HTML, nie CSV, i taki „plik"
 * w aktach wyglądałby jak dane.
 */
export async function pobierzStooq(
  sb: SupabaseClient,
  id: string,
  tickery: string[],
): Promise<{ pobrane: string[]; istniejace: string[]; bledy: string[] }> {
  const pobrane: string[] = [];
  const istniejace: string[] = [];
  const bledy: string[] = [];
  const { data: znane } = await sb
    .from("documents")
    .select("rel_path")
    .eq("case_id", id)
    .like("rel_path", "pozyskane/stooq_%");
  const znaneRel = new Set((znane ?? []).map((d) => d.rel_path as string));

  for (const surowy of tickery) {
    let t: string;
    try {
      t = czystyTicker(surowy);
    } catch (e) {
      bledy.push((e as Error).message);
      continue;
    }
    const rel = sciezkaStooq(t);
    if (znaneRel.has(rel)) {
      istniejace.push(t);
      continue;
    }
    const url = `https://stooq.pl/q/d/l/?s=${encodeURIComponent(t)}&i=d`;
    try {
      const odp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      const tekst = await odp.text();
      // Stooq broni endpointu weryfikacją przeglądarki (JS) i limitem dziennym —
      // wtedy zamiast CSV przychodzi strona HTML. Takiego „pliku" nie wolno zapisać
      // do akt, a komunikat musi mówić, JAK pozyskać dane ręcznie.
      if (/^\s*<!DOCTYPE|<html/i.test(tekst))
        throw new Error(
          "stooq wymaga przeglądarki (weryfikacja JS / limit pobrań). Pobierz plik ręcznie: " +
            `otwórz ${url} w przeglądarce, zapisz CSV i wgraj go jako pozyskane/stooq_${t}_d.csv ` +
            "(scripts/ingest_pozyskane.py, typ NOTOWANIA_REF)",
        );
      const { notowania, uwagi } = parsujStooqCsv(tekst);
      if (notowania.length < 30)
        throw new Error(
          `stooq nie zwrócił danych dziennych (wierszy: ${notowania.length}${uwagi.length ? `; ${uwagi[0]}` : ""}) — ` +
            "sprawdź ticker albo limit pobrań serwisu",
        );
      const up = await sb.storage
        .from(BUCKET)
        .upload(`${id}/${rel}`, new Blob([tekst], { type: "text/csv" }), { upsert: true });
      if (up.error) throw new Error(up.error.message);
      const ins = await sb.from("documents").upsert(
        {
          case_id: id,
          rel_path: rel,
          storage_path: `${id}/${rel}`,
          doc_type: "NOTOWANIA_REF",
          opis:
            `Notowania dzienne ${t.toUpperCase()} (stooq.pl, ${notowania[0].dzien}–${notowania[notowania.length - 1].dzien}, ` +
            `${notowania.length} sesji) [pozyskane przez biegłego: ${url}]`,
          source: "biegły sądowy (pozyskane)",
          provenance: "wejście",
          warstwa_tekstu: "tekst",
          size_bytes: tekst.length,
        },
        { onConflict: "case_id,rel_path" },
      );
      if (ins.error) throw new Error(ins.error.message);
      pobrane.push(t);
    } catch (e) {
      bledy.push(`${t}: ${(e as Error).message}`);
    }
  }
  return { pobrane, istniejace, bledy };
}

async function csvZeStorage(sb: SupabaseClient, id: string, rel: string): Promise<string | null> {
  const { data } = await sb.storage.from(BUCKET).download(`${id}/${rel}`);
  return data ? await data.text() : null;
}

/**
 * Notowania instrumentu Z AKT — fallback, gdy stooq nie został jeszcze pozyskany.
 *
 * Subanalizy `trem_<ticker>` niosą per-instrument metryki silnika (day_open/high/
 * low/close, day_sess_vol) policzone z arkusza UTP/TREM. To pokrywa OKRES AKT
 * (w ZASTAL: 203 sesje wokół okresu badanego), więc wystarcza na wykres kursu
 * i wolumenu okresu — ale NIE na kontrast od debiutu, który wymaga pełnej
 * historii ze stooq. Źródło jest zapisywane przy wykresie, bo „akta sprawy”
 * i „stooq.pl” to różne podstawy dowodowe.
 */
async function notowaniaZTrem(
  sb: SupabaseClient,
  id: string,
  ticker: string,
): Promise<NotowanieDzienne[] | null> {
  const { data: sub } = await sb
    .from("subanalyses")
    .select("data")
    .eq("case_id", id)
    .eq("kind", `trem_${ticker}`)
    .maybeSingle();
  const ms =
    ((sub?.data as { metrics?: { key: string; session_day?: string | null; value: number | null }[] } | null)
      ?.metrics ?? []);
  const wg = new Map<string, Partial<NotowanieDzienne> & { dzien: string }>();
  const POLA: Record<string, keyof NotowanieDzienne> = {
    day_open: "otwarcie", day_high: "najwyzszy", day_low: "najnizszy",
    day_close: "zamkniecie", day_sess_vol: "wolumen",
  };
  for (const m of ms) {
    const pole = POLA[m.key];
    if (!pole || !m.session_day || m.value == null) continue;
    const w = wg.get(m.session_day) ?? { dzien: m.session_day };
    (w as Record<string, unknown>)[pole] = m.value;
    wg.set(m.session_day, w);
  }
  const notowania = [...wg.values()]
    .filter((w) => w.zamkniecie != null)
    .map((w) => ({
      dzien: w.dzien,
      otwarcie: w.otwarcie ?? null,
      najwyzszy: w.najwyzszy ?? null,
      najnizszy: w.najnizszy ?? null,
      zamkniecie: w.zamkniecie as number,
      wolumen: w.wolumen ?? null,
    }))
    .sort((a, b) => a.dzien.localeCompare(b.dzien));
  return notowania.length ? notowania : null;
}

type Tabela = { caption: string; head: string[]; rows: string[][] };
type SeriaWykresu = { label: string; unit: string; values: (number | null)[]; kind: "line" | "bars" };
type WykresEkofin = { title: string; days: string[]; left: SeriaWykresu; right?: SeriaWykresu };

const pl = (v: number | null | undefined, u = "") =>
  v == null ? "—" : `${v.toLocaleString("pl-PL", { maximumFractionDigits: 2 })}${u ? ` ${u}` : ""}`;

export type WynikEkofin = {
  ok: boolean;
  powod?: string;
  tabel?: number;
  wykresow?: number;
  findings?: string[];
  doPozyskania?: string[];
};

/** Przelicza krok 4 i zapisuje subanalizę `ekofin_dane`. */
export async function wykonajEkofin(
  sb: SupabaseClient,
  id: string,
  cfg: KonfigEkofin,
): Promise<WynikEkofin> {
  const { data: caseRow } = await sb.from("cases").select("name,typ").eq("id", id).single();
  if (!caseRow) return { ok: false, powod: "nie znaleziono sprawy" };
  if (caseRow.typ !== "manipulacja_gpw")
    return { ok: false, powod: "krok 4 (ekonomia emitenta) dotyczy spraw o manipulację GPW" };

  const emitenci = (cfg.emitenci?.length ? cfg.emitenci : cfg.emitent ? [cfg.emitent] : []).map((e) => ({
    ticker: czystyTicker(e.ticker),
    nazwa: e.nazwa,
  }));
  if (!emitenci.length) return { ok: false, powod: "podaj co najmniej jeden instrument (emitenci)" };
  const peers = cfg.peers.map((p) => ({ ...p, ticker: czystyTicker(p.ticker) }));

  // Okres badany: z konfiguracji, a bez niej — z metryk silnika (sesje objęte analizą).
  let odBadany = cfg.odBadany ?? null;
  let doBadany = cfg.doBadany ?? null;
  if (!odBadany || !doBadany) {
    const { data: mdni } = await sb
      .from("metrics")
      .select("session_day")
      .eq("case_id", id)
      .not("session_day", "is", null)
      .order("session_day", { ascending: true });
    const dni = [...new Set((mdni ?? []).map((m) => m.session_day as string))];
    if (!dni.length)
      return { ok: false, powod: "brak okresu badanego: podaj go w konfiguracji albo policz najpierw metryki silnika" };
    odBadany = odBadany ?? dni[0];
    doBadany = doBadany ?? dni[dni.length - 1];
  }

  const doPozyskania: string[] = [];
  const uwagi: string[] = [];
  const findings: string[] = [];
  const tables: Tabela[] = [];
  const charts: WykresEkofin[] = [];
  const zrodla: string[] = [];

  // ── spółki porównawcze (wspólne dla wszystkich instrumentów) ─────────────
  const seriePeers: { ticker: string; nazwa?: string; notowania: NotowanieDzienne[] }[] = [];
  for (const p of peers) {
    const csv = await csvZeStorage(sb, id, sciezkaStooq(p.ticker));
    if (!csv) {
      doPozyskania.push(`notowania spółki porównawczej ${p.ticker.toUpperCase()} (stooq)`);
      continue;
    }
    seriePeers.push({ ticker: p.ticker.toUpperCase(), nazwa: p.nazwa, notowania: parsujStooqCsv(csv).notowania });
    zrodla.push(sciezkaStooq(p.ticker));
  }
  if (!peers.length)
    doPozyskania.push("lista spółek porównawczych (tickery stooq) — do wskazania przez biegłego");

  // ── sekcja per instrument (wzorzec IV.1; ZASTAL: CSY i RSY osobno) ───────
  for (const em of emitenci) {
    const nazwaEm = em.nazwa ?? em.ticker.toUpperCase();
    const csvEm = await csvZeStorage(sb, id, sciezkaStooq(em.ticker));
    let notEm: NotowanieDzienne[] = [];
    let zrodloNotowan = "stooq.pl (pozyskane)";
    if (csvEm) {
      const p = parsujStooqCsv(csvEm);
      notEm = p.notowania;
      uwagi.push(...p.uwagi.map((u) => `${em.ticker}: ${u}`));
      zrodla.push(sciezkaStooq(em.ticker));
    } else {
      doPozyskania.push(
        `notowania dzienne ${nazwaEm} od debiutu — przycisk „Pobierz notowania” albo ręcznie stooq.pl/q/d/l/?s=${em.ticker}&i=d ` +
          "(bez nich brak kontrastu z historią sprzed okresu badanego)",
      );
      const zTrem = await notowaniaZTrem(sb, id, em.ticker);
      if (zTrem) {
        notEm = zTrem;
        zrodloNotowan = "akta sprawy (arkusz UTP/TREM — metryki silnika)";
        uwagi.push(
          `${nazwaEm}: notowania z akt obejmują ${zTrem.length} sesji (${zTrem[0].dzien}–${zTrem[zTrem.length - 1].dzien}) — ` +
            "wystarczają na wykres okresu, nie na kontrast od debiutu",
        );
      }
    }
    if (!notEm.length) continue;

    // Kontrast od debiutu — tylko przy pełnej historii (stooq).
    if (csvEm) {
      const k = kontrastObrotu(notEm, odBadany, doBadany);
      if (k && k.przed.dniSesyjnych > 0) {
        tables.push({
          caption:
            `Tabela. ${nazwaEm} — kontrast obrotu: okres historyczny od debiutu wobec okresu objętego ` +
            "postanowieniem (wartość obrotu liczona wg kursów zamknięcia)",
          head: ["Okres", "Od", "Do", "Dni sesyjnych", "Średni dzienny wolumen [szt.]", "Średnia dzienna wartość obrotu [zł]"],
          rows: [
            ["historyczny", k.przed.od, k.przed.do, String(k.przed.dniSesyjnych), pl(k.przed.sredniWolumen), pl(k.przed.sredniaWartoscObrotu)],
            ["badany", k.badany.od, k.badany.do, String(k.badany.dniSesyjnych), pl(k.badany.sredniWolumen), pl(k.badany.sredniaWartoscObrotu)],
          ],
        });
        if (k.krotnoscWolumenu != null)
          findings.push(
            `${nazwaEm}: średni dzienny wolumen w okresie badanym (${pl(k.badany.sredniWolumen, "szt.")}) był ` +
              `${pl(k.krotnoscWolumenu)}-krotnie wyższy niż średnia wcześniejszej historii notowań ` +
              `(${k.przed.dniSesyjnych} sesji od ${k.przed.od}: ${pl(k.przed.sredniWolumen, "szt.")}).`,
          );
      }
      // Wykres 1 wzorca: kurs + wolumen w pełnej historii (spróbkowany).
      const ixPelny = indeks100({ ticker: em.ticker, notowania: notEm }, [], notEm[0].dzien);
      if (ixPelny) {
        const wgDnia = new Map(notEm.map((x) => [x.dzien, x]));
        charts.push({
          title: `Kształtowanie się kursu i wolumenu obrotu akcjami ${nazwaEm} od debiutu (${notEm[0].dzien})`,
          days: ixPelny.dni,
          left: { label: "Kurs zamknięcia", unit: "zł", values: ixPelny.dni.map((d) => wgDnia.get(d)?.zamkniecie ?? null), kind: "line" },
          right: { label: "Wolumen", unit: "szt", values: ixPelny.dni.map((d) => wgDnia.get(d)?.wolumen ?? null), kind: "bars" },
        });
        uwagi.push(...ixPelny.uwagi.map((u) => `${em.ticker}: ${u}`));
      }
    }

    // Wykres 4 wzorca: okres badany dzień po dniu, bez próbkowania — źródło jawne.
    const badane = notEm.filter((x) => x.dzien >= odBadany! && x.dzien <= doBadany!);
    if (badane.length)
      charts.push({
        title: `${nazwaEm} — kurs i wolumen w okresie objętym postanowieniem (${odBadany}–${doBadany}); źródło: ${zrodloNotowan}`,
        days: badane.map((x) => x.dzien),
        left: { label: "Kurs zamknięcia", unit: "zł", values: badane.map((x) => x.zamkniecie), kind: "line" },
        right: { label: "Wolumen", unit: "szt", values: badane.map((x) => x.wolumen), kind: "bars" },
      });

    // Indeks porównawczy — pełna historia (stooq) + peers.
    if (csvEm && seriePeers.length) {
      const baza = cfg.bazaIndeksu ?? odBadany;
      const ix = indeks100({ ticker: em.ticker.toUpperCase(), notowania: notEm }, seriePeers, baza!);
      if (ix) {
        charts.push({
          title: `${nazwaEm} na tle mediany spółek porównawczych (${ix.bazaDzien} = 100)`,
          days: ix.dni,
          left: { label: nazwaEm, unit: "pkt", values: ix.emitent, kind: "line" },
          right: { label: `mediana: ${seriePeers.map((p) => p.ticker).join(", ")}`, unit: "pkt", values: ix.medianaPeers, kind: "line" },
        });
        const ost = ix.dni.length - 1;
        findings.push(
          `${nazwaEm}: indeks (${ix.bazaDzien} = 100) na koniec okresu ${pl(ix.emitent[ost], "pkt")} wobec mediany ` +
            `spółek porównawczych ${pl(ix.medianaPeers[ost], "pkt")}.`,
        );
        const koniecMies = ix.dni.filter((d, i) => i === ix.dni.length - 1 || ix.dni[i + 1]?.slice(0, 7) !== d.slice(0, 7));
        tables.push({
          caption: `Tabela. ${nazwaEm} — indeks porównawczy na koniec kolejnych miesięcy (${ix.bazaDzien} = 100)`,
          head: ["Miesiąc", nazwaEm, "Mediana branży", ...ix.perPeer.map((p) => p.ticker)],
          rows: koniecMies.map((d) => {
            const i = ix.dni.indexOf(d);
            return [d.slice(0, 7), pl(ix.emitent[i]), pl(ix.medianaPeers[i]), ...ix.perPeer.map((p) => pl(p.wartosci[i]))];
          }),
        });
        uwagi.push(...ix.uwagi.map((u) => `${em.ticker}: ${u}`));
      }
    }
  }

  // ── dynamika pozycji sprawozdawczych (z ekstrakcji fin_stats) ─────────────
  const { data: fin } = await sb
    .from("subanalyses")
    .select("data")
    .eq("case_id", id)
    .eq("kind", "fin_stats")
    .maybeSingle();
  const items = ((fin?.data as { items?: PozycjaFin[] } | null)?.items ?? []) as PozycjaFin[];
  if (items.length) {
    const dyn = dynamikaFin(items);
    if (dyn.table) {
      tables.push(dyn.table);
      findings.push(
        `Dynamika pozycji sprawozdawczych: policzono zmiany dla ${new Set(dyn.table.rows.map((r) => r[0])).size} pozycji ` +
          `w ${dyn.table.rows.length} okresach (źródło: sprawozdania/raporty okresowe w aktach — subanaliza fin_stats).`,
      );
    }
    uwagi.push(...dyn.uwagi);
  } else {
    doPozyskania.push("pozycje sprawozdawcze emitenta — uruchom „Ekstrakcję finansów” (fin_stats) na sprawozdaniach z akt");
  }

  // ── wskaźniki wykazane przez portale ──────────────────────────────────────
  const csvMn = await csvZeStorage(sb, id, SCIEZKA_MNOZNIKI);
  if (csvMn) {
    const mn = mnoznikiWykazane(csvMn);
    if (mn.table) {
      tables.push(mn.table);
      zrodla.push(SCIEZKA_MNOZNIKI);
      findings.push(`Wskaźniki wartości rynkowej: ${mn.table.rows.length} pozycji WYKAZANYCH przez serwisy (z medianą branży).`);
    }
    uwagi.push(...mn.uwagi);
  } else {
    doPozyskania.push(
      `wskaźniki portali (C/Z, C/WK, C/P, EV/P + mediana branży) — plik ${SCIEZKA_MNOZNIKI} ` +
        "(kolumny: wskaznik,emitent,mediana_branzy,na_dzien,zrodlo; odczyt ze stooq/StockWatch/BiznesRadar)",
    );
  }

  const { error } = await sb.from("subanalyses").upsert(
    {
      case_id: id,
      kind: "ekofin_dane",
      chapter_no: "IV",
      title: "Analiza ekonomiczno-finansowa emitenta — dane (krok 4)",
      status: "szkic",
      body_md: "",
      data: {
        config: { ...cfg, emitenci, emitent: undefined, odBadany, doBadany },
        table: tables[0] ?? null,
        tables,
        charts,
        findings,
        ...(doPozyskania.length ? { doPozyskania } : {}),
        ...(uwagi.length ? { uwagi } : {}),
        zrodla,
      },
    },
    { onConflict: "case_id,kind" },
  );
  if (error) return { ok: false, powod: `zapis subanalizy: ${error.message}` };

  return { ok: true, tabel: tables.length, wykresow: charts.length, findings, doPozyskania };
}
