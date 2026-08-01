import Anthropic from "@anthropic-ai/sdk";

import {
  buildIvRedactPrompt,
  buildRedactPrompt,
  buildWnioskiRedactPrompt,
  IV_REDACT_KINDS,
  REDACT_META,
  type IvRedactKind,
  type RedactChapter,
} from "@/lib/opinion/redact";
import { buildWnioskiSubanaliza, sessionFacts, type StoredSub } from "@/lib/opinion/build";
import { buildStyleCorpus } from "@/lib/opinion/korekty";
import { buildWzorzecBlock } from "@/lib/opinion/wzorce";
import { buildWiedzaBlock } from "@/lib/opinion/wiedza";
import { BANK_REDACT_KINDS, buildBankRedactPrompt, modulDla, type BankRedactKind } from "@/lib/opinion/redact-bank";
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
  const { data: caseRow } = await supabase.from("cases").select("name,signature,typ").eq("id", id).single();
  if (!caseRow) return Response.json({ ok: false, reason: "not found" }, { status: 404 });
  const bankowa = caseRow.typ === "ryzyko_bankowe";

  const isIv = !bankowa && (IV_REDACT_KINDS as readonly string[]).includes(chapter);
  const isBank = bankowa && (BANK_REDACT_KINDS as readonly string[]).includes(chapter);
  const isWnioski = chapter === "wnioski";
  if (!chapter || (!REDACT_META[chapter as RedactChapter] && !isIv && !isBank && !isWnioski))
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

  if (isWnioski) {
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
    type Tbl = { caption?: string; head?: string[]; rows?: string[][] };
    // WSZYSTKIE tabele modułu, nie tylko pierwsza. Moduły zapisują ich kilka i druga
    // bywa tą istotną: publikacje PO zdarzeniu oraz przepisy późniejsze mają w podpisie
    // ostrzeżenie, że nie wolno ich użyć do oceny stanu z dnia decyzji. Branie samej
    // pierwszej tabeli gubiło to ostrzeżenie i — przy kilku szeregach w module `makro` —
    // większość danych.
    const tabele = ((sub.data?.tables as Tbl[] | undefined)?.length
      ? (sub.data?.tables as Tbl[])
      : ([sub.data?.table as Tbl | undefined].filter(Boolean) as Tbl[])
    ).filter((x) => x?.head?.length && x.rows?.length);
    const MAX_W = 120;
    const bloki = tabele.map((x) => {
      const widoczne = (x.rows ?? []).slice(0, MAX_W);
      // Ucięcie musi być WIDOCZNE w promptcie — milczące skrócenie tabeli czytałoby się
      // jak komplet danych i model opisałby niepełny szereg jako pełny.
      const ogon =
        (x.rows?.length ?? 0) > MAX_W
          ? `\n[…] pominięto ${(x.rows?.length ?? 0) - MAX_W} dalszych wierszy — omów zakres, nie każdy wiersz`
          : "";
      return `${x.caption ? x.caption + ":\n" : ""}${(x.head ?? []).join(" | ")}\n${widoczne
        .map((r) => r.join(" | "))
        .join("\n")}${ogon}`;
    });
    const tableText = bloki.length ? bloki.join("\n\n") : null;
    const { data: docsB } = await supabase.from("documents").select("doc_type").eq("case_id", id);
    const licz: Record<string, number> = {};
    for (const d of docsB ?? []) licz[d.doc_type as string] = (licz[d.doc_type as string] ?? 0) + 1;
    // Data zdarzenia z warsztatu (Krok 4) — wyznacza stan prawny rozdziału.
    const dzien =
      ((subs ?? []).find((s) => s.kind === "limity")?.data as { dzienZdarzenia?: string | null } | undefined)
        ?.dzienZdarzenia ?? null;
    const modul = modulDla(chapter as BankRedactKind);
    const p = buildBankRedactPrompt({
      kind: chapter as BankRedactKind,
      title: sub.title,
      caseName: caseRow.name,
      signature: caseRow.signature,
      dzienZdarzenia: dzien,
      tableText,
      findings: (sub.data?.findings ?? []) as string[],
      inventory: Object.entries(licz)
        .filter(([k]) => !["UNKNOWN", "GRAFIKA"].includes(k))
        .map(([k, v]) => `${v} × ${k}`),
      przepisy: dzien ? przepisyNaDzien(dzien, modul as never).map((x) => `${x.ref} — ${x.zakres}`) : [],
      anachroniczne: dzien
        ? przepisyAnachroniczne(dzien)
            .filter((x) => x.moduly.includes(modul as never))
            .map((x) => `${x.ref} (obowiązuje od ${x.od})`)
        : [],
      uwagi: (sub.data as { uwagi?: string[] } | null)?.uwagi ?? [],
    });
    system = p.system;
    userPrompt = p.user;
    meta = { kind: chapter };
  } else if (isIv) {
    const sub = (subs ?? []).find((s) => s.kind === chapter);
    if (!sub)
      return Response.json({ ok: false, reason: "Najpierw wygeneruj ten rozdział (Generuj), potem rozwiń prozą." });
    type Tbl = { caption?: string; head?: string[]; rows?: string[][] };
    const many = (sub.data?.tables as Tbl[] | undefined) ?? [];
    const tbls: Tbl[] = many.length ? many : sub.data?.table ? [sub.data.table as Tbl] : [];
    const asText = (t: Tbl) =>
      t.head && t.rows?.length
        ? `${t.caption ? t.caption.replace(/^Tabela\.\s*/, "") + ":\n" : ""}${t.head.join(" | ")}\n` +
          t.rows.slice(0, 120).map((r) => r.join(" | ")).join("\n")
        : null;
    const blocks = tbls.map(asText).filter((s): s is string => !!s);
    const tableText = blocks.length ? blocks.join("\n\n") : null;
    const { data: docsData } = await supabase.from("documents").select("doc_type,rel_path").eq("case_id", id);
    const counts: Record<string, number> = {};
    for (const d of docsData ?? []) counts[d.doc_type as string] = (counts[d.doc_type as string] ?? 0) + 1;
    // Pomiń typy niemerytoryczne — inaczej model raportuje „N × UNKNOWN" jako lukę [do uzupełnienia].
    const SKIP_TYPES = new Set(["UNKNOWN", "LITERATURA"]);
    const inventory = Object.entries(counts)
      .filter(([k]) => !SKIP_TYPES.has(k))
      .map(([k, v]) => `${v} × ${k}`);
    // Aktywność/ESPI: dołącz zdarzenia ESPI/EBI do cross-linku czasowego. Jeśli wyciągnięto
    // datowane zdarzenia z PDF (subanaliza espi_events) — użyj ich; inaczej same nazwy plików.
    if (chapter === "aktywnosc" || chapter === "espi") {
      const ev = (subs ?? []).find((s) => s.kind === "espi_events");
      const events =
        (ev?.data?.events as
          | { date?: string; type?: string; subject?: string; content?: string; session?: string; chg?: number | null; vol?: number | null }[]
          | undefined) ?? [];
      if (events.length) {
        inventory.push(
          ...events
            .slice(0, 15)
            .map(
              (e) =>
                `ESPI zdarzenie: ${e.date || "—"} — ${(e.type || "").trim()}${e.subject ? " — " + e.subject : ""}` +
                (e.content ? ` | treść: ${e.content}` : "") +
                (e.session
                  ? ` | zbieżna sesja ${e.session}` +
                    (e.chg != null ? `: zmiana kursu ${e.chg > 0 ? "+" : ""}${e.chg.toLocaleString("pl-PL")}%` : "") +
                    (e.vol != null ? `, wolumen ${e.vol.toLocaleString("pl-PL")} szt` : "")
                  : ""),
            ),
        );
      } else {
        inventory.push(
          ...(docsData ?? [])
            .filter((d) => d.doc_type === "RAPORT_ESPI_EBI")
            .map((d) => "ESPI/EBI: " + String(d.rel_path).split("/").pop())
            .slice(0, 15),
        );
      }
    }
    // Ekofin: dołącz pozycje finansowe emitenta z wyciągu ze sprawozdań (fin_stats).
    if (chapter === "ekofin") {
      const fin = (subs ?? []).find((s) => s.kind === "fin_stats");
      const items =
        (fin?.data as { items?: { position?: string; period?: string; value?: string; unit?: string }[] } | null)
          ?.items ?? [];
      inventory.push(
        ...items
          .slice(0, 20)
          .map((i) => `Dane finansowe: ${i.position} ${i.period ?? ""}: ${i.value} ${i.unit ?? ""}`.trim()),
      );
    }
    // Relacje: dołącz osoby pełniące funkcje w wielu podmiotach (z wyciągu KRS).
    if (chapter === "relacje") {
      const kb = (subs ?? []).find((s) => s.kind === "krs_boards");
      const shared = (kb?.data?.shared as { name?: string; entities?: string[] }[] | undefined) ?? [];
      inventory.push(
        ...shared
          .slice(0, 15)
          .map((sh) => `KRS — osoba w wielu podmiotach: ${sh.name} (${(sh.entities || []).join(", ")})`),
      );
    }
    const ivIntro = String((subs ?? []).find((s) => s.kind === "proza_i")?.body_md ?? "").slice(0, 500) || null;
    // Fakty dnia dla akapitów sesyjnych — sesje z captionów tabel rozbicia.
    const sessDays = [
      ...new Set(
        tbls
          .map((t) => (t.caption ?? "").match(/w sesji (\d{4}-\d{2}-\d{2})/)?.[1])
          .filter((d): d is string => !!d),
      ),
    ].sort();
    const p = buildIvRedactPrompt({
      kind: chapter as IvRedactKind,
      title: (sub.title as string) || chapter,
      caseName: caseRow.name,
      signature: caseRow.signature,
      period,
      caseIntro: ivIntro,
      tableText,
      findings: (sub.data?.findings ?? []) as string[],
      inventory,
      legalRefs: (sub.data?.legalRefs ?? []) as string[],
      sessionFacts: sessDays.length ? sessionFacts(m, sessDays) : undefined,
    });
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
  const rodzaj = isWnioski ? "wnioski" : (REDACT_META[chapter as RedactChapter]?.kind ?? chapter);
  const [wiedza, wzorzec, styl] = await Promise.all([
    buildWiedzaBlock(supabase, rodzaj, caseRow.typ),
    buildWzorzecBlock(supabase, rodzaj),
    buildStyleCorpus(supabase, rodzaj),
  ]);
  const systemZeStylem = [system, wiedza, wzorzec, styl].filter(Boolean).join("\n\n");

  try {
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: "claude-opus-4-8",
      // Rozdziały z rozbiciem per sesja (akapit na każdą sesję) potrzebują zapasu.
      max_tokens:
        isWnioski ? 6500
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
