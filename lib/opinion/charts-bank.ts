// Wykresy dziedziny bankowej — składane z danych subanaliz, bez modelu.
//
// U biegłego opinia MBR ma 29 wykresów; u nas było zero, choć dane były policzone.
// Wykres nie jest ozdobą: szereg 33 punktów w tabeli jest nieczytelny, a spadek
// indeksu o 55% widać dopiero na osi.
//
// ZASADA „LLM NIE LICZY" obowiązuje też grafikę — wykres jest rzutem policzonych
// serii na osie, bez wygładzeń i interpolacji.
import type { ChartSpec } from "./charts";

type Wiersz = string[];
type Tabela = { caption?: string; head?: string[]; rows?: Wiersz[] };

/**
 * Liczba z zapisu polskiego („3 634,60 %") — null, gdy komórka nie jest liczbą.
 *
 * Komórka pusta albo z myślnikiem MUSI dać null, nie zero. Silnik wpisuje „—",
 * gdy w danym okresie progu regulacyjnego NIE BYŁO (przed CRR nie istniał wymóg
 * CET1); zamiana tego na 0 kazałaby narysować próg na poziomie zerowym i sugerować
 * wymóg, którego nie było.
 */
function liczba(s: string | undefined): number | null {
  if (!s) return null;
  const t = s.replace(/[^\d,.-]/g, "").replace(/\s/g, "").replace(",", ".");
  if (!/\d/.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/**
 * Wykres szeregu rynkowego (moduł `makro`, `sygnaly_rynkowe`).
 * Tabela ma postać [Miesiąc, Wartość] — pierwsza kolumna to data ISO.
 */
export function wykresSzeregu(
  t: Tabela | undefined,
  tytul: string,
  jednostka: string,
  dzienZdarzenia?: string | null,
): ChartSpec | null {
  const rows = (t?.rows ?? []).filter((r) => r[0] && liczba(r[1]) !== null);
  if (rows.length < 3) return null;
  return {
    title: tytul,
    days: rows.map((r) => r[0]),
    left: { label: tytul, unit: jednostka, kind: "line", values: rows.map((r) => liczba(r[1])) },
    znacznik: dzienZdarzenia ? { dzien: dzienZdarzenia, label: "dzień decyzji" } : undefined,
  };
}

/**
 * Wykres współczynnika kapitałowego w czasie (moduł `wskazniki_bank`).
 *
 * Tabela ma układ [Wskaźnik, okres₁, okres₂, …, Zmiana, Próg, Podstawa progu],
 * czyli wskaźniki w WIERSZACH, a okresy w KOLUMNACH — trzeba ją obrócić.
 * Próg rysujemy z tej samej tabeli: wykres bez niego nie mówi, czy 11% to dużo.
 */
export function wykresAdekwatnosci(t: Tabela | undefined, kodWiersza: string): ChartSpec | null {
  const head = t?.head ?? [];
  const rows = t?.rows ?? [];
  if (head.length < 3 || !rows.length) return null;

  // Kolumny okresów to te, których nagłówek wygląda jak data ISO.
  const idxOkresow = head
    .map((h, i) => ({ h, i }))
    .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.h))
    .map((x) => x.i);
  if (idxOkresow.length < 2) return null;

  const wiersz = rows.find((r) => (r[0] ?? "").toLowerCase().includes(kodWiersza.toLowerCase()));
  if (!wiersz) return null;

  const wartosci = idxOkresow.map((i) => liczba(wiersz[i]));
  if (wartosci.filter((v) => v !== null).length < 2) return null;

  const iProg = head.findIndex((h) => h.toLowerCase() === "próg");
  const prog = iProg >= 0 ? liczba(wiersz[iProg]) : null;
  const iPodstawa = head.findIndex((h) => h.toLowerCase().startsWith("podstawa"));
  const podstawa = iPodstawa >= 0 ? (wiersz[iPodstawa] ?? "") : "";

  return {
    title: wiersz[0],
    days: idxOkresow.map((i) => head[i]),
    left: { label: wiersz[0], unit: "%", kind: "line", values: wartosci },
    // Próg tylko wtedy, gdy w danym okresie obowiązywał — silnik zwraca „—",
    // gdy przepisu jeszcze nie było, i takiej linii NIE WOLNO dorysować.
    prog: prog !== null ? { wartosc: prog, label: `próg ${prog}% — ${podstawa}`.slice(0, 64) } : undefined,
  };
}

/** Wszystkie wykresy dla sprawy bankowej, w kolejności rozdziałów opinii. */
export function wykresyBankowe(
  subanalizy: { kind: string; data?: unknown }[],
  dzienZdarzenia?: string | null,
): { kind: string; name: string; spec: ChartSpec }[] {
  const dane = (k: string) =>
    subanalizy.find((s) => s.kind === k)?.data as
      | { table?: Tabela; tables?: Tabela[] }
      | undefined;

  const out: { kind: string; name: string; spec: ChartSpec }[] = [];

  const makro = dane("makro");
  for (const [i, t] of (makro?.tables ?? []).entries()) {
    const nazwa = (t.caption ?? "").replace(/^Tabela\.\s*/, "").split("—")[0].trim() || "Szereg rynkowy";
    const w = wykresSzeregu(t, nazwa, "", dzienZdarzenia);
    if (w) out.push({ kind: "makro", name: `makro_${i + 1}`, spec: w });
  }

  const wsk = dane("wskazniki_bank");
  for (const kod of ["kapitału podstawowego", "kapitału Tier 1", "Łączny współczynnik"]) {
    const w = wykresAdekwatnosci(wsk?.table, kod);
    if (w) out.push({ kind: "wskazniki_bank", name: `adekwatnosc_${out.length + 1}`, spec: w });
  }

  const syg = dane("sygnaly_rynkowe");
  for (const [i, t] of (syg?.tables ?? []).entries()) {
    // Tabela parametrów obliczenia nie jest szeregiem — nie rysujemy jej.
    if (/parametry obliczenia/i.test(t.caption ?? "")) continue;
    const nazwa = (t.caption ?? "").replace(/^Tabela\.\s*/, "").split("—")[0].trim() || "Sygnał rynkowy";
    const w = wykresSzeregu(t, nazwa, "", dzienZdarzenia);
    if (w) out.push({ kind: "sygnaly_rynkowe", name: `sygnal_${i + 1}`, spec: w });
  }

  return out;
}
