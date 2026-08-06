import { przepisyAnachroniczne, przepisyNaDzien } from "@/lib/domain/prawo-bankowe";
import { zbudujOtoczeniePrawne } from "@/lib/opinion/warsztat-bank";
import { createClient } from "@/lib/supabase/server";

// KROK „OTOCZENIE PRAWNE" — zapis modułu `otoczenie_prawne` BEZ przebiegu całego
// warsztatu. Warsztat (LLM czyta dokumenty) potrafi trwać minuty i kosztuje;
// otoczenie prawne jest w całości deterministyczne (datowany katalog + data
// zdarzenia), więc ma własną, natychmiastową trasę. Obie trasy piszą ten sam
// kształt danych tym samym budowniczym (zbudujOtoczeniePrawne) — rozjazd między
// nimi wykluczony konstrukcyjnie.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, reason: "unauthorized" }, { status: 401 });

  const { data: caseRow } = await supabase.from("cases").select("typ").eq("id", id).single();
  if (!caseRow) return Response.json({ ok: false, reason: "not found" }, { status: 404 });
  // Bramka dziedziny — katalog przepisów bankowych w sprawie o manipulację
  // podpowiadałby CRR tam, gdzie właściwy jest MAR.
  if (caseRow.typ !== "ryzyko_bankowe")
    return Response.json(
      { ok: false, reason: "Otoczenie prawne w tym kształcie dotyczy wyłącznie spraw o ryzyko bankowe." },
      { status: 409 },
    );

  let body: { dzienZdarzenia?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* puste ciało */
  }
  const dzien = (body.dzienZdarzenia ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dzien))
    return Response.json({
      ok: false,
      reason: "Podaj datę ocenianego zdarzenia (RRRR-MM-DD) — bez niej stanu prawnego nie da się ustalić.",
    });

  const wlasciwe = przepisyNaDzien(dzien);
  const anachroniczne = przepisyAnachroniczne(dzien);
  const prawne = zbudujOtoczeniePrawne(wlasciwe, anachroniczne, dzien);

  // Proza zredagowanego wcześniej rozdziału zostaje — znaczymy tylko, że opisuje
  // wcześniejszy stan (ta sama zasada co w warsztacie i silniku bankowym).
  const { data: istniejaca } = await supabase
    .from("subanalyses")
    .select("body_md")
    .eq("case_id", id)
    .eq("kind", "otoczenie_prawne")
    .maybeSingle();
  const proza = istniejaca?.body_md ?? "";

  const { error } = await supabase.from("subanalyses").upsert(
    {
      case_id: id,
      kind: "otoczenie_prawne",
      chapter_no: "V",
      title: "Otoczenie prawne i standardy identyfikacji ryzyka",
      status: "szkic",
      data: {
        ...prawne.data,
        findings: prawne.findings,
        dzienZdarzenia: dzien,
        ...(proza.trim() ? { proza_sprzed_przeliczenia: true } : {}),
      },
      body_md: proza,
    },
    { onConflict: "case_id,kind" },
  );
  if (error) return Response.json({ ok: false, reason: error.message });

  return Response.json({
    ok: true,
    przepisowWlasciwych: wlasciwe.length,
    anachronicznych: anachroniczne.length,
  });
}
