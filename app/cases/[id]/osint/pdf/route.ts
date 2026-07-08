import { milisystemOsint, type PanelLink } from "@/lib/osint/content";
import { renderOsintPdf } from "@/lib/osint/pdf";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// C · Generuj Analizę OSINT — zwraca gotowy PDF (jakość dokumentu finalnego).
// Treść: kuratorowany szkielet MLM (Grupa Milisystem) + hybrydowo dołączone
// powiązania zapisane w panelu OSINT (zakładki A/B). Render: pdfmake (bez LibreOffice).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: caseRow } = await supabase.from("cases").select("name,signature").eq("id", id).single();
  if (!caseRow) return new Response("Not found", { status: 404 });

  // Hybryda: dołącz zapisane w panelu OSINT powiązania (jeśli są).
  const { data: sub } = await supabase
    .from("subanalyses")
    .select("data")
    .eq("case_id", id)
    .eq("kind", "powiazania_osint")
    .maybeSingle();
  const links = ((sub?.data as { osint?: { links?: PanelLink[] } } | null)?.osint?.links) ?? [];

  const buf = await renderOsintPdf(milisystemOsint(links));

  const safe = (caseRow.name || "sprawa").replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 60);
  const fname = `Analiza_OSINT_${safe}.pdf`;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fname}"`,
      "Cache-Control": "no-store",
    },
  });
}
