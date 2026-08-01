// KORPUS WZORCÓW STYLU — szkieletyzacja historycznych opinii biegłego i ich dobór.
//
// Problem: chcemy, by proza brzmiała jak opinie biegłego, ale opinia sądowa NIE MOŻE
// zawierać faktu przeniesionego z innej sprawy. Zasada evidence-only jest tu twarda:
// ustalenia wynikają z materiału dowodowego TEJ sprawy, nigdy ze wzorca.
//
// Rozwiązanie: wzorzec jest SZKIELETYZOWANY — nazwiska, nazwy podmiotów, liczby, daty
// i sygnatury zastępujemy znacznikami. Zostaje architektura zdania i chwyty retoryczne
// („Wzorzec — duże, w większości anulowane zlecenia … — odpowiada technice …"), a znika
// wszystko, co dałoby się bezmyślnie przepisać. To jednocześnie bezpieczniejsze i
// SKUTECZNIEJSZE dla transferu stylu: model nie może pójść na skróty i skopiować treści.
//
// Szkielet jest jedyną formą zapisywaną w bazie (patrz migracja 0008).

import type { SupabaseClient } from "@supabase/supabase-js";

export type Wzorzec = {
  autor: string;
  sprawa: string;
  plik: string;
  rozdzial_no: string;
  rodzaj: string;
  tytul: string;
  szkielet: string;
  znakow: number;
};

// ── Szkieletyzacja ───────────────────────────────────────────────────────────

/** Formy prawne — kotwica do wykrywania nazw podmiotów bez listy nazwisk. */
const FORMY = String.raw`(?:S\.?\s?A\.?|Sp\.?\s?z\s?o\.?\s?o\.?|S\.?K\.?A\.?|sp\.?\s?k\.?|LTD|LIMITED|GmbH|B\.?V\.?|PTE\.?\s?LTD|EOOD|OOD|Inc\.?)`;

/** Słowa zaczynające zdanie / terminy prawne — NIE są nazwami własnymi. */
const STOP = new Set(
  ("grupa emitent spółka spolka biegły biegly sąd sad prokuratura komisja rozporządzenie rozporzadzenie " +
    "załącznik zalacznik artykuł artykul ustawa opinia analiza wniosek wnioski tabela wykres sesja sesji " +
    "kurs wolumen obrót obrot transakcja transakcje zlecenie zlecenia rachunek podmiot podmioty osoba " +
    "według wedlug ponadto jednocześnie jednoczesnie natomiast zatem wobec przy dla oraz jako który ktory " +
    "niniejsz w na z o i a to te ten ta").split(/\s+/),
);

/**
 * Usuwa z tekstu wszystko, co mogłoby zostać przeniesione jako FAKT.
 * `nazwyWlasne` — dodatkowe ciągi do bezwarunkowego usunięcia (rostery spraw):
 * to najpewniejsza warstwa, heurystyki są uzupełnieniem.
 */
export function szkieletyzuj(tekst: string, nazwyWlasne: string[] = []): string {
  let s = tekst;

  // 1) Jawne nazwy z rosterów — najpewniejsza warstwa (dokładne dopasowanie, bez względu na odmianę rdzenia).
  const rdzenie = [...new Set(nazwyWlasne.flatMap((n) => n.split(/\s+/)))]
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((w) => w.length >= 4)
    .sort((a, b) => b.length - a.length); // najdłuższe najpierw, by nie ciąć w środku
  for (const rdzen of rdzenie) {
    // Dopuszczamy polskie końcówki fleksyjne (Joyfixu, Zalewskiego…). Granicy NIE
    // wyznacza \b, bo podkreślenie jest znakiem słowa — a nazwiska siedzą właśnie
    // w nazwach plików („joyfix_desktop", „Tonbo_1491_…xlsx"). Stąd lookaround po
    // klasach liter/cyfr: separatorem jest każdy znak, który literą ani cyfrą nie jest.
    s = s.replace(
      new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(rdzen)}\\p{L}{0,4}(?![\\p{L}])`, "giu"),
      "⟨PODMIOT⟩",
    );
  }

  // 2) Sygnatury akt (RP I Ds 4.2019, III K 193/23/1, …) — zanim zniknie interpunkcja liczb.
  s = s.replace(/\b[IVXLC]{1,4}\s?[A-ZĆŁŃÓŚŹŻ]{1,3}\s?\d+[./]\d+(?:[./]\d+)*/g, "⟨sygn.⟩");
  s = s.replace(/\bsygn\.?\s*akt[^,.;)]*/gi, "sygn. akt ⟨sygn.⟩");

  // 3) ISIN i numery KRS/NIP/REGON.
  s = s.replace(/\b[A-Z]{2}[A-Z0-9]{9}\d\b/g, "⟨ISIN⟩");
  s = s.replace(/\bKRS\s*:?\s*\d{6,}/gi, "KRS ⟨nr⟩");
  s = s.replace(/\b(?:NIP|REGON)\s*:?\s*[\d-]{7,}/gi, "⟨nr⟩");

  // 4) Daty (ISO i polskie słowne) — przed ogólnym cięciem liczb.
  s = s.replace(/\b\d{4}-\d{2}-\d{2}\b/g, "⟨data⟩");
  s = s.replace(/\b\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}\b/g, "⟨data⟩");
  s = s.replace(
    /\b\d{1,2}\s+(?:stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|wrzesnia|października|pazdziernika|listopada|grudnia)\s+\d{4}\s*r?\.?/gi,
    "⟨data⟩",
  );
  s = s.replace(/\b(?:19|20)\d{2}\s*r\./g, "⟨rok⟩");

  // 5) Nazwy podmiotów po formie prawnej — łapie nazwy spoza rostera.
  s = s.replace(
    new RegExp(String.raw`\b(?:[A-ZĆŁŃÓŚŹŻ][\p{L}.&-]*\s+){0,3}${FORMY}`, "gu"),
    "⟨PODMIOT⟩",
  );

  // 6) Godziny i przedziały czasowe — zanim potniemy liczby.
  s = s.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, "⟨godz.⟩");

  // 7) Liczby: procenty, kwoty, wolumeny, liczebniki (w tym ze spacją/przecinkiem).
  s = s.replace(/\d[\d\s .,]*\s*%/g, "⟨%⟩");
  s = s.replace(/\d[\d\s .,]*\s*(?:zł|PLN|EUR|USD)/gi, "⟨kwota⟩");
  s = s.replace(/\d[\d\s .,]*\s*(?:szt\.?|sztuk\w*|akcji|akcje)/gi, "⟨wolumen⟩");
  s = s.replace(/\d[\d\s .,]*\d|\d/g, "⟨liczba⟩");

  // 8) Pary Wielka+Wielka (imię+nazwisko / nazwa) poza początkiem zdania — reszta nazwisk.
  s = s.replace(
    /(^|[^.!?]\s)([A-ZĆŁŃÓŚŹŻ][\p{Ll}]{2,})\s+([A-ZĆŁŃÓŚŹŻ][\p{Ll}]{2,})/gu,
    (m, pre: string, a: string, b: string) =>
      STOP.has(a.toLowerCase()) || STOP.has(b.toLowerCase()) ? m : `${pre}⟨PODMIOT⟩`,
  );

  // 9) Sprzątanie: zbitki znaczników i nadmiarowe spacje.
  s = s.replace(/(⟨PODMIOT⟩[\s,–-]*){2,}/g, "⟨PODMIOT⟩ i ⟨PODMIOT⟩ ");
  s = s.replace(/(⟨liczba⟩[\s,]*){3,}/g, "⟨liczba⟩ ");
  return s.replace(/[ \t ]{2,}/g, " ").trim();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Kontrola szczelności — zwraca fragmenty, które NIE powinny przetrwać. */
export function wykryjWycieki(szkielet: string, nazwyWlasne: string[]): string[] {
  const wycieki: string[] = [];
  for (const n of nazwyWlasne) {
    for (const w of n.split(/\s+/)) {
      const rdzen = w.replace(/[^\p{L}\p{N}]/gu, "");
      // Dopasowanie CAŁEGO słowa (rdzeń + do 3 liter fleksji), nie prefiksu — inaczej
      // rdzeń „rach" (z rostera) fałszywie alarmował na słowie „rachunek", zatruwając
      // raport i odrzucając poprawnie zszkieletyzowane rozdziały.
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(rdzen)}\\p{L}{0,3}(?![\\p{L}])`, "iu");
      if (rdzen.length >= 4 && re.test(szkielet)) wycieki.push(rdzen);
    }
  }
  // Liczby wielocyfrowe = potencjalny przeniesiony fakt (rok w znaczniku ⟨rok⟩ jest OK).
  const liczby = szkielet.match(/\d{2,}/g) ?? [];
  wycieki.push(...liczby.map((l) => `liczba:${l}`));
  return [...new Set(wycieki)];
}

// ── Podział opinii na rozdziały ──────────────────────────────────────────────

/** Mapowanie nagłówka rozdziału na `rodzaj` używany w aplikacji. */
export function rodzajZTytulu(tytul: string): string {
  const t = tytul.toLowerCase();
  if (/wash|sztuczn\w+ obrót|transakcj\w+ wzajemn/.test(t)) return "wash";
  if (/layering|spoofing|warstw/.test(t)) return "layering";
  if (/matched|dopasowan|umówion/.test(t)) return "imo";
  if (/pump|dump|pompowan/.test(t)) return "pumpdump";
  if (/fixing|zamknięc|marking/.test(t)) return "fixing";
  if (/koncentracj/.test(t)) return "concentration";
  if (/odwrócen|reversal/.test(t)) return "reversal";
  if (/informacj/.test(t)) return "infomanip";
  if (/relacj|powiąza/.test(t)) return "relacje";
  if (/aktywnoś/.test(t)) return "aktywnosc";
  if (/espi|ebi|raport\w* bieżąc/.test(t)) return "espi";
  // Rozdziały teoretyczne PRZED ekonomiczno-finansowym: „MANIPULACJA INSTRUMENTEM
  // FINANSOWYM — UJĘCIE TEORETYCZNE" trafiał do `ekofin`, bo wzorzec `finansow`
  // łapał „finansowym" z nazwy instrumentu. Wzorzec ekofin jest teraz węższy.
  if (/teoretyczn|ujęcie prawne|ujęcie teoret|wstęp|zastosowane techniki/.test(t)) return "proza_iii";
  if (/ekonomiczno|sytuacj\w+ finansow|otoczeni\w* rynkow/.test(t)) return "ekofin";
  // W nowszym szkielecie biegłego nie ma rozdziału „Wnioski" — jego rolę pełni
  // „Odpowiedzi na postawione pytania". To ten sam gatunek wypowiedzi.
  if (/wniosk|odpowiedzi na (postawione )?pytani/.test(t)) return "wnioski";
  if (/podsumowan/.test(t)) return "proza_v";
  if (/ujęci/.test(t)) return "proza_iii";
  if (/przedmiot|podstawa prawna/.test(t)) return "proza_i";

  // ── Moduły dziedziny bankowej (pakiet `ryzyko_bankowe`) ────────────────────
  // Dopisane PO wzorcach GPW, żeby nie zmienić klasyfikacji spraw manipulacyjnych.
  // Wzorce z podrozdziałów A–L opinii PO III Ds 84.2020.
  if (/inflacj|kurs walutow|stopy procentow|makroekonomicz/.test(t)) return "makro";
  if (/\bcds\b|credit default|rating/.test(t)) return "sygnaly_rynkowe";
  if (/artykuł z|prasy|prasow/.test(t)) return "media";
  if (/aktywa banków|do pkb|wobec pkb/.test(t)) return "ekspozycja_sektor";
  if (/sprawozdania finansow|elementów sprawozdania/.test(t)) return "sprawozdania";
  if (/adekwatnoś|współczynnik\w* kapitałow|fundusz\w* własn/.test(t)) return "adekwatnosc";
  if (/limit/.test(t)) return "limity";
  if (/otoczenie prawne|standard\w* identyfikacj|procedur|uchwał\w* zarządu/.test(t)) return "otoczenie_prawne";
  return "inne";
}

// Nagłówek w tekście z zachowanymi liniami. Trzy formy naraz, bo biegły używa
// wszystkich: rzymskiej („IV. ANALIZA"), arabskiej („4. Wash trades") i BEZ NUMERU
// („ZASTOSOWANE TECHNIKI MANIPULACJI" — numer bywa tylko w spisie treści).
// Próg długości jest niski (5 znaków), bo tytuły bywają krótkie: „WNIOSKI", „WSTĘP",
// „ANALIZA". Fałszywe trafienia odsiewa filtr treści < 400 znaków niżej.
const NAGLOWEK =
  /^\s*(?:((?:[IVXLC]{1,5}|\d{1,2}|[A-Z])(?:\.\d+)*)[.)]\s+([A-ZĄĆĘŁŃÓŚŹŻ][^\n]{4,120})|()([A-ZĄĆĘŁŃÓŚŹŻ][A-ZĄĆĘŁŃÓŚŹŻ\s\d.,()–—-]{4,110}))$/gm;

// Fallback dla PDF: `unpdf` zwraca CAŁY dokument jako jedną linię (zero znaków
// nowej linii), więc kotwice ^$ nie działają. Szukamy nagłówków w strumieniu
// ciągłym: numer + WERSALIKOWY tytuł. Wpisy spisu treści odpadają same, bo są
// zakończone kropkami wiodącymi („4. WASH TRADES ....... 57").
//
// Półpauza i myślnik w klasie tytułu są konieczne: „ANALIZA – ODPOWIEDZI NA PYTANIA"
// bez nich nie pasowało, przez co cały ogon opinii (179 tys. znaków w SFI, 129 tys.
// w FTI) zostawał doklejony do rozdziału „WNIOSKI".
const NAGLOWEK_INLINE =
  /(?:^|\s)((?:[IVXLC]{1,5}|\d{1,2})(?:\.\d+)?)\.\s+([A-ZĄĆĘŁŃÓŚŹŻ][A-ZĄĆĘŁŃÓŚŹŻ\s.,()–—-]{6,70}?)(?=\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]|\s+[Ww] |\s+[Nn]a )/g;

export type Rozdzial = { no: string; tytul: string; tresc: string; poziom: number };

const _ODSL = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");

/**
 * Rozdziały z .docx po STYLACH NAGŁÓWKÓW Worda — autorytatywna struktura dokumentu.
 *
 * DLACZEGO NIE REGEX NA TEKŚCIE:
 * Rozdzielacz tekstowy widział w opinii HubTech 7 rozdziałów, a dokument ma ich 14.
 * Cała różnica to poziom 2 — czyli DOKŁADNIE rozdziały technik (Wash trades, Improper
 * matched orders, Layering and spoofing, aktywność, relacje, ekofin, ESPI), które
 * zlepiały się w jeden blok 108 tys. znaków pod nagłówkiem „IV. ANALIZA". Stąd korpus
 * wzorców nie miał ANI JEDNEGO wzorca techniki, mimo że materiał leżał w bazie od
 * miesięcy. W MLM ten sam blok ma 221 tys. znaków.
 *
 * Numer rozdziału bierzemy z treści nagłówka, gdy tam jest („IV. ANALIZA", „4. Wash
 * trades", „A) INFLACJA"). Przy numeracji automatycznej Worda numeru w tekście nie ma
 * — wtedy składamy go z pozycji, żeby rozdziały dały się rozróżnić i uporządkować.
 */
export function rozdzialyZDocx(xml: string): Rozdzial[] {
  type Trafienie = { poziom: number; tytul: string; idx: number };
  const naglowki: Trafienie[] = [];
  const akapity: { tekst: string; naglowek: Trafienie | null }[] = [];

  for (const frag of xml.split(/<w:p[ >]/).slice(1)) {
    const styl = frag.match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? "";
    const tekst = _ODSL([...frag.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(""))
      .replace(/\s+/g, " ")
      .trim();
    // Style bywają nazwane po angielsku (Heading1) i po polsku (Nagwek1 — Word gubi
    // znaki diakrytyczne w identyfikatorach stylów), stąd oba warianty.
    const m = styl.match(/^(?:Heading|Nagwek|Nag[łl][oó]wek)\s*(\d)?/i);
    if (m && tekst && !/^\d+$/.test(tekst)) {
      const t: Trafienie = { poziom: Number(m[1] ?? 1), tytul: tekst, idx: naglowki.length };
      naglowki.push(t);
      akapity.push({ tekst, naglowek: t });
    } else if (tekst) {
      akapity.push({ tekst, naglowek: null });
    }
  }
  if (!naglowki.length) return [];

  const out: Rozdzial[] = [];
  let biezacy: Trafienie | null = null;
  let bufor: string[] = [];
  const licznik: number[] = [];

  const numer = (t: Trafienie): string => {
    // Litera jako numer („A) INFLACJA – CPI") obok cyfr rzymskich i arabskich —
    // tak numeruje podrozdziały analizy szkielet opinii bankowych. Bez tego „A)"
    // i „B)" spadały na licznik pozycyjny, a „C)" i „I)" łapały się jako rzymskie,
    // przez co numeracja jednego rozdziału mieszała dwa systemy.
    const wTytule = t.tytul.match(/^((?:[IVXLC]+|[A-Z]|\d+)(?:\.\d+)*)[.)]/);
    if (wTytule) return wTytule[1];
    licznik.length = t.poziom;
    licznik[t.poziom - 1] = (licznik[t.poziom - 1] ?? 0) + 1;
    return licznik.filter((n) => n).join(".");
  };

  const domknij = () => {
    if (!biezacy) return;
    const tresc = bufor.join("\n").trim();
    // Nagłówek bez treści to pozycja spisu treści albo pusty tytuł działu.
    if (tresc.length > 400) {
      out.push({ no: numer(biezacy), tytul: biezacy.tytul, tresc, poziom: biezacy.poziom });
    }
  };

  for (const a of akapity) {
    if (a.naglowek) {
      domknij();
      biezacy = a.naglowek;
      bufor = [a.tekst];
    } else if (biezacy) {
      bufor.push(a.tekst);
    }
  }
  domknij();
  return out;
}

/** Dzieli pełny tekst opinii na rozdziały po nagłówkach „IV.4. Wash trades". */
export function podzielNaRozdzialy(
  tekst: string,
): { no: string; tytul: string; tresc: string }[] {
  const hits: { no: string; tytul: string; idx: number }[] = [];
  for (const m of tekst.matchAll(NAGLOWEK)) {
    // Wariant nienumerowany zwraca puste m[1] i tytuł w m[4] — numer nadajemy z pozycji.
    const numerowany = m[1] !== undefined && m[1] !== "";
    const tytul = (numerowany ? m[2] : m[4] ?? "").trim();
    if (!tytul) continue;
    hits.push({ no: numerowany ? m[1] : String(hits.length + 1), tytul, idx: m.index ?? 0 });
  }
  if (!hits.length) {
    // Druga próba — dokument bez podziału na linie (PDF).
    const seen = new Set<string>();
    for (const m of tekst.matchAll(NAGLOWEK_INLINE)) {
      const tytul = m[2].trim().replace(/[.\s]+$/, "");
      if (tytul.length < 6 || /^\.{2,}/.test(tytul)) continue;
      const klucz = `${m[1]}|${tytul}`;
      if (seen.has(klucz)) continue; // pierwszy raz = spis treści, drugi = treść
      seen.add(klucz);
      hits.push({ no: m[1], tytul, idx: (m.index ?? 0) + m[0].indexOf(m[1]) });
    }
    hits.sort((a, b) => a.idx - b.idx);
  }
  if (!hits.length) return [];
  return hits
    .map((h, i) => ({
      no: h.no,
      tytul: h.tytul,
      tresc: tekst.slice(h.idx, i + 1 < hits.length ? hits[i + 1].idx : undefined).trim(),
    }))
    .filter((r) => r.tresc.length > 400); // pomijamy spis treści i puste nagłówki
}

// ── Dobór wzorca do promptu redakcji ─────────────────────────────────────────

const MAX_ZN_WZORCA = 3200;

/**
 * Zwraca blok promptu ze zszkieletyzowanym rozdziałem tego samego rodzaju z opinii
 * wzorcowej biegłego. To mechanizm, w którym jakość prozy ROŚNIE z liczbą spraw:
 * każda dograna opinia powiększa pulę, z której dobierany jest wzorzec.
 *
 * Zwraca `null`, gdy brak wzorca danego rodzaju lub brak migracji 0008 — świadomie
 * NIE podstawiamy wzorca innego rodzaju: rozdział o wash trades zbudowany na wzorcu
 * rozdziału teoretycznego byłby gorszy niż brak wzorca.
 */
export async function buildWzorzecBlock(
  supabase: SupabaseClient,
  rodzaj: string,
): Promise<string | null> {
  let rows: { sprawa: string; rozdzial_no: string; tytul: string; szkielet: string; znakow: number }[] = [];
  try {
    const { data, error } = await supabase
      .from("wzorce")
      .select("sprawa,rozdzial_no,tytul,szkielet,znakow")
      .eq("rodzaj", rodzaj)
      .eq("aktywny", true)
      .order("znakow", { ascending: false })
      .limit(1);
    if (error || !data?.length) return null;
    rows = data;
  } catch {
    return null; // brak migracji 0008 — funkcja jest opcjonalna
  }

  const w = rows[0];
  const tresc = w.szkielet.length > MAX_ZN_WZORCA ? w.szkielet.slice(0, MAX_ZN_WZORCA) + "…" : w.szkielet;
  return (
    `WZORZEC ROZDZIAŁU Z WCZEŚNIEJSZEJ OPINII TEGO BIEGŁEGO (rozdz. ${w.rozdzial_no} „${w.tytul}").\n` +
    `Wszystkie nazwy, liczby i daty zostały ZASTĄPIONE ZNACZNIKAMI (⟨PODMIOT⟩, ⟨liczba⟩, ⟨data⟩), ` +
    `bo wzorzec ma uczyć wyłącznie SPOSOBU PISANIA: budowy akapitu, kolejności wywodu, formuł ` +
    `ostrożnościowych, sposobu wprowadzania podstawy prawnej i odwołań do dowodów.\n` +
    `BEZWZGLĘDNIE: nie odtwarzaj treści wzorca ani nie zgaduj, co kryje się pod znacznikami — ` +
    `wszystkie fakty i liczby bierz WYŁĄCZNIE z materiału tej sprawy podanego niżej.\n\n` +
    `--- wzorzec (szkielet) ---\n${tresc}\n--- koniec wzorca ---`
  );
}

// ── Kontrola proweniencji ────────────────────────────────────────────────────

// Znaczniki produkowane WYŁĄCZNIE przez tę aplikację. Jedno trafienie przesądza,
// że plik jest jej własnym wytworem, a nie autorską opinią biegłego.
//
// Po co: gdyby korpus wzorców zasilić opiniami wygenerowanymi przez aplikację,
// model uczyłby się WŁASNEGO stylu zamiast stylu biegłego — sprzężenie zwrotne,
// które utrwala bieżące maniery zamiast je korygować. Przy pierwszym zasiewie
// 41 z 55 wzorców pochodziło właśnie z generatów; stąd ta bramka.
//
// UWAGA: frazy, których aplikacja nauczyła się OD biegłego (np. „Źródło: opracowanie
// własne na podstawie akt sprawy") celowo NIE są tu wymienione — występują w obu
// źródłach i dawały fałszywe alarmy na autentycznych opiniach.
const ODCISKI_APLIKACJI = [
  "[do uzupełnienia]",
  "Rozdział do wygenerowania",
  "Subanaliza:",
  "silnik faktów",
  "— do wstawienia",
  "Wykres — do wstawienia",
  "Tabela — do wstawienia",
];

/** Czy tekst jest wytworem aplikacji (a więc NIE nadaje się na wzorzec stylu). */
export function czyGeneratAplikacji(tekst: string): { generat: boolean; odciski: string[] } {
  const odciski = ODCISKI_APLIKACJI.filter((o) => tekst.includes(o));
  return { generat: odciski.length > 0, odciski };
}

// ── Nazwy resztkowe: kontrola dla spraw BEZ rostera w bazie ──────────────────
//
// Najpewniejsza warstwa szkieletyzacji opiera się na rosterach z tabeli `cases`.
// Dla opinii z KOLEJNYCH spraw (historyczne opinie biegłego, których w bazie nie ma)
// tej warstwy nie ma — zostają same heurystyki, a `wykryjWycieki` sprawdza wyłącznie
// nazwy znane z rosterów. Efekt: raport pokazywałby „szczelny ✓", choć nazwisko z
// nieznanej sprawy właśnie przetrwało. Tu wykrywamy takie resztki do przeglądu okiem.

/** Terminy pisane wielką literą, które są częścią języka opinii — nie nazwami stron. */
const SLOWNIK_DOMENOWY = new Set(
  (
    // instytucje i rynek
    "KNF GPW KDPW UOKiK ESMA MAR RD UE PL EOG NewConnect Catalyst BondSpot WIG ISIN " +
    "ESPI EBI UTP TREM MiFID MiFIR LEI KRS NIP REGON PKD OTC " +
    "Komisja Giełda Giełdy Giełdzie Papierów Wartościowych Nadzoru Finansowego Krajowy Depozyt " +
    "Sąd Sądu Sądzie Sądowy Prokuratura Prokuratury Prokurator Prokuratorem Rzeczypospolitej Polskiej " +
    // akty prawne i struktura dokumentu
    "Rozporządzenie Rozporządzenia Rozporządzeniu Dyrektywa Dyrektywy Ustawa Ustawy Ustawie " +
    "Kodeks Kodeksu Dziennik Urzędowy Załącznik Załączniku Załącznika Artykuł Artykule " +
    "Sekcja Sekcji Tabela Tabeli Wykres Wykresu Rozdział Rozdziale Opinia Opinii Wnioski " +
    "Analiza Analizy Podsumowanie Wstęp Przedmiot Spis Treści " +
    // typowe początki zdań w prozie prawniczej
    "Biegły Biegłego Grupa Grupy Grupie Grupę Emitent Emitenta Spółka Spółki Spółce Spółkę " +
    "Podmiot Podmioty Podmiotu Osoba Osoby Rachunek Rachunku Zlecenie Zlecenia Transakcja Transakcje " +
    "Kurs Kursu Wolumen Obrót Obrotu Sesja Sesji Data Daty Okres Okresu Wartość Wartości " +
    "Powyższe Poniższe Niniejsza Niniejszy Niniejsze Zgodnie Ponadto Jednocześnie Natomiast " +
    "Wobec Zatem Przy Dla Oraz Jako Który Która Które Powyżej Poniżej Ustalono Stwierdzono " +
    "Zdaniem Analizie Badaniu Materiale Aktach Sprawie Sprawy Sprawa " +
    // nagłówki tabel i zwroty sprawozdawcze (wychwycone na realnych opiniach)
    "Razem RAZEM Suma SUMA Łącznie Ogółem Liczba LICZBA Udział UDZIAŁ Wartość WARTOŚĆ " +
    "Zrealizowane Niezrealizowane Anulowane Kupno Sprzedaż Saldo Lp Nazwa Rodzaj Numer Adres " +
    "Siedziba Źródło Czy Jakie Jaki Jakich Powyższa Poniższa Uwagi Uwaga Legenda Objaśnienia " +
    // formy prawne rozpisane słownie (także z literówkami spotykanymi w skanach)
    "Akcyjna AKCYJNA Spółka SPÓŁKA SPÓLKA Spolka Ograniczoną Odpowiedzialnością Komandytowa " +
    "Dom Maklerski Maklerskiego Biuro Bank Banku " +
    // miesiące (samodzielne, poza wzorcem daty)
    "Styczeń Luty Marzec Kwiecień Maj Czerwiec Lipiec Sierpień Wrzesień Październik Listopad Grudzień"
  ).split(/\s+/),
);

const RZYMSKIE = /^[IVXLC]+$/;

/**
 * Zwraca nazwy własne, które PRZETRWAŁY szkieletyzację — kandydatów do przeglądu.
 * Liczy tylko wystąpienia ŚRÓDZDANIOWE (nie po kropce), bo w polskim każde zdanie
 * zaczyna się wielką literą i początki zdań zalałyby raport szumem.
 */
export function resztkoweNazwy(szkielet: string): { nazwa: string; ile: number }[] {
  const licznik = new Map<string, number>();
  const dodaj = (w: string) => {
    if (w.length < 3 || RZYMSKIE.test(w) || SLOWNIK_DOMENOWY.has(w)) return;
    licznik.set(w, (licznik.get(w) ?? 0) + 1);
  };

  // 1) Wielka+małe (Joyfix, Kowalski) — wyłącznie śródzdaniowo.
  for (const m of szkielet.matchAll(
    /(^|[^.!?:;\n]\s+)([A-ZĆŁŃÓŚŹŻ][\p{Ll}]{2,})(?![\p{L}])/gu,
  )) {
    dodaj(m[2]);
  }
  // 2) WERSALIKI ≥4 znaki (JOYFIX w nagłówku) — niezależnie od pozycji.
  for (const m of szkielet.matchAll(/(?<![\p{L}⟨])([A-ZĆŁŃÓŚŹŻ]{4,})(?![\p{L}⟩])/gu)) {
    dodaj(m[1]);
  }

  return [...licznik.entries()]
    .map(([nazwa, ile]) => ({ nazwa, ile }))
    .sort((a, b) => b.ile - a.ile || a.nazwa.localeCompare(b.nazwa, "pl"));
}
