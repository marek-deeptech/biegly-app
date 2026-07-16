import { renderGraphPdf } from "@/lib/opinion/graph-pdf";
import { milisystemGraphSvg } from "@/lib/osint/graph";
import { buildRelationGraph, relationGraphSvg } from "@/lib/opinion/relation-graph";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Załącznik „Graf powiązań kapitałowo-osobowych" (PDF poziomy). Dla sprawy Milisystem
// — kuratorowany graf (milisystemGraphSvg). Dla pozostałych — generowany z danych
// ugruntowanych: roster Grupy (podmioty + beneficjenci), KRS (wspólne organy),
// obrót wewnątrzgrupowy (pair_intra z UTP). Brak rostera → 409.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: caseRow } = await supabase.from("cases").select("name,signature,group_roster").eq("id", id).single();
  if (!caseRow) return new Response("Not found", { status: 404 });

  const nm = (caseRow.name ?? "").toLowerCase();
  const isMlm = /milisystem|intelligent gaming|2intellect|\bmlm\b/.test(nm);

  let svg: string;
  let note: string;
  if (isMlm) {
    svg = milisystemGraphSvg();
    note = "Graf kuratorowany na podstawie KRS, GLEIF, akt sprawy i źródeł jawnych. Źródło: opracowanie własne.";
  } else {
    const entities = (caseRow.group_roster as { entities?: { name: string; kind: string; fragment?: string }[] } | null)?.entities ?? [];
    if (!entities.length) {
      return Response.json(
        { ok: false, reason: "Brak zdefiniowanego składu Grupy (roster). Uzupełnij roster w zakładce Sprawa, aby wygenerować graf." },
        { status: 409 },
      );
    }
    const [{ data: pm }, { data: krsSub }] = await Promise.all([
      supabase.from("metrics").select("key,value").eq("case_id", id).like("key", "pair_intra::%").order("value", { ascending: false }).limit(30),
      supabase.from("subanalyses").select("data").eq("case_id", id).eq("kind", "krs_boards").maybeSingle(),
    ]);
    const pairs = (pm ?? []).map((m) => {
      const [a, b] = m.key.slice("pair_intra::".length).split("|");
      return { a, b, value: m.value ?? 0 };
    });
    const krs = ((krsSub?.data as { persons?: { name: string; role: string; entity: string }[] } | null)?.persons) ?? [];
    const emitterLabel = /hub/.test(nm) ? "HubTech S.A." : (caseRow.name ?? "Emitent");
    const { graph } = buildRelationGraph({ caseName: caseRow.name ?? "", signature: caseRow.signature, emitterLabel, entities, pairs, krs });
    svg = relationGraphSvg(graph);
    note =
      "Graf generowany z danych ugruntowanych: roster Grupy (podmioty + beneficjenci/reprezentanci), KRS (wspólne organy), " +
      "obrót wewnątrzgrupowy (dane UTP). Źródło: opracowanie własne na podstawie akt sprawy.";
  }

  const buf = await renderGraphPdf({ caseName: caseRow.name ?? "sprawa", signature: caseRow.signature, svg, note });
  const safe = (caseRow.name || "sprawa").replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 60);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Graf_powiazan_${safe}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
