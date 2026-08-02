import Anthropic from "@anthropic-ai/sdk";


import { buildOpinionDla } from "@/lib/opinion/build-router";
import { reviewOpinion } from "@/lib/opinion/review";
import { fetchAllMetrics } from "@/lib/metrics-fetch";
import { buildAudytPrompt, RUBRYKA_BANK, SYSTEM_AUDYT_BANK, type KryteriumRubryki } from "@/lib/opinion/audyt-bank";
import { createClient } from "@/lib/supabase/server";

// AGENT AUDYTORA OPINII — mierzalna kontrola jakości wyjścia.
//
// Warstwa 1 (deterministyczna): reużywa istniejący `reviewOpinion` — placeholdery,
// tabele, podstawy prawne, kalibracja, zakres, kompletność. Tego NIE dubluje model.
//
// Warstwa 2 (model): sprawdza to, czego kod sprawdzić nie może — czy każde pytanie
// organu ma realną odpowiedź, czy każda teza o manipulacji ma pokrycie w konkretnej
// liczbie, czy atrybucja jest imienna i czy fakty są oddzielone od ocen prawnych.
//
// ZASADA: audytor weryfikuje opinię wobec DANYCH (wykaz metryk silnika podany jako
// materiał kontrolny), a nie wobec opinii innego modelu. Każda liczba w tekście musi
// dać się odnaleźć w metrykach — inaczej audytor zgłasza ją jako niepotwierdzoną.
// To odróżnia audyt od „drugiego agenta, który przyklepuje pierwszego".

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Kryterium = {
  kryterium: string;
  status: "spelnione" | "czesciowo" | "brak";
  waga: number;
  uwaga: string;
};

const RUBRYKA_GPW = [
  { id: "pytania", waga: 25, opis: "Każde pytanie organu ma w rozdziale II wyraźną, wprost sformułowaną odpowiedź (a nie samo streszczenie ustaleń)." },
  { id: "pokrycie", waga: 25, opis: "Każda teza o wystąpieniu techniki manipulacji jest poparta konkretną liczbą (udział %, wolumen, liczba sesji) — a ta liczba występuje w WYKAZIE METRYK." },
  { id: "atrybucja", waga: 15, opis: "Ustalenia są przypisane imiennie: który podmiot, w której sesji, w jakiej wielkości — zamiast bezosobowego „Grupa działała…”." },
  { id: "podstawa", waga: 15, opis: "Każda technika ma wskazaną podstawę prawną (art. 12 MAR i właściwa litera zał. I / RD 2016/522)." },
  { id: "fakty_oceny", waga: 10, opis: "Ustalenia faktyczne są oddzielone od ocen prawnych; opinia nie przesądza winy ani kwalifikacji zastrzeżonej dla sądu." },
  { id: "zrodla", waga: 10, opis: "Wskazano źródło danych (plik/akta) dla ustaleń liczbowych; braki oznaczono uczciwie zamiast je pomijać." },
] as const;

const SYSTEM_GPW =
  "Jesteś audytorem opinii biegłego sądowego z zakresu manipulacji instrumentami finansowymi. " +
  "Twoim zadaniem NIE jest napisanie ani poprawienie opinii, lecz jej OCENA wobec rubryki. " +
  "ZASADY BEZWZGLĘDNE: " +
  "(1) Oceniaj wyłącznie na podstawie przekazanego TEKSTU OPINII i WYKAZU METRYK. " +
  "(2) Każdą liczbę występującą w opinii traktuj jako niepotwierdzoną, jeśli nie odnajdujesz jej " +
  "w wykazie metryk — zgłoś to wprost jako uwagę przy kryterium „pokrycie”. " +
  "(3) Nie chwal. Uwaga ma wskazywać KONKRETNY brak (rozdział + czego brakuje), inaczej jest bezużyteczna. " +
  "(4) Nie proponuj tez merytorycznych ani nie sugeruj, że manipulacja wystąpiła lub nie — to rola biegłego. " +
  "(5) Odpowiadasz WYŁĄCZNIE wywołaniem narzędzia oceń_opinie.";

// Rubryka i prompt zależą od DZIEDZINY. Rubryka GPW ocenia pokrycie tez o technikach
// manipulacji i wskazanie litery załącznika I do MAR — w opinii bankowej nie ma ani
// technik, ani MAR, więc audytor wystawiałby „brak" za nieobecność rzeczy, których
// w tej dziedzinie być nie może, a niska ocena czytałaby się jak wada opinii.
const rubrykaDla = (typ: string | null) =>
  typ === "ryzyko_bankowe" ? RUBRYKA_BANK : (RUBRYKA_GPW as readonly KryteriumRubryki[]);
const systemDla = (typ: string | null) => (typ === "ryzyko_bankowe" ? SYSTEM_AUDYT_BANK : SYSTEM_GPW);

const TOOL: Anthropic.Tool = {
  name: "ocen_opinie",
  description: "Zwraca ocenę opinii wobec rubryki audytu.",
  input_schema: {
    type: "object",
    properties: {
      kryteria: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "identyfikator kryterium z rubryki" },
            status: { type: "string", enum: ["spelnione", "czesciowo", "brak"] },
            uwaga: { type: "string", description: "konkretny brak: rozdział + czego brakuje (do 40 słów)" } },
          required: ["id", "status", "uwaga"] } },
      podsumowanie: { type: "string", description: "2–3 zdania: co najpilniej poprawić przed złożeniem opinii" } },
    required: ["kryteria", "podsumowanie"] } };

const MAX_ZN_ROZDZIALU = 6000;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY)
    return Response.json({ ok: false, reason: "Brak ANTHROPIC_API_KEY w zmiennych środowiskowych." });

  const { data: caseRow } = await supabase
    .from("cases")
    .select("name,signature,group_roster,typ")
    .eq("id", id)
    .single();
  if (!caseRow) return Response.json({ ok: false, reason: "not found" }, { status: 404 });

  const metrics = await fetchAllMetrics(supabase, id);
  const { data: documents } = await supabase.from("documents").select("rel_path,provenance").eq("case_id", id);
  const { data: subanalyses } = await supabase
    .from("subanalyses")
    .select("kind,chapter_no,title,status,body_md,data")
    .eq("case_id", id);

  const op = buildOpinionDla(caseRow as never, metrics ?? [], (documents ?? []) as never, (subanalyses ?? []) as never);

  // ── Warstwa 1: deterministyczna (istniejący recenzent) ──
  // DZIEDZINA rozstrzyga rubrykę i prompt audytu.
  const bankowa = caseRow.typ === "ryzyko_bankowe";
  const RUBRYKA = rubrykaDla(caseRow.typ ?? null);
  // Data zdarzenia z warsztatu (Krok 4) — audytor bez niej nie sprawdzi ani stanu
  // prawnego, ani granicy wiedzy dostępnej w dniu decyzji.
  const dzienZdarzenia =
    ((subanalyses ?? []).find((s) => s.kind === "limity")?.data as { dzienZdarzenia?: string | null } | undefined)
      ?.dzienZdarzenia ?? null;

  const det = reviewOpinion(op, (metrics ?? []) as never, (subanalyses ?? []) as never);
  const bledy = det.filter((f) => f.severity === "ERROR");
  const ostrzezenia = det.filter((f) => f.severity === "WARN");

  // ── Materiał kontrolny dla warstwy 2 ──
  const pytania =
    ((subanalyses ?? []).find((s) => s.kind === "pytania_organu")?.data as { questions?: string[] } | null)
      ?.questions ?? [];

  // Wykaz metryk = ŹRÓDŁO PRAWDY do weryfikacji liczb w tekście. Skracamy do
  // kluczy zagregowanych + szczytów, żeby zmieścić się w kontekście.
  // Wykaz metryk = ŹRÓDŁO PRAWDY do weryfikacji liczb w tekście.
  //
  // ⚠️ INNY KSZTAŁT PER DZIEDZINA. W GPW metryk są tysiące (klucz × sesja), więc
  // podajemy szczyt na klucz. W dziedzinie bankowej jest ich kilkadziesiąt, ale KAŻDA
  // niesie okres — i to okres jest przedmiotem oceny. Szczyt na klucz pokazywałby dla
  // CET1 wyłącznie 8,17% z 2006 r., przez co audytor nie mógł potwierdzić ani jednej
  // wartości z dnia decyzji i uznawał całą warstwę liczbową opinii za niepotwierdzoną.
  const wykazMetryk = (() => {
    const m = metrics ?? [];
    if (bankowa)
      return m
        .slice(0, 300)
        .map((x) => `${x.key}${x.session_day ? ` (${x.session_day})` : ""} = ${x.value} ${x.unit ?? ""}`.trim())
        .join("\n");
    const single = m.filter((x) => !x.session_day).slice(0, 120);
    const peaks = new Map<string, { v: number; d: string }>();
    for (const x of m) {
      if (!x.session_day || x.value == null) continue;
      const base = x.key.split("::")[0];
      const cur = peaks.get(base);
      if (!cur || x.value > cur.v) peaks.set(base, { v: x.value, d: x.session_day });
    }
    return [
      ...single.map((x) => `${x.key} = ${x.value} ${x.unit ?? ""}`.trim()),
      ...[...peaks.entries()].map(([k, p]) => `${k} — maks. ${p.v} (sesja ${p.d})`),
    ].join("\n");
  })();

  const tekstOpinii = op.chapters
    .map((c) => {
      const proza = c.paras.map((p) => p.text).join("\n");
      return `### ${c.no}. ${c.title}\n${proza.slice(0, MAX_ZN_ROZDZIALU)}${proza.length > MAX_ZN_ROZDZIALU ? "\n[…]" : ""}`;
    })
    .join("\n\n");

  const userPrompt = buildAudytPrompt({
    caseName: caseRow.name,
    signature: caseRow.signature,
    rubryka: RUBRYKA,
    bankowa,
    dzienZdarzenia,
    pytania,
    wykazMetryk,
    tekstOpinii,
  });

  try {
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: "claude-opus-4-8",
      // Siedem kryteriów z konkretnymi uwagami (uwaga bez wskazania rozdziału i braku
      // jest bezużyteczna) nie mieści się w 3000 — audyt urywał się przed podsumowaniem.
      max_tokens: 8000,
      system: systemDla(caseRow.typ ?? null),
      tools: [TOOL],
      tool_choice: { type: "tool", name: "ocen_opinie" },
      messages: [{ role: "user", content: userPrompt }] });
    const use = msg.content.find((c): c is Anthropic.ToolUseBlock => c.type === "tool_use");
    const parsed = (use?.input ?? {}) as {
      kryteria?: { id?: string; status?: string; uwaga?: string }[];
      podsumowanie?: string;
    };

    // ⚠️ AUDYT, KTÓRY SIĘ NIE UDAŁ, NIE MOŻE WYGLĄDAĆ NA WYNIK 0/100.
    // Brakujące kryterium jest niżej mapowane na „brak", więc urwana albo pusta
    // odpowiedź modelu dawała komplet „brak" i punktację zero — czyli komunikat
    // „opinia nie spełnia żadnego kryterium" tam, gdzie prawdą jest „nie udało się
    // ocenić". Biegły dostawał najgorszą możliwą ocenę bez ani jednej uwagi.
    if (msg.stop_reason === "max_tokens" || !(parsed.kryteria ?? []).length)
      return Response.json({
        ok: false,
        reason:
          msg.stop_reason === "max_tokens"
            ? "Audyt urwał się na limicie długości odpowiedzi — oceny nie ukończono. Punktacji nie wyliczono; uruchom ponownie."
            : "Audytor nie zwrócił oceny. Punktacji nie wyliczono; uruchom ponownie.",
      });

    // ── Punktacja: rubryka modelu minus kary za twarde błędy deterministyczne ──
    const kryteria: Kryterium[] = RUBRYKA.map((r) => {
      const hit = (parsed.kryteria ?? []).find((k) => k.id === r.id);
      const status = (hit?.status === "spelnione" || hit?.status === "czesciowo" ? hit.status : "brak") as Kryterium["status"];
      return { kryterium: r.opis, status, waga: r.waga, uwaga: String(hit?.uwaga ?? "") };
    });
    const punktyRubryki = kryteria.reduce(
      (a, k) => a + (k.status === "spelnione" ? k.waga : k.status === "czesciowo" ? k.waga / 2 : 0),
      0,
    );
    const kara = Math.min(30, bledy.length * 8) + Math.min(15, ostrzezenia.length * 3);
    const wynik = Math.max(0, Math.round(punktyRubryki - kara));

    const ustalenia = [
      ...kryteria.map((k) => ({ ...k, zrodlo: "rubryka" })),
      ...det.map((f) => ({
        kryterium: `[${f.check}] ${f.message}`,
        status: f.severity === "ERROR" ? "brak" : f.severity === "WARN" ? "czesciowo" : "spelnione",
        waga: 0,
        uwaga: "kontrola deterministyczna",
        zrodlo: "silnik" })),
    ];

    const podsumowanie = String(parsed.podsumowanie ?? "").trim();

    // Zapis historii — trend wyników to mierzalny postęp jakości aplikacji.
    // Best-effort: brak migracji 0007 nie może zablokować zwrócenia wyniku.
    let zapisano = true;
    try {
      const { error } = await supabase.from("audyty_opinii").insert({
        case_id: id,
        wynik,
        max_wynik: 100,
        ustalenia,
        podsumowanie,
        model: "claude-opus-4-8" });
      if (error) zapisano = false;
    } catch {
      zapisano = false;
    }

    return Response.json({
      ok: true,
      wynik,
      kryteria,
      deterministyczne: { bledy: bledy.length, ostrzezenia: ostrzezenia.length },
      podsumowanie,
      zapisano,
      message:
        `Audyt: ${wynik}/100 (rubryka ${Math.round(punktyRubryki)} − kary ${kara}). ` +
        `Błędy: ${bledy.length}, ostrzeżenia: ${ostrzezenia.length}.` +
        (zapisano ? "" : " Wynik NIE zapisany — uruchom migrację 0007_korekty_audyty.sql.") });
  } catch (e) {
    return Response.json({ ok: false, reason: "Błąd modelu: " + (e as Error).message });
  }
}
