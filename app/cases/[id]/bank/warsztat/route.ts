import { wykonajWarsztatBankowy } from "@/lib/opinion/warsztat-bank-run";
import { createClient } from "@/lib/supabase/server";

// KROK 4 DZIEDZINY BANKOWEJ — warsztat dowodowy.
//
// Odtwarza z akt dwie rzeczy, na których stoi ocena procesu identyfikacji ryzyka:
//   `procedury` — kto, kiedy i na jakiej podstawie decydował (protokoły komitetu,
//                 uchwały o kompetencjach, ustalenia audytu, korespondencja),
//   `limity`    — jakie limity obowiązywały, jak je wyznaczono i jak się mają
//                 do limitu regulacyjnego OBOWIĄZUJĄCEGO W DACIE ZDARZENIA.
//
// PODZIAŁ PRACY, TAKI SAM JAK W DZIEDZINIE MANIPULACJI:
// model CZYTA dokumenty i wyodrębnia fakty (data, organ, ustalenie, karta akt);
// zestawienie z przepisem robi KOD, na datowanym katalogu z lib/domain/prawo-bankowe.
// Gdyby kwalifikację prawną zostawić modelowi, opinia powoływałaby CRR do decyzji
// z 2008 r. — dokładnie ten błąd, przed którym chroni datowanie katalogu.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY)
    return Response.json({ ok: false, reason: "Brak klucza ANTHROPIC_API_KEY." });

  const { data: caseRow } = await supabase.from("cases").select("name,typ").eq("id", id).single();
  if (!caseRow) return Response.json({ ok: false, reason: "not found" }, { status: 404 });
  // Bramka dziedziny — ta sama zasada co w /api/bank. Warsztat bankowy w sprawie
  // o manipulację szukałby protokołów komitetu, których tam nie ma.
  if (caseRow.typ !== "ryzyko_bankowe")
    return Response.json(
      { ok: false, reason: "Ten warsztat dotyczy wyłącznie spraw o ryzyko bankowe." },
      { status: 409 },
    );

  // Data zdarzenia rozstrzyga, KTÓRE przepisy są właściwe. Bez niej nie zestawiamy
  // limitów z regulacją, zamiast zgadywać.
  let body: { dzienZdarzenia?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* puste ciało */
  }
  return Response.json(await wykonajWarsztatBankowy(supabase, id, (body.dzienZdarzenia ?? "").trim()));
}
