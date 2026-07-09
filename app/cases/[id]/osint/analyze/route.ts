import { advanceRun } from "@/lib/osint/agent";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // pojedynczy KROK; cały przebieg to kilka kroków wołanych z panelu

// C · Analiza OSINT — jeden krok etapowego przebiegu (odporność na limity czasu):
// gather → search → synth → review×(2–3) → finalize. Panel woła w pętli aż done=true.
// Body: { restart?: true } wymusza start od nowa. Stan w subanalizie `osint_run`;
// wynik końcowy w `osint_analysis`.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY)
    return Response.json({ ok: false, reason: "Brak ANTHROPIC_API_KEY w zmiennych środowiskowych." });

  let restart = false;
  try {
    const body = await req.json().catch(() => ({}));
    restart = !!body?.restart;
  } catch { /* brak body */ }

  try {
    const res = await advanceRun(supabase, id, restart);
    return Response.json({ ok: true, ...res });
  } catch (e) {
    return Response.json({ ok: false, reason: `Błąd kroku analizy: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }
}
