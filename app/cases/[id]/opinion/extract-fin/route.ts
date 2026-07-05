import Anthropic from "@anthropic-ai/sdk";

import { pdfText } from "@/lib/intake/pdf";
import { createClient } from "@/lib/supabase/server";

// Wyciąga kluczowe wielkości ekonomiczno-finansowe emitenta ze sprawozdań w aktach
// (SPRAWOZDANIE_FIN, odczyt PDF przez unpdf) i zapisuje jako subanalizę `fin_stats`
// (Pozycja | Okres | Wartość | Jednostka | Plik). Zasila rozdział IV.1 (ekofin) —
// test falsyfikacji: czy dynamika kursu ma oparcie w fundamentach.
// Evidence-only: model odczytuje WYŁĄCZNIE z treści dokumentów; nie liczy i nie zmyśla.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Item = { file: string; position: string; period: string; value: string; unit: string };

const SYSTEM =
  "Jesteś asystentem biegłego sądowego. Otrzymujesz fragmenty sprawozdań finansowych i raportów okresowych " +
  "emitenta z akt sprawy. Wyodrębnij WYŁĄCZNIE wielkości wprost zapisane w treści — dla pozycji: przychody netto " +
  "ze sprzedaży, zysk/strata z działalności operacyjnej, zysk/strata netto, suma bilansowa (aktywa razem), " +
  "kapitał (fundusz) własny, przepływy pieniężne netto, zatrudnienie — o ile występują. Dla każdej podaj okres " +
  "(np. '2019', '2020', 'I półrocze 2020', 'III kw. 2020') oraz wartość DOKŁADNIE jak w dokumencie (z separatorami) " +
  "i jednostkę ('zł' albo 'tys. zł' — wg nagłówka tabeli w dokumencie). ZASADY: (1) nie przeliczaj, nie sumuj, nie " +
  "zaokrąglaj — przepisuj; (2) pozycji nieobecnych nie zwracaj; (3) Zwróć WYŁĄCZNIE JSON: " +
  '{"items":[{"file":"","position":"","period":"","value":"","unit":""}]}';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY)
    return Response.json({ ok: false, reason: "Brak ANTHROPIC_API_KEY w zmiennych środowiskowych." });

  const { data: docs } = await supabase
    .from("documents")
    .select("rel_path,storage_path")
    .eq("case_id", id)
    .eq("doc_type", "SPRAWOZDANIE_FIN")
    .limit(30);
  const isPdf = (fn: string) => /\.pdf$/i.test(fn) && !/loader|ads|sodar|zrt_|jsapi|cookie|lookup|\.pobrane/i.test(fn);
  const seen = new Set<string>();
  const uniq = (docs ?? [])
    .filter((d) => {
      const fn = String(d.rel_path).split("/").pop() ?? "";
      if (!d.storage_path || !isPdf(fn) || seen.has(fn)) return false;
      seen.add(fn);
      return true;
    })
    .slice(0, 8);
  if (!uniq.length) return Response.json({ ok: false, reason: "Brak sprawozdań finansowych (PDF) ze ścieżką w Storage." });

  const texts: string[] = [];
  for (const d of uniq) {
    const fn = String(d.rel_path).split("/").pop() ?? "";
    try {
      const { data: blob, error } = await supabase.storage.from("case-files").download(d.storage_path as string);
      if (error || !blob) {
        texts.push(`### ${fn}\n[nie udało się pobrać pliku]`);
        continue;
      }
      const text = await pdfText(await blob.arrayBuffer(), 9000);
      texts.push(`### ${fn}\n${text}`);
    } catch (e) {
      texts.push(`### ${fn}\n[błąd odczytu PDF: ${(e as Error).message}]`);
    }
  }

  const userPrompt = [
    "TREŚĆ SPRAWOZDAŃ/RAPORTÓW (nazwa pliku + fragment treści):",
    texts.join("\n\n"),
    "",
    "Wyodrębnij wielkości zgodnie ze schematem JSON.",
  ].join("\n");

  try {
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 3000,
      system: SYSTEM,
      messages: [{ role: "user", content: userPrompt }],
    });
    const raw = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .replace(/```json|```/g, "")
      .trim();
    const s = raw.indexOf("{");
    const e = raw.lastIndexOf("}");
    if (s < 0 || e <= s) return Response.json({ ok: false, reason: "Model nie zwrócił JSON." });
    const parsed = JSON.parse(raw.slice(s, e + 1)) as { items?: Item[] };
    const items: Item[] = (Array.isArray(parsed.items) ? parsed.items : [])
      .filter((v) => v && v.position && v.value)
      .map((v) => ({
        file: String(v.file ?? ""),
        position: String(v.position ?? ""),
        period: String(v.period ?? ""),
        value: String(v.value ?? ""),
        unit: String(v.unit ?? ""),
      }))
      .sort((a, b) => a.position.localeCompare(b.position, "pl") || a.period.localeCompare(b.period, "pl"));

    const table = {
      caption: "Tabela. Wybrane dane ekonomiczno-finansowe emitenta (wyciąg ze sprawozdań w aktach)",
      head: ["Pozycja", "Okres", "Wartość", "Jednostka", "Źródło (plik)"],
      rows: items.map((v) => [v.position, v.period || "—", v.value, v.unit || "—", v.file.split("/").pop() || "—"]),
    };
    await supabase.from("subanalyses").upsert(
      {
        case_id: id,
        kind: "fin_stats",
        chapter_no: "IV",
        title: "Dane finansowe emitenta (wyciąg ze sprawozdań)",
        body_md:
          `Odczytano ${uniq.length} sprawozdań/raportów; wyodrębniono ${items.length} pozycji finansowych` +
          (items.length
            ? ": " + items.slice(0, 8).map((i) => `${i.position} ${i.period}: ${i.value} ${i.unit}`.trim()).join("; ") + "."
            : "."),
        data: { table, items, findings: [`Wyodrębniono ${items.length} pozycji finansowych ze sprawozdań w aktach.`], legalRefs: [] },
        status: "szkic",
      },
      { onConflict: "case_id,kind" },
    );
    return Response.json({ ok: true, items, message: `Odczytano ${uniq.length} PDF-ów, wyodrębniono ${items.length} pozycji.` });
  } catch (e) {
    return Response.json({ ok: false, reason: "Błąd modelu: " + (e as Error).message });
  }
}
