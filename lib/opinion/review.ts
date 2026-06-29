// Agent recenzent (QA#2) — DETERMINISTYCZNY linter zmontowanej opinii.
// Zero zgadywania przez model: same reguły nad strukturą opinii, metrykami i
// subanalizami. Sześć kontroli adwersarialnych; każda zwraca uwagi lub „OK".

import type { Chapter, Opinion, StoredSub } from "./build";

export type Severity = "ERROR" | "WARN" | "OK";
export type ReviewFinding = { check: string; severity: Severity; message: string };

type Metric = { key: string; value: number | null; unit: string | null; session_day: string | null };

const C = {
  numbers: "Spójność liczb",
  tables: "Odniesienia do tabel",
  legal: "Powołania prawne",
  calib: "Kalibracja sformułowań",
  scope: "Zakres = pytania postanowienia",
  complete: "Kompletność i falsyfikacja",
};
export const REVIEW_CHECKS = [C.numbers, C.tables, C.legal, C.calib, C.scope, C.complete];

function chapText(ch: Chapter): string {
  return (
    ch.paras.map((p) => p.text).join("\n") +
    "\n" +
    (ch.findings?.map((f) => f.text).join("\n") ?? "")
  );
}

export function reviewOpinion(opinion: Opinion, metrics: Metric[], stored: StoredSub[]): ReviewFinding[] {
  void stored;
  const out: ReviewFinding[] = [];
  const add = (check: string, severity: Severity, message: string) => out.push({ check, severity, message });

  // 1. Spójność liczb — wartości procentowe w rozdziale ilościowym muszą mieć
  //    pokrycie w metrykach silnika lub w komórkach tabel.
  const numSet = new Set<string>();
  for (const m of metrics)
    if (m.value != null) numSet.add(m.value.toLocaleString("pl-PL") + (m.unit === "%" ? "%" : ""));
  for (const ch of opinion.chapters)
    if (ch.table) for (const row of ch.table.rows) for (const cell of row) numSet.add(cell.trim());
  const pctRe = /\d{1,3}(?:,\d+)?%/g;
  let numIssues = 0;
  for (const ch of opinion.chapters) {
    if (!/ilościow/i.test(ch.title) && !/ilościow/i.test(ch.source ?? "")) continue;
    for (const c of chapText(ch).match(pctRe) ?? [])
      if (!numSet.has(c)) {
        add(C.numbers, "WARN", `Liczba ${c} (rozdz. ${ch.no}) nie ma pokrycia w policzonych wskaźnikach — zweryfikuj.`);
        numIssues++;
      }
  }
  if (!numIssues) add(C.numbers, "OK", "Liczby w rozdziale ilościowym zgodne z metrykami silnika.");

  // 2. Odniesienia do tabel — każde „Tabela N" w tekście musi istnieć.
  const tabNums = new Set<number>();
  for (const ch of opinion.chapters)
    if (ch.table) {
      const m = ch.table.caption.match(/tabela\s*(\d+)/i);
      if (m) tabNums.add(+m[1]);
    }
  const refRe = /tabel\w*\s*(?:nr\s*)?(\d+)/gi;
  let tabIssues = 0;
  for (const ch of opinion.chapters) {
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
  const overRe = /jednoznacznie|bez wątpienia|niewątpliwie|na pewno|udowodniono|winny|umyśln\w+|z premedytacją/gi;
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
  const chII = opinion.chapters.find((c) => c.no === "II");
  if (chII && chII.status === "todo") {
    add(C.scope, "WARN", "Rozdz. II „Wnioski” niewygenerowany — opinia nie odpowiada wprost na pytania postanowienia.");
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
  if (!/wyklucz|wyłącz|falsyfik|nie nosi znamion|nie wykazuj|bez znamion/i.test(allText)) {
    add(C.complete, "WARN", "Brak elementu falsyfikacji — wskaż podmioty/osoby, których aktywność nie nosi znamion manipulacji.");
    compIssues++;
  }
  const todoMarks = (allText.match(/\[do uzupełnienia/gi) ?? []).length;
  if (todoMarks) {
    add(C.complete, "WARN", `Pozostało ${todoMarks} miejsc „[do uzupełnienia]" do uzupełnienia.`);
    compIssues++;
  }
  if (!compIssues) add(C.complete, "OK", "Opinia kompletna, z elementem falsyfikacji.");

  return out;
}
