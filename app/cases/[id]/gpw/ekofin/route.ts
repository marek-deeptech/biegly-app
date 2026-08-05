// KROK 4 GPW — analiza ekonomiczno-finansowa emitenta (pobór stooq + przeliczenie).
//
// POST body:
//   { action: "pobierz",  config: KonfigEkofin }  → pobiera CSV stooq do pozyskane/
//   { action: "przelicz", config?: KonfigEkofin } → liczy i zapisuje `ekofin_dane`
//     (bez config używa zapisanego przy poprzednim przeliczeniu — fail-loud gdy brak).
//
// Logika w lib/opinion/ekofin-run.ts — trasa i CLI (scripts/ekofin_gpw.ts) wołają
// ten sam kod; różnią się wyłącznie klientem Supabase.
import { createClient } from "@/lib/supabase/server";
import { pobierzStooq, wykonajEkofin, type KonfigEkofin } from "@/lib/opinion/ekofin-run";

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

  const body = (await req.json().catch(() => ({}))) as { action?: string; config?: KonfigEkofin };
  let config = body.config ?? null;
  if (!config) {
    const { data: sub } = await supabase
      .from("subanalyses")
      .select("data")
      .eq("case_id", id)
      .eq("kind", "ekofin_dane")
      .maybeSingle();
    config = ((sub?.data as { config?: KonfigEkofin } | null)?.config ?? null) as KonfigEkofin | null;
  }
  if (!config?.emitent?.ticker)
    return Response.json({ ok: false, reason: "Podaj konfigurację: ticker emitenta (i ewentualnie spółki porównawcze)." });

  try {
    if (body.action === "pobierz") {
      const tickery = [config.emitent.ticker, ...config.peers.map((p) => p.ticker)];
      const w = await pobierzStooq(supabase, id, tickery);
      return Response.json({ ok: !w.bledy.length, ...w });
    }
    const w = await wykonajEkofin(supabase, id, config);
    return Response.json(w, { status: w.ok ? 200 : 400 });
  } catch (e) {
    return Response.json({ ok: false, reason: (e as Error).message }, { status: 500 });
  }
}
