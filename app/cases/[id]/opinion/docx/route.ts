import { Packer } from "docx";


import { sprawdzFinalna } from "@/lib/opinion/bramka-finalna";
import { buildOpinionDla } from "@/lib/opinion/build-router";
import { renderOpinionDocx } from "@/lib/opinion/docx";
import { fetchAllMetrics } from "@/lib/metrics-fetch";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const final = new URL(req.url).searchParams.get("final") === "1";
  const supabase = await createClient();
  const {
    data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: caseRow } = await supabase
    .from("cases")
    .select("name,signature,group_roster,typ,tryb,rola")
    .eq("id", id)
    .single();
  if (!caseRow) return new Response("Not found", { status: 404 });

  const metrics = await fetchAllMetrics(supabase, id);
  const { data: documents } = await supabase
    .from("documents")
    .select("rel_path,provenance")
    .eq("case_id", id);
  const { data: subanalyses } = await supabase
    .from("subanalyses")
    .select("kind,chapter_no,title,status,body_md,data")
    .eq("case_id", id);

  const op = buildOpinionDla(caseRow, metrics ?? [], documents ?? [], subanalyses ?? []);


  // ⚠️ „FINALNA" MA ZNACZYĆ FINALNA. `?final=1` był zwykłym parametrem w adresie

  // i nie sprawdzał niczego — dawało się pobrać opinię bez adnotacji „(projekt

  // roboczy)", złożoną wyłącznie ze szkiców. Wersja robocza zostaje bez warunków.

  if (final) {

    const bramka = sprawdzFinalna(op);

    if (!bramka.ok) return new Response(bramka.powod, { status: 409 });

  }
  const buf = await Packer.toBuffer(renderOpinionDocx(op, { final }));

  const safe = (caseRow.name || "sprawa").replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 60);
  const fname = `Opinia_${safe}${final ? "" : "_projekt"}.docx`;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${fname}"`,
      "Cache-Control": "no-store" } });
}
