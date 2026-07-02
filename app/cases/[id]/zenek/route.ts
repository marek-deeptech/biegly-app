import Anthropic from "@anthropic-ai/sdk";

import { pdfText } from "@/lib/intake/pdf";
import { DOC_TYPES, REQUIRED } from "@/lib/intake/taxonomy";
import { createClient } from "@/lib/supabase/server";

// Zenek — asystent sprawy dla biegłego. Zna kontekst sprawy (roster, wskaźniki
// silnika, ustalenia rozdziałów, zdarzenia ESPI/KRS, pełny wykaz akt) i potrafi
// CZYTAĆ dokumenty z akt (tool read_document → Storage → PDF/TXT), żeby odpowiadać
// na pytania o ich treść. Evidence-only: odpowiada wyłącznie na podstawie danych
// sprawy i przeczytanych plików, zawsze cytuje źródło; ocena prawna należy do sądu.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Doc = { id: string; rel_path: string; doc_type: string; provenance: string | null; storage_path: string | null };
type ChatMsg = { role: "user" | "zenek"; text: string };

const base = (p: string) => p.split("/").pop() || p;
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

// Dopasowanie dokumentu po fragmencie nazwy (bez wielkości liter i diakrytyków).
function matchDoc(docs: Doc[], fragment: string): Doc | null {
  const q = norm(fragment.trim());
  if (!q) return null;
  const cands = docs.filter((d) => d.storage_path && norm(base(d.rel_path)).includes(q));
  if (!cands.length) return null;
  cands.sort((a, b) => base(a.rel_path).length - base(b.rel_path).length);
  return cands[0];
}

const TEXT_EXT = /\.(txt|csv|md|json|log)$/i;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY)
    return Response.json({ ok: false, reason: "Brak ANTHROPIC_API_KEY w zmiennych środowiskowych." });

  let body: { messages?: ChatMsg[] } = {};
  try {
    body = await req.json();
  } catch {
    /* puste ciało */
  }
  const history = (body.messages ?? []).filter((m) => m && m.text).slice(-12);
  if (!history.length || history[history.length - 1].role !== "user")
    return Response.json({ ok: false, reason: "Brak pytania." }, { status: 400 });

  // ── Kontekst sprawy ─────────────────────────────────────────────────────────
  const { data: caseRow } = await supabase.from("cases").select("name,signature,group_roster").eq("id", id).single();
  if (!caseRow) return Response.json({ ok: false, reason: "not found" }, { status: 404 });
  const { data: docsData } = await supabase
    .from("documents")
    .select("id,rel_path,doc_type,provenance,storage_path")
    .eq("case_id", id)
    .limit(3000);
  const docs: Doc[] = (docsData ?? []) as Doc[];
  const { data: metricsData } = await supabase
    .from("metrics")
    .select("key,label,value,unit,session_day")
    .eq("case_id", id)
    .limit(6000);
  const m = metricsData ?? [];
  const { data: subs } = await supabase
    .from("subanalyses")
    .select("kind,chapter_no,title,status,data")
    .eq("case_id", id);

  const roster = ((caseRow.group_roster as { entities?: { name?: string; fragment?: string; kind?: string }[] } | null)
    ?.entities ?? []);
  const podmioty = roster.filter((e) => (e.kind ?? "podmiot") === "podmiot");
  const osoby = roster.filter((e) => e.kind === "osoba");

  const find = (k: string) => m.find((x) => x.key === k);
  const peak = (pfx: string) =>
    m.filter((x) => x.key.startsWith(pfx)).reduce<(typeof m)[number] | null>((a, b) => ((b.value ?? -1) > (a?.value ?? -1) ? b : a), null);
  const days = [...new Set(m.filter((x) => x.session_day).map((x) => x.session_day as string))].sort();
  const lastDay = days[days.length - 1];
  const atLast = (k: string) => m.find((x) => x.key === k && x.session_day === lastDay)?.value ?? null;
  const num = (v: number | null | undefined, u?: string | null) =>
    v == null ? "—" : v.toLocaleString("pl-PL") + (u === "%" ? "%" : u ? ` ${u}` : "");
  const facts: string[] = [];
  const f1 = find("totals_transactions");
  if (f1) facts.push(`transakcje: ${num(f1.value)} o wartości ${num(find("totals_value")?.value, "zł")}`);
  const gs = find("group_turnover_share");
  if (gs) facts.push(`udział Grupy w wartości obrotu: ${num(gs.value, "%")} (${num(find("group_turnover_value")?.value, "zł")})`);
  const wp = peak("wash_");
  if (wp) facts.push(`wash trades — szczyt: ${num(wp.value, "%")} wolumenu sesji (${wp.session_day})`);
  const cp = peak("cancel_");
  if (cp) facts.push(`anulacje kupna Grupy — szczyt: ${num(cp.value, "%")} (${cp.session_day})`);
  const imoC = find("imo_count");
  if (imoC) facts.push(`matched orders ≤2s: ${num(imoC.value)} transakcji, ${num(find("imo_value")?.value, "zł")}`);
  const cc = atLast("day_grp_cum_cash");
  if (cc != null) facts.push(`skumulowany przychód Grupy (${lastDay}): ${num(cc, "zł")}; saldo wolumenu: ${num(atLast("day_grp_cum_vol"), "szt")}`);
  const hi = peak("day_high");
  if (hi) facts.push(`kurs maksymalny: ${num(hi.value, "zł")} (${hi.session_day}); okres: ${days[0]} → ${lastDay}`);
  const sellers = m
    .filter((x) => x.key.startsWith("ent_sell_share::"))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .slice(0, 3)
    .map((x) => `${x.key.split("::")[1]} ${num(x.value, "%")}`);
  if (sellers.length) facts.push(`najwięksi sprzedawcy: ${sellers.join(", ")}`);

  const approved = (subs ?? []).filter((s) => s.status === "zatwierdzona");
  const findings = approved
    .filter((s) => String(s.chapter_no).startsWith("IV") || s.chapter_no === "II")
    .map((s) => `- ${s.title} (rozdz. ${s.chapter_no}): ${((s.data?.findings ?? []) as string[]).join(" ")}`.trim())
    .filter((x) => !x.endsWith(":"));
  const events =
    ((subs ?? []).find((s) => s.kind === "espi_events")?.data as {
      events?: { date?: string; type?: string; subject?: string; session?: string }[];
    } | null)?.events ?? [];
  const shared =
    ((subs ?? []).find((s) => s.kind === "krs_boards")?.data as {
      shared?: { name?: string; entities?: string[] }[];
    } | null)?.shared ?? [];

  const present = new Set(docs.map((d) => d.doc_type));
  const missing = REQUIRED.filter((c) => !present.has(c)).map((c) => DOC_TYPES[c]?.label ?? c);

  // Wykaz akt: typ (liczba) + nazwy plików (dedup), wyjściowe oznaczone.
  const byType = new Map<string, Set<string>>();
  for (const d of docs) {
    const key = d.doc_type + (d.provenance === "wyjście" ? " [WYJŚCIE]" : "");
    const s = byType.get(key) ?? new Set<string>();
    s.add(base(d.rel_path));
    byType.set(key, s);
  }
  const inventory = [...byType.entries()]
    .sort((a, b) => b[1].size - a[1].size)
    .map(([t, names]) => `${t} (${DOC_TYPES[t.replace(" [WYJŚCIE]", "")]?.label ?? t}; ${names.size}): ${[...names].join("; ")}`)
    .join("\n");

  const system =
    `Jesteś Zenek — asystent biegłego sądowego w sprawie ${caseRow.name}` +
    (caseRow.signature ? ` (sygn. ${caseRow.signature})` : "") +
    `. Pomagasz biegłemu poruszać się po aktach: znasz wykaz dokumentów, podmioty i osoby sprawy, wskaźniki ` +
    `deterministycznego silnika oraz ustalenia rozdziałów opinii. Umiesz CZYTAĆ dokumenty narzędziem read_document ` +
    `(podaj fragment nazwy pliku z wykazu) — używaj go, gdy pytanie dotyczy TREŚCI dokumentu.\n\n` +
    `ZASADY BEZWZGLĘDNE: (1) Odpowiadasz WYŁĄCZNIE na podstawie danych poniżej i treści przeczytanych dokumentów — ` +
    `niczego nie zmyślasz; czego nie ma w aktach, mówisz wprost. (2) Zawsze wskazuj źródło: [plik: nazwa] / ` +
    `[silnik] / [rozdz. X] / [roster]. (3) Liczb nie wyliczasz samodzielnie — cytujesz wskaźniki silnika. ` +
    `(4) Nie przesądzasz o winie, zamiarze ani kwalifikacji prawnej — to domena sądu. (5) Odpowiadasz po polsku, ` +
    `zwięźle i konkretnie.\n\n` +
    `PODMIOTY GRUPY (roster, ${podmioty.length}): ${podmioty.map((e) => e.name).join("; ") || "—"}\n` +
    `OSOBY (roster, ${osoby.length}): ${osoby.map((e) => e.name).join("; ") || "—"}\n\n` +
    `WSKAŹNIKI SILNIKA:\n${facts.map((f) => "- " + f).join("\n") || "- (nie policzono)"}\n\n` +
    (findings.length ? `USTALENIA ZATWIERDZONYCH ROZDZIAŁÓW:\n${findings.join("\n")}\n\n` : "") +
    (events.length
      ? `ZDARZENIA ESPI/EBI (z akt): ${events
          .map((e) => `${e.date} — ${(e.type || e.subject || "").trim()}${e.session ? ` (sesja ${e.session})` : ""}`)
          .join("; ")}\n\n`
      : "") +
    (shared.length
      ? `OSOBY W WIELU PODMIOTACH (KRS): ${shared.map((x) => `${x.name} (${(x.entities ?? []).join(", ")})`).join("; ")}\n\n`
      : "") +
    (missing.length ? `BRAKUJĄCE DOKUMENTY OBOWIĄZKOWE: ${missing.join(", ")}\n\n` : `KOMPLET dokumentów obowiązkowych.\n\n`) +
    `WYKAZ AKT (${docs.length} plików):\n${inventory}`;

  const tools: Anthropic.Tool[] = [
    {
      name: "read_document",
      description:
        "Czyta treść dokumentu z akt sprawy (PDF/TXT). Podaj fragment nazwy pliku z WYKAZU AKT. Pliki .xlsx to dane liczbowe silnika — nie czytaj ich, cytuj WSKAŹNIKI.",
      input_schema: {
        type: "object",
        properties: { file: { type: "string", description: "fragment nazwy pliku z wykazu akt" } },
        required: ["file"],
      },
    },
  ];

  async function readDoc(fragment: string): Promise<{ doc: Doc | null; content: string }> {
    const doc = matchDoc(docs, fragment);
    if (!doc) return { doc: null, content: `Nie znalazłem w aktach pliku pasującego do „${fragment}".` };
    const name = base(doc.rel_path);
    if (/\.(xlsx|xls)$/i.test(name))
      return { doc, content: `${name}: plik danych (.xlsx) — zawartość liczbową przetwarza silnik faktów; cytuj WSKAŹNIKI z kontekstu.` };
    try {
      const { data: blob, error } = await supabase.storage.from("case-files").download(doc.storage_path as string);
      if (error || !blob) return { doc, content: `${name}: nie udało się pobrać pliku ze Storage.` };
      const buf = await blob.arrayBuffer();
      if (TEXT_EXT.test(name)) return { doc, content: `### ${name}\n${new TextDecoder().decode(buf).slice(0, 12000)}` };
      const text = await pdfText(buf, 12000);
      return { doc, content: `### ${name}\n${text || "(pusty tekst — możliwy skan bez warstwy tekstowej)"}` };
    } catch (e) {
      return { doc, content: `${name}: błąd odczytu (${(e as Error).message}).` };
    }
  }

  const messages: Anthropic.MessageParam[] = history.map((h) => ({
    role: h.role === "user" ? ("user" as const) : ("assistant" as const),
    content: h.text,
  }));
  const read: { name: string; storage_path: string | null }[] = [];

  try {
    const client = new Anthropic();
    for (let i = 0; i < 5; i++) {
      const resp = await client.messages.create({
        model: "claude-opus-4-8",
        max_tokens: 1600,
        system,
        tools,
        messages,
      });
      if (resp.stop_reason === "tool_use") {
        messages.push({ role: "assistant", content: resp.content });
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const b of resp.content) {
          if (b.type !== "tool_use") continue;
          const frag = String((b.input as { file?: string }).file ?? "");
          const { doc, content } = await readDoc(frag);
          if (doc) read.push({ name: base(doc.rel_path), storage_path: doc.storage_path });
          results.push({ type: "tool_result", tool_use_id: b.id, content });
        }
        messages.push({ role: "user", content: results });
        continue;
      }
      const text = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return Response.json({ ok: true, text: text || "(brak treści)", read });
    }
    return Response.json({ ok: false, reason: "Przekroczono limit odczytów dokumentów w jednej odpowiedzi." });
  } catch (e) {
    return Response.json({ ok: false, reason: "Błąd modelu: " + (e as Error).message });
  }
}
