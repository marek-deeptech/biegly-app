import Anthropic from "@anthropic-ai/sdk";
import { klientLLM } from "@/lib/llm/klient";

import {
  buildIvRedactPrompt,
  buildRedactPrompt,
  buildWnioskiRedactPrompt,
  IV_REDACT_KINDS,
  REDACT_META,
  type IvRedactKind,
  type RedactChapter,
} from "@/lib/opinion/redact";
import { buildWnioskiSubanaliza, type StoredSub } from "@/lib/opinion/build";
import { wejscieIV } from "@/lib/opinion/redact-iv-input";
import { buildStyleCorpus } from "@/lib/opinion/korekty";
import { buildWzorzecBlock } from "@/lib/opinion/wzorce";
import { buildWiedzaBlock } from "@/lib/opinion/wiedza";
import { packDla } from "@/lib/domain";
import {
  BANK_REDACT_KINDS,
  buildBankProzaIIIPrompt,
  buildBankRedactPrompt,
  type BankRedactKind,
  wejscieBankowe,
} from "@/lib/opinion/redact-bank";
import { buildBankWnioskiPrompt, materialWnioskow } from "@/lib/opinion/wnioski-bank";
import { przepisyAnachroniczne, przepisyNaDzien } from "@/lib/domain/prawo-bankowe";
import { PROSECUTOR_QUESTIONS, TECHNIQUES } from "@/lib/opinion/legal";
import { fetchAllMetrics } from "@/lib/metrics-fetch";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Redakcja rozdziałów prozą to długa generacja opus (III/layering/aktywność do 8–9 tys.
// tokenów) — przy 60 s funkcja bywała ubijana przed odpowiedzią (klient dostawał 504/HTML,
// stąd „Błąd sieci przy redakcji"). 300 s jak w osint/analyze (limit dopuszczany przez plan).
export const maxDuration = 300;

type MetricRow = { key: string; value: number | null; unit: string | null; session_day: string | null };

// POST { chapter: "I" | "III" | "V" } → { ok, text, meta } | { ok:false, reason }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, reason: "unauthorized" }, { status: 401 });

  if (!process.env.ANTHROPIC_API_KEY)
    return Response.json({
      ok: false,
      reason: "Brak klucza ANTHROPIC_API_KEY — dodaj go w .env.local oraz w zmiennych środowiskowych Vercel.",
    });

  let body: { chapter?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* puste ciało */
  }
  const chapter = (body.chapter || "") as string;

  // Sprawę pobieramy PRZED walidacją rozdziału: zbiór dopuszczalnych rodzajów
  // zależy od dziedziny. Rozdział „limity" jest poprawny w sprawie bankowej
  // i błędny w sprawie o manipulację — i odwrotnie dla „layering".
  // `select("*")`, a nie lista kolumn: `tryb` przychodzi migracją 0014 i do czasu jej
  // uruchomienia nazwany SELECT zwracałby 400, psując redakcję we WSZYSTKICH sprawach.
  const { data: caseRow } = await supabase.from("cases").select("*").eq("id", id).single();
  if (!caseRow) return Response.json({ ok: false, reason: "not found" }, { status: 404 });
  const bankowa = caseRow.typ === "ryzyko_bankowe";

  const isIv = !bankowa && (IV_REDACT_KINDS as readonly string[]).includes(chapter);
  const isBank = bankowa && (BANK_REDACT_KINDS as readonly string[]).includes(chapter);
  // Wnioski mają OSOBNĄ ścieżkę per dziedzina. Wnioski GPW składa się z technik
  // manipulacji, zdarzeń ESPI, powiązań KRS i zbieżności IP — w sprawie o ryzyko
  // kredytowe banku nie ma żadnej z tych rzeczy, a prompt pytałby o nie modelu.
  // Rozdziały „miękkie" (I/III/V) mają prompty GPW — zakotwiczone w MAR i sesjach
  // giełdowych. W sprawie bankowej rozdział III (Wstęp teoretyczny) wygenerowany
  // tą ścieżką dał 14 504 znaki wywodu o integralności rynku regulowanego i wash
  // trades, w opinii o lokacie międzybankowej. Bank ma własny wariant.
  const isProzaBank = bankowa && chapter === "III";
  const isWnioski = chapter === "wnioski" && !bankowa;
  const isWnioskiBank = chapter === "wnioski" && bankowa;
  if (!chapter || (!REDACT_META[chapter as RedactChapter] && !isIv && !isBank && !isWnioski && !isWnioskiBank))
    return Response.json({ ok: false, reason: "Nieznany rozdział w tej dziedzinie." }, { status: 400 });

  const metricsData = await fetchAllMetrics(supabase, id);
  const { data: subs } = await supabase
    .from("subanalyses")
    .select("kind,title,status,data,chapter_no,body_md")
    .eq("case_id", id);

  const m: MetricRow[] = metricsData ?? [];
  const days = [...new Set(m.filter((x) => x.session_day).map((x) => x.session_day as string))].sort();
  const period = days.length ? `od ${days[0]} do ${days[days.length - 1]}` : null;

  let system: string;
  let userPrompt: string;
  let meta: unknown;

  if (isProzaBank) {
    // ── Wstęp teoretyczny dziedziny bankowej (rozdz. IV opinii) ──
    const dzien =
      ((subs ?? []).find((s) => s.kind === "limity")?.data as { dzienZdarzenia?: string | null } | undefined)
        ?.dzienZdarzenia ?? null;
    const obecne = new Set((subs ?? []).map((s) => s.kind));
    const p = buildBankProzaIIIPrompt({
      caseName: caseRow.name,
      signature: caseRow.signature,
      dzienZdarzenia: dzien,
      przepisy: dzien ? przepisyNaDzien(dzien).map((x) => `${x.ref} — ${x.zakres}`) : [],
      anachroniczne: dzien ? przepisyAnachroniczne(dzien).map((x) => `${x.ref} (od ${x.od})`) : [],
      tryb: caseRow.tryb,
      moduly: packDla(caseRow.typ)
        .moduly.filter((m) => obecne.has(m.id === "adekwatnosc" ? "wskazniki_bank" : m.id))
        .map((m) => m.tytul),
    });
    system = p.system;
    userPrompt = p.user;
    meta = { kind: "proza_iii" };
  } else if (isWnioskiBank) {
    // ── Wnioski dziedziny bankowej ──
    const sub = (subs ?? []).find((s) => s.kind === "wnioski");
    if (!sub)
      return Response.json({ ok: false, reason: "Najpierw wygeneruj Wnioski (Generuj: Wnioski), potem rozwiń prozą." });
    const pytania =
      ((subs ?? []).find((s) => s.kind === "pytania_organu")?.data as { questions?: string[] } | null)?.questions
        ?.map((q) => String(q).trim())
        .filter((q) => q.length > 0) ?? [];
    // Data zdarzenia z warsztatu (Krok 4) — wyznacza stan prawny wniosków. BEZ domyślnej
    // wartości: zgadnięta data dobrałaby zły stan prawny, a to jest rozdział, który
    // prokurator czyta jako odpowiedź na swoje pytanie.
    const dzien =
      ((subs ?? []).find((s) => s.kind === "limity")?.data as { dzienZdarzenia?: string | null } | undefined)
        ?.dzienZdarzenia ?? null;
    // Materiał liczymy ŚWIEŻO z modułów, nie z body_md — wcześniejsza redakcja mogła
    // zastąpić szkielet prozą, a wnioski muszą stać na aktualnych ustaleniach.
    const material = materialWnioskow((subs ?? []) as never, dzien);
    const p = buildBankWnioskiPrompt({
      caseName: caseRow.name,
      signature: caseRow.signature,
      dzienZdarzenia: dzien,
      pytania,
      material,
      tryb: caseRow.tryb,
    });
    system = p.system;
    userPrompt = p.user;
    meta = { kind: "wnioski" };
  } else if (isWnioski) {
    const sub = (subs ?? []).find((s) => s.kind === "wnioski");
    if (!sub)
      return Response.json({ ok: false, reason: "Najpierw wygeneruj Wnioski (Generuj: Wnioski), potem rozwiń prozą." });
    // Pytania organu PER SPRAWA (subanaliza pytania_organu) — muszą to być pytania z postanowienia
    // TEJ sprawy. Brak → fallback do domyślnych (HubTech/MLM), by nie zablokować starych spraw.
    const caseQuestions =
      ((subs ?? []).find((s) => s.kind === "pytania_organu")?.data as { questions?: string[] } | null)?.questions
        ?.map((q) => String(q).trim())
        .filter((q) => q.length > 0) ?? [];
    const questions = caseQuestions.length ? caseQuestions : [...PROSECUTOR_QUESTIONS];
    // Świeży szkielet z silnika (nie z body_md) — odporny na wcześniejsze rozwinięcia prozy.
    const skeleton = buildWnioskiSubanaliza(
      caseRow.name,
      m,
      (subs ?? []) as unknown as StoredSub[],
      caseQuestions.length ? caseQuestions : undefined,
    ).bodyMd;
    const approved = (subs ?? [])
      .filter((s) => s.status === "zatwierdzona" && String(s.chapter_no).startsWith("IV"))
      .map((s) => ({ title: `${s.title} (rozdz. ${s.chapter_no})`, findings: (s.data?.findings ?? []) as string[] }));
    const evs =
      ((subs ?? []).find((s) => s.kind === "espi_events")?.data as {
        events?: { date?: string; type?: string; subject?: string; session?: string }[];
      } | null)?.events ?? [];
    const events = evs.map(
      (e) => `${e.date ?? "—"} — ${(e.type || e.subject || "").trim()}${e.session ? ` (zbieżne z sesją ${e.session})` : ""}`,
    );
    const kb =
      ((subs ?? []).find((s) => s.kind === "krs_boards")?.data as {
        shared?: { name?: string; entities?: string[] }[];
      } | null)?.shared ?? [];
    const relations = kb
      .slice(0, 10)
      .map((x) => `KRS — osoba w wielu podmiotach: ${x.name} (${(x.entities ?? []).join(", ")})`);
    const ipTable = ((subs ?? []).find((s) => s.kind === "powiazania_dane")?.data as {
      table?: { rows?: string[][] };
    } | null)?.table;
    for (const r of (ipTable?.rows ?? []).slice(0, 5)) relations.push(`Wspólne IP: ${r[0]} ↔ ${r[1]} (${r[2]} adresów)`);
    const intro = String((subs ?? []).find((s) => s.kind === "proza_i")?.body_md ?? "").slice(0, 600) || null;
    const p = buildWnioskiRedactPrompt({
      caseName: caseRow.name,
      signature: caseRow.signature,
      period,
      caseIntro: intro,
      questions,
      skeleton,
      techniques: approved,
      relations,
      events,
    });
    system = p.system;
    userPrompt = p.user;
    meta = { kind: "wnioski" };
  } else if (isBank) {
    // ── Rozdział analizy dziedziny bankowej ──
    const sub = (subs ?? []).find((s) => s.kind === chapter);
    if (!sub)
      return Response.json({ ok: false, reason: "Najpierw wykonaj Krok 3 lub 4 dla tego rozdziału." });
    const { data: docsB } = await supabase.from("documents").select("doc_type").eq("case_id", id);
    const licz: Record<string, number> = {};
    for (const d of docsB ?? []) licz[d.doc_type as string] = (licz[d.doc_type as string] ?? 0) + 1;
    const p = buildBankRedactPrompt(
      wejscieBankowe({
        kind: chapter as BankRedactKind,
        sub,
        caseRow,
        subs: (subs ?? []) as never,
        licznikTypow: licz,
        przepisyNaDzien,
        przepisyAnachroniczne,
      }),
    );
    system = p.system;
    userPrompt = p.user;
    meta = { kind: chapter };
  } else if (isIv) {
    // Wejście składa `wejscieIV` — ta sama funkcja, której używa CLI
    // (scripts/redakcja_iv.ts); patrz komentarz w lib/opinion/redact-iv-input.ts.
    const wejscie = await wejscieIV(supabase, id, chapter as IvRedactKind, {
      caseRow: { name: caseRow.name, signature: caseRow.signature },
      subs: (subs ?? []) as never,
      metrics: m,
      period,
    });
    if (!wejscie)
      return Response.json({ ok: false, reason: "Najpierw wygeneruj ten rozdział (Generuj), potem rozwiń prozą." });
    const p = buildIvRedactPrompt(wejscie);
    system = p.system;
    userPrompt = p.user;
    meta = { kind: chapter };
  } else {
    const find = (k: string) => m.find((x) => x.key === k);
    const peak = (pfx: string) =>
      m.filter((x) => x.key.startsWith(pfx)).reduce<MetricRow | null>((a, b) => ((b.value ?? -1) > (a?.value ?? -1) ? b : a), null);
    const num = (v: number | null | undefined, u: string) => (v == null ? "—" : u === "%" ? `${v}%` : `${v} ${u}`);
    const facts: string[] = [];
    const gs = find("group_turnover_share");
    if (gs) facts.push(`Udział Grupy w wartości obrotu: ${num(gs.value, "%")}.`);
    const wp = peak("wash_");
    if (wp) facts.push(`Maksymalny udział transakcji wzajemnych w wolumenie sesji: ${num(wp.value, "%")} (sesja ${wp.session_day}).`);
    const cp = peak("cancel_");
    if (cp) facts.push(`Maksymalny udział anulacji zleceń kupna Grupy: ${num(cp.value, "%")} (sesja ${cp.session_day}).`);
    const approved = (subs ?? [])
      .filter((s) => s.status === "zatwierdzona" && String(s.chapter_no).startsWith("IV"))
      .map((s) => ({ title: s.title as string, findings: ((s.data?.findings ?? []) as string[]) }));
    const legalBasis = [
      "art. 12 rozporządzenia MAR (UE) 596/2014",
      "rozporządzenie delegowane (UE) 2016/522, załącznik II",
      "art. 183 ustawy o obrocie instrumentami finansowymi",
    ];
    // Rozdział III jest OGÓLNY: zamiast liczb sprawy dostaje bibliotekę definicji
    // technik (legal.ts) do wiernego przytoczenia i rozwinięcia.
    const library =
      chapter === "III"
        ? Object.values(TECHNIQUES).map((t) => `${t.label} (${t.mar}; ${t.rd}): ${t.definicja}`)
        : undefined;
    const p = buildRedactPrompt({
      chapter: chapter as RedactChapter,
      caseName: caseRow.name,
      signature: caseRow.signature,
      period,
      facts: chapter === "III" ? [] : facts,
      approved: chapter === "III" ? [] : approved,
      legalBasis,
      library,
    });
    system = p.system;
    userPrompt = p.user;
    meta = REDACT_META[chapter as RedactChapter];
  }

  // SPRZĘŻENIE ZWROTNE: dokładamy do systemu wzorce z WŁASNYCH poprawek biegłego
  // (tabela `korekty`). Model się nie douczy, ale przykłady „tak model napisał / tak
  // biegły poprawił" przesuwają kolejne redakcje w stronę jego stylu. Brak korekt lub
  // brak migracji 0007 → funkcja zwraca null i prompt zostaje bez zmian.
  // Dwie warstwy uczenia stylu, w kolejności rosnącej specyficzności:
  //  1) WZORZEC — zszkieletyzowany rozdział tego samego rodzaju z wcześniejszej opinii
  //     biegłego (korpus `wzorce`). Uczy architektury wywodu; rośnie z liczbą spraw.
  //  2) KOREKTY — jego własne poprawki nanoszone w tej aplikacji (korpus `korekty`).
  //     Są świeższe i bardziej konkretne, więc stoją bliżej generacji (na końcu).
  //  3) WIEDZA — doktryna i przepisy z repozytorium `wiedza` (globalnego, niezwiązanego
  //     ze sprawą). Odpowiada za poprawność DEFINICJI i kwalifikacji prawnej techniki,
  //     nie za styl. Stoi PRZED wzorcem i korektami, bo jest najbardziej ogólna,
  //     a bliżej generacji mają stać rzeczy najbardziej specyficzne dla biegłego.
  // KLUCZ ROZDZIAŁU, nie surowa nazwa. Rozdziały I/III/V są w korpusach zapisane jako
  // `proza_i` / `proza_iii` / `proza_v` (tak nazywa je REDACT_META.kind), a pytanie szło
  // wcześniej o „I"/„III"/„V" — wzorzec stylu dla tych trzech NIGDY nie trafiał, mimo
  // że leżał w bazie. Sprawdzone zapytaniem: rodzaj=III → 0 wzorców, proza_iii → 2.
  // Obie ścieżki wniosków (GPW i bankowa) sięgają po ten sam korpus `wnioski` —
  // wzorce stylu są zapisane wg ROLI rozdziału, nie wg dziedziny, i to jest cały
  // powód, dla którego dziedziny dzielą jedną aplikację zamiast być klonami.
  const rodzaj =
    isWnioski || isWnioskiBank
      ? "wnioski"
      : isProzaBank
        ? "proza_iii"
        : (REDACT_META[chapter as RedactChapter]?.kind ?? chapter);
  const [wiedza, wzorzec, styl] = await Promise.all([
    buildWiedzaBlock(supabase, rodzaj, caseRow.typ),
    buildWzorzecBlock(supabase, rodzaj),
    buildStyleCorpus(supabase, rodzaj),
  ]);
  const systemZeStylem = [system, wiedza, wzorzec, styl].filter(Boolean).join("\n\n");

  try {
    const client = klientLLM("redakcja/rozdzial", { sprawa: id });
    const msg = await client.messages.create({
      model: "claude-opus-4-8",
      // Rozdziały z rozbiciem per sesja (akapit na każdą sesję) potrzebują zapasu.
      max_tokens:
        isProzaBank ? 8000
        : isWnioski || isWnioskiBank ? 6500
        : chapter === "layering" || chapter === "aktywnosc" ? 9000
        // Rozdziały bankowe: 6–12 akapitów gęstej analizy z omówieniem tabeli
        // okres po okresie — domyślne 2500 ucinałoby je w połowie.
        : isBank ? 5500
        : isIv ? 5500
        : chapter === "III" ? 8000
        : 2500,
      system: systemZeStylem,
      messages: [{ role: "user", content: userPrompt }],
    });
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (!text) return Response.json({ ok: false, reason: "Model nie zwrócił treści." });
    return Response.json({ ok: true, text, meta });
  } catch (e) {
    return Response.json({ ok: false, reason: "Błąd modelu: " + (e as Error).message });
  }
}
