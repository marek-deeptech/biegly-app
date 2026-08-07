import { renderSpoofingPdf, type SpoofAnalysis } from "@/lib/opinion/spoofing-pdf";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pobranie raportu „Spoofing & Layering" (PDF) — renderuje analizę wykrytą przez detektor.
//
// ⚠️ ŹRÓDŁO PER INSTRUMENT. Sprawa wieloinstrumentowa ma osobną analizę każdego waloru
// (`spoofing_<ticker>`); zbiorczy `spoofing_analysis` pochodzi sprzed rozdzielenia
// i miesza sesje dwóch arkuszy zleceń. Walor wybiera parametr `?walor=csy`, a bez niego
// bierzemy pierwszy alfabetycznie i mówimy w odpowiedzi, jakie są pozostałe.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: caseRow } = await supabase.from("cases").select("name").eq("id", id).single();
  if (!caseRow) return new Response("Not found", { status: 404 });

  const { data: subs } = await supabase
    .from("subanalyses").select("kind,data").eq("case_id", id).like("kind", "spoofing%");
  const perInstrument = (subs ?? []).filter((s) => s.kind !== "spoofing_analysis").sort((a, b) => a.kind.localeCompare(b.kind));
  const zrodla = perInstrument.length ? perInstrument : (subs ?? []).filter((s) => s.kind === "spoofing_analysis");
  const walor = new URL(req.url).searchParams.get("walor")?.toLowerCase() ?? null;
  const wybrany = walor ? zrodla.find((s) => s.kind === `spoofing_${walor}`) : zrodla[0];
  const analysis = (wybrany?.data as { analysis?: SpoofAnalysis } | null)?.analysis ?? null;
  if (!analysis) {
    const dostepne = zrodla.map((s) => s.kind.replace(/^spoofing_/, "")).filter((x) => x !== "analysis");
    return Response.json(
      {
        ok: false,
        reason: walor && dostepne.length
          ? `Brak analizy dla waloru „${walor}". Dostępne: ${dostepne.join(", ")}.`
          : "Brak analizy Spoofing/Layering. Uruchom najpierw „Wykryj (analiza arkusza zleceń)” w sekcji Spoofing and Layering.",
      },
      { status: 409 },
    );
  }
  const sufiks = wybrany && wybrany.kind !== "spoofing_analysis" ? `_${wybrany.kind.slice("spoofing_".length).toUpperCase()}` : "";

  const buf = await renderSpoofingPdf(analysis);
  const safe = (caseRow.name || "sprawa").replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 60);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Spoofing_Layering_${safe}${sufiks}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
