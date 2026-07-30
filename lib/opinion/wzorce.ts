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
  if (/ekonomiczno|finansow|otoczeni/.test(t)) return "ekofin";
  if (/wniosk/.test(t)) return "wnioski";
  if (/podsumowan/.test(t)) return "proza_v";
  if (/wstęp|teoretyczn|ujęci/.test(t)) return "proza_iii";
  if (/przedmiot|podstawa prawna/.test(t)) return "proza_i";
  return "inne";
}

const NAGLOWEK =
  /^\s*((?:[IVX]{1,4})(?:\.\d+)?)[.)]?\s+([A-ZĆŁŃÓŚŹŻ][^\n]{4,120})$/gm;

// Fallback dla PDF: `unpdf` zwraca CAŁY dokument jako jedną linię (zero znaków
// nowej linii), więc kotwice ^$ nie działają. Szukamy więc nagłówków w strumieniu
// ciągłym: numer + WERSALIKOWY tytuł. Wpisy spisu treści odpadają same, bo są
// zakończone kropkami wiodącymi („4. WASH TRADES ....... 57") — stąd negatywny
// lookahead na kropki i cyfrę strony.
const NAGLOWEK_INLINE =
  /(?:^|\s)((?:[IVX]{1,4}|\d{1,2})(?:\.\d+)?)\.\s+([A-ZĄĆĘŁŃÓŚŹŻ][A-ZĄĆĘŁŃÓŚŹŻ\s.-]{6,70}?)(?=\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]|\s+[Ww] |\s+[Nn]a )/g;

/** Dzieli pełny tekst opinii na rozdziały po nagłówkach „IV.4. Wash trades". */
export function podzielNaRozdzialy(
  tekst: string,
): { no: string; tytul: string; tresc: string }[] {
  const hits: { no: string; tytul: string; idx: number }[] = [];
  for (const m of tekst.matchAll(NAGLOWEK)) {
    hits.push({ no: m[1], tytul: m[2].trim(), idx: m.index ?? 0 });
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
