// Graf powiązań (wektor SVG) do analizy OSINT — Grupa Milisystem.
// Renderowany bezpośrednio przez pdfmake (svg-to-pdfkit). Tekst używa rodziny
// "IBMPlexSans" (ta sama nazwa co font zarejestrowany w printerze) — dzięki temu
// polskie znaki (ł, ż, ą, ę, ń, ś) mają pokrycie glifów.
//
// Węzeł centralny = emitent; kolory = trzy klastry + dom maklerski.
// Linia ciągła = powiązanie bezpośrednie (funkcja / kapitał / obrót);
// linia przerywana = powiązanie pośrednie lub działanie na rachunku własnym.

type Cluster = "emit" | "I" | "II" | "III" | "broker" | "neutral";
type Node = { id: string; x: number; y: number; w: number; label: string; sub?: string; c: Cluster };
type Edge = { a: string; b: string; label?: string; dashed?: boolean; thick?: boolean };

const PALETTE: Record<Cluster, { fill: string; stroke: string; text: string }> = {
  emit:    { fill: "#F9DCE0", stroke: "#C0405A", text: "#8B1E3F" },
  I:       { fill: "#DCE6F2", stroke: "#6E86A8", text: "#24405F" },
  II:      { fill: "#DEEFE0", stroke: "#7FA982", text: "#2F5D33" },
  III:     { fill: "#F5E6D0", stroke: "#C79A5B", text: "#7A5320" },
  broker:  { fill: "#E6DEF2", stroke: "#9B7FC0", text: "#4A2E7F" },
  neutral: { fill: "#FFFFFF", stroke: "#9AA0AA", text: "#333333" },
};

const H = 40; // wysokość węzła

const NODES: Node[] = [
  // ── emitent ──
  { id: "MILI", x: 470, y: 385, w: 240, label: "MILISYSTEM S.A.", sub: "emitent · KRS 449009 · Toruń", c: "emit" },
  // ── klaster I — Toruń / Międlar (niebieski) ──
  { id: "RAGSP", x: 505, y: 78, w: 170, label: "Ragnar sp. z o.o.", c: "I" },
  { id: "RAGT", x: 250, y: 150, w: 220, label: "Ragnar Trade sp. z o.o.", sub: "KRS 602579 · Gorzowska 19", c: "I" },
  { id: "MIED", x: 500, y: 232, w: 210, label: "Piotr Międlar", sub: "prezes emitenta od 26.05.2022", c: "I" },
  { id: "JURA", x: 235, y: 292, w: 200, label: "Michał Jura", sub: "rach. własny + Ragnar/Labcanna", c: "I" },
  { id: "NOWAK", x: 360, y: 352, w: 200, label: "Tomasz Nowak", sub: "zbywca 22,73% → Ragnar Trade", c: "I" },
  { id: "LABC", x: 800, y: 150, w: 175, label: "Labcanna S.A.", sub: "NewConnect", c: "I" },
  { id: "FOX", x: 905, y: 232, w: 165, label: "Foxbuy.com", c: "I" },
  { id: "KICI", x: 850, y: 320, w: 210, label: "Paweł Kiciński", sub: "rach. własny + Labcanna/Foxbuy", c: "I" },
  { id: "GREN", x: 1000, y: 402, w: 190, label: "Sebastian Greń", sub: "rach. własny + Dirox/Foxbuy", c: "I" },
  // ── klaster II — Katowice / Boszko-Ochman (zielony) ──
  { id: "CENT", x: 235, y: 468, w: 220, label: "Centurion Finance ASI", sub: "KRS 396580 · Katowice", c: "II" },
  { id: "JBOS", x: 40, y: 452, w: 190, label: "Joanna Boszko", sub: "akcjonariuszka + rach. własny", c: "II" },
  { id: "BBOS", x: 95, y: 585, w: 175, label: "Bartosz Boszko", sub: "prezes Centurion", c: "II" },
  { id: "OCHL", x: 250, y: 645, w: 190, label: "Łukasz Ochman", sub: "wiceprezes Centurion", c: "II" },
  { id: "OCHM", x: 420, y: 690, w: 180, label: "Marcin Ochman", sub: "rach. własny", c: "II" },
  // ── klaster III — offshore (pomarańczowy) ──
  { id: "ALP", x: 500, y: 528, w: 175, label: "Alpha Trading (Nevis)", c: "III" },
  { id: "MAMA", x: 830, y: 512, w: 155, label: "Mamavale (CY)", c: "III" },
  { id: "TEXL", x: 505, y: 692, w: 155, label: "Texla Pte (SG)", c: "III" },
  { id: "TEXO", x: 640, y: 730, w: 165, label: "Texolla Pte (SG)", c: "III" },
  { id: "NVA1", x: 815, y: 730, w: 165, label: "NVA Trading 1 (BG)", c: "III" },
  { id: "NVA5", x: 985, y: 695, w: 170, label: "NVA Trading 5 (BG)", c: "III" },
  { id: "NVM", x: 890, y: 645, w: 160, label: "NVM Trading (SG)", c: "III" },
  { id: "ICM", x: 1055, y: 618, w: 165, label: "ICM Trade 1 (BG)", c: "III" },
  // ── dom maklerski + Mayster ──
  { id: "DMIC", x: 655, y: 585, w: 195, label: "DM INTERCAPITAL", sub: "broker klastra · zał. N. Mayster", c: "broker" },
  { id: "MAY", x: 900, y: 505, w: 195, label: "Nicolay Mayster", sub: "dysp. NVM+ICM = zał. brokera", c: "neutral" },
];

const EDGES: Edge[] = [
  { a: "RAGSP", b: "RAGT" },
  { a: "RAGT", b: "MIED", label: "prezes/wspólnik" },
  { a: "RAGT", b: "MILI", label: "22,73% (10.05, pozarynek)", thick: true },
  { a: "MIED", b: "MILI", label: "prezes od 26.05" },
  { a: "NOWAK", b: "RAGT", label: "zbywca 22,73%", dashed: true },
  { a: "JURA", b: "MILI", label: "rach. własny", dashed: true },
  { a: "MIED", b: "LABC", dashed: true },
  { a: "JURA", b: "FOX", dashed: true },
  { a: "KICI", b: "LABC", dashed: true },
  { a: "KICI", b: "MILI", label: "rach. własny", dashed: true },
  { a: "GREN", b: "MILI", label: "rach. własny", dashed: true },
  // klaster II
  { a: "CENT", b: "MILI", label: "obrót" },
  { a: "CENT", b: "BBOS", label: "prezes" },
  { a: "CENT", b: "OCHL", label: "wiceprezes" },
  { a: "JBOS", b: "MILI", label: "rach. własny", dashed: true },
  { a: "OCHM", b: "MILI", label: "rach. własny", dashed: true },
  // klaster III + broker
  { a: "MAY", b: "DMIC", label: "założyciel/dyrektor" },
  { a: "DMIC", b: "MILI", label: "obrót", thick: true },
  { a: "MAY", b: "NVM", label: "dysponent", dashed: true },
  { a: "MAY", b: "ICM", label: "dysponent", dashed: true },
  { a: "DMIC", b: "ALP" },
  { a: "DMIC", b: "MAMA" },
  { a: "DMIC", b: "TEXL" },
  { a: "DMIC", b: "TEXO" },
  { a: "DMIC", b: "NVA1" },
  { a: "DMIC", b: "NVA5" },
  { a: "DMIC", b: "NVM" },
  { a: "DMIC", b: "ICM" },
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const byId = (id: string) => NODES.find((n) => n.id === id)!;
const cx = (n: Node) => n.x + n.w / 2;
const cy = (n: Node) => n.y + H / 2;

// Punkt na krawędzi prostokąta n w kierunku (tx,ty) — by linie dochodziły do brzegu, nie środka.
function anchor(n: Node, tx: number, ty: number): [number, number] {
  const dx = tx - cx(n), dy = ty - cy(n);
  if (dx === 0 && dy === 0) return [cx(n), cy(n)];
  const hw = n.w / 2, hh = H / 2;
  const sx = dx === 0 ? Infinity : hw / Math.abs(dx);
  const sy = dy === 0 ? Infinity : hh / Math.abs(dy);
  const s = Math.min(sx, sy);
  return [cx(n) + dx * s, cy(n) + dy * s];
}

export function milisystemGraphSvg(): string {
  const W = 1200, HT = 860;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${HT}" font-family="IBMPlexSans">`);
  parts.push(`<rect x="0" y="0" width="${W}" height="${HT}" fill="#FFFFFF"/>`);
  // tytuł
  parts.push(`<text x="30" y="34" font-size="21" fill="#1F3864">${esc("Graf powiązań — Grupa Milisystem (RP I Ds 4.2019)")}</text>`);

  // ── krawędzie (pod węzłami) ──
  for (const e of EDGES) {
    const A = byId(e.a), B = byId(e.b);
    const [x1, y1] = anchor(A, cx(B), cy(B));
    const [x2, y2] = anchor(B, cx(A), cy(A));
    const col = "#8A93A0";
    const dash = e.dashed ? ` stroke-dasharray="5 4"` : "";
    const wdt = e.thick ? 2.4 : 1.2;
    parts.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${col}" stroke-width="${wdt}"${dash}/>`);
    if (e.label) {
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const w = e.label.length * 5.4 + 8;
      parts.push(`<rect x="${(mx - w / 2).toFixed(1)}" y="${(my - 8).toFixed(1)}" width="${w.toFixed(1)}" height="15" fill="#FFFFFF" opacity="0.9"/>`);
      parts.push(`<text x="${mx.toFixed(1)}" y="${(my + 3.5).toFixed(1)}" font-size="10.5" fill="#5B6470" text-anchor="middle">${esc(e.label)}</text>`);
    }
  }

  // ── węzły ──
  for (const n of NODES) {
    const p = PALETTE[n.c];
    parts.push(`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${H}" rx="5" ry="5" fill="${p.fill}" stroke="${p.stroke}" stroke-width="1.3"/>`);
    if (n.sub) {
      parts.push(`<text x="${cx(n).toFixed(1)}" y="${(n.y + 17).toFixed(1)}" font-size="12.5" fill="${p.text}" text-anchor="middle">${esc(n.label)}</text>`);
      parts.push(`<text x="${cx(n).toFixed(1)}" y="${(n.y + 31).toFixed(1)}" font-size="9.5" fill="${p.text}" text-anchor="middle" opacity="0.85">${esc(n.sub)}</text>`);
    } else {
      parts.push(`<text x="${cx(n).toFixed(1)}" y="${(n.y + 25).toFixed(1)}" font-size="12.5" fill="${p.text}" text-anchor="middle">${esc(n.label)}</text>`);
    }
  }

  // ── legenda ──
  const ly = 812;
  const leg: [Cluster, string][] = [["emit", "Emitent"], ["I", "Klaster I — Toruń / Międlar"], ["II", "Klaster II — Katowice / Boszko-Ochman"], ["III", "Klaster III — offshore"], ["broker", "Dom maklerski (Mayster)"]];
  let lx = 30;
  for (const [c, lab] of leg) {
    const p = PALETTE[c];
    parts.push(`<rect x="${lx}" y="${ly - 10}" width="16" height="12" rx="2" fill="${p.fill}" stroke="${p.stroke}"/>`);
    parts.push(`<text x="${lx + 22}" y="${ly}" font-size="10.5" fill="#3A3A3A">${esc(lab)}</text>`);
    lx += 40 + lab.length * 6.0;
  }
  parts.push(`<text x="30" y="${ly + 22}" font-size="9.5" fill="#6B7280">${esc("linia ciągła — powiązanie bezpośrednie (funkcja / kapitał / obrót);  linia przerywana — powiązanie pośrednie / rachunek własny.  Źródła: KRS, GLEIF, akta sprawy, źródła jawne.")}</text>`);

  parts.push(`</svg>`);
  return parts.join("");
}
