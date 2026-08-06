// Składanie WEJŚCIA promptu redakcji rozdziałów IV (dziedzina GPW).
//
// DLACZEGO OSOBNO OD TRASY: to samo, co w dziedzinie bankowej (`wejscieBankowe`).
// Dopóki wejście powstawało wewnątrz trasy HTTP, redakcję dało się uruchomić tylko
// z przeglądarki po zalogowaniu — a każda weryfikacja na realnych aktach wymagała
// odtworzenia tej logiki w skrypcie. Odtworzona kopia rozjeżdża się z oryginałem
// przy pierwszej poprawce (tak zginęło pole `zrodla` w dziedzinie bankowej).
// Tutaj trasa i CLI (scripts/redakcja_iv.ts) wołają JEDNĄ funkcję.
import type { SupabaseClient } from "@supabase/supabase-js";

import { sessionFacts, type Metric } from "./build";
import type { IvRedactInput, IvRedactKind } from "./redact";

type Tbl = { caption?: string; head?: string[]; rows?: string[][] };
type Sub = { kind: string; title?: string | null; status?: string | null; chapter_no?: string | null; body_md?: string | null; data?: Record<string, unknown> | null };

/** Typy dokumentów pomijane w inwentarzu — inaczej model raportuje „N × UNKNOWN" jako lukę. */
const SKIP_TYPES = new Set(["UNKNOWN", "LITERATURA"]);

/** Tabela → tekst dla promptu. Limit wierszy chroni budżet, więc ucięcie MUSI być widoczne. */
function tabelaJakoTekst(t: Tbl, maksWierszy = 120): string | null {
  if (!t.head || !t.rows?.length) return null;
  const naglowek = t.caption ? `${t.caption.replace(/^Tabela\.\s*/, "")}:\n` : "";
  const wiersze = t.rows.slice(0, maksWierszy).map((r) => r.join(" | ")).join("\n");
  const ogon =
    t.rows.length > maksWierszy
      ? `\n[…] w tabeli jest ${t.rows.length} wierszy; powyżej pokazano ${maksWierszy}. ` +
        "Nie twierdź, że to komplet — odwołaj się do tabeli jako całości."
      : "";
  return `${naglowek}${t.head.join(" | ")}\n${wiersze}${ogon}`;
}

/**
 * Buduje wejście promptu dla rozdziału IV.x sprawy manipulacyjnej.
 *
 * Zwraca `null`, gdy subanalizy rozdziału nie ma — rozdział trzeba najpierw
 * wygenerować, a redakcja pustki napisałaby prozę bez pokrycia w danych.
 */
export async function wejscieIV(
  sb: SupabaseClient,
  id: string,
  chapter: IvRedactKind,
  ctx: {
    caseRow: { name: string; signature: string | null };
    subs: Sub[];
    metrics: Metric[];
    period: string | null;
  },
): Promise<IvRedactInput | null> {
  const sub = ctx.subs.find((s) => s.kind === chapter);
  if (!sub) return null;

  const many = (sub.data?.tables as Tbl[] | undefined) ?? [];
  const tbls: Tbl[] = many.length ? many : sub.data?.table ? [sub.data.table as Tbl] : [];
  const blocks = tbls.map((t) => tabelaJakoTekst(t)).filter((s): s is string => !!s);
  const tableText = blocks.length ? blocks.join("\n\n") : null;

  const { data: docsData } = await sb.from("documents").select("doc_type,rel_path").eq("case_id", id);
  const counts: Record<string, number> = {};
  for (const d of docsData ?? []) counts[d.doc_type as string] = (counts[d.doc_type as string] ?? 0) + 1;
  const inventory = Object.entries(counts)
    .filter(([k]) => !SKIP_TYPES.has(k))
    .map(([k, v]) => `${v} × ${k}`);

  // Aktywność/ESPI — datowane zdarzenia do cross-linku czasowego z sesjami.
  if (chapter === "aktywnosc" || chapter === "espi") {
    const ev = ctx.subs.find((s) => s.kind === "espi_events");
    const events =
      (ev?.data?.events as { date?: string; type?: string; subject?: string; content?: string; session?: string; chg?: number | null; vol?: number | null }[] | undefined) ?? [];
    if (events.length) {
      inventory.push(
        ...events.slice(0, 15).map(
          (e) =>
            `ESPI zdarzenie: ${e.date || "—"} — ${(e.type || "").trim()}${e.subject ? " — " + e.subject : ""}` +
            (e.content ? ` | treść: ${e.content}` : "") +
            (e.session
              ? ` | zbieżna sesja ${e.session}` +
                (e.chg != null ? `: zmiana kursu ${e.chg > 0 ? "+" : ""}${e.chg.toLocaleString("pl-PL")}%` : "") +
                (e.vol != null ? `, wolumen ${e.vol.toLocaleString("pl-PL")} szt` : "")
              : ""),
        ),
      );
    } else {
      // Rejestr raportów bez rozbicia na zdarzenia — wiersze tabeli espi_events.
      const rows = ((ev?.data?.table as Tbl | undefined)?.rows ?? []).slice(0, 15);
      if (rows.length) inventory.push(...rows.map((r) => `Raport ESPI/EBI: ${r.slice(0, 5).join(" | ")}`));
      else
        inventory.push(
          ...(docsData ?? [])
            .filter((d) => d.doc_type === "RAPORT_ESPI_EBI")
            .map((d) => "ESPI/EBI: " + String(d.rel_path).split("/").pop())
            .slice(0, 15),
        );
    }
  }

  // Ekofin — pozycje finansowe emitentów z wyciągu ze sprawozdań.
  if (chapter === "ekofin") {
    const fin = ctx.subs.find((s) => s.kind === "fin_stats");
    const items =
      (fin?.data as { items?: { issuer?: string; position?: string; period?: string; value?: string; unit?: string }[] } | null)?.items ?? [];
    inventory.push(
      ...items
        .slice(0, 24)
        .map((i) => `Dane finansowe: ${i.issuer ? i.issuer + " — " : ""}${i.position} ${i.period ?? ""}: ${i.value} ${i.unit ?? ""}`.trim()),
    );
  }

  // Relacje — osoby pełniące funkcje w wielu podmiotach (wyciąg KRS).
  if (chapter === "relacje") {
    const kb = ctx.subs.find((s) => s.kind === "krs_boards");
    const shared = (kb?.data?.shared as { name?: string; entities?: string[] }[] | undefined) ?? [];
    inventory.push(
      ...shared.slice(0, 15).map((sh) => `KRS — osoba w wielu podmiotach: ${sh.name} (${(sh.entities || []).join(", ")})`),
    );
  }

  const ivIntro = String(ctx.subs.find((s) => s.kind === "proza_i")?.body_md ?? "").slice(0, 500) || null;
  const sessDays = [
    ...new Set(
      tbls.map((t) => (t.caption ?? "").match(/w sesji (\d{4}-\d{2}-\d{2})/)?.[1]).filter((d): d is string => !!d),
    ),
  ].sort();

  return {
    kind: chapter,
    title: (sub.title as string) || chapter,
    caseName: ctx.caseRow.name,
    signature: ctx.caseRow.signature,
    period: ctx.period,
    caseIntro: ivIntro,
    tableText,
    findings: (sub.data?.findings ?? []) as string[],
    inventory,
    legalRefs: (sub.data?.legalRefs ?? []) as string[],
    sessionFacts: sessDays.length ? sessionFacts(ctx.metrics, sessDays) : undefined,
  };
}
