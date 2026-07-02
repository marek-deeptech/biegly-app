import Anthropic from "@anthropic-ai/sdk";

import { createClient } from "@/lib/supabase/server";

// „Przeanalizuj ponownie" — po recenzji przeszukuje DOKUMENTY W AKTACH pod kątem
// braków oznaczonych [do uzupełnienia] / [oznaczenie …] w opinii i wskazuje, które
// dokumenty sprawy prawdopodobnie je pokrywają oraz co w nich sprawdzić.
// Evidence-only: model odwołuje się WYŁĄCZNIE do dokumentów z wykazu akt; braku źródła
// nie zmyśla — oznacza found=false. To narzędzie kierujące biegłego, nie ustalenie.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Finding = { gap: string; chapter: string; sources: string[]; note: string; found: boolean };

// Wyciąga kompletne obiekty {...} (zbalansowane nawiasy) — ratuje wyniki mimo
// ewentualnego ucięcia odpowiedzi modelu (truncation), gdy pełny JSON.parse zawiedzie.
function extractObjects(s: string): string[] {
  const out: string[] = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") { if (depth === 0) start = i; depth++; }
    else if (ch === "}") { depth--; if (depth === 0 && start >= 0) { out.push(s.slice(start, i + 1)); start = -1; } }
  }
  return out;
}

const SYSTEM =
  "Jesteś asystentem biegłego sądowego badającego manipulacje na GPW. Otrzymujesz LISTĘ BRAKÓW " +
  "oznaczonych w projekcie opinii jako [do uzupełnienia] / [oznaczenie …] oraz pełny WYKAZ DOKUMENTÓW " +
  "zgromadzonych w aktach sprawy (typ + przykładowe nazwy plików). Dla każdego braku wskaż, które " +
  "dokumenty z akt prawdopodobnie zawierają brakującą informację i co konkretnie w nich sprawdzić. " +
  "ZASADY BEZWZGLĘDNE: " +
  "(1) Odwołuj się WYŁĄCZNIE do dokumentów z podanego wykazu (po typie i/lub nazwie pliku) — nie zmyślaj " +
  "żadnych plików ani ustaleń. " +
  "(2) Jeśli dla danego braku w aktach NIE MA żadnego wiarygodnego źródła, ustaw found=false, sources=[] " +
  "i w note napisz, że materiał nie występuje w aktach. " +
  "(3) note = jedno krótkie zdanie (do 25 słów): CO sprawdzić w tych dokumentach. " +
  "(4) Nie przesądzaj o winie ani kwalifikacji prawnej. " +
  "(5) Zwróć WYŁĄCZNIE poprawny JSON bez komentarzy, schemat: " +
  '{"findings":[{"gap":"…","chapter":"IV.3","sources":["typ/nazwa","…"],"note":"…","found":true}]}';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, reason: "unauthorized" }, { status: 401 });

  if (!process.env.ANTHROPIC_API_KEY)
    return Response.json({
      ok: false,
      reason: "Brak klucza ANTHROPIC_API_KEY — dodaj go w zmiennych środowiskowych Vercel i zrób redeploy.",
    });

  const { data: subs } = await supabase
    .from("subanalyses")
    .select("chapter_no,body_md")
    .eq("case_id", id);

  // Zbierz braki (placeholdery) z kontekstem — grupuj po treści, by nie dublować.
  const gapRe = /\[(?:do uzupełnienia|oznaczenie|do ustalenia|do wskazania|nazwa)[^\]]*\]/gi;
  const gaps: { chapter: string; text: string }[] = [];
  const seen = new Set<string>();
  for (const s of subs ?? []) {
    const body = String(s.body_md ?? "");
    for (const m of body.matchAll(gapRe)) {
      const idx = m.index ?? 0;
      const ctx = body.slice(Math.max(0, idx - 130), idx + m[0].length + 30).replace(/\s+/g, " ").trim();
      const key = `${s.chapter_no}|${ctx}`;
      if (seen.has(key)) continue;
      seen.add(key);
      gaps.push({ chapter: String(s.chapter_no), text: ctx });
    }
  }
  if (!gaps.length)
    return Response.json({ ok: true, findings: [], message: "Brak pozycji [do uzupełnienia] — nic do doszukania w aktach." });

  // Wykaz dokumentów: typ → liczność + przykładowe nazwy plików.
  const { data: docs } = await supabase
    .from("documents")
    .select("doc_type,rel_path")
    .eq("case_id", id)
    .limit(3000);
  const byType = new Map<string, { count: number; names: Set<string> }>();
  for (const d of docs ?? []) {
    const t = String(d.doc_type ?? "UNKNOWN");
    const e = byType.get(t) ?? { count: 0, names: new Set<string>() };
    e.count++;
    if (e.names.size < 10) e.names.add(String(d.rel_path).split("/").pop() ?? "");
    byType.set(t, e);
  }
  const inventory = [...byType.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([t, e]) => `${t} (${e.count}): ${[...e.names].join("; ")}`)
    .join("\n");

  const userPrompt = [
    "BRAKI DO UZUPEŁNIENIA (z projektu opinii; chapter = numer rozdziału, fragment = kontekst):",
    gaps.slice(0, 40).map((g, i) => `${i + 1}. [${g.chapter}] …${g.text}…`).join("\n"),
    "",
    "WYKAZ DOKUMENTÓW W AKTACH (typ (liczba): przykładowe pliki):",
    inventory,
    "",
    "Dla każdego braku wskaż źródła z akt i co sprawdzić, zgodnie ze schematem JSON.",
  ].join("\n");

  try {
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 4096,
      system: SYSTEM,
      messages: [{ role: "user", content: userPrompt }],
    });
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const raw = text.replace(/```json|```/g, "").trim();
    // Pełny parse; przy niepowodzeniu (np. ucięcie odpowiedzi) ratuj kompletne obiekty.
    let rawFindings: { gap?: unknown; chapter?: unknown; sources?: unknown; note?: unknown; found?: unknown }[] = [];
    try {
      const s = raw.indexOf("{");
      const e = raw.lastIndexOf("}");
      rawFindings = (JSON.parse(raw.slice(s, e + 1)) as { findings?: typeof rawFindings }).findings ?? [];
    } catch {
      const arrAt = raw.indexOf("[", raw.indexOf('"findings"'));
      if (arrAt >= 0)
        for (const o of extractObjects(raw.slice(arrAt))) {
          try {
            const p = JSON.parse(o);
            if (p && typeof p.gap === "string") rawFindings.push(p);
          } catch {
            /* pomiń niekompletny obiekt */
          }
        }
    }
    if (!rawFindings.length) return Response.json({ ok: false, reason: "Model nie zwrócił wyników w formacie JSON." });
    const findings: Finding[] = rawFindings
      .filter((f) => f && typeof f.gap === "string")
      .map((f) => ({
        gap: String(f.gap),
        chapter: String(f.chapter ?? ""),
        sources: Array.isArray(f.sources) ? f.sources.map(String) : [],
        note: String(f.note ?? ""),
        found: !!f.found,
      }));
    const covered = findings.filter((f) => f.found).length;
    return Response.json({ ok: true, findings, message: `Przeszukano akta: ${covered}/${findings.length} braków ma źródło w dokumentach sprawy.` });
  } catch (e) {
    return Response.json({ ok: false, reason: "Błąd modelu: " + (e as Error).message });
  }
}
