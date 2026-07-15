// Wykres „data × adres IP" w formie wykresu nr 6 analizy specjalisty (styl ggplot):
// oś X = daty logowań, oś Y = współdzielone adresy IP, punkt = logowanie podmiotu
// (pusty symbol w kolorze podmiotu). NAŁOŻENIE symboli = różne podmioty na tym samym
// IP tego samego dnia — wizualny dowód zbieżności. Czysty SVG (render przez pdfmake).

export type IpEvent = { date: string; ip: string; user: string };

const GRID = "#E5E5E5";
const AXIS = "#4D4D4D";
// Paleta odcieni jak ggplot hue (12 kategorii, cyklicznie).
const HUE = [
  "#F8766D", "#DB8E00", "#AEA200", "#64B200", "#00BD5C", "#00C1A7",
  "#00BADE", "#00A6FF", "#B385FF", "#EF67EB", "#FF63B6", "#FF6C91",
];

// Puste symbole (stroke, bez wypełnienia) — kolejność jak shapes ggplot.
function marker(kind: number, x: number, y: number, c: string, r = 5.4): string {
  const s = `fill="none" stroke="${c}" stroke-width="${Math.max(1.1, r * 0.31)}"`;
  switch (kind % 12) {
    case 0: return `<rect x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}" ${s}/>`;
    case 1: return `<circle cx="${x}" cy="${y}" r="${r}" ${s}/>`;
    case 2: return `<path d="M${x} ${y - r} L${x + r} ${y + r} L${x - r} ${y + r} Z" ${s}/>`;
    case 3: return `<path d="M${x - r} ${y} H${x + r} M${x} ${y - r} V${y + r}" ${s}/>`;
    case 4: return `<path d="M${x - r} ${y - r} L${x + r} ${y + r} M${x - r} ${y + r} L${x + r} ${y - r}" ${s}/>`;
    case 5: return `<path d="M${x} ${y - r} L${x + r} ${y} L${x} ${y + r} L${x - r} ${y} Z" ${s}/>`;
    case 6: return `<path d="M${x} ${y + r} L${x + r} ${y - r} L${x - r} ${y - r} Z" ${s}/>`;
    case 7: return `<g ${s}><rect x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}"/><path d="M${x - r} ${y - r} L${x + r} ${y + r} M${x - r} ${y + r} L${x + r} ${y - r}"/></g>`;
    case 8: return `<path d="M${x} ${y - r} V${y + r} M${x - r} ${y} H${x + r} M${x - 0.7 * r} ${y - 0.7 * r} L${x + 0.7 * r} ${y + 0.7 * r} M${x - 0.7 * r} ${y + 0.7 * r} L${x + 0.7 * r} ${y - 0.7 * r}" ${s}/>`;
    case 9: return `<g ${s}><path d="M${x} ${y - r} L${x + r} ${y} L${x} ${y + r} L${x - r} ${y} Z"/><path d="M${x - r} ${y} H${x + r} M${x} ${y - r} V${y + r}"/></g>`;
    case 10: return `<g ${s}><circle cx="${x}" cy="${y}" r="${r}"/><path d="M${x - r} ${y} H${x + r} M${x} ${y - r} V${y + r}"/></g>`;
    default: return `<g ${s}><circle cx="${x}" cy="${y}" r="${r}"/><path d="M${x - 0.75 * r} ${y - 0.75 * r} L${x + 0.75 * r} ${y + 0.75 * r} M${x - 0.75 * r} ${y + 0.75 * r} L${x + 0.75 * r} ${y - 0.75 * r}"/></g>`;
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const plDate = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;

const MAX_IPS = 28; // czytelność strony — najbardziej znamienne adresy (najwięcej podmiotów/zdarzeń)

export function ipChartSvg(events: IpEvent[]): { svg: string; truncated: number } {
  // Oś Y: adresy wg liczby podmiotów → zdarzeń; rysowane w porządku malejącym (jak wzór).
  const byIp = new Map<string, { users: Set<string>; n: number }>();
  for (const e of events) {
    const b = byIp.get(e.ip) ?? { users: new Set(), n: 0 };
    b.users.add(e.user); b.n++;
    byIp.set(e.ip, b);
  }
  const ranked = [...byIp.entries()].sort((a, b) => b[1].users.size - a[1].users.size || b[1].n - a[1].n);
  const keep = new Set(ranked.slice(0, MAX_IPS).map(([ip]) => ip));
  const truncated = Math.max(0, byIp.size - keep.size);
  const ev = events.filter((e) => keep.has(e.ip));

  const ips = [...keep].sort((a, b) => (a < b ? 1 : -1)); // string desc — układ jak we wzorze
  const dates = [...new Set(ev.map((e) => e.date))].sort();
  const users = [...new Set(ev.map((e) => e.user))].sort((a, b) => a.localeCompare(b, "pl"));
  const ipIdx = new Map(ips.map((v, i) => [v, i]));
  const dIdx = new Map(dates.map((v, i) => [v, i]));
  const uIdx = new Map(users.map((v, i) => [v, i]));

  // Krok siatki adaptacyjny: całość celuje w ~1300 px szerokości (czytelność po
  // przeskalowaniu do strony poziomej PDF); przy wielu datach punkty i etykiety gęstnieją.
  const ML = 148, MT = 14, MR = 16;
  const CW = Math.max(6, Math.min(26, 1150 / Math.max(dates.length, 2)));
  const CH = 24;
  const plotW = Math.max(dates.length, 2) * CW, plotH = Math.max(ips.length, 2) * CH;
  const dateStep = Math.max(1, Math.ceil(9.2 / CW)); // etykiety dat bez nakładania
  const dateFont = CW * dateStep > 12 ? 8.5 : 7.5;
  const MB = 108;

  // Legenda: łamanie wierszy wg szacowanej szerokości pozycji.
  const legW = ML + plotW + MR;
  const items = users.map((u, i) => ({ u, w: 26 + u.length * 6.6, i }));
  const rows: { u: string; i: number; x: number }[][] = [];
  let cur: { u: string; i: number; x: number }[] = [], curW = 0;
  for (const it of items) {
    if (curW + it.w > legW - 130 && cur.length) { rows.push(cur); cur = []; curW = 0; }
    cur.push({ u: it.u, i: it.i, x: curW }); curW += it.w + 22;
  }
  if (cur.length) rows.push(cur);
  const legH = rows.length * 20 + 14;

  const W = ML + plotW + MR, H = MT + plotH + MB + legH;
  const px = (di: number) => ML + di * CW + CW / 2;
  const py = (ii: number) => MT + ii * CH + CH / 2;

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="DejaVu Sans, Arial, sans-serif">`);
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="white"/>`);
  parts.push(`<rect x="${ML}" y="${MT}" width="${plotW}" height="${plotH}" fill="#FBFBFB" stroke="#D9D9D9" stroke-width="0.8"/>`);
  // siatka
  for (let i = 0; i < ips.length; i++)
    parts.push(`<line x1="${ML}" y1="${py(i)}" x2="${ML + plotW}" y2="${py(i)}" stroke="${GRID}" stroke-width="0.8"/>`);
  for (let d = 0; d < dates.length; d++)
    parts.push(`<line x1="${px(d)}" y1="${MT}" x2="${px(d)}" y2="${MT + plotH}" stroke="${GRID}" stroke-width="0.8"/>`);
  // etykiety Y (IP) + X (daty, pionowo)
  for (let i = 0; i < ips.length; i++)
    parts.push(`<text x="${ML - 6}" y="${py(i) + 3}" text-anchor="end" font-size="9" fill="${AXIS}">${esc(ips[i])}</text>`);
  for (let d = 0; d < dates.length; d += dateStep)
    parts.push(`<text x="${px(d)}" y="${MT + plotH + 8}" text-anchor="end" font-size="${dateFont}" fill="${AXIS}" transform="rotate(-90 ${px(d)} ${MT + plotH + 8})">${plDate(dates[d])}</text>`);
  // tytuły osi
  parts.push(`<text x="${ML + plotW / 2}" y="${MT + plotH + 86}" text-anchor="middle" font-size="11" fill="black">Data</text>`);
  parts.push(`<text x="14" y="${MT + plotH / 2}" text-anchor="middle" font-size="11" fill="black" transform="rotate(-90 14 ${MT + plotH / 2})">Adres IP</text>`);
  // Kolor podmiotu: przy zawinięciu kształtów (>12 podmiotów) przesuwamy paletę,
  // żeby ta sama para (kształt, kolor) nie powtórzyła się dla dwóch podmiotów.
  const colorOf = (i: number) => HUE[(i + Math.floor(i / HUE.length) * 5) % HUE.length];

  // punkty (promień adaptacyjny do gęstości dat)
  const R = Math.min(5.4, Math.max(2.4, CW * 0.45));
  for (const e of ev)
    parts.push(marker(uIdx.get(e.user)!, px(dIdx.get(e.date)!), py(ipIdx.get(e.ip)!), colorOf(uIdx.get(e.user)!), R));
  // legenda
  const ly0 = MT + plotH + MB - 6;
  parts.push(`<text x="${ML - 8}" y="${ly0 + rows.length * 10}" text-anchor="end" font-size="10.5" fill="black">Podmiot</text>`);
  rows.forEach((row, ri) => {
    const rowW = row.length ? row[row.length - 1].x + 26 + row[row.length - 1].u.length * 6.6 : 0;
    const x0 = ML + Math.max(0, (plotW - rowW) / 2);
    for (const it of row) {
      const y = ly0 + ri * 20 + 6;
      parts.push(marker(it.i, x0 + it.x + 8, y, colorOf(it.i)));
      parts.push(`<text x="${x0 + it.x + 20}" y="${y + 3.5}" font-size="9.5" fill="${AXIS}">${esc(it.u)}</text>`);
    }
  });
  parts.push(`</svg>`);
  return { svg: parts.join(""), truncated };
}
