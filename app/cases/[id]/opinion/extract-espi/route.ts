import Anthropic from "@anthropic-ai/sdk";

import { pdfText } from "@/lib/intake/pdf";
import { createClient } from "@/lib/supabase/server";

// Wyciąga datowane zdarzenia korporacyjne z raportów ESPI/EBI wgranych do sprawy
// (odczyt PDF przez unpdf) i zapisuje je jako subanalizę `espi_events` (Data | Rodzaj |
// Temat | Sesja). Zasila cross-link czasowy skoków kursu (IV.3) i analizę ESPI (IV.2).
// Evidence-only: model odczytuje WYŁĄCZNIE z treści dokumentów; nie zmyśla dat ani numerów.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Event = { file: string; date: string; type: string; subject: string; session: string };

const SYSTEM =
  "Jesteś asystentem biegłego sądowego. Otrzymujesz fragmenty treści dokumentów ESPI/EBI z akt sprawy " +
  "(raporty bieżące/okresowe, uchwały WZ/NWZA, zawiadomienia o stanie posiadania) oraz listę dni sesyjnych " +
  "objętych analizą. Dla każdego dokumentu wyodrębnij: date zdarzenia (date, format YYYY-MM-DD), rodzaj (type: " +
  "np. 'raport bieżący nr X/RRRR', 'uchwały NWZA', 'zawiadomienie o zmianie stanu posiadania', 'raport kwartalny'), " +
  "krótki temat (subject) oraz — jeśli data pokrywa się lub bezpośrednio poprzedza dzień sesyjny z listy — tę sesję " +
  "(session, YYYY-MM-DD; inaczej pusty). ZASADY: (1) wyłącznie na podstawie treści — nie zmyślaj dat, numerów ani " +
  "tematów; czego nie ma, zostaw pustym stringiem. (2) Zwróć WYŁĄCZNIE JSON: " +
  '{"events":[{"file":"","date":"YYYY-MM-DD","type":"","subject":"","session":""}]}';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY)
    return Response.json({ ok: false, reason: "Brak ANTHROPIC_API_KEY w zmiennych środowiskowych." });

  const { data: docs } = await supabase
    .from("documents")
    .select("rel_path,storage_path")
    .eq("case_id", id)
    .eq("doc_type", "RAPORT_ESPI_EBI")
    .limit(40);
  const seen = new Set<string>();
  const uniq = (docs ?? []).filter((d) => {
    const fn = String(d.rel_path).split("/").pop() ?? "";
    if (!d.storage_path || seen.has(fn)) return false;
    seen.add(fn);
    return true;
  }).slice(0, 8);
  if (!uniq.length) return Response.json({ ok: false, reason: "Brak raportów ESPI/EBI ze ścieżką w Storage." });

  // Odczyt PDF-ów (fragmenty początkowe — tam jest data i temat).
  const texts: string[] = [];
  for (const d of uniq) {
    const fn = String(d.rel_path).split("/").pop() ?? "";
    try {
      const { data: blob, error } = await supabase.storage.from("case-files").download(d.storage_path as string);
      if (error || !blob) {
        texts.push(`### ${fn}\n[nie udało się pobrać pliku]`);
        continue;
      }
      const text = await pdfText(await blob.arrayBuffer(), 4500);
      texts.push(`### ${fn}\n${text}`);
    } catch (e) {
      texts.push(`### ${fn}\n[błąd odczytu PDF: ${(e as Error).message}]`);
    }
  }

  const { data: metricsData } = await supabase.from("metrics").select("session_day").eq("case_id", id);
  const days = [...new Set((metricsData ?? []).map((m) => m.session_day).filter(Boolean))].sort();

  const userPrompt = [
    `Dni sesyjne objęte analizą: ${days.join(", ") || "(brak)"}.`,
    "",
    "TREŚĆ DOKUMENTÓW ESPI/EBI (nazwa pliku + początek treści):",
    texts.join("\n\n"),
    "",
    "Wyodrębnij zdarzenia zgodnie ze schematem JSON.",
  ].join("\n");

  try {
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 2500,
      system: SYSTEM,
      messages: [{ role: "user", content: userPrompt }],
    });
    const raw = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .replace(/```json|```/g, "")
      .trim();
    const s = raw.indexOf("{");
    const e = raw.lastIndexOf("}");
    if (s < 0 || e <= s) return Response.json({ ok: false, reason: "Model nie zwrócił JSON." });
    const parsed = JSON.parse(raw.slice(s, e + 1)) as { events?: Event[] };
    const events: Event[] = (Array.isArray(parsed.events) ? parsed.events : [])
      .filter((v) => v && (v.date || v.subject))
      .map((v) => ({
        file: String(v.file ?? ""),
        date: String(v.date ?? ""),
        type: String(v.type ?? ""),
        subject: String(v.subject ?? ""),
        session: String(v.session ?? ""),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const table = {
      caption: "Tabela. Zdarzenia korporacyjne (ESPI/EBI) a sesje objęte analizą",
      head: ["Data", "Rodzaj", "Temat", "Sesja"],
      rows: events.map((v) => [v.date || "—", v.type || "—", v.subject || "—", v.session || "—"]),
    };
    await supabase.from("subanalyses").upsert(
      {
        case_id: id,
        kind: "espi_events",
        chapter_no: "IV",
        title: "Zdarzenia ESPI/EBI (wyciąg z akt)",
        body_md: `Wyciągnięto ${events.length} zdarzeń korporacyjnych z raportów ESPI/EBI wgranych do sprawy (odczyt PDF).`,
        data: { table, events, findings: [`Zidentyfikowano ${events.length} datowanych zdarzeń ESPI/EBI.`], legalRefs: [] },
        status: "szkic",
      },
      { onConflict: "case_id,kind" },
    );
    return Response.json({ ok: true, events, message: `Odczytano ${uniq.length} PDF-ów, wyodrębniono ${events.length} zdarzeń.` });
  } catch (e) {
    return Response.json({ ok: false, reason: "Błąd modelu: " + (e as Error).message });
  }
}
