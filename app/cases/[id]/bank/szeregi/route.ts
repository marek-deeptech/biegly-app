import { pozyskajSzeregiBankowe } from "@/lib/opinion/szeregi-bank-run";
import { createClient } from "@/lib/supabase/server";

// KROK „OTOCZENIE MAKRO" — pozyskanie publicznych szeregów tła (NBP, stooq)
// do akt sprawy bankowej. Trasa TYLKO pozyskuje (Storage + documents z proweniencją
// „pozyskane przez biegłego"); liczenie zostaje w /api/makro i /api/sygnaly,
// które czytają akta — dokładnie jak przy materiale wgranym ręcznie.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, reason: "unauthorized" }, { status: 401 });

  const { data: caseRow } = await supabase.from("cases").select("typ").eq("id", id).single();
  if (!caseRow) return Response.json({ ok: false, reason: "not found" }, { status: 404 });
  if (caseRow.typ !== "ryzyko_bankowe")
    return Response.json(
      { ok: false, reason: "Pozyskiwanie szeregów tła dotyczy wyłącznie spraw o ryzyko bankowe." },
      { status: 409 },
    );

  let body: { dzienZdarzenia?: string; obligacje?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* puste ciało */
  }

  const wynik = await pozyskajSzeregiBankowe(supabase, id, {
    dzienZdarzenia: (body.dzienZdarzenia ?? "").trim() || null,
    obligacje: (body.obligacje ?? "").trim() || null,
  });
  return Response.json({ ok: true, ...wynik });
}
