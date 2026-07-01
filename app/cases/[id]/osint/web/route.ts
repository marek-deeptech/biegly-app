import { createClient } from "@/lib/supabase/server";

// Wyszukiwanie OSINT przez Brave Search API. Zwraca realne wyniki (tytuł, URL,
// snippet) — biegły wybiera trafne i dodaje do karty z URL-em jako źródłem.
// „social" zawęża do platform przez operator site:. Model NIE wymyśla powiązań.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BraveResult = { title?: string; url?: string; description?: string };
type BraveResp = { web?: { results?: BraveResult[] } };

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, reason: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const social = url.searchParams.get("social") === "1";
  if (!q) return Response.json({ ok: false, reason: "Podaj zapytanie." }, { status: 400 });

  const key = process.env.BRAVE_API_KEY;
  if (!key)
    return Response.json({
      ok: false,
      reason: "Brak BRAVE_API_KEY — dodaj klucz Brave Search API w zmiennych środowiskowych Vercel.",
    });

  const query = social
    ? `${q} (site:linkedin.com OR site:x.com OR site:facebook.com OR site:instagram.com)`
    : q;

  try {
    const r = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`,
      { headers: { Accept: "application/json", "X-Subscription-Token": key }, cache: "no-store" },
    );
    if (!r.ok) return Response.json({ ok: false, reason: `Brave API: HTTP ${r.status}` }, { status: 502 });
    const j = (await r.json()) as BraveResp;
    const results = (j.web?.results ?? [])
      .map((x) => ({ title: (x.title || "").trim(), url: (x.url || "").trim(), description: (x.description || "").trim() }))
      .filter((x) => x.url);
    return Response.json({ ok: true, results, query });
  } catch (e) {
    return Response.json({ ok: false, reason: `Błąd sieci: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }
}
