import Anthropic from "@anthropic-ai/sdk";

import { createClient } from "@/lib/supabase/server";

// Podpowiedzi OSINT wytypowane przez model WYŁĄCZNIE z danych sprawy:
// roster Grupy (A1), nazwy plików akt, podmioty z danych transakcyjnych (metryki).
// Evidence-only: każda pozycja musi wskazywać źródło; model niczego nie wymyśla —
// to punkt wyjścia do weryfikacji przez biegłego, nie ustalenie.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Item = { value: string; source?: string; why?: string };
type Sugg = { krs: Item[]; persons: Item[]; entities: Item[]; queries: Item[] };

const SYSTEM =
  "Jesteś asystentem biegłego sądowego badającego manipulacje na GPW. Na podstawie WYŁĄCZNIE " +
  "przekazanych danych z akt wytypuj podpowiedzi do wyszukiwań OSINT. ZASADY BEZWZGLĘDNE: " +
  "(1) Niczego nie wymyślaj — każda pozycja musi wynikać wprost z przekazanych danych; w polu " +
  "source wskaż skąd (nazwa pliku / roster / dane transakcyjne). " +
  "(2) Numery KRS podawaj TYLKO, gdy 10-cyfrowy numer jest w danych jawnie oznaczony jako KRS; " +
  "numerów rachunków ani innych ciągów cyfr nie traktuj jako KRS — gdy brak, zwróć pustą listę. " +
  "(3) persons = osoby fizyczne (właściciele rachunków, pełnomocnicy, reprezentanci) w formacie " +
  "Imię Nazwisko; entities = podmioty gospodarcze (pełne nazwy). " +
  "(4) queries = 5-12 gotowych zapytań do wyszukiwarki, każde łączy parę podmiotów/osób z akt i " +
  "celuje we wspólne zarządy, powiązania rodzinne, umowy, wspólne adresy (w why napisz, jakiego " +
  "powiązania szukamy). " +
  "(5) Maksymalnie 15 pozycji na listę. " +
  "(6) Zwróć WYŁĄCZNIE poprawny JSON bez komentarzy, schemat: " +
  '{"krs":[{"value":"0000000000","source":"..."}],"persons":[{"value":"...","source":"..."}],' +
  '"entities":[{"value":"...","source":"..."}],"queries":[{"value":"...","source":"...","why":"..."}]}';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const { data: caseRow } = await supabase
    .from("cases")
    .select("name,signature,group_roster")
    .eq("id", id)
    .single();
  if (!caseRow) return Response.json({ ok: false, reason: "not found" }, { status: 404 });

  const { data: docs } = await supabase
    .from("documents")
    .select("rel_path,doc_type")
    .eq("case_id", id)
    .limit(2000);
  const { data: ents } = await supabase
    .from("metrics")
    .select("key")
    .eq("case_id", id)
    .like("key", "ent_sell_share::%");

  const roster = (
    ((caseRow.group_roster as { entities?: { name?: string }[] } | null)?.entities ?? [])
      .map((e) => e.name)
      .filter(Boolean) as string[]
  ).slice(0, 40);
  const fragments = [...new Set((ents ?? []).map((m) => String(m.key).split("::")[1]))].slice(0, 40);
  const fileLines = [
    ...new Set(
      (docs ?? []).map((d) => `${d.doc_type}: ${String(d.rel_path).split("/").pop()}`),
    ),
  ].slice(0, 500);

  const userPrompt = [
    `Sprawa: ${caseRow.name}${caseRow.signature ? ` (sygn. ${caseRow.signature})` : ""}.`,
    roster.length
      ? "Roster Grupy (podmioty objęte zarzutami, zatwierdzone przez biegłego):\n" +
        roster.map((r) => "- " + r).join("\n")
      : "Roster Grupy: (pusty).",
    fragments.length
      ? "Podmioty aktywne w danych transakcyjnych (fragmenty nazw z silnika):\n" +
        fragments.map((f) => "- " + f).join("\n")
      : "",
    "Pliki akt (typ: nazwa pliku):\n" + fileLines.map((f) => "- " + f).join("\n"),
    "Wytypuj listy zgodnie ze schematem JSON.",
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 3000,
      system: SYSTEM,
      messages: [{ role: "user", content: userPrompt }],
    });
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const raw = text.replace(/```json|```/g, "").trim();
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return Response.json({ ok: false, reason: "Model nie zwrócił JSON." });
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Partial<Sugg>;
    const arr = (x: unknown): Item[] =>
      Array.isArray(x) ? x.filter((i): i is Item => !!i && typeof (i as Item).value === "string") : [];
    return Response.json({
      ok: true,
      suggestions: {
        krs: arr(parsed.krs).filter((i) => /^\d{10}$/.test(i.value.replace(/\D/g, ""))),
        persons: arr(parsed.persons),
        entities: arr(parsed.entities),
        queries: arr(parsed.queries),
      } satisfies Sugg,
    });
  } catch (e) {
    return Response.json({ ok: false, reason: "Błąd modelu: " + (e as Error).message });
  }
}
