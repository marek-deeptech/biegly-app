// POZYSKIWANIE PUBLICZNYCH SZEREGÓW DLA TORU BANKOWEGO — domknięcie luki nr 1
// audytu kroku Analiza EF: moduły tła wzorca MBR (V.A inflacja, V.C stopy,
// V.K surowce) oraz indeks sektora nie miały ŻADNEGO wejścia, bo /api/makro czyta
// wyłącznie DANE_RYNKOWE_SZEREG z akt — a sprawa SK Banku ma ich zero.
//
// WZORZEC PRZEPŁYWU = ekofin (tor GPW): pobierz z serwisu publicznego → zapisz
// CSV do Storage pod prefiksem sprawy → wiersz w `documents` z proweniencją
// „pozyskane przez biegłego" i URL-em źródła w opisie. Od tego momentu materiał
// jest CZĘŚCIĄ AKT POZYSKANYCH i liczy go istniejący silnik (/api/makro,
// /api/sygnaly) — ta trasa NICZEGO nie liczy sama.
//
// ⚠️ KURSY WALUTOWE ŚWIADOMIE POMINIĘTE (decyzja klienta 7.08.2026) — moduł V.B
// wzorca zostaje do pozyskania ręcznego, gdy sprawa ma wątek walutowy.
//
// ⚠️ STOOQ BRONI SIĘ WERYFIKACJĄ PRZEGLĄDARKI (JS) i limitem pobrań — wtedy
// przychodzi HTML zamiast CSV. Takiego „pliku" nie wolno zapisać do akt; błąd
// mówi, JAK pozyskać dane ręcznie (ta sama zasada co w ekofin). NBP (api.nbp.pl)
// jest otwartym API urzędowym i challenge'a nie ma.

import type { SupabaseClient } from "@supabase/supabase-js";

import { parsujStooqCsv } from "./ekofin";

const BUCKET = "case-files";

export type SeriaBankowa = {
  /** Ścieżka w aktach — nazwa pliku steruje slotem i etykietą w silniku makro. */
  rel: string;
  etykieta: string;
  zrodlo: { stooq: string; interwal: "d" | "m" } | { nbp: "cenyzlota" };
};

// Symbole stooq: cpiypl.m (CPI r/r Polska), intrpl.m (stopa referencyjna Polska),
// wig_banki (indeks sektorowy GPW), cl.f (ropa WTI). Nazwy PLIKÓW dobrane tak,
// żeby trafiały we frazy slotów silnika makro (inflacj/stop/wig/ropa|zloto).
export const SERIE_BANKOWE: SeriaBankowa[] = [
  { rel: "pozyskane/szeregi/inflacja_cpi_pl.csv", etykieta: "Inflacja CPI r/r (Polska)",
    zrodlo: { stooq: "cpiypl.m", interwal: "m" } },
  { rel: "pozyskane/szeregi/stopy_procentowe_pl.csv", etykieta: "Stopa referencyjna NBP",
    zrodlo: { stooq: "intrpl.m", interwal: "m" } },
  { rel: "pozyskane/szeregi/indeks_wig_banki.csv", etykieta: "Indeks WIG-banki",
    zrodlo: { stooq: "wig_banki", interwal: "d" } },
  { rel: "pozyskane/szeregi/surowce_ropa_wti.csv", etykieta: "Ropa naftowa WTI",
    zrodlo: { stooq: "cl.f", interwal: "d" } },
  { rel: "pozyskane/szeregi/surowce_zloto_nbp.csv", etykieta: "Złoto (NBP, PLN/g)",
    zrodlo: { nbp: "cenyzlota" } },
];

/** Ile lat tła przed dniem zdarzenia pozyskujemy z NBP (wzorzec MBR: ~1,5–2 lata
 *  wykresów przed zdarzeniem; bierzemy szerzej, ucięcie robi analiza). */
const LATA_TLA = 4;

const dodajLata = (iso: string, lata: number) => {
  const [r, m, d] = iso.split("-").map(Number);
  return `${r + lata}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

async function pobierzNbpZloto(od: string, doDnia: string): Promise<{ csv: string; punktow: number }> {
  // API NBP ogranicza zapytanie do 367 dni — tniemy zakres na roczne kawałki.
  // Kawałki nachodzą na siebie dniem granicznym; duplikaty zdejmuje mapa po dacie.
  const wiersze: string[] = [];
  let start = od;
  while (start < doDnia) {
    const rokDalej = dodajLata(start, 1);
    const koniec = rokDalej < doDnia ? rokDalej : doDnia;
    const url = `https://api.nbp.pl/api/cenyzlota/${start}/${koniec}?format=json`;
    const odp = await fetch(url, { headers: { Accept: "application/json" } });
    // 404 = brak notowań w zakresie (np. same dni wolne) — to nie jest błąd sieci.
    if (odp.ok) {
      const dane = (await odp.json()) as { data: string; cena: number }[];
      for (const p of dane) wiersze.push(`${p.data},${p.cena}`);
    } else if (odp.status !== 404) {
      throw new Error(`api.nbp.pl: HTTP ${odp.status} dla zakresu ${start}–${koniec}`);
    }
    if (koniec >= doDnia) break;
    start = koniec;
  }
  const unikalne = [...new Map(wiersze.map((w) => [w.split(",")[0], w])).values()].sort();
  return { csv: "Data,Cena zlota (PLN za 1 g)\n" + unikalne.join("\n") + "\n", punktow: unikalne.length };
}

export type WynikPozyskania = {
  pobrane: string[];
  istniejace: string[];
  bledy: string[];
};

/**
 * Pozyskuje komplet szeregów tła dla sprawy bankowej + opcjonalnie notowania
 * obligacji emitenta (odpowiednik CDS dla banku bez rynku CDS — luka nr 2 audytu;
 * SK Bank: obligacje BSW0424 na Catalyst).
 *
 * Pliki już pozyskane są POMIJANE (idempotencja) — usunięcie wiersza z `documents`
 * wymusza ponowne pobranie, dokładnie jak w ekofin.
 */
export async function pozyskajSzeregiBankowe(
  sb: SupabaseClient,
  caseId: string,
  opcje: { dzienZdarzenia?: string | null; obligacje?: string | null },
): Promise<WynikPozyskania> {
  const pobrane: string[] = [];
  const istniejace: string[] = [];
  const bledy: string[] = [];

  const dzis = new Date().toISOString().slice(0, 10);
  const doDnia = opcje.dzienZdarzenia && opcje.dzienZdarzenia <= dzis ? opcje.dzienZdarzenia : dzis;
  const od = dodajLata(doDnia, -LATA_TLA);

  const serie: SeriaBankowa[] = [...SERIE_BANKOWE];
  const obligacje = (opcje.obligacje ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (obligacje)
    serie.push({
      rel: `pozyskane/szeregi/obligacje_${obligacje}.csv`,
      etykieta: `Notowania obligacji ${obligacje.toUpperCase()} (Catalyst)`,
      zrodlo: { stooq: obligacje, interwal: "d" },
    });

  // Idempotencja PO NAZWIE PLIKU, nie po pełnej ścieżce: ręczny fallback
  // (scripts/ingest_pozyskane.py) kładzie pliki w pozyskane/<nazwa>, a trasa
  // w pozyskane/szeregi/<nazwa> — silnik i tak dopasowuje po nazwie, więc
  // ten sam szereg pod dwiema ścieżkami dublowałby tabele w opinii.
  const { data: znane } = await sb
    .from("documents")
    .select("rel_path")
    .eq("case_id", caseId)
    .like("rel_path", "pozyskane/%");
  const znaneNazwy = new Set((znane ?? []).map((d) => (d.rel_path as string).split("/").pop()));

  for (const s of serie) {
    if (znaneNazwy.has(s.rel.split("/").pop())) {
      istniejace.push(s.etykieta);
      continue;
    }
    try {
      let csv: string;
      let opisZrodla: string;
      let punktow: number;
      if ("nbp" in s.zrodlo) {
        const w = await pobierzNbpZloto(od, doDnia);
        if (w.punktow < 12) throw new Error(`api.nbp.pl zwróciło tylko ${w.punktow} notowań w zakresie ${od}–${doDnia}`);
        csv = w.csv;
        punktow = w.punktow;
        opisZrodla = `api.nbp.pl/api/cenyzlota (${od}–${doDnia})`;
      } else {
        const url = `https://stooq.pl/q/d/l/?s=${encodeURIComponent(s.zrodlo.stooq)}&i=${s.zrodlo.interwal}`;
        const odp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
        const tekst = await odp.text();
        if (/^\s*<!DOCTYPE|<html/i.test(tekst))
          throw new Error(
            "stooq wymaga przeglądarki (weryfikacja JS / limit pobrań). Pobierz ręcznie: " +
              `otwórz ${url} w przeglądarce, zapisz plik pod nazwą ${s.rel.split("/").pop()} ` +
              "i wgraj przez scripts/ingest_pozyskane.py (typ DANE_RYNKOWE_SZEREG)",
          );
        const { notowania } = parsujStooqCsv(tekst);
        if (notowania.length < 12)
          throw new Error(
            `stooq nie zwrócił szeregu (wierszy: ${notowania.length}) — sprawdź symbol ${s.zrodlo.stooq} albo limit pobrań`,
          );
        csv = tekst;
        punktow = notowania.length;
        opisZrodla = `stooq.pl (${url}; ${notowania[0].dzien}–${notowania[notowania.length - 1].dzien})`;
      }

      const up = await sb.storage
        .from(BUCKET)
        .upload(`${caseId}/${s.rel}`, new Blob([csv], { type: "text/csv" }), { upsert: true });
      if (up.error) throw new Error(up.error.message);
      const ins = await sb.from("documents").upsert(
        {
          case_id: caseId,
          rel_path: s.rel,
          storage_path: `${caseId}/${s.rel}`,
          doc_type: "DANE_RYNKOWE_SZEREG",
          opis: `${s.etykieta} — ${punktow} notowań [pozyskane przez biegłego: ${opisZrodla}]`,
          source: "biegły sądowy (pozyskane)",
          provenance: "wejście",
          warstwa_tekstu: "tekst",
          size_bytes: csv.length,
        },
        { onConflict: "case_id,rel_path" },
      );
      if (ins.error) throw new Error(ins.error.message);
      pobrane.push(s.etykieta);
    } catch (e) {
      bledy.push(`${s.etykieta}: ${(e as Error).message}`);
    }
  }
  return { pobrane, istniejace, bledy };
}
