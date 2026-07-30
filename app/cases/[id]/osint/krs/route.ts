import { fetchKrsOdpis } from "@/lib/osint/registry";
import { createClient } from "@/lib/supabase/server";

// Odpytanie oficjalnego API KRS (bez klucza) — logika w lib/osint/registry.ts,
// współdzielona z agentem OSINT (obowiązkowy etap rejestrowy). Zwraca dane spółki
// (jawne) oraz skład organów (dane osobowe są ZAMASKOWANE w rejestrze publicznym —
// pełne dane tylko w odpisie z akt sądowych). Źródło jest cytowane w odpowiedzi.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, reason: "unauthorized" }, { status: 401 });

  const krs = (new URL(req.url).searchParams.get("krs") || "").replace(/\D/g, "");
  if (krs.length !== 10)
    return Response.json({ ok: false, reason: "Podaj 10-cyfrowy numer KRS." }, { status: 400 });

  const rec = await fetchKrsOdpis(krs);
  if (!rec) return Response.json({ ok: false, reason: "Nie znaleziono podmiotu w KRS." }, { status: 404 });
  return Response.json({ ok: true, ...rec });
}
