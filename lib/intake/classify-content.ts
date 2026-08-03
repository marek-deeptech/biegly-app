// Klasyfikacja dokumentu z TREŚCI (OCR) — dla akt skanowanych (ZASTAL), gdzie nazwa
// pliku (SKM_C451i…) nic nie mówi. Model rozpoznaje TYP dokumentu i WYTWÓRCĘ na
// podstawie nagłówka, pieczęci, podpisów, sygnatur. Evidence-only: zwraca też krótkie
// uzasadnienie (zacytowany fragment) i — jeśli widoczny — numer karty akt.
import Anthropic from "@anthropic-ai/sdk";
import { klientLLM } from "@/lib/llm/klient";

import { AUTHORS, DOC_TYPES } from "./taxonomy";

export type ContentClass = {
  doc_type: string; // kod z DOC_TYPES
  wytworca: string; // kod z AUTHORS
  karta_start: number | null; // nr karty akt (prawy górny róg 1. strony), jeśli czytelny
  reason: string; // krótkie uzasadnienie z cytatem
};

const DOC_LIST = Object.entries(DOC_TYPES)
  .map(([k, v]) => `  ${k} — ${v.label} (źródło typowe: ${v.source})`)
  .join("\n");
const AUTHOR_LIST = Object.entries(AUTHORS)
  .sort((a, b) => a[1].order - b[1].order)
  .map(([k, v]) => `  ${k} — ${v.label}`)
  .join("\n");

const SYSTEM =
  "Jesteś asystentem biegłego sądowego. Klasyfikujesz zeskanowany dokument z akt sprawy " +
  "karnej o manipulację giełdową (spółki CSY/RSY, sprawa ZASTAL). Masz surowy tekst OCR " +
  "(może być zaszumiony). Ustal DWA wymiary: (1) TYP dokumentu, (2) WYTWÓRCA — kto go " +
  "sporządził/podpisał (nagłówek instytucji, pieczęć, podpis, sygnatura). Jeśli w prawym " +
  "górnym rogu widnieje odręczny/pieczątkowy numer karty akt — podaj go jako karta_start.\n\n" +
  "TYPY (kod — opis):\n" + DOC_LIST + "\n\nWYTWÓRCY (kod — opis):\n" + AUTHOR_LIST + "\n\n" +
  "Zasady: opinia dr. Jarosława Kozłowskiego = doc_type OPINIA_BIEGLY_PROK, wytworca BIEGLY_PROK. " +
  "Postanowienie o dopuszczeniu dowodu z opinii / powołaniu biegłego = POSTANOWIENIE (prokuratura/policja) " +
  "lub POSTANOWIENIE_SAD (sąd). Zawiadomienie KNF o podejrzeniu przestępstwa = ZAWIADOMIENIE_KNF, KNF. " +
  "Umowy/zestawienia z domu maklerskiego = DANE_BROKERSKIE, DM_BROKER. Gdy niepewne — wybierz " +
  "najbliższy typ i UNKNOWN tylko w ostateczności. Odpowiadasz WYŁĄCZNIE wywołaniem narzędzia.";

const TOOL: Anthropic.Tool = {
  name: "klasyfikuj",
  description: "Zwraca klasyfikację dokumentu (typ + wytwórca + nr karty + uzasadnienie).",
  input_schema: {
    type: "object",
    properties: {
      doc_type: { type: "string", enum: Object.keys(DOC_TYPES) },
      wytworca: { type: "string", enum: Object.keys(AUTHORS) },
      karta_start: { type: ["integer", "null"], description: "nr karty akt z prawego górnego rogu 1. strony, albo null" },
      reason: { type: "string", description: "1 zdanie: co przesądza (z krótkim cytatem z OCR)" },
    },
    required: ["doc_type", "wytworca", "karta_start", "reason"],
  },
};

export async function classifyByContent(
  ocrText: string,
  fileName: string,
  opts: { model?: string; apiKey?: string } = {},
): Promise<ContentClass> {
  const client = klientLLM("klasyfikacja-tresci", { apiKey: opts.apiKey ?? process.env.ANTHROPIC_API_KEY });
  const head = ocrText.slice(0, 4500); // nagłówek/pieczęć/podpis są na początku
  const msg = await client.messages.create({
    model: opts.model ?? "claude-haiku-4-5-20251001",
    max_tokens: 400,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: "tool", name: "klasyfikuj" },
    messages: [
      {
        role: "user",
        content: `Nazwa pliku: ${fileName}\n\n=== TEKST OCR (początek) ===\n${head}`,
      },
    ],
  });
  const use = msg.content.find((c): c is Anthropic.ToolUseBlock => c.type === "tool_use");
  const j = (use?.input ?? {}) as Partial<ContentClass>;
  return {
    doc_type: j.doc_type && j.doc_type in DOC_TYPES ? j.doc_type : "UNKNOWN",
    wytworca: j.wytworca && j.wytworca in AUTHORS ? j.wytworca : "INNY",
    karta_start: typeof j.karta_start === "number" ? j.karta_start : null,
    reason: j.reason ?? "",
  };
}
