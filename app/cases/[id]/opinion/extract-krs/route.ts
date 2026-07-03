import Anthropic from "@anthropic-ai/sdk";

import { pdfText } from "@/lib/intake/pdf";
import { createClient } from "@/lib/supabase/server";

// Wyciąga osoby w organach (zarząd, rada nadzorcza, prokura, wspólnicy) z odpisów KRS
// wgranych do sprawy (odczyt PDF, sekcja „Dział 2 — Organy") i wskazuje osoby pełniące
// funkcje w WIĘCEJ NIŻ JEDNYM podmiocie — sygnał powiązań osobowych do rozdziału IV.7.
// Evidence-only: model odczytuje WYŁĄCZNIE z treści odpisów; nie zmyśla nazwisk ani funkcji.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Person = { entity: string; name: string; role: string };
type DocResult = { entity: string; persons: { name: string; role: string }[] };

const SYSTEM =
  "Jesteś asystentem biegłego sądowego. Otrzymujesz fragmenty odpisów KRS (sekcje o organach spółek). " +
  "Dla każdego dokumentu wyodrębnij nazwę podmiotu (entity) oraz osoby fizyczne w organach: zarząd, rada " +
  "nadzorcza, prokurenci, wspólnicy/komplementariusze — w formacie Imię Nazwisko z funkcją (role). " +
  "ZASADY: (1) wyłącznie na podstawie treści — nie zmyślaj nazwisk ani funkcji; czego nie ma, pomiń. " +
  "(2) name = 'Imię Nazwisko' (bez PESEL/dat). (3) Zwróć WYŁĄCZNIE JSON: " +
  '{"docs":[{"entity":"","persons":[{"name":"","role":""}]}]}';

function norm(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY)
    return Response.json({ ok: false, reason: "Brak ANTHROPIC_API_KEY w zmiennych środowiskowych." });

  const { data: caseRow0 } = await supabase.from("cases").select("group_roster").eq("id", id).single();
  const { data: docs } = await supabase
    .from("documents")
    .select("rel_path,storage_path")
    .eq("case_id", id)
    .eq("doc_type", "KRS_REJESTR")
    .limit(400);
  // Tylko realne odpisy PDF — odsiej zapisane strony WWW i ich asset-dumpy
  // (loader.js, ads.html, *.pobrane, jsapi_*), które bywają błędnie zaklasyfikowane.
  const isKrsPdf = (fn: string) => /\.pdf$/i.test(fn) && !/loader|ads|sodar|zrt_|jsapi|cookie|lookup|\.pobrane/i.test(fn);
  const roster =
    ((caseRow0?.group_roster as { entities?: { fragment?: string }[] } | null)?.entities ?? [])
      .map((e) => norm(String(e.fragment ?? "")))
      .filter(Boolean);
  const seen = new Set<string>();
  const pdfs = (docs ?? []).filter((d) => {
    const fn = String(d.rel_path).split("/").pop() ?? "";
    if (!d.storage_path || !isKrsPdf(fn) || seen.has(fn)) return false;
    seen.add(fn);
    return true;
  });
  // Priorytet: odpisy, których nazwa pasuje do podmiotu z rostera; potem reszta.
  pdfs.sort((a, b) => {
    const ma = roster.some((r) => norm(a.rel_path).includes(r)) ? 0 : 1;
    const mb = roster.some((r) => norm(b.rel_path).includes(r)) ? 0 : 1;
    return ma - mb;
  });
  const uniq = pdfs.slice(0, 14);
  if (!uniq.length) return Response.json({ ok: false, reason: "Brak odpisów KRS (PDF) ze ścieżką w Storage." });

  // Odczyt PDF-ów; wytnij sekcję „Dział 2 — Organy" (tam są osoby), plus nagłówek z nazwą.
  const texts: string[] = [];
  for (const d of uniq) {
    const fn = String(d.rel_path).split("/").pop() ?? "";
    try {
      const { data: blob, error } = await supabase.storage.from("case-files").download(d.storage_path as string);
      if (error || !blob) {
        texts.push(`### ${fn}\n[nie udało się pobrać pliku]`);
        continue;
      }
      const full = await pdfText(await blob.arrayBuffer(), 50000);
      const dz2 = full.search(/DZIA[ŁL]\s*2/i);
      const dz3 = full.search(/DZIA[ŁL]\s*3/i);
      const organy = dz2 >= 0 ? full.slice(dz2, dz3 > dz2 ? dz3 : dz2 + 7000) : full.slice(0, 7000);
      texts.push(`### ${fn}\nNAZWA/NAGŁÓWEK: ${full.slice(0, 500)}\nORGANY: ${organy}`);
    } catch (e) {
      texts.push(`### ${fn}\n[błąd odczytu PDF: ${(e as Error).message}]`);
    }
  }

  const userPrompt = [
    "ODPISY KRS (nazwa pliku + nagłówek + sekcja organów):",
    texts.join("\n\n"),
    "",
    "Wyodrębnij osoby w organach zgodnie ze schematem JSON.",
  ].join("\n");

  try {
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 3500,
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
    const parsed = JSON.parse(raw.slice(s, e + 1)) as { docs?: DocResult[] };
    const persons: Person[] = [];
    for (const d of parsed.docs ?? [])
      for (const p of d.persons ?? [])
        if (p && p.name) persons.push({ entity: String(d.entity ?? ""), name: String(p.name), role: String(p.role ?? "") });

    // Osoby w więcej niż jednym podmiocie — sygnał powiązań osobowych (IV.7).
    // Podmiot kanonizujemy po numerze KRS (ten sam podmiot bywa podpisany dwojako:
    // „KRS 0000482497" i „Hubtech (KRS 0000482497)") — inaczej fałszywe trafienia.
    const entKey = (e: string) => (/(\d{10})/.exec(e)?.[1] ?? norm(e));
    const letters = (s: string) => (s.match(/[a-ząćęłńóśżź]/gi) ?? []).length;
    const byPerson = new Map<string, Map<string, string>>();
    for (const p of persons) {
      if (!p.entity) continue;
      const pm = byPerson.get(norm(p.name)) ?? new Map<string, string>();
      const k = entKey(p.entity);
      const cur = pm.get(k);
      if (!cur || letters(p.entity) > letters(cur)) pm.set(k, p.entity); // zachowaj etykietę z nazwą, nie sam „KRS …"
      byPerson.set(norm(p.name), pm);
    }
    const shared = persons
      .filter((p, i) => persons.findIndex((q) => norm(q.name) === norm(p.name)) === i)
      .filter((p) => (byPerson.get(norm(p.name))?.size ?? 0) > 1)
      .map((p) => ({ name: p.name, entities: [...(byPerson.get(norm(p.name))?.values() ?? [])] }));

    const table = {
      caption: "Tabela. Osoby w organach podmiotów (wyciąg z odpisów KRS)",
      head: ["Podmiot", "Osoba", "Funkcja"],
      rows: persons.map((p) => [p.entity || "—", p.name, p.role || "—"]),
    };
    await supabase.from("subanalyses").upsert(
      {
        case_id: id,
        kind: "krs_boards",
        chapter_no: "IV",
        title: "Organy podmiotów — wyciąg z KRS",
        body_md:
          `Odczytano ${uniq.length} odpisów KRS; wyodrębniono ${persons.length} osób w organach` +
          (shared.length
            ? `. Osoby pełniące funkcje w więcej niż jednym podmiocie (${shared.length}): ` +
              shared.slice(0, 10).map((x) => `${x.name} (${(x.entities ?? []).join(", ")})`).join("; ") +
              "."
            : "; nie stwierdzono osób pełniących funkcje w więcej niż jednym z odczytanych podmiotów."),
        data: { table, persons, shared, findings: [`${persons.length} osób w organach; ${shared.length} w wielu podmiotach.`], legalRefs: [] },
        status: "szkic",
      },
      { onConflict: "case_id,kind" },
    );
    return Response.json({
      ok: true,
      persons,
      shared,
      message: `Odczytano ${uniq.length} odpisów KRS, wyodrębniono ${persons.length} osób (${shared.length} w wielu podmiotach).`,
    });
  } catch (e) {
    return Response.json({ ok: false, reason: "Błąd modelu: " + (e as Error).message });
  }
}
