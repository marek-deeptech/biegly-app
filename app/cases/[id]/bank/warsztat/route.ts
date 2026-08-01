import Anthropic from "@anthropic-ai/sdk";

import { przepisyAnachroniczne, przepisyNaDzien } from "@/lib/domain/prawo-bankowe";
import { tekstZPliku } from "@/lib/intake/office";
import { pdfText } from "@/lib/intake/pdf";
import { createClient } from "@/lib/supabase/server";

// KROK 4 DZIEDZINY BANKOWEJ — warsztat dowodowy.
//
// Odtwarza z akt dwie rzeczy, na których stoi ocena procesu identyfikacji ryzyka:
//   `procedury` — kto, kiedy i na jakiej podstawie decydował (protokoły komitetu,
//                 uchwały o kompetencjach, ustalenia audytu, korespondencja),
//   `limity`    — jakie limity obowiązywały, jak je wyznaczono i jak się mają
//                 do limitu regulacyjnego OBOWIĄZUJĄCEGO W DACIE ZDARZENIA.
//
// PODZIAŁ PRACY, TAKI SAM JAK W DZIEDZINIE MANIPULACJI:
// model CZYTA dokumenty i wyodrębnia fakty (data, organ, ustalenie, karta akt);
// zestawienie z przepisem robi KOD, na datowanym katalogu z lib/domain/prawo-bankowe.
// Gdyby kwalifikację prawną zostawić modelowi, opinia powoływałaby CRR do decyzji
// z 2008 r. — dokładnie ten błąd, przed którym chroni datowanie katalogu.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TYPY_PROCEDURY = ["PROTOKOL_KOMITETU", "UCHWALA_WEWNETRZNA", "AUDYT_WEWNETRZNY", "KORESPONDENCJA_WEWN"];
const TYPY_LIMITY = ["METODYKA_LIMITOW"];
const MAX_ZN_DOK = 24000;

type Zdarzenie = { plik: string; data: string; organ: string; ustalenie: string; osoby?: string[] };
type Limit = { plik: string; okres: string; podstawa: string; kwota: string; termin?: string };

const SYSTEM_PROCEDURY =
  "Jesteś asystentem biegłego sądowego z zakresu bankowości. Otrzymujesz fragmenty dokumentów " +
  "wewnętrznych banku z akt sprawy karnej (protokoły komitetów, uchwały zarządu o kompetencjach, " +
  "ustalenia audytu wewnętrznego, korespondencja departamentów). Wyodrębnij DATOWANE ZDARZENIA " +
  "procesu decyzyjnego: date (YYYY-MM-DD), organ (np. 'Komitet Zarządzania Aktywami i Pasywami', " +
  "'Zarząd Banku', 'Departament Ryzyka Finansowego', 'audyt wewnętrzny'), ustalenie (1–3 zdania: co " +
  "postanowiono, zatwierdzono, zgłoszono lub stwierdzono — z kwotami i numerami uchwał, jeśli są), " +
  "oraz osoby wymienione z imienia i nazwiska (osoby: tablica; pusta, gdy brak). " +
  "ZASADY BEZWZGLĘDNE: (1) wyłącznie na podstawie treści — nie zmyślaj dat, kwot, nazwisk ani " +
  "numerów; czego nie ma, pomiń. (2) NIE OCENIAJ, czy postępowanie było prawidłowe — ocena należy " +
  "do biegłego, a kwalifikacja czynu do organu. Opisujesz, co dokument stwierdza. " +
  '(3) Zwróć WYŁĄCZNIE JSON: {"zdarzenia":[{"plik":"","data":"YYYY-MM-DD","organ":"","ustalenie":"","osoby":[]}]}';

const SYSTEM_LIMITY =
  "Jesteś asystentem biegłego sądowego z zakresu bankowości. Otrzymujesz fragmenty metodyki " +
  "wyznaczania limitów zaangażowania banku. Wyodrębnij obowiązujące LIMITY: okres (np. 'III kw. 2008'), " +
  "podstawa wyznaczenia (np. '2,5-krotność funduszy własnych'), kwota (dokładnie jak w dokumencie, " +
  "np. '272 mln zł'), termin zaangażowania (termin: np. 'do 1 dnia', 'do 3 miesięcy', 'do 1 roku'). " +
  "ZASADY: (1) przepisuj wartości dosłownie z dokumentu, nie przeliczaj i nie zaokrąglaj. " +
  "(2) nie oceniaj adekwatności limitu — to zadanie biegłego. " +
  '(3) Zwróć WYŁĄCZNIE JSON: {"limity":[{"plik":"","okres":"","podstawa":"","kwota":"","termin":""}]}';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY)
    return Response.json({ ok: false, reason: "Brak klucza ANTHROPIC_API_KEY." });

  const { data: caseRow } = await supabase.from("cases").select("name,typ").eq("id", id).single();
  if (!caseRow) return Response.json({ ok: false, reason: "not found" }, { status: 404 });
  // Bramka dziedziny — ta sama zasada co w /api/bank. Warsztat bankowy w sprawie
  // o manipulację szukałby protokołów komitetu, których tam nie ma.
  if (caseRow.typ !== "ryzyko_bankowe")
    return Response.json(
      { ok: false, reason: "Ten warsztat dotyczy wyłącznie spraw o ryzyko bankowe." },
      { status: 409 },
    );

  // Data zdarzenia rozstrzyga, KTÓRE przepisy są właściwe. Bierzemy ją z ciała żądania
  // albo z rostera sprawy; bez niej nie zestawiamy limitów z regulacją, zamiast zgadywać.
  let body: { dzienZdarzenia?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* puste ciało */
  }
  const dzien = (body.dzienZdarzenia ?? "").trim();

  const { data: docs } = await supabase
    .from("documents")
    .select("rel_path,doc_type,storage_path,warstwa_tekstu")
    .eq("case_id", id);
  const wszystkie = docs ?? [];

  // Skan bez OCR jest pustym plikiem. Ale ORYGINAŁ skanu, którego wersja po OCR
  // jest już w aktach, NIE jest luką — jego treść została odczytana z bliźniaka.
  // Mieszanie tych dwóch przypadków w jednym komunikacie sugerowało utratę treści,
  // której nie było; biegły musi wiedzieć, co realnie wypadło z analizy.
  const nazwaPliku = (rp: string) => (rp.split("/").pop() ?? rp).normalize("NFC");
  const poOcr = new Set(
    wszystkie.filter((d) => d.warstwa_tekstu === "ocr").map((d) => nazwaPliku(d.rel_path)),
  );
  const istotne = wszystkie.filter(
    (d) => [...TYPY_PROCEDURY, ...TYPY_LIMITY].includes(d.doc_type) && d.warstwa_tekstu === "brak",
  );
  // Nieczytelne i BEZ odpowiednika po OCR — to jest prawdziwa luka dowodowa.
  const bezOcr = istotne
    .filter((d) => !poOcr.has(nazwaPliku(d.rel_path).replace(/\.pdf$/i, ".ocr.pdf")))
    .map((d) => nazwaPliku(d.rel_path));
  // Oryginały skanów, których treść weszła do analizy przez wersję po OCR.
  const zastapioneOcr = istotne.length - bezOcr.length;

  async function tekstyDla(typy: string[]): Promise<{ plik: string; tekst: string }[]> {
    const wybrane = wszystkie.filter(
      (d) => typy.includes(d.doc_type) && d.storage_path && d.warstwa_tekstu !== "brak",
    );
    const out: { plik: string; tekst: string }[] = [];
    for (const d of wybrane.slice(0, 12)) {
      const { data: blob } = await supabase.storage.from("case-files").download(d.storage_path!);
      if (!blob) continue;
      const nazwa = d.rel_path.split("/").pop() ?? d.rel_path;
      const buf = await blob.arrayBuffer();
      // .docx i .xlsx to archiwa ZIP — `blob.text()` dawał na nich binarne śmieci.
      // Przez to wypadły KWOTY LIMITÓW: 254 i 272 mln zł są w arkuszu, nie w PDF.
      const tekst = /\.pdf$/i.test(nazwa) ? await pdfText(buf) : await tekstZPliku(nazwa, buf);
      if (tekst.trim().length > 200) out.push({ plik: nazwa, tekst: tekst.slice(0, MAX_ZN_DOK) });
    }
    return out;
  }

  const client = new Anthropic();
  async function wyodrebnij<T>(system: string, dok: { plik: string; tekst: string }[], klucz: string): Promise<T[]> {
    if (!dok.length) return [];
    const msg = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 8000,
      system,
      messages: [
        {
          role: "user",
          content: dok.map((d) => `### PLIK: ${d.plik}\n${d.tekst}`).join("\n\n"),
        },
      ],
    });
    const txt = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    try {
      const m = txt.match(/\{[\s\S]*\}/);
      return m ? ((JSON.parse(m[0])[klucz] ?? []) as T[]) : [];
    } catch {
      return [];
    }
  }

  const [dokProc, dokLim] = await Promise.all([tekstyDla(TYPY_PROCEDURY), tekstyDla(TYPY_LIMITY)]);
  const [zdarzenia, limity] = await Promise.all([
    wyodrebnij<Zdarzenie>(SYSTEM_PROCEDURY, dokProc, "zdarzenia"),
    wyodrebnij<Limit>(SYSTEM_LIMITY, dokLim, "limity"),
  ]);
  zdarzenia.sort((a, b) => String(a.data).localeCompare(String(b.data)));

  // ZESTAWIENIE Z PRZEPISEM — deterministyczne, na datowanym katalogu.
  const wlasciwe = dzien ? przepisyNaDzien(dzien) : [];
  const anachroniczne = dzien ? przepisyAnachroniczne(dzien) : [];

  const zapisz = async (kind: string, title: string, chapter_no: string, data: unknown, findings: string[]) => {
    await supabase.from("subanalyses").upsert(
      { case_id: id, kind, title, chapter_no, status: "szkic", body_md: "", data: { ...(data as object), findings } },
      { onConflict: "case_id,kind" },
    );
  };

  await zapisz(
    "procedury",
    "Proces decyzyjny i dokumenty wewnętrzne",
    "V",
    {
      table: {
        caption: "Tabela. Chronologia procesu decyzyjnego",
        head: ["Data", "Organ", "Ustalenie", "Osoby", "Źródło"],
        rows: zdarzenia.map((z) => [z.data, z.organ, z.ustalenie, (z.osoby ?? []).join(", "), z.plik]),
      },
      bezOcr,
      zastapioneOcr,
      przepisy: wlasciwe.filter((p) => p.moduly.includes("procedury")).map((p) => `${p.ref} — ${p.zakres}`),
    },
    zdarzenia.length
      ? [`Odtworzono ${zdarzenia.length} datowanych zdarzeń procesu decyzyjnego z ${dokProc.length} dokumentów.`]
      : ["Nie odtworzono zdarzeń — brak czytelnych dokumentów wewnętrznych w aktach."],
  );

  await zapisz(
    "limity",
    "Metodyka limitów i koncentracja zaangażowania",
    "V",
    {
      table: {
        caption: "Tabela. Limity zaangażowania wg metodyki banku",
        head: ["Okres", "Termin", "Podstawa wyznaczenia", "Kwota", "Źródło"],
        rows: limity.map((l) => [l.okres, l.termin ?? "", l.podstawa, l.kwota, l.plik]),
      },
      dzienZdarzenia: dzien || null,
      przepisy: wlasciwe.filter((p) => p.moduly.includes("limity")).map((p) => `${p.ref} — ${p.zakres}`),
      anachroniczne: anachroniczne.filter((p) => p.moduly.includes("limity")).map((p) => `${p.ref} (od ${p.od})`),
    },
    limity.length
      ? [`Odczytano ${limity.length} pozycji limitów z metodyki banku.`]
      : ["Nie odczytano limitów — brak czytelnej metodyki w aktach."],
  );

  return Response.json({
    ok: true,
    zdarzen: zdarzenia.length,
    limitow: limity.length,
    dokumentow: dokProc.length + dokLim.length,
    bezOcr,
    zastapioneOcr,
    przepisow: wlasciwe.length,
    anachronicznych: anachroniczne.length,
  });
}
