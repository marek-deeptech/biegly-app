import { createClient } from "@/lib/supabase/server";
import { wykonajFinStats } from "@/lib/opinion/fin-stats";

// Wyciąga kluczowe wielkości ekonomiczno-finansowe emitenta ze sprawozdań w aktach
// i zapisuje jako subanalizę `fin_stats` — zasila rozdział IV.1 (test falsyfikacji:
// czy dynamika kursu ma oparcie w fundamentach) i dynamikę kw/kw oraz r/r w kroku 4.
//
// Logika mieszka w lib/opinion/fin-stats.ts: trasa i skrypt CLI
// (scripts/fin_stats.ts) wołają ten sam kod, różnią się tylko klientem Supabase.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY)
    return Response.json({ ok: false, reason: "Brak ANTHROPIC_API_KEY w zmiennych środowiskowych." });

  try {
    const w = await wykonajFinStats(supabase, id);
    return w.ok
      ? Response.json({
          ok: true,
          items: w.items,
          message: `Odczytano ${w.plikow} PDF-ów, wyodrębniono ${w.pozycji} pozycji.`,
        })
      : Response.json({ ok: false, reason: w.powod });
  } catch (e) {
    return Response.json({ ok: false, reason: "Błąd modelu: " + (e as Error).message });
  }
}
