import Anthropic from "@anthropic-ai/sdk";
import { klientLLM } from "@/lib/llm/klient";

import { pdfText } from "@/lib/intake/pdf";
import { createClient } from "@/lib/supabase/server";

// „Zaproponuj z akt" (Krok 2) — model typuje roster Grupy WYŁĄCZNIE z treści dokumentów
// wskazujących krąg podejrzanych: postanowienie o przedstawieniu zarzutów, akt oskarżenia,
// zawiadomienie KNF (a pomocniczo opinia biegłego). Działa i dla PDF z warstwą tekstową
// (HUBTECH/MLM), i dla czystych skanów (ZASTAL) — te drugie idą do modelu jako blok
// „document" (natywny odczyt OCR przez model). Evidence-only: to PROPOZYCJA do potwierdzenia
// przez biegłego, nie ustalenie; model niczego nie dopisuje spoza treści akt.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Sug = { kind: "osoba" | "podmiot"; name: string; fragment?: string; note?: string };

// Typy dokumentów, które wymieniają krąg podejrzanych — w kolejności przydatności.
const PRIORITY: Record<string, number> = {
  AKT_OSKARZENIA: 0,
  ZAWIADOMIENIE_KNF: 1,
  POSTANOWIENIE: 2,
  POSTANOWIENIE_SAD: 3,
  OPINIA_BIEGLY_PROK: 4,
  OPINIA_UKNF: 5,
  OPINIA_INNY_BIEGLY: 6,
};
const MAX_DOCS = 6;
const MAX_PDF_BYTES = 18 * 1024 * 1024; // limit pojedynczego skanu do bloku PDF (model: ≤100 str./32MB)
const MAX_SCAN_BLOCKS = 3; // ile skanów maksymalnie ślemy jako obraz (koszt/latencja)
const MIN_TEXT = 300; // poniżej tylu znaków traktujemy PDF jako skan (brak warstwy tekstowej)

const SYSTEM =
  "Jesteś asystentem biegłego sądowego w sprawie karnej o manipulację instrumentami na GPW/NewConnect. " +
  "Otrzymujesz dokumenty z akt (postanowienie o przedstawieniu zarzutów, akt oskarżenia, zawiadomienie KNF, " +
  "ewentualnie opinia biegłego) — jako tekst albo skan. Twoje zadanie: wskaż KRĄG PODEJRZANYCH/OSKARŻONYCH " +
  "(roster Grupy) do zbadania przez biegłego. ZASADY BEZWZGLĘDNE: " +
  "(1) Wyłącznie na podstawie treści przekazanych dokumentów — NIE dopisuj osób ani podmiotów spoza akt; " +
  "czego nie ma, pomiń. " +
  "(2) kind='osoba' dla osób fizycznych (podejrzani, oskarżeni, właściciele/pełnomocnicy rachunków) w formacie " +
  "'Imię Nazwisko' (bez PESEL, dat, funkcji w nazwie). kind='podmiot' dla osób prawnych i wehikułów " +
  "(spółki, fundusze) w pełnej nazwie. " +
  "(3) fragment = krótki, wyróżniający ciąg, którym w danych transakcyjnych dopasujemy WŁAŚCICIELA rachunku " +
  "(małe litery). Dla podmiotu: charakterystyczny człon nazwy (np. 'amida', 'joyfix'). Dla osoby fizycznej " +
  "podaj fragment (nazwisko małymi literami) TYLKO, gdy z treści wynika, że osoba ma WŁASNY rachunek " +
  "(jest właścicielem/posiadaczem rachunku); jeśli występuje wyłącznie jako pełnomocnik/reprezentant spółki — " +
  "zostaw fragment PUSTY (rachunek pokrywa już wehikuł, nie dublujemy atrybucji). " +
  "(4) note = 1 krótka wskazówka skąd wynika (np. 'podejrzany, rachunek 914' albo 'pełnomocnik Amida Capital'). " +
  "(5) Odpowiadasz WYŁĄCZNIE wywołaniem narzędzia zaproponuj_roster.";

const TOOL: Anthropic.Tool = {
  name: "zaproponuj_roster",
  description: "Zwraca proponowany roster Grupy (osoby + podmioty) wyłącznie z treści akt.",
  input_schema: {
    type: "object",
    properties: {
      entities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["osoba", "podmiot"] },
            name: { type: "string" },
            fragment: { type: "string", description: "ciąg do dopasowania właściciela rachunku (małe litery) lub pusty" },
            note: { type: "string", description: "krótka wskazówka z akt" },
          },
          required: ["kind", "name"],
        },
      },
    },
    required: ["entities"],
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
  const candidates = (docs ?? [])
    .filter((d) => d.storage_path && /\.pdf$/i.test(String(d.rel_path)))
    // Izolacja spraw (defense-in-depth): ścieżka w Storage MUSI być w prefiksie tej sprawy.
    .filter((d) => String(d.storage_path).startsWith(`${id}/`))
    .sort((a, b) => {
      const pa = PRIORITY[a.doc_type] ?? 9;
      const pb = PRIORITY[b.doc_type] ?? 9;
      if (pa !== pb) return pa - pb;
      return (a.size_bytes ?? 0) - (b.size_bytes ?? 0); // przy równym priorytecie — mniejszy plik najpierw
    });
  if (!candidates.length)
    return Response.json({
      ok: false,
      reason: "Brak w aktach dokumentu wskazującego krąg podejrzanych (postanowienie / akt oskarżenia / zawiadomienie KNF).",
    });

  // Zbierz treść: PDF z warstwą tekstową → tekst; czysty skan → blok „document" (odczyt przez model).
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
    return Response.json({ ok: false, reason: "Nie udało się odczytać treści żadnego z dokumentów akt (skany zbyt duże lub uszkodzone)." });

  blocks.unshift({
    type: "text",
    text:
      `Sprawa: ${caseRow.name}${caseRow.signature ? ` (sygn. ${caseRow.signature})` : ""}.\n` +
      `Poniżej ${sources.length} dokument(ów) z akt. Wskaż roster Grupy zgodnie z zasadami — wywołaj zaproponuj_roster.`,
  });

  try {
    const client = klientLLM("roster/sugestie", { sprawa: id });
    const msg = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 2500,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "zaproponuj_roster" },
      messages: [{ role: "user", content: blocks }],
    });
    const use = msg.content.find((c): c is Anthropic.ToolUseBlock => c.type === "tool_use");
    const raw = ((use?.input as { entities?: Sug[] } | undefined)?.entities ?? []).filter(
      (e) => e && typeof e.name === "string" && e.name.trim(),
    );
    // Dedupe po nazwie; sanitizacja fragmentu.
    const seen = new Set<string>();
    const entities = raw
      .map((e) => ({
        kind: e.kind === "osoba" ? "osoba" : "podmiot",
        name: e.name.trim(),
        fragment: (e.fragment ?? "").trim().toLowerCase(),
        note: (e.note ?? "").trim(),
      }))
      .filter((e) => {
        const k = norm(e.name);
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 40);

    return Response.json({
      ok: true,
      entities,
      sources,
      message: `Propozycja z ${sources.length} dok.: ${entities.length} pozycji (${
        entities.filter((e) => e.kind === "osoba").length
      } osób, ${entities.filter((e) => e.kind === "podmiot").length} podmiotów).`,
    });
  } catch (e) {
    return Response.json({ ok: false, reason: "Błąd modelu: " + (e as Error).message });
  }
}
