import Anthropic from "@anthropic-ai/sdk";
import { klientLLM } from "@/lib/llm/klient";

import { pdfText } from "@/lib/intake/pdf";
import { createClient } from "@/lib/supabase/server";

// „Zaczytaj z akt pytania do biegłego" (Krok 1) — model wypisuje DOSŁOWNIE pytania/zagadnienia
// zlecone biegłemu z postanowienia o dopuszczeniu dowodu z opinii (albo z pisma z pytaniami).
// Działa dla PDF z warstwą tekstową i dla czystych skanów (blok „document" = natywny OCR modelu).
// Evidence-only: to PROPOZYCJA do zatwierdzenia przez biegłego; model niczego nie dopisuje.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Typy dokumentów, które zawierają pytania do biegłego — w kolejności przydatności.
const PRIORITY: Record<string, number> = {
  PYTANIA_BIEGLY: 0,
  POSTANOWIENIE_SAD: 1,
  POSTANOWIENIE: 2,
};
const MAX_DOCS = 4;
const MAX_PDF_BYTES = 18 * 1024 * 1024;
const MAX_SCAN_BLOCKS = 3;
const MIN_TEXT = 300;

const SYSTEM =
  "Jesteś asystentem biegłego sądowego w sprawie karnej o manipulację instrumentami finansowymi. " +
  "Otrzymujesz dokument z akt (postanowienie o dopuszczeniu dowodu z opinii biegłego / o powołaniu biegłego, " +
  "ewentualnie pismo z pytaniami) — jako tekst albo skan. Zadanie: wypisz DOSŁOWNIE listę PYTAŃ / zagadnień " +
  "zleconych biegłemu (zwykle po formule typu 'biegły ustali / odpowie na następujące pytania' i numerowana " +
  "lista 1) 2) 3) ...). ZASADY BEZWZGLĘDNE: " +
  "(1) Przepisuj WYŁĄCZNIE treść pytań z dokumentu — nie streszczaj, nie parafrazuj, nie dodawaj własnych " +
  "pytań ani komentarzy; zachowaj polskie znaki. " +
  "(2) Każde pytanie to osobny element tablicy, bez wiodącego numeru (numer nadaje aplikacja). " +
  "(3) Jeśli pytanie zawiera wyliczenie osób/rachunków lub podpunkty — zachowaj je w treści tego pytania. " +
  "(4) Pomiń część nagłówkową postanowienia (podstawa prawna, dane biegłego, pouczenia) — tylko same pytania. " +
  "(5) Odpowiadasz WYŁĄCZNIE wywołaniem narzędzia wypisz_pytania.";

const TOOL: Anthropic.Tool = {
  name: "wypisz_pytania",
  description: "Zwraca dosłowną listę pytań zleconych biegłemu, wyodrębnionych z treści akt.",
  input_schema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        items: { type: "string", description: "dosłowna treść jednego pytania (bez wiodącego numeru)" },
      },
    },
    required: ["questions"],
  },
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY)
    return Response.json({ ok: false, reason: "Brak ANTHROPIC_API_KEY w zmiennych środowiskowych." });

  const { data: caseRow } = await supabase.from("cases").select("name,signature").eq("id", id).single();
  if (!caseRow) return Response.json({ ok: false, reason: "not found" }, { status: 404 });

  const { data: docs } = await supabase
    .from("documents")
    .select("rel_path,doc_type,storage_path,size_bytes")
    .eq("case_id", id)
    .in("doc_type", Object.keys(PRIORITY))
    .limit(400);
  const seenNames = new Set<string>();
  const candidates = (docs ?? [])
    .filter((d) => d.storage_path && /\.pdf$/i.test(String(d.rel_path)))
    // Izolacja spraw (defense-in-depth): ścieżka w Storage MUSI być w prefiksie tej sprawy.
    .filter((d) => String(d.storage_path).startsWith(`${id}/`))
    .filter((d) => {
      const base = String(d.rel_path).split("/").pop()?.toLowerCase() ?? "";
      if (seenNames.has(base)) return false; // dedup kopii z różnych TOM-ów
      seenNames.add(base);
      return true;
    })
    .sort((a, b) => {
      const pa = PRIORITY[a.doc_type] ?? 9;
      const pb = PRIORITY[b.doc_type] ?? 9;
      if (pa !== pb) return pa - pb;
      return (a.size_bytes ?? 0) - (b.size_bytes ?? 0);
    });
  if (!candidates.length)
    return Response.json({
      ok: false,
      reason: "Brak w aktach postanowienia o powołaniu biegłego ani pisma z pytaniami (PYTANIA_BIEGLY / POSTANOWIENIE).",
    });

  const blocks: Anthropic.ContentBlockParam[] = [];
  const sources: string[] = [];
  let scanBlocks = 0;
  for (const d of candidates) {
    if (sources.length >= MAX_DOCS) break;
    const fn = String(d.rel_path).split("/").pop() ?? "";
    try {
      const { data: blob, error } = await supabase.storage.from("case-files").download(d.storage_path as string);
      if (error || !blob) continue;
      const buf = await blob.arrayBuffer();
      const text = await pdfText(buf, 24000).catch(() => "");
      if (text.length >= MIN_TEXT) {
        blocks.push({ type: "text", text: `### ${d.doc_type} — ${fn}\n${text}` });
        sources.push(fn);
      } else if (buf.byteLength <= MAX_PDF_BYTES && scanBlocks < MAX_SCAN_BLOCKS) {
        const b64 = Buffer.from(buf).toString("base64");
        blocks.push({ type: "text", text: `### ${d.doc_type} — ${fn} (skan):` });
        blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 }, title: fn });
        sources.push(fn);
        scanBlocks++;
      }
    } catch {
      // pomiń nieczytelny plik
    }
  }
  if (!sources.length)
    return Response.json({ ok: false, reason: "Nie udało się odczytać treści postanowienia (skan zbyt duży lub uszkodzony)." });

  blocks.unshift({
    type: "text",
    text:
      `Sprawa: ${caseRow.name}${caseRow.signature ? ` (sygn. ${caseRow.signature})` : ""}.\n` +
      `Poniżej ${sources.length} dokument(ów) z akt. Wypisz dosłownie pytania zlecone biegłemu — wywołaj wypisz_pytania.`,
  });

  try {
    const client = klientLLM("pytania/sugestie", { sprawa: id });
    const msg = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 3000,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "wypisz_pytania" },
      messages: [{ role: "user", content: blocks }],
    });
    const use = msg.content.find((c): c is Anthropic.ToolUseBlock => c.type === "tool_use");
    const raw = ((use?.input as { questions?: string[] } | undefined)?.questions ?? [])
      .map((q) => String(q).trim())
      .filter((q) => q.length > 0);
    // Dedup po znormalizowanej treści.
    const seen = new Set<string>();
    const questions = raw.filter((q) => {
      const k = norm(q);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (!questions.length)
      return Response.json({ ok: false, reason: "Model nie znalazł pytań w treści dokumentu." });

    return Response.json({
      ok: true,
      questions,
      sources,
      message: `Odczytano ${questions.length} pytań z ${sources.length} dok. (${sources.join(", ")}).`,
    });
  } catch (e) {
    return Response.json({ ok: false, reason: "Błąd modelu: " + (e as Error).message });
  }
}
