// Wykres śróddziennej aktywności arkusza dla jednej sesji (layering/spoofing) —
// CZYSTY moduł SVG (bez node:fs), współdzielony przez raport Spoofing & Layering
// (lib/opinion/spoofing-pdf.ts) i opinię (lib/opinion/build.ts → rozdział IV layering,
// który trafia też do bundla klienckiego podglądu). Obszary: SumaWolK (kupno, zielony),
// SumaWolS (sprzedaż, różowy poniżej zera), Różnica (żółty); linie BestBid/BestAsk
// (oś prawa) z silnika dopasowań, a bez kwotowań — kurs transakcyjny.

export type SessionSeries = {
  times: string[];
  sumK: number[];
  sumS: number[];
  diff: number[];
  price: (number | null)[];
  bid?: (number | null)[];
  ask?: (number | null)[];
  bid_full?: (number | null)[];
  ask_full?: (number | null)[];
};

export function sessionChartSvg(
  s: SessionSeries,
  day: string,
  bidArr: (number | null)[] | undefined,
  askArr: (number | null)[] | undefined,
  title: string,
): string {
  void day;
  const W = 760, H = 320, ML = 60, MR = 52, MT = 28, MB = 44;
  const pw = W - ML - MR, ph = H - MT - MB, n = s.times.length;
  const x = (i: number) => ML + (pw * i) / Math.max(1, n - 1);
  const top = Math.max(1, ...s.sumK, ...s.diff);
  const bot = Math.max(1, ...s.sumS, ...s.diff.map((v) => -v));
  const vhi = top, vlo = -bot;
  const yV = (v: number) => MT + ph * (1 - (v - vlo) / (vhi - vlo));
  const zeroY = yV(0);
  const hasBook = !!(bidArr && askArr && bidArr.some((v) => v != null) && askArr.some((v) => v != null));
  const prices = (hasBook ? [...(bidArr ?? []), ...(askArr ?? [])] : s.price).filter((p): p is number => p != null);
  const plo = prices.length ? Math.min(...prices) : 0, phi = prices.length ? Math.max(...prices) : 1;
  const pad = (phi - plo) * 0.12 || 0.1;
  const yP = (p: number) => MT + ph * (1 - (p - (plo - pad)) / (phi + pad - (plo - pad)));
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const area = (arr: number[], sign = 1) =>
    `<polygon points="${x(0).toFixed(1)},${zeroY.toFixed(1)} ` +
    arr.map((v, i) => `${x(i).toFixed(1)},${yV(sign * v).toFixed(1)}`).join(" ") +
    ` ${x(n - 1).toFixed(1)},${zeroY.toFixed(1)}"`;
  const line = (arr: (number | null)[], mapY: (v: number) => number) =>
    arr.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${mapY(v).toFixed(1)}`)).filter(Boolean).join(" ");
  const el: string[] = [];
  el.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="DejaVu Sans" font-size="10" fill="#333">`);
  el.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="white"/>`);
  el.push(`<text x="${ML}" y="16" font-size="11.5" font-weight="bold" fill="#1F3864">${esc(title)}</text>`);
  for (let k = 0; k <= 4; k++) {
    const v = vlo + ((vhi - vlo) * k) / 4, y = yV(v);
    el.push(`<line x1="${ML}" y1="${y.toFixed(1)}" x2="${W - MR}" y2="${y.toFixed(1)}" stroke="#E5E7EB" stroke-width="1"/>`);
    el.push(`<text x="${ML - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="#888">${Math.round(v).toLocaleString("pl-PL")}</text>`);
  }
  for (let k = 0; k <= 4; k++) {
    const p = plo - pad + ((phi + pad - (plo - pad)) * k) / 4, y = yP(p);
    el.push(`<text x="${W - MR + 6}" y="${(y + 3).toFixed(1)}" fill="#C0392B">${p.toFixed(2)}</text>`);
  }
  for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 8))) {
    el.push(`<text x="${x(i).toFixed(1)}" y="${H - 24}" text-anchor="middle" fill="#888">${esc(s.times[i])}</text>`);
  }
  el.push(`${area(s.sumK)} fill="#C6EFCE" stroke="none"/>`);
  el.push(`${area(s.sumS, -1)} fill="#F8C7CE" stroke="none"/>`);
  el.push(`${area(s.diff)} fill="#F5D90A" fill-opacity="0.72" stroke="none"/>`);
  el.push(`<line x1="${ML}" y1="${zeroY.toFixed(1)}" x2="${W - MR}" y2="${zeroY.toFixed(1)}" stroke="#9AA0AA" stroke-width="1"/>`);
  const lg: [string, string, boolean][] = [
    ["#C6EFCE", "wolumen kupna Grupy", false], ["#F8C7CE", "wolumen sprzedaży", false], ["#F5D90A", "Różnica (saldo)", false],
  ];
  if (hasBook) {
    const bidPts = line(bidArr!, yP), askPts = line(askArr!, yP);
    if (bidPts) el.push(`<polyline points="${bidPts}" fill="none" stroke="#2E7D32" stroke-width="1.7"/>`);
    if (askPts) el.push(`<polyline points="${askPts}" fill="none" stroke="#C0392B" stroke-width="1.7"/>`);
    lg.push(["#2E7D32", "BestBid", true], ["#C0392B", "BestAsk", true]);
  } else {
    const pricePts = line(s.price, yP);
    if (pricePts) el.push(`<polyline points="${pricePts}" fill="none" stroke="#C0392B" stroke-width="1.7"/>`);
    lg.push(["#C0392B", "kurs transakcyjny (zł)", true]);
  }
  let lx = ML;
  for (const [c, t, isLine] of lg) {
    if (isLine) el.push(`<line x1="${lx}" y1="${H - 12}" x2="${lx + 14}" y2="${H - 12}" stroke="${c}" stroke-width="2.2"/>`);
    else el.push(`<rect x="${lx}" y="${H - 16}" width="14" height="9" fill="${c}"/>`);
    el.push(`<text x="${lx + 18}" y="${H - 9}" fill="#555">${esc(t)}</text>`);
    lx += 24 + t.length * 6.2;
  }
  el.push(`</svg>`);
  return el.join("");
}
