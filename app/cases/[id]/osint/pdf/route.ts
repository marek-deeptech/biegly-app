import { milisystemOsint, appendPanelLinks, type PanelLink, type OsintContent } from "@/lib/osint/content";
import { renderOsintPdf } from "@/lib/osint/pdf";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// C · Generuj Analizę OSINT (PDF) — renderuje analizę PRZEPROWADZONĄ dla sprawy przez
// agenta (subanaliza `osint_analysis`). Fallback: gdy analizy jeszcze nie ma, a sprawa
// to MLM — kuratorowany wzorzec Milisystem; dla innych spraw — komunikat, by najpierw
// uruchomić „Przeprowadź analizę OSINT". Hybrydowo dokłada powiązania z panelu (A/B).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: caseRow } = await supabase.from("cases").select("name,signature").eq("id", id).single();
  if (!caseRow) return new Response("Not found", { status: 404 });

  // Powiązania z panelu OSINT (A/B) — dołączane hybrydowo do analizy.
  const [{ data: analysisRow }, { data: linksRow }] = await Promise.all([
    supabase.from("subanalyses").select("data").eq("case_id", id).eq("kind", "osint_analysis").maybeSingle(),
    supabase.from("subanalyses").select("data").eq("case_id", id).eq("kind", "powiazania_osint").maybeSingle(),
  ]);
  const links = ((linksRow?.data as { osint?: { links?: PanelLink[] } } | null)?.osint?.links) ?? [];

  // 1) Analiza przeprowadzona przez agenta — priorytet.
  const stored = (analysisRow?.data as { content?: OsintContent } | null)?.content ?? null;
  let content: OsintContent | null = stored ? appendPanelLinks(stored, links) : null;

  // 2) Fallback: brak analizy → kuratorowany MLM tylko dla sprawy Milisystem.
  if (!content) {
    const nm = `${caseRow.name ?? ""} ${caseRow.signature ?? ""}`.toLowerCase();
    const isMlm = /milisystem|intelligent gaming|2intellect|4\.2019/.test(nm);
    if (isMlm) content = milisystemOsint(links);
  }

  if (!content) {
    return Response.json(
      { ok: false, reason: "Brak analizy OSINT dla tej sprawy. Uruchom najpierw „Przeprowadź analizę OSINT” w zakładce OSINT (C)." },
      { status: 409 },
    );
  }

  const buf = await renderOsintPdf(content);
  const safe = (caseRow.name || "sprawa").replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 60);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Analiza_OSINT_${safe}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
