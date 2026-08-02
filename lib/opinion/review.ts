// Agent recenzent (QA#2) — DETERMINISTYCZNY linter zmontowanej opinii.
// Zero zgadywania przez model: same reguły nad strukturą opinii, metrykami i
// subanalizami. Sześć kontroli adwersarialnych; każda zwraca uwagi lub „OK".

import { DOC_TYPES_BANK } from "@/lib/domain/taxonomy-bank";
import { DOC_TYPES } from "@/lib/intake/taxonomy";

import type { Chapter, Opinion, StoredSub } from "./build";

export type Severity = "ERROR" | "WARN" | "OK";
// Odesłanie „[do uzupełnienia]" → źródło w aktach (załącznik). `docType` klikalne
// (otwiera zakładkę Pliki zawężoną do dowodu); `internal` = odsyłacz do rozdziału.
export type PlaceholderRef = { label: string; docType?: string; internal?: boolean };
export type ReviewFinding = { check: string; severity: Severity; message: string; refs?: PlaceholderRef[] };

type Metric = { key: string; value: number | null; unit: string | null; session_day: string | null };

const C = {
  numbers: "Spójność liczb",
  tables: "Odniesienia do tabel",
  legal: "Powołania prawne",
  calib: "Kalibracja sformułowań",
  scope: "Zakres = pytania postanowienia",
  complete: "Kompletność i falsyfikacja",
  aktualnosc: "Aktualność prozy wobec danych",
};
export const REVIEW_CHECKS = [C.numbers, C.tables, C.legal, C.calib, C.scope, C.complete, C.aktualnosc];

function chapText(ch: Chapter): string {
  return (
    ch.paras.map((p) => p.text).join("\n") +
    "\n" +
    (ch.findings?.map((f) => f.text).join("\n") ?? "")
  );
}

// Wszystkie tabele rozdziału (wiele numerowanych albo pojedyncza) — spójne z montażem.
function chTables(ch: Chapter) {
  return ch.tables && ch.tables.length ? ch.tables : ch.table ? [ch.table] : [];
}

// Mapowanie „[do uzupełnienia]" → źródło w aktach (załącznik), z którego biegły
// może uzupełnić brakującą daną. Klasyfikacja po kontekście poprzedzającym lukę
// oraz treści samego placeholdera. Etykiety z jednego źródła prawdy (taksonomia).
function placeholderSource(ctx: string, chapterNo: string, bank = false): PlaceholderRef {
  const s = ctx.toLowerCase();
  if (/rozdzia|rozdz\.|właściw\w*\s+rozdzia/.test(s))
    return { label: "odsyłacz wewnętrzny — wskaż właściwy rozdział opinii (np. IV.5)", internal: true };
  if (/\bstor\b/.test(s)) return { label: DOC_TYPES.STOR.label, docType: "STOR" };
  if (/adres\w*\s+ip|\bip\b|logowa/.test(s)) return { label: DOC_TYPES.DANE_IP.label, docType: "DANE_IP" };
  if (/rejestrow|\bkrs\b|reprezentac|pełnomocnic|zarząd|organ\w*\s+podmiot|powiązań\w*\s+osobow|relacj\w*\s+osobow/.test(s))
    return { label: DOC_TYPES.KRS_REJESTR.label, docType: "KRS_REJESTR" };
  if (/espi|\bebi\b|raport\w*\s+bieżąc|komunikat|treść\w*[^.]*raport|datacj\w*[^.]*raport/.test(s))
    return { label: DOC_TYPES.RAPORT_ESPI_EBI.label, docType: "RAPORT_ESPI_EBI" };
  if (/sprawozda|finansow|fundament|bilans|rachunek\w*\s+zysk/.test(s))
    return { label: DOC_TYPES.SPRAWOZDANIE_FIN.label, docType: "SPRAWOZDANIE_FIN" };
  if (/strateg|rachunk|brokersk|firm\w*\s+inwestycyjn|dom\w*\s+maklersk/.test(s))
    return { label: DOC_TYPES.DANE_BROKERSKIE.label, docType: "DANE_BROKERSKIE" };
  if (/rozlicze|\btrem\b|kdpw|rozrachun/.test(s))
    return { label: DOC_TYPES.DANE_TREM.label, docType: "DANE_TREM" };
  // ⚠️ FALLBACK MUSI ODSYŁAĆ DO AKT TEJ DZIEDZINY. Opinia bankowa dostawała
  // odesłanie do „źródłowych danych UTP (transakcje i zlecenia)" — pliku, którego
  // w aktach bankowych nie ma i nigdy nie będzie. Biegły czytał wskazówkę, jak
  // uzupełnić lukę z dokumentu z drugiej dziedziny.
  if (bank) return { label: DOC_TYPES_BANK.SPRAWOZDANIE_BANK.label, docType: "SPRAWOZDANIE_BANK" };
  // Fallback zależny od rozdziału: identyfikacja relacji → KRS, analiza ESPI →
  // raporty bieżące; pozostałe rozdziały ilościowe → źródłowe dane transakcyjne.
  if (chapterNo === "IV.3") return { label: DOC_TYPES.KRS_REJESTR.label, docType: "KRS_REJESTR" };
  if (chapterNo === "IV.2") return { label: DOC_TYPES.RAPORT_ESPI_EBI.label, docType: "RAPORT_ESPI_EBI" };
  return { label: DOC_TYPES.DANE_UTP.label, docType: "DANE_UTP" };
}

export function reviewOpinion(opinion: Opinion, metrics: Metric[], stored: StoredSub[]): ReviewFinding[] {
  const out: ReviewFinding[] = [];
  // ⚠️ NUMERY ROZDZIAŁÓW SĄ CECHĄ DZIEDZINY, NIE STAŁĄ. Kontrole odwoływały się
  // wprost do „II" (Wnioski) i „IV" (analiza) — tak wygląda szkielet opinii
  // o manipulacji. W szkielecie bankowym Wnioski są w III, analiza w V, spisy
  // w VII–VIII. Recenzent sprawdzał więc nie te rozdziały co trzeba, wskazywał
  // biegłemu złe numery, a kontrola pokrycia liczb NIGDY nie oglądała modułów
  // bankowych — mimo to jej ostrzeżenia odejmowały punkty w ocenie opinii.
  const bank = opinion.typ === "ryzyko_bankowe";
  const NR_WNIOSKI = bank ? "III" : "II";
  const PREFIX_ANALIZY = bank ? "V" : "IV";
  const NRY_SPISOW = bank ? ["VII", "VIII"] : ["VI"];
  const add = (check: string, severity: Severity, message: string) => out.push({ check, severity, message });

  // 0. PROZA STARSZA NIŻ DANE, KTÓRE OPISUJE.
  //    Ponowne uruchomienie kroku liczbowego kasowało wcześniej zredagowany rozdział;
  //    dziś tekst zostaje, ale opisuje odczyt sprzed przeliczenia. Milczące zachowanie
  //    takiej prozy jest groźniejsze niż jej skasowanie — wygląda na aktualną, a może
  //    powoływać liczby, których w tabelach już nie ma.
  const nieaktualne = stored
    .filter((s) => (s.data as { proza_sprzed_przeliczenia?: boolean } | null)?.proza_sprzed_przeliczenia)
    .filter((s) => (s.body_md ?? "").trim().length > 0)
    .map((s) => s.kind);
  if (nieaktualne.length)
    add(
      C.aktualnosc,
      "WARN",
      `Proza ${nieaktualne.length} rozdziałów powstała PRZED ostatnim przeliczeniem danych ` +
        `(${nieaktualne.join(", ")}). Sprawdź, czy powołane w niej liczby zgadzają się z tabelami, ` +
        "albo zredaguj rozdział ponownie.",
    );

  // 1. Spójność liczb — wartości procentowe w rozdziale ilościowym muszą mieć
  //    pokrycie w metrykach silnika lub w komórkach tabel.
  // Normalizacja znaku: proza podaje magnitudę („spadek o 16,28%"), tabela/metryka
  // ma znak („−16,28%") — porównujemy wartości bezwzględne (znak nie decyduje o pokryciu).
  const unsign = (s: string) => s.replace(/^[+\-−]/, "");
  const numSet = new Set<string>();
  for (const m of metrics)
    if (m.value != null) numSet.add(unsign(m.value.toLocaleString("pl-PL")) + (m.unit === "%" ? "%" : ""));
  for (const ch of opinion.chapters)
    for (const t of chTables(ch))
      for (const row of t.rows) for (const cell of row) numSet.add(unsign(String(cell ?? "").trim()));
  const pctRe = /\d{1,3}(?:,\d+)?%/g;
  let numIssues = 0;
  const seenNum = new Set<string>();
  for (const ch of opinion.chapters) {
    // Rozdziały analityczne: ilościowy (zgodność wsteczna) oraz rozdział IV (analiza).
    const analytical =
      /ilościow/i.test(ch.title) || /ilościow/i.test(ch.source ?? "") || ch.no.startsWith(PREFIX_ANALIZY);
    if (!analytical) continue;
    for (const c of chapText(ch).match(pctRe) ?? []) {
      const key = ch.no + "|" + c;
      if (numSet.has(c) || seenNum.has(key)) continue;
      seenNum.add(key);
      // Odesłanie do pliku źródłowego, w którym biegły zweryfikuje niespójność:
      // dane transakcyjne (UTP) dla rozdziałów ilościowych, z override'em na
      // raporty ESPI (IV.2) i KRS (IV.3) — ta sama heurystyka co placeholdery.
      out.push({
        check: C.numbers,
        severity: "WARN",
        message: `Liczba ${c} (rozdz. ${ch.no}) nie ma pokrycia w policzonych wskaźnikach ani w tabelach — zweryfikuj w źródle.`,
        refs: [placeholderSource("", ch.no, bank)],
      });
      numIssues++;
    }
  }
  if (!numIssues) add(C.numbers, "OK", "Liczby w rozdziale ilościowym zgodne z metrykami silnika.");

  // 2. Odniesienia do tabel — każde „Tabela N" w tekście musi istnieć.
  //
  // Numer bierzemy Z KOLEJNOŚCI, nie z podpisu. Podpisy dziedziny bankowej brzmią
  // „Tabela. Pozycje sprawozdań…" — numeracja powstaje dopiero przy składaniu spisu.
  // Wyprowadzanie zbioru numerów z podpisów dawało zbiór PUSTY, przez co każde
  // poprawne odwołanie stawało się błędem.
  let ileTabel = 0;
  for (const ch of opinion.chapters) ileTabel += chTables(ch).length;
  const tabNums = new Set<number>(Array.from({ length: ileTabel }, (_, i) => i + 1));
  for (const ch of opinion.chapters)
    for (const t of chTables(ch)) {
      const m = t.caption.match(/tabela\s*(?:nr\s*)?(\d+)/i);
      if (m) tabNums.add(+m[1]);
    }
  // Rozdziały SPISOWE wymieniają tabele i wykresy z numerami — to jest ich treść,
  // a nie odwołanie do czegoś innego. Skanowanie ich jako odsyłaczy dawało tyle
  // fałszywych błędów, ile pozycji w spisie, i podważało zaufanie do kontrolera.
  const spisowy = (t: string) => /^spis\s/i.test(t.trim());
  const refRe = /tabel\w*\s*(?:nr\s*)?(\d+)/gi;
  let tabIssues = 0;
  for (const ch of opinion.chapters) {
    if (spisowy(ch.title)) continue;
    const t = chapText(ch);
    let m: RegExpExecArray | null;
    refRe.lastIndex = 0;
    while ((m = refRe.exec(t)))
      if (!tabNums.has(+m[1])) {
        add(C.tables, "ERROR", `Odwołanie do „Tabeli ${m[1]}" (rozdz. ${ch.no}), której nie ma w opinii.`);
        tabIssues++;
      }
  }
  if (!tabIssues) add(C.tables, "OK", "Wszystkie odwołania do tabel mają pokrycie.");

  // 3. Powołania prawne — opis techniki manipulacji musi mieć powołanie przepisu.
  const techRe = /wash[ -]?trade|layering|spoofing|matched order|pozorny obrót|transakcj\w* wzajemn/i;
  const lawRe = /\bMAR\b|2016\/522|art\.\s*12|art\.\s*183/i;
  let legalIssues = 0;
  for (const ch of opinion.chapters) {
    // Rozdział VI (spis tabel/wykresów) wymienia nazwy technik w podpisach tabel —
    // to indeks, nie analiza, więc nie wymaga powołania przepisu w treści.
    if (NRY_SPISOW.includes(ch.no) || /spis (tabel|treści|wykres)/i.test(ch.title)) continue;
    const t = chapText(ch);
    if (techRe.test(t) && !lawRe.test(t)) {
      add(C.legal, "WARN", `Rozdz. ${ch.no} opisuje technikę manipulacji bez powołania przepisu w treści (MAR / RD 2016/522).`);
      legalIssues++;
    }
  }
  if (!opinion.legalBasis.length) {
    add(C.legal, "WARN", "Brak ogólnej podstawy prawnej opinii.");
    legalIssues++;
  }
  if (!legalIssues) add(C.legal, "OK", "Twierdzenia o technikach mają powołania prawne.");

  // 4. Kalibracja sformułowań — wyrażenia przesądzające o pewności/winie/zamiarze.
  // „winny" tylko w kontekście winy (winny czynu/manipulacji), nie „winny/powinny być".
  const overRe = /jednoznacznie|bez wątpienia|niewątpliwie|na pewno|udowodniono|win(?:ny|ien|ni)\s+(?:zarzuc\w+|czynu|manipulacji|przestępstwa|popełnienia|zarzutu)|umyśln\w+|z premedytacją/gi;
  let calibIssues = 0;
  for (const ch of opinion.chapters) {
    const hits = new Set((chapText(ch).match(overRe) ?? []).map((s) => s.toLowerCase()));
    for (const h of hits) {
      add(C.calib, "WARN", `Sformułowanie „${h}" (rozdz. ${ch.no}) — ocena pewności/winy/zamiaru należy do sądu; rozważ kalibrację.`);
      calibIssues++;
    }
  }
  if (!calibIssues) add(C.calib, "OK", "Brak nadmiarowych sformułowań przesądzających.");

  // 5. Zakres = pytania postanowienia.
  let scopeIssues = 0;
  const chI = opinion.chapters.find((c) => c.no === "I");
  if (chI && chI.paras.some((p) => p.conf === "todo")) {
    add(C.scope, "WARN", "Rozdz. I — oznacz przedmiot, spółkę, okres i pytania postanowienia.");
    scopeIssues++;
  }
  const chWnioski = opinion.chapters.find((c) => c.no === NR_WNIOSKI);
  if (chWnioski && chWnioski.status === "todo") {
    add(C.scope, "WARN", `Rozdz. ${NR_WNIOSKI} „Wnioski” niewygenerowany — opinia nie odpowiada wprost na pytania postanowienia.`);
    scopeIssues++;
  }
  if (!opinion.signature) {
    add(C.scope, "WARN", "Brak sygnatury sprawy w opinii.");
    scopeIssues++;
  }
  if (!scopeIssues) add(C.scope, "OK", "Zakres zakotwiczony w postanowieniu.");

  // 6. Kompletność i falsyfikacja.
  let compIssues = 0;
  const notReady = opinion.chapters.filter((c) => c.status !== "ready").map((c) => c.no);
  if (notReady.length) {
    add(C.complete, "WARN", `Rozdziały niegotowe: ${notReady.join(", ")} (do wygenerowania/zatwierdzenia).`);
    compIssues++;
  }
  const allText = opinion.chapters.map(chapText).join("\n");
  // Falsyfikacja przez wskazanie podmiotów BEZ znamion manipulacji to wymóg opinii
  // o manipulacji instrumentem. W opinii bankowej nie ma podmiotów do wykluczenia —
  // ten WARN padał w każdej sprawie bankowej i odejmował punkty za brak czegoś,
  // czego ta dziedzina w ogóle nie zna.
  if (!bank && !/wyklucz|wyłącz|falsyfik|nie nosi znamion|nie wykazuj|bez znamion/i.test(allText)) {
    add(C.complete, "WARN", "Brak elementu falsyfikacji — wskaż podmioty/osoby, których aktywność nie nosi znamion manipulacji.");
    compIssues++;
  }
  // Wszystkie placeholdery do wypełnienia — nie tylko „[do uzupełnienia]", ale też
  // „[oznaczenie …]", „[do ustalenia …]" itp. Wyliczamy je pojedynczo: rozdział +
  // fragment kontekstu + ODESŁANIE do źródła w aktach (załącznik), z którego biegły
  // uzupełni brakującą daną. Odesłania z docType są klikalne (otwierają Pliki).
  const phRe = /\[(?:do uzupełnienia|oznaczenie|do ustalenia|do wskazania|nazwa)[^\]]*\]/gi;
  const phItems: { ch: string; snippet: string; ref: PlaceholderRef }[] = [];
  const seenPh = new Set<string>();
  for (const ch of opinion.chapters) {
    const t = chapText(ch);
    let m: RegExpExecArray | null;
    phRe.lastIndex = 0;
    while ((m = phRe.exec(t))) {
      const before = t.slice(Math.max(0, m.index - 70), m.index).replace(/\s+/g, " ").trim();
      const dedup = ch.no + "|" + before.slice(-40) + "|" + m[0];
      if (seenPh.has(dedup)) continue;
      seenPh.add(dedup);
      phItems.push({ ch: ch.no, snippet: before.slice(-58), ref: placeholderSource(before + " " + m[0], ch.no, bank) });
    }
  }
  if (phItems.length) {
    add(
      C.complete,
      "WARN",
      `Pozostało ${phItems.length} miejsc do uzupełnienia — przy każdym wskazano źródło w aktach ` +
        `(załącznik) do ręcznego uzupełnienia przez biegłego.`,
    );
    for (const p of phItems)
      out.push({
        check: C.complete,
        severity: "WARN",
        message: `Rozdz. ${p.ch}: „…${p.snippet} [do uzupełnienia]”`,
        refs: [p.ref],
      });
    compIssues++;
  }
  if (!compIssues) add(C.complete, "OK", "Opinia kompletna, z elementem falsyfikacji.");

  return out;
}
