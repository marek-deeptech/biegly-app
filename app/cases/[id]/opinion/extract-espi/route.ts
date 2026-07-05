import Anthropic from "@anthropic-ai/sdk";

import { pdfText } from "@/lib/intake/pdf";
import { createClient } from "@/lib/supabase/server";

// Wyciąga datowane zdarzenia korporacyjne z raportów ESPI/EBI wgranych do sprawy
// (odczyt PDF przez unpdf) i zapisuje je jako subanalizę `espi_events` (Data | Rodzaj |
// Temat | Treść | Sesja | Reakcja sesji). Treść = streszczenie merytoryczne komunikatu
// (model, evidence-only); reakcja sesji (zmiana kursu, wolumen) = DETERMINISTYCZNIE
// z metryk silnika. Zasila cross-link czasowy (IV.3) i analizę ESPI (IV.2).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Event = {
  file: string;
  date: string;
  type: string;
  subject: string;
  content?: string;
  session: string;
  chg?: number | null; // reakcja sesji z silnika (deterministyczna)
  vol?: number | null;
};

const SYSTEM =
  "Jesteś asystentem biegłego sądowego. Otrzymujesz fragmenty treści dokumentów ESPI/EBI z akt sprawy " +
  "(raporty bieżące/okresowe, uchwały WZ/NWZA, zawiadomienia o stanie posiadania) oraz listę dni sesyjnych " +
  "objętych analizą. Dla każdego dokumentu wyodrębnij: date zdarzenia (date, format YYYY-MM-DD), rodzaj (type: " +
  "np. 'raport bieżący nr X/RRRR', 'uchwały NWZA', 'zawiadomienie o zmianie stanu posiadania', 'raport kwartalny'), " +
  "krótki temat (subject), STRESZCZENIE merytorycznej treści (content: 2–4 zdania — co spółka faktycznie " +
  "komunikuje: kwoty, umowy, decyzje, progi; bez oceny cenotwórczości, która należy do biegłego) oraz — jeśli " +
  "data pokrywa się lub bezpośrednio poprzedza dzień sesyjny z listy — tę sesję (session, YYYY-MM-DD; inaczej " +
  "pusty). ZASADY: (1) wyłącznie na podstawie treści — nie zmyślaj dat, numerów, kwot ani tematów; czego nie ma, " +
  "zostaw pustym stringiem. (2) Zwróć WYŁĄCZNIE JSON: " +
  '{"events":[{"file":"","date":"YYYY-MM-DD","type":"","subject":"","content":"","session":""}]}';

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
  const isPdf = (fn: string) => /\.pdf$/i.test(fn) && !/loader|ads|sodar|zrt_|jsapi|cookie|lookup|\.pobrane/i.test(fn);
  const seen = new Set<string>();
  const uniq = (docs ?? []).filter((d) => {
    const fn = String(d.rel_path).split("/").pop() ?? "";
    if (!d.storage_path || !isPdf(fn) || seen.has(fn)) return false;
    seen.add(fn);
    return true;
  }).slice(0, 12);
  if (!uniq.length) return Response.json({ ok: false, reason: "Brak raportów ESPI/EBI (PDF) ze ścieżką w Storage." });

  // Odczyt PDF-ów — 8000 zn na plik (data i temat na początku; treść merytoryczna dalej).
  const texts: string[] = [];
  for (const d of uniq) {
    const fn = String(d.rel_path).split("/").pop() ?? "";
    try {
      const { data: blob, error } = await supabase.storage.from("case-files").download(d.storage_path as string);
      if (error || !blob) {
        texts.push(`### ${fn}\n[nie udało się pobrać pliku]`);
        continue;
      }
      const text = await pdfText(await blob.arrayBuffer(), 8000);
      texts.push(`### ${fn}\n${text}`);
    } catch (e) {
      texts.push(`### ${fn}\n[błąd odczytu PDF: ${(e as Error).message}]`);
    }
  }

  const { data: metricsData } = await supabase
    .from("metrics")
    .select("key,value,session_day")
    .eq("case_id", id)
    .in("key", ["day_change_pct", "day_sess_vol"]);
  const days = [...new Set((metricsData ?? []).map((m) => m.session_day).filter(Boolean))].sort();
  const at = (k: string, d: string) => (metricsData ?? []).find((m) => m.key === k && m.session_day === d)?.value ?? null;

  const userPrompt = [
    `Dni sesyjne objęte analizą: ${days.join(", ") || "(brak)"}.`,
    "",
    "TREŚĆ DOKUMENTÓW ESPI/EBI (nazwa pliku + treść):",
    texts.join("\n\n"),
    "",
    "Wyodrębnij zdarzenia zgodnie ze schematem JSON.",
  ].join("\n");

  try {
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 4000,
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
      .map((v) => {
        const session = String(v.session ?? "");
        return {
          file: String(v.file ?? ""),
          date: String(v.date ?? ""),
          type: String(v.type ?? ""),
          subject: String(v.subject ?? ""),
          content: String(v.content ?? ""),
          session,
          // Reakcja sesji — wyłącznie z metryk silnika (nie od modelu).
          chg: session ? at("day_change_pct", session) : null,
          vol: session ? at("day_sess_vol", session) : null,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    const plnum = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("pl-PL"));
    const table = {
      caption:
        "Tabela. Zdarzenia korporacyjne (ESPI/EBI) a sesje objęte analizą — treść komunikatu i reakcja sesji (zmiana kursu, wolumen)",
      head: ["Data", "Rodzaj", "Treść (skrót)", "Sesja", "Zmiana kursu sesji", "Wolumen sesji"],
      rows: events.map((v) => [
        v.date || "—",
        v.type || v.subject || "—",
        (v.content || v.subject || "—").slice(0, 220),
        v.session || "—",
        v.chg == null ? "—" : `${v.chg > 0 ? "+" : ""}${plnum(v.chg)}%`,
        v.vol == null ? "—" : `${plnum(v.vol)} szt`,
      ]),
    };
    await supabase.from("subanalyses").upsert(
      {
        case_id: id,
        kind: "espi_events",
        chapter_no: "IV",
        title: "Zdarzenia ESPI/EBI (wyciąg z akt)",
        body_md:
          `Odczytano ${uniq.length} raportów ESPI/EBI; wyodrębniono ${events.length} datowanych zdarzeń korporacyjnych ` +
          `wraz ze streszczeniem treści i reakcją zbieżnych sesji (zmiana kursu, wolumen — z silnika)` +
          (events.length
            ? ": " + events.slice(0, 10).map((e) => `${e.date || "—"} — ${(e.type || e.subject || "").trim()}`).join("; ") + "."
            : "."),
        data: { table, events, findings: [`Zidentyfikowano ${events.length} datowanych zdarzeń ESPI/EBI (z treścią i reakcją sesji).`], legalRefs: [] },
        status: "szkic",
      },
      { onConflict: "case_id,kind" },
    );
    return Response.json({ ok: true, events, message: `Odczytano ${uniq.length} PDF-ów, wyodrębniono ${events.length} zdarzeń (z treścią i reakcją sesji).` });
  } catch (e) {
    return Response.json({ ok: false, reason: "Błąd modelu: " + (e as Error).message });
  }
}
