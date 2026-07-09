import { runOsintAnalysis } from "@/lib/osint/agent";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // pełen przebieg: akta + GLEIF + Brave + synteza modelu

// C · Przeprowadź analizę OSINT — pełen proces per sprawa (akta + GLEIF + Brave →
// synteza modelu → OsintContent). Wynik zapisywany jako subanaliza `osint_analysis`
// (data.content = OsintContent); przycisk „Generuj PDF" renderuje tę zapisaną analizę.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY)
    return Response.json({ ok: false, reason: "Brak ANTHROPIC_API_KEY w zmiennych środowiskowych." });

  try {
    const { content, stats } = await runOsintAnalysis(supabase, id);
    const secN = content.sections.length;
    const { error } = await supabase.from("subanalyses").upsert(
      {
        case_id: id,
        kind: "osint_analysis",
        chapter_no: "IV",
        title: "Analiza OSINT (agent)",
        body_md:
          `Przeprowadzono analizę OSINT: odczytano ${stats.pdfs} dok. z akt, ${stats.gleif} rekordów GLEIF, ` +
          `${stats.web} wyszukiwań web; ustalono ${stats.relations} powiązań w ${stats.clusters} klastrach ` +
          `(${secN} rozdziałów). Każde powiązanie z cytowanym źródłem; pozycje niepewne oznaczone „(do potwierdzenia)”.`,
        data: { content },
        status: "szkic",
      },
      { onConflict: "case_id,kind" },
    );
    if (error)
      return Response.json({
        ok: false,
        reason: /subanalyses|schema cache|relation/i.test(error.message) ? "Uruchom migrację 0004_subanalyses.sql." : error.message,
      });
    return Response.json({ ok: true, stats, sections: secN });
  } catch (e) {
    return Response.json({ ok: false, reason: `Błąd analizy: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }
}
