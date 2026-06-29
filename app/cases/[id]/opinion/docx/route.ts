import { Packer } from "docx";

import { buildOpinion } from "@/lib/opinion/build";
import { renderOpinionDocx } from "@/lib/opinion/docx";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: caseRow } = await supabase
    .from("cases")
    .select("name,signature")
    .eq("id", id)
    .single();
  if (!caseRow) return new Response("Not found", { status: 404 });

  const { data: metrics } = await supabase
    .from("metrics")
    .select("key,value,unit,session_day")
    .eq("case_id", id);
  const { data: documents } = await supabase
    .from("documents")
    .select("rel_path,provenance")
    .eq("case_id", id);

  const op = buildOpinion(caseRow, metrics ?? [], documents ?? []);
  const buf = await Packer.toBuffer(renderOpinionDocx(op));

  const safe = (caseRow.name || "sprawa").replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 60);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="Opinia_${safe}.docx"`,
      "Cache-Control": "no-store",
    },
  });
}
