import { renderSpoofingPdf, type SpoofAnalysis } from "@/lib/opinion/spoofing-pdf";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pobranie raportu „Spoofing & Layering" (PDF) — renderuje analizę wykrytą przez
// detektor (subanaliza `spoofing_analysis`, zapisana przez /api/spoofing). Brak → 409.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: caseRow } = await supabase.from("cases").select("name").eq("id", id).single();
  if (!caseRow) return new Response("Not found", { status: 404 });

  const { data: sub } = await supabase
    .from("subanalyses")
    .select("data")
    .eq("case_id", id)
    .eq("kind", "spoofing_analysis")
    .maybeSingle();
  const analysis = (sub?.data as { analysis?: SpoofAnalysis } | null)?.analysis ?? null;
  if (!analysis) {
    return Response.json(
      { ok: false, reason: "Brak analizy Spoofing/Layering. Uruchom najpierw „Wykryj (analiza arkusza zleceń)” w sekcji Spoofing and Layering." },
      { status: 409 },
    );
  }

  const buf = await renderSpoofingPdf(analysis);
  const safe = (caseRow.name || "sprawa").replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 60);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Spoofing_Layering_${safe}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
