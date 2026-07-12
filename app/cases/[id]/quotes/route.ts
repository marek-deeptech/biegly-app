import { computeQuoteDynamics, parseQuotesCsv } from "@/lib/quotes/parse";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET ?path=<storage_path>&from=<YYYY-MM-DD>&to=<YYYY-MM-DD>
// Pobiera plik notowań (CSV) z magazynu, liczy dynamikę kursu w oknie [from,to].
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, reason: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!path) return Response.json({ ok: false, reason: "brak ścieżki pliku" }, { status: 400 });

  // Izolacja spraw: plik musi należeć do TEJ sprawy (storage_path = "<case_id>/…").
  if (!path.startsWith(`${id}/`))
    return Response.json({ ok: false, reason: "plik nie należy do tej sprawy" }, { status: 403 });

  const { data: blob, error } = await supabase.storage.from("case-files").download(path);
  if (error || !blob) return Response.json({ ok: false, reason: "nie pobrano pliku notowań" });

  let dynamics;
  try {
    const rows = parseQuotesCsv(await blob.text());
    dynamics = computeQuoteDynamics(rows, from, to);
  } catch (e) {
    return Response.json({ ok: false, reason: "plik nie jest czytelnym CSV notowań (" + (e as Error).message + ")" });
  }
  return Response.json({ ok: true, dynamics });
}
