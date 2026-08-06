// Ekstrakcja wielkości ekonomiczno-finansowych emitenta ze sprawozdań w aktach.
//
// DLACZEGO W BIBLIOTECE, A NIE W TRASIE: logika żyła w app/cases/[id]/opinion/
// extract-fin/route.ts i dało się ją uruchomić wyłącznie z przeglądarki po
// zalogowaniu. Weryfikacja na realnych aktach wymagała odtwarzania jej w skrypcie,
// a odtworzona kopia rozjeżdża się przy pierwszej poprawce (ta sama awaria, przed
// którą chroni wspólne `wejscieBankowe` w dziedzinie bankowej).
//
// EVIDENCE-ONLY: model wyłącznie ODCZYTUJE wielkości wprost zapisane w dokumencie —
// nie liczy, nie sumuje, nie zaokrągla. Dynamikę (kw/kw, r/r) liczy silnik
// deterministyczny w lib/opinion/ekofin.ts.
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

import { klientLLM } from "@/lib/llm/klient";
import { keywordWindows, pdfText } from "@/lib/intake/pdf";

export type PozycjaFinansowa = {
  file: string;
  position: string;
  period: string;
  value: string;
  unit: string;
  /** Emitent, którego dotyczy pozycja — obowiązkowy przy wielu instrumentach. */
  issuer?: string;
};

export const SYSTEM_FIN =
  "Jesteś asystentem biegłego sądowego. Otrzymujesz fragmenty sprawozdań finansowych i raportów okresowych " +
  "emitenta z akt sprawy. Wyodrębnij WYŁĄCZNIE wielkości wprost zapisane w treści — dla pozycji: przychody netto " +
  "ze sprzedaży, zysk/strata z działalności operacyjnej, zysk/strata brutto, zysk/strata netto, suma bilansowa " +
  "(aktywa razem), kapitał własny, przepływy pieniężne netto — o ile występują. Dla każdej podaj okres " +
  "(np. '2017', '2016', 'I półrocze 2017', 'III kw. 2017'), wartość DOKŁADNIE jak w dokumencie (z separatorami), " +
  "jednostkę ('zł' albo 'tys. zł' — wg nagłówka tabeli) oraz EMITENTA, którego pozycja dotyczy (skrócona nazwa " +
  "ze sprawozdania, np. 'CSY S.A.'). " +
  "ZASADY BEZWZGLĘDNE: (1) nie przeliczaj, nie sumuj, nie zaokrąglaj — przepisuj; (2) pozycji nieobecnych nie " +
  "zwracaj; (3) gdy dokument podaje dane JEDNOSTKOWE i SKONSOLIDOWANE, bierz jednostkowe, a skonsolidowane " +
  "oznacz emitentem z dopiskiem '(Grupa)' — zmieszanie ich dałoby nieporównywalny szereg; " +
  '(4) Zwróć WYŁĄCZNIE JSON: {"items":[{"file":"","issuer":"","position":"","period":"","value":"","unit":""}]}';

const FIN_KW =
  /przychody\s+netto|zysk\s*\(strata\)|strata\s+netto|zysk\s+netto|suma\s+bilansowa|aktywa\s+razem|kapitał\s*(własny|\(fundusz\))|rachunek zysków|przepływy pieniężne|wybrane dane/gi;

/** Czy nazwa pliku wygląda na raport okresowy (sprawozdania bywają w załącznikach ESPI/EBI). */
export function czyOkresowy(nazwa: string): boolean {
  return /raport[-_ ]?za|kwarta|roczn|polrocz|półrocz|wyniki|sprawozdanie|wybrane[-_ ]?dane|jsf|ssf/i.test(nazwa);
}

export type WynikFinStats = {
  ok: boolean;
  powod?: string;
  plikow?: number;
  pozycji?: number;
  items?: PozycjaFinansowa[];
};

/**
 * Czyta sprawozdania z akt i zapisuje subanalizę `fin_stats`.
 *
 * Zwraca `ok:false` z powodem zamiast rzucać — wołający (trasa i CLI) mają
 * pokazać powód użytkownikowi, a nie ślad stosu.
 */
export async function wykonajFinStats(
  sb: SupabaseClient,
  id: string,
  maxPlikow = 8,
): Promise<WynikFinStats> {
  const { data: docsFin } = await sb
    .from("documents")
    .select("rel_path,storage_path")
    .eq("case_id", id)
    .eq("doc_type", "SPRAWOZDANIE_FIN")
    .limit(40);
  const { data: docsEspi } = await sb
    .from("documents")
    .select("rel_path,storage_path")
    .eq("case_id", id)
    .eq("doc_type", "RAPORT_ESPI_EBI")
    .limit(200);

  const kandydaci = [
    ...(docsFin ?? []),
    ...(docsEspi ?? []).filter((d) => czyOkresowy(String(d.rel_path).split("/").pop() ?? "")),
  ];
  const isPdf = (fn: string) => /\.pdf$/i.test(fn) && !/loader|ads|sodar|zrt_|jsapi|cookie|lookup|\.pobrane/i.test(fn);
  const widziane = new Set<string>();
  const uniq = kandydaci
    .filter((d) => {
      const fn = String(d.rel_path).split("/").pop() ?? "";
      if (!d.storage_path || !isPdf(fn) || widziane.has(fn)) return false;
      widziane.add(fn);
      return true;
    })
    .slice(0, maxPlikow);
  if (!uniq.length) return { ok: false, powod: "Brak sprawozdań finansowych (PDF) ze ścieżką w Storage." };

  const teksty: string[] = [];
  for (const d of uniq) {
    const fn = String(d.rel_path).split("/").pop() ?? "";
    try {
      const { data: blob, error } = await sb.storage.from("case-files").download(d.storage_path as string);
      if (error || !blob) {
        teksty.push(`### ${fn}\n[nie udało się pobrać pliku]`);
        continue;
      }
      const pelny = await pdfText(await blob.arrayBuffer(), 200_000);
      if (!pelny) {
        teksty.push(`### ${fn}\n[brak warstwy tekstowej — skan, wymaga OCR]`);
        continue;
      }
      teksty.push(`### ${fn}\n${keywordWindows(pelny, FIN_KW, 700, 9000)}`);
    } catch (e) {
      teksty.push(`### ${fn}\n[błąd odczytu PDF: ${(e as Error).message}]`);
    }
  }

  const msg = await klientLLM("ekstrakcja/finanse", { sprawa: id }).messages.create({
    model: "claude-opus-4-8",
    // Dwóch emitentów × 7 pozycji × kilka okresów × sprawozdania jednostkowe
    // i skonsolidowane — przy 6000 odpowiedź urywała się na sprawie ZASTAL.
    max_tokens: 14000,
    system: SYSTEM_FIN,
    messages: [
      {
        role: "user",
        content: `TREŚĆ SPRAWOZDAŃ/RAPORTÓW (nazwa pliku + fragment treści):\n${teksty.join("\n\n")}\n\nWyodrębnij wielkości zgodnie ze schematem JSON.`,
      },
    ],
  });
  if (msg.stop_reason === "max_tokens")
    return { ok: false, powod: "Odpowiedź modelu urwała się na limicie długości — ustalenia byłyby niepełne." };

  const raw = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .replace(/```json|```/g, "")
    .trim();
  const s = raw.indexOf("{");
  const e = raw.lastIndexOf("}");
  if (s < 0 || e <= s) return { ok: false, powod: "Model nie zwrócił danych w formacie JSON." };

  let parsed: { items?: PozycjaFinansowa[] };
  try {
    parsed = JSON.parse(raw.slice(s, e + 1)) as { items?: PozycjaFinansowa[] };
  } catch {
    return { ok: false, powod: `Odpowiedzi modelu (${raw.length} zn.) nie dało się odczytać jako danych.` };
  }
  // Ta sama wielkość pada w kilku dokumentach (sprawozdanie roczne, „wybrane dane",
  // raport kwartalny) — bez deduplikacji szereg dostawałby dwa identyczne punkty
  // i dynamika liczyłaby się „sama ze sobą" (0%), co wyglądałoby jak ustalenie.
  const widzianePozycje = new Set<string>();
  const items: PozycjaFinansowa[] = (Array.isArray(parsed.items) ? parsed.items : [])
    .filter((v) => v && v.position && v.value)
    .filter((v) => {
      const k = [v.issuer, v.position, v.period, v.value, v.unit]
        .map((x) => String(x ?? "").trim().toLowerCase())
        .join("|");
      if (widzianePozycje.has(k)) return false;
      widzianePozycje.add(k);
      return true;
    })
    .map((v) => ({
      file: String(v.file ?? "").split("/").pop() ?? "",
      issuer: String(v.issuer ?? "").trim() || undefined,
      position: String(v.position ?? "").trim(),
      period: String(v.period ?? "").trim(),
      value: String(v.value ?? "").trim(),
      unit: String(v.unit ?? "").trim(),
    }))
    .sort(
      (a, b) =>
        (a.issuer ?? "").localeCompare(b.issuer ?? "", "pl") ||
        a.position.localeCompare(b.position, "pl") ||
        a.period.localeCompare(b.period, "pl"),
    );

  const table = {
    caption: "Tabela. Wybrane dane ekonomiczno-finansowe emitentów (wyciąg ze sprawozdań w aktach)",
    head: ["Emitent", "Pozycja", "Okres", "Wartość", "Jednostka", "Źródło (plik)"],
    rows: items.map((v) => [v.issuer ?? "—", v.position, v.period || "—", v.value, v.unit || "—", v.file || "—"]),
  };
  const emitenci = [...new Set(items.map((v) => v.issuer).filter(Boolean))];
  const { error } = await sb.from("subanalyses").upsert(
    {
      case_id: id,
      kind: "fin_stats",
      chapter_no: "IV",
      title: "Dane finansowe emitentów (wyciąg ze sprawozdań)",
      status: "szkic",
      body_md:
        `Odczytano ${uniq.length} sprawozdań/raportów; wyodrębniono ${items.length} pozycji finansowych` +
        (emitenci.length ? ` dla ${emitenci.length} podmiotów: ${emitenci.join(", ")}` : "") + ".",
      data: {
        table,
        items,
        findings: [
          `Wyodrębniono ${items.length} pozycji finansowych ze sprawozdań w aktach` +
            (emitenci.length ? ` (${emitenci.join(", ")})` : "") + ".",
        ],
        legalRefs: [],
      },
    },
    { onConflict: "case_id,kind" },
  );
  if (error) return { ok: false, powod: `zapis subanalizy: ${error.message}` };
  return { ok: true, plikow: uniq.length, pozycji: items.length, items };
}
