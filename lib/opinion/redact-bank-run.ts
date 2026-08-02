// Redakcja rozdziałów bankowych — uruchomienie WSADOWE, poza trasą HTTP.
//
// DLACZEGO OSOBNO OD TRASY:
// Trasa redaguje JEDEN rozdział na żądanie z przeglądarki i zwraca tekst klientowi,
// który go zapisuje. Opinia bankowa ma dziewięć modułów rozdziału V — dziewięć
// kliknięć po ~2 minuty, bez możliwości sprawdzenia całości przed zapisem. Tutaj
// idą równolegle, a wynik zapisujemy od razu.
//
// WEJŚCIE PROMPTU SKŁADA `wejscieBankowe` — ta sama czysta funkcja, której używa
// trasa. To nie jest ozdoba: gdy trasa składała wejście u siebie, a skrypt
// odtwarzał je po swojemu, dodanie pola `zrodla` (po którym model przestał
// przypisywać sprawozdania kontrahenta oskarżonemu bankowi) rozjechało obie kopie.
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

import { przepisyAnachroniczne, przepisyNaDzien } from "@/lib/domain/prawo-bankowe";

import { buildStyleCorpus } from "./korekty";
import {
  BANK_REDACT_KINDS,
  buildBankRedactPrompt,
  type BankRedactKind,
  wejscieBankowe,
} from "./redact-bank";
import { buildWiedzaBlock } from "./wiedza";
import { buildBankWnioskiPrompt, materialWnioskow } from "./wnioski-bank";
import { buildWzorzecBlock } from "./wzorce";

export type WynikRedakcji = {
  kind: string;
  ok: boolean;
  znakow: number;
  akapitow: number;
  powod?: string;
};

/** Rozdziały bankowe do redakcji, w kolejności występowania w opinii. */
export const ROZDZIALY_BANKOWE = [...BANK_REDACT_KINDS] as const;

async function jedenRozdzial(
  sb: SupabaseClient,
  id: string,
  kind: BankRedactKind,
  ctx: {
    caseRow: { name: string; signature: string | null; typ: string | null };
    subs: { kind: string; title: string; data?: Record<string, unknown> | null }[];
    licznikTypow: Record<string, number>;
  },
): Promise<WynikRedakcji> {
  const sub = ctx.subs.find((s) => s.kind === kind);
  if (!sub) return { kind, ok: false, znakow: 0, akapitow: 0, powod: "brak subanalizy — wykonaj Krok 3/4" };

  const p = buildBankRedactPrompt(
    wejscieBankowe({
      kind,
      sub,
      caseRow: ctx.caseRow,
      subs: ctx.subs,
      licznikTypow: ctx.licznikTypow,
      przepisyNaDzien,
      przepisyAnachroniczne,
    }),
  );
  // Wiedza, wzorzec stylu i korekty biegłego — dokładnie jak w trasie.
  const [wiedza, wzorzec, styl] = await Promise.all([
    buildWiedzaBlock(sb, kind, ctx.caseRow.typ),
    buildWzorzecBlock(sb, kind),
    buildStyleCorpus(sb, kind),
  ]);
  const msg = await new Anthropic().messages.create({
    model: "claude-opus-4-8",
    // 6–12 akapitów gęstej analizy z omówieniem tabeli okres po okresie.
    max_tokens: 5500,
    system: [p.system, wiedza, wzorzec, styl].filter(Boolean).join("\n\n"),
    messages: [{ role: "user", content: p.user }],
  });
  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  // Urwana odpowiedź NIE jest tekstem rozdziału — zapisana wyglądałaby jak gotowa
  // proza, a kończyłaby się w połowie zdania kilkanaście stron dalej w dokumencie.
  if (msg.stop_reason === "max_tokens")
    return { kind, ok: false, znakow: text.length, akapitow: 0, powod: "odpowiedź urwana na limicie długości" };
  if (!text) return { kind, ok: false, znakow: 0, akapitow: 0, powod: "model nie zwrócił treści" };

  await sb.from("subanalyses").update({ body_md: text, status: "szkic" }).eq("case_id", id).eq("kind", kind);
  return { kind, ok: true, znakow: text.length, akapitow: text.split(/\n\n+/).length };
}

/**
 * Redaguje wskazane rozdziały bankowe (domyślnie wszystkie) i zapisuje `body_md`.
 *
 * Status zostaje `szkic` — zatwierdza biegły. Redakcja wsadowa ma przyspieszyć
 * pisanie, a nie ominąć jego decyzję.
 */
export async function zredagujRozdzialyBankowe(
  sb: SupabaseClient,
  id: string,
  ktore: readonly BankRedactKind[] = ROZDZIALY_BANKOWE,
): Promise<WynikRedakcji[]> {
  // `select("*")`, a nie lista kolumn: `tryb` przychodzi migracją 0014 i do czasu jej
  // uruchomienia nazwany SELECT zwracałby 400, psując redakcję we WSZYSTKICH sprawach.
  const { data: caseRow } = await sb.from("cases").select("*").eq("id", id).single();
  if (!caseRow) throw new Error("Nie znaleziono sprawy.");
  if (caseRow.typ !== "ryzyko_bankowe") throw new Error("Redakcja bankowa dotyczy spraw o ryzyko bankowe.");

  const { data: subs } = await sb.from("subanalyses").select("kind,title,data").eq("case_id", id);
  const { data: docs } = await sb.from("documents").select("doc_type").eq("case_id", id);
  const licznikTypow: Record<string, number> = {};
  for (const d of docs ?? []) licznikTypow[d.doc_type as string] = (licznikTypow[d.doc_type as string] ?? 0) + 1;

  const ctx = { caseRow: caseRow as never, subs: (subs ?? []) as never, licznikTypow };
  return Promise.all(ktore.map((k) => jedenRozdzial(sb, id, k, ctx)));
}

/** Wnioski (rozdz. III) dziedziny bankowej — osobno, bo stoją na WSZYSTKICH modułach. */
export async function zredagujWnioskiBankowe(sb: SupabaseClient, id: string): Promise<WynikRedakcji> {
  const { data: caseRow } = await sb.from("cases").select("*").eq("id", id).single();
  const { data: subs } = await sb.from("subanalyses").select("kind,title,data,body_md").eq("case_id", id);
  const lista = (subs ?? []) as { kind: string; data?: Record<string, unknown> | null }[];
  const dzien =
    (lista.find((s) => s.kind === "limity")?.data as { dzienZdarzenia?: string | null } | undefined)
      ?.dzienZdarzenia ?? null;
  const pytania =
    ((lista.find((s) => s.kind === "pytania_organu")?.data as { questions?: string[] } | undefined)?.questions ?? [])
      .map((q) => String(q).trim())
      .filter(Boolean);
  const p = buildBankWnioskiPrompt({
    caseName: (caseRow as { name: string }).name,
    signature: (caseRow as { signature: string | null }).signature,
    dzienZdarzenia: dzien,
    pytania,
    material: materialWnioskow(lista as never, dzien),
    tryb: (caseRow as { tryb?: string | null }).tryb ?? null,
  });
  const [wiedza, wzorzec, styl] = await Promise.all([
    buildWiedzaBlock(sb, "wnioski", (caseRow as { typ: string | null }).typ),
    buildWzorzecBlock(sb, "wnioski"),
    buildStyleCorpus(sb, "wnioski"),
  ]);
  const msg = await new Anthropic().messages.create({
    model: "claude-opus-4-8",
    max_tokens: 6500,
    system: [p.system, wiedza, wzorzec, styl].filter(Boolean).join("\n\n"),
    messages: [{ role: "user", content: p.user }],
  });
  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (msg.stop_reason === "max_tokens")
    return { kind: "wnioski", ok: false, znakow: text.length, akapitow: 0, powod: "odpowiedź urwana" };
  if (!text) return { kind: "wnioski", ok: false, znakow: 0, akapitow: 0, powod: "model nie zwrócił treści" };
  await sb.from("subanalyses").update({ body_md: text, status: "szkic" }).eq("case_id", id).eq("kind", "wnioski");
  return { kind: "wnioski", ok: true, znakow: text.length, akapitow: text.split(/\n\n+/).length };
}
