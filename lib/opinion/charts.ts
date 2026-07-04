// Deterministyczny generator wykresów opinii — czysty SVG (bez zależności).
//
// Zasada „LLM nie liczy" obowiązuje też grafikę: wykres to rzut serii metryk
// silnika na osie; żadnych wygładzeń, trendów ani interpolacji. Rasteryzacja do
// PNG odbywa się wyłącznie po stronie serwera (lib/opinion/docx.ts, resvg);
// ten moduł jest czysty i bezpieczny dla bundla klienta.

export type ChartSeries = {
  label: string;
  unit: string; // "zł" | "%" | "szt" — do etykiet osi i legendy
  values: (number | null)[]; // wyrównane do days
  kind: "line" | "bars";
};

export type ChartSpec = {
  title: string;
  days: string[]; // oś X (sesje, ISO)
  left: ChartSeries; // oś lewa
  right?: ChartSeries; // opcjonalna oś prawa (druga skala)
};

const W = 1000;
const H = 420;
const ML = 86; // margines lewy (etykiety osi)
const MR = 86; // margines prawy (druga oś)
const MT = 54; // tytuł + legenda
const MB = 74; // daty pod kątem

const INK = "#1f2a37";
const LEFT_COLOR = "#16324f";
const RIGHT_BAR = "#c3cad4";
const RIGHT_LINE = "#8a5a2c";
const GRID = "#e3e6ea";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Skala z „ładnymi" podziałkami (5 kresek) — deterministyczna.
function niceScale(lo: number, hi: number): { lo: number; hi: number; step: number } {
  if (!isFinite(lo) || !isFinite(hi)) return { lo: 0, hi: 1, step: 0.25 };
  if (lo > 0 && lo < hi * 0.4) lo = 0; // serie dodatnie zaczynaj od zera, gdy blisko
  if (hi === lo) hi = lo + 1;
  const span = hi - lo;
  const raw = span / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step };
}

// Etykieta osi w formacie PL, kompaktowa dla dużych liczb.
function fmtTick(v: number, unit: string): string {
  const abs = Math.abs(v);
  let s: string;
  if (abs >= 1_000_000) s = (v / 1_000_000).toLocaleString("pl-PL", { maximumFractionDigits: 1 }) + " mln";
  else if (abs >= 10_000) s = (v / 1_000).toLocaleString("pl-PL", { maximumFractionDigits: 0 }) + " tys.";
  else s = v.toLocaleString("pl-PL", { maximumFractionDigits: abs < 10 ? 2 : 0 });
  return unit === "%" ? `${s}%` : s;
}

function scaleOf(series: ChartSeries): { lo: number; hi: number; step: number } {
  const vals = series.values.filter((v): v is number => v != null && isFinite(v));
  if (!vals.length) return { lo: 0, hi: 1, step: 0.25 };
  let lo = Math.min(...vals);
  const hi = Math.max(...vals);
  if (series.kind === "bars") lo = Math.min(0, lo);
  return niceScale(lo, hi);
}

export function chartSvg(spec: ChartSpec): string {
  const iw = W - ML - MR; // szerokość pola rysunku
  const ih = H - MT - MB;
  const n = spec.days.length || 1;
  const band = iw / n;
  const xC = (i: number) => ML + band * i + band / 2;

  const L = scaleOf(spec.left);
  const R = spec.right ? scaleOf(spec.right) : null;
  const yOf = (v: number, s: { lo: number; hi: number }) => MT + ih - ((v - s.lo) / (s.hi - s.lo)) * ih;

  const el: string[] = [];
  el.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="DejaVu Sans" font-size="12" fill="${INK}">`,
  );
  el.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="white"/>`);
  el.push(`<text x="${ML}" y="22" font-size="15" font-weight="bold">${esc(spec.title)}</text>`);

  // Siatka + kreski osi lewej.
  for (let v = L.lo; v <= L.hi + 1e-9; v += L.step) {
    const y = yOf(v, L);
    el.push(`<line x1="${ML}" y1="${y}" x2="${W - MR}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`);
    el.push(`<text x="${ML - 8}" y="${y + 4}" text-anchor="end">${esc(fmtTick(v, spec.left.unit))}</text>`);
  }
  if (spec.right && R)
    for (let v = R.lo; v <= R.hi + 1e-9; v += R.step) {
      const y = yOf(v, R);
      el.push(`<text x="${W - MR + 8}" y="${y + 4}" text-anchor="start" fill="#6b7280">${esc(fmtTick(v, spec.right.unit))}</text>`);
    }

  // Oś X: daty co k-ta, pod kątem.
  const stepX = Math.max(1, Math.ceil(n / 12));
  spec.days.forEach((d, i) => {
    if (i % stepX !== 0 && i !== n - 1) return;
    const x = xC(i);
    el.push(`<line x1="${x}" y1="${MT + ih}" x2="${x}" y2="${MT + ih + 4}" stroke="${INK}" stroke-width="1"/>`);
    el.push(`<text x="${x}" y="${MT + ih + 16}" text-anchor="end" transform="rotate(-42 ${x} ${MT + ih + 16})">${esc(d)}</text>`);
  });
  el.push(`<line x1="${ML}" y1="${MT + ih}" x2="${W - MR}" y2="${MT + ih}" stroke="${INK}" stroke-width="1"/>`);

  // Serie: najpierw prawa (tło — słupki), potem lewa (linia na wierzchu).
  const drawBars = (s: ChartSeries, sc: { lo: number; hi: number }, color: string) => {
    const y0 = yOf(Math.max(sc.lo, 0), sc);
    s.values.forEach((v, i) => {
      if (v == null || !isFinite(v)) return;
      const y = yOf(v, sc);
      const bw = Math.max(1.5, band * 0.62);
      el.push(
        `<rect x="${xC(i) - bw / 2}" y="${Math.min(y, y0)}" width="${bw}" height="${Math.max(0.75, Math.abs(y0 - y))}" fill="${color}"/>`,
      );
    });
  };
  const drawLine = (s: ChartSeries, sc: { lo: number; hi: number }, color: string) => {
    let seg: string[] = [];
    const flush = () => {
      if (seg.length > 1) el.push(`<polyline points="${seg.join(" ")}" fill="none" stroke="${color}" stroke-width="2.2"/>`);
      else if (seg.length === 1) {
        const [x, y] = seg[0].split(",").map(Number);
        el.push(`<circle cx="${x}" cy="${y}" r="2.6" fill="${color}"/>`);
      }
      seg = [];
    };
    s.values.forEach((v, i) => {
      if (v == null || !isFinite(v)) return flush();
      seg.push(`${xC(i)},${yOf(v, sc)}`);
    });
    flush();
  };
  if (spec.right && R) (spec.right.kind === "bars" ? drawBars : drawLine)(spec.right, R, spec.right.kind === "bars" ? RIGHT_BAR : RIGHT_LINE);
  (spec.left.kind === "bars" ? drawBars : drawLine)(spec.left, L, spec.left.kind === "bars" ? RIGHT_BAR : LEFT_COLOR);

  // Legenda (prawy górny róg).
  const legend: { label: string; color: string; bar: boolean }[] = [
    { label: `${spec.left.label} (${spec.left.unit})`, color: spec.left.kind === "bars" ? RIGHT_BAR : LEFT_COLOR, bar: spec.left.kind === "bars" },
  ];
  if (spec.right)
    legend.push({
      label: `${spec.right.label} (${spec.right.unit})`,
      color: spec.right.kind === "bars" ? RIGHT_BAR : RIGHT_LINE,
      bar: spec.right.kind === "bars",
    });
  let lx = W - MR;
  const parts: string[] = [];
  for (const item of [...legend].reverse()) {
    const tw = item.label.length * 6.4 + 26;
    lx -= tw;
    parts.push(
      (item.bar
        ? `<rect x="${lx}" y="30" width="12" height="10" fill="${item.color}"/>`
        : `<line x1="${lx}" y1="35" x2="${lx + 12}" y2="35" stroke="${item.color}" stroke-width="2.4"/>`) +
        `<text x="${lx + 17}" y="39">${esc(item.label)}</text>`,
    );
  }
  el.push(...parts);
  el.push(`</svg>`);
  return el.join("");
}
