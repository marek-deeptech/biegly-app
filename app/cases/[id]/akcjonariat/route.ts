import { wykonajBankier, wykonajSprawozdania } from "@/lib/opinion/akcjonariat-run";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Krok „Historia zmian w akcjonariacie" — dwa źródła, dwa biegi.
//   { zrodlo: "bankier", ticker: "HUBTECH", emitent: "Hub.Tech S.A." }
//   { zrodlo: "sprawozdania", emitent: "Hub.Tech" }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, reason: "unauthorized" }, { status: 401 });

  const { data: caseRow } = await supabase.from("cases").select("name,typ").eq("id", id).single();
  if (!caseRow) return Response.json({ ok: false, reason: "nie znaleziono sprawy" }, { status: 404 });
  // Krok istnieje wyłącznie w pakiecie manipulacyjnym — w sprawie bankowej nie ma
  // emitenta giełdowego, którego stan posiadania dałoby się śledzić.
  if (caseRow.typ !== "manipulacja_gpw")
    return Response.json({ ok: false, reason: "krok dotyczy spraw o manipulację instrumentami finansowymi" });

  const body = (await req.json().catch(() => ({}))) as { zrodlo?: string; ticker?: string; emitent?: string };
  const emitent = (body.emitent ?? "").trim() || (caseRow.name as string);

  try {
    if (body.zrodlo === "sprawozdania") {
      const w = await wykonajSprawozdania(supabase, id, { emitent });
      return Response.json(w, { status: w.ok ? 200 : 200 });
    }
    if (!body.ticker?.trim())
      return Response.json({ ok: false, reason: "podaj symbol spółki w serwisie Bankier.pl (np. HUBTECH)" });
    const w = await wykonajBankier(supabase, id, { ticker: body.ticker.trim(), emitent });
    return Response.json(w);
  } catch (e) {
    return Response.json({ ok: false, reason: (e as Error).message });
  }
}
