import { wykonajBankier, wykonajSprawozdania, wykonajZawiadomienia, zlozAkcjonariat } from "@/lib/opinion/akcjonariat-run";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Krok „Historia zmian w akcjonariacie" — dwa źródła, dwa biegi.
//   { zrodlo: "zawiadomienia", emitent: "CSY S.A." }  ← źródło pierwotne (art. 69)
//   { zrodlo: "sprawozdania", emitent: "CSY S.A." }   ← stan na dzień bilansowy
//   { zrodlo: "bankier", ticker: "HUBTECH", … }       ← tylko spółki notowane
//   { zrodlo: "zloz" }                                ← ponowne złożenie rozdziału
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
    if (body.zrodlo === "zawiadomienia") {
      const w = await wykonajZawiadomienia(supabase, id, { emitent });
      return Response.json(w);
    }
    if (body.zrodlo === "zloz") return Response.json(await zlozAkcjonariat(supabase, id, { emitent }));
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
