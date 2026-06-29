// Deterministyczny parser notowań (Stooq CSV) i obliczenie dynamiki kursu.
// LLM NIE LICZY — skala wzrostu kursu pochodzi wyłącznie z tych funkcji.
// Obsługa formatów Stooq: nagłówki PL/EN, separator ',' lub ';', dziesiętne '.'/','.

export type QuoteRow = { date: string; close: number; high: number | null; volume: number | null };

export type QuoteDynamics = {
  from: string;
  to: string;
  n: number;
  start: number;
  end: number;
  maxClose: number;
  peakDate: string;
  changeStartMaxPct: number;
  changeStartEndPct: number;
};

function norm(h: string): string {
  return h.replace(/[<>"]/g, "").trim().toLowerCase();
}

export function parseQuotesCsv(text: string): QuoteRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error("za mało wierszy");

  const delim = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const decimalComma = delim === ";";
  const header = lines[0].split(delim).map(norm);

  const idx = (re: RegExp) => header.findIndex((h) => re.test(h));
  const iDate = idx(/data|date/);
  const iClose = idx(/zamkni|close/);
  const iHigh = idx(/najwy|high/);
  const iVol = idx(/wolumen|volume|vol/);
  if (iDate < 0 || iClose < 0) throw new Error("brak kolumn Data/Zamknięcie");

  const num = (s: string | undefined): number | null => {
    if (s == null) return null;
    const v = parseFloat(decimalComma ? s.replace(/\s/g, "").replace(",", ".") : s.trim());
    return Number.isFinite(v) ? v : null;
  };

  const rows: QuoteRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(delim);
    const date = (c[iDate] ?? "").replace(/[<>"]/g, "").trim();
    const close = num(c[iClose]);
    if (!date || close == null) continue;
    rows.push({ date, close, high: iHigh >= 0 ? num(c[iHigh]) : null, volume: iVol >= 0 ? num(c[iVol]) : null });
  }
  if (!rows.length) throw new Error("brak danych");
  return rows;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function computeQuoteDynamics(
  rows: QuoteRow[],
  from?: string | null,
  to?: string | null,
): QuoteDynamics {
  let r = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  if (from && to) {
    const win = r.filter((x) => x.date >= from && x.date <= to);
    if (win.length) r = win;
  }
  const start = r[0].close;
  const end = r[r.length - 1].close;
  const peak = r.reduce((a, b) => (b.close > a.close ? b : a), r[0]);
  return {
    from: r[0].date,
    to: r[r.length - 1].date,
    n: r.length,
    start: r2(start),
    end: r2(end),
    maxClose: r2(peak.close),
    peakDate: peak.date,
    changeStartMaxPct: start ? r2((peak.close / start - 1) * 100) : 0,
    changeStartEndPct: start ? r2((end / start - 1) * 100) : 0,
  };
}
