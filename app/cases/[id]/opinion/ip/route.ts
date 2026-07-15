import { renderIpPdf, type IpTable } from "@/lib/opinion/ip-pdf";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Załącznik „Wykaz powiązań IP" (PDF) — renderuje analizę zbieżności adresów IP
// (subanaliza `powiazania_dane`, zapisana przez /api/ip). Brak danych → 409.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: caseRow } = await supabase.from("cases").select("name,signature").eq("id", id).single();
  if (!caseRow) return new Response("Not found", { status: 404 });

  const { data: sub } = await supabase
    .from("subanalyses")
    .select("body_md,data")
    .eq("case_id", id)
    .eq("kind", "powiazania_dane")
    .maybeSingle();
  const table = (sub?.data as { table?: IpTable } | null)?.table ?? null;
  if (!table || !table.rows?.length) {
    return Response.json(
      { ok: false, reason: "Brak wykazu powiązań IP. Uruchom najpierw analizę zbieżności IP (Powiązania — dane)." },
      { status: 409 },
    );
  }
  const findings = ((sub?.data as { findings?: string[] } | null)?.findings) ?? [];
  const events =
    ((sub?.data as { chart?: { events?: { date: string; ip: string; user: string }[] } } | null)?.chart?.events) ?? [];
  const buf = await renderIpPdf({
    caseName: caseRow.name,
    signature: caseRow.signature,
    summary: sub?.body_md ?? "",
    table,
    findings,
    events,
  });
  const safe = (caseRow.name || "sprawa").replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 60);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Wykaz_powiazan_IP_${safe}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
