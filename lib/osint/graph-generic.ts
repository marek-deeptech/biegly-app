// Generyczny graf powiązań (wektor SVG) — budowany z danych ustalonych przez
// agenta OSINT (GraphData), dla dowolnej sprawy. Układ deterministyczny:
// węzeł centralny (emitent) w środku, klastry w ćwiartkach wokół niego,
// węzły klastra w siatce 2-kolumnowej. Paleta i konwencje jak w grafie MLM
// (linia ciągła = powiązanie bezpośrednie, przerywana = pośrednie/rachunek własny).
// Tekst w rodzinie "IBMPlexSans" (font zarejestrowany w pdfmake → glify PL).

export type GNode = { id: string; label: string; sub?: string };
export type GEdge = { a: string; b: string; label?: string; dashed?: boolean; thick?: boolean };
export type GraphData = {
  title: string;
  center: GNode;
  clusters: { name: string; nodes: GNode[] }[];
  edges: GEdge[];
};

type Palette = { fill: string; stroke: string; text: string };
const CENTER_P: Palette = { fill: "#F9DCE0", stroke: "#C0405A", text: "#8B1E3F" };
const CLUSTER_P: Palette[] = [
  { fill: "#DCE6F2", stroke: "#6E86A8", text: "#24405F" }, // niebieski
  { fill: "#DEEFE0", stroke: "#7FA982", text: "#2F5D33" }, // zielony
  { fill: "#F5E6D0", stroke: "#C79A5B", text: "#7A5320" }, // pomarańczowy
  { fill: "#E6DEF2", stroke: "#9B7FC0", text: "#4A2E7F" }, // fioletowy
  { fill: "#FFFFFF", stroke: "#9AA0AA", text: "#333333" }, // neutralny
];

const W = 1200, HT = 880, NW = 212, NH = 40;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clamp = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

type Placed = GNode & { x: number; y: number; w: number; p: Palette };

// Punkt na krawędzi prostokąta w kierunku (tx,ty) — linie dochodzą do brzegu węzła.
function anchor(n: Placed, tx: number, ty: number): [number, number] {
  const cx = n.x + n.w / 2, cy = n.y + NH / 2;
  const dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return [cx, cy];
  const s = Math.min(dx ? n.w / 2 / Math.abs(dx) : Infinity, dy ? NH / 2 / Math.abs(dy) : Infinity);
  return [cx + dx * s, cy + dy * s];
}

export function buildGraphSvg(g: GraphData): string {
  // ── rozmieszczenie ── centrum + ćwiartki (kolejne klastry dokładane cyklicznie)
  const placed = new Map<string, Placed>();
  const centerW = 250;
  placed.set(g.center.id, { ...g.center, x: (W - centerW) / 2, y: 402, w: centerW, p: CENTER_P });

  // Ćwiartki: [x0, y0] lewy-górny narożnik siatki 2×k; siatka: 2 kolumny co 262 px, wiersze co 66 px.
  const quads: [number, number][] = [
    [45, 96],   // lewa-górna
    [655, 96],  // prawa-górna
    [45, 560],  // lewa-dolna
    [655, 560], // prawa-dolna
  ];
  const used = [0, 0, 0, 0]; // zajęte wiersze w ćwiartce
  g.clusters.slice(0, 8).forEach((cl, ci) => {
    const q = ci % 4;
    const p = CLUSTER_P[ci % CLUSTER_P.length];
    cl.nodes.slice(0, 10).forEach((n, ni) => {
      if (placed.has(n.id)) return;
      const col = ni % 2, row = used[q] + Math.floor(ni / 2);
      placed.set(n.id, { ...n, x: quads[q][0] + col * 262, y: quads[q][1] + row * 66, w: NW, p });
    });
    used[q] += Math.ceil(Math.min(cl.nodes.length, 10) / 2) + 0.35; // odstęp między klastrami w ćwiartce
  });

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${HT}" font-family="IBMPlexSans">`);
  parts.push(`<rect x="0" y="0" width="${W}" height="${HT}" fill="#FFFFFF"/>`);
  parts.push(`<text x="30" y="34" font-size="21" fill="#1F3864">${esc(clamp(g.title, 90))}</text>`);

  // ── krawędzie (pod węzłami) ──
  for (const e of g.edges) {
    const A = placed.get(e.a), B = placed.get(e.b);
    if (!A || !B) continue;
    const [x1, y1] = anchor(A, B.x + B.w / 2, B.y + NH / 2);
    const [x2, y2] = anchor(B, A.x + A.w / 2, A.y + NH / 2);
    parts.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#8A93A0" stroke-width="${e.thick ? 2.4 : 1.2}"${e.dashed ? ` stroke-dasharray="5 4"` : ""}/>`);
    if (e.label) {
      const lab = clamp(e.label, 34);
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, w = lab.length * 5.4 + 8;
      parts.push(`<rect x="${(mx - w / 2).toFixed(1)}" y="${(my - 8).toFixed(1)}" width="${w.toFixed(1)}" height="15" fill="#FFFFFF" opacity="0.9"/>`);
      parts.push(`<text x="${mx.toFixed(1)}" y="${(my + 3.5).toFixed(1)}" font-size="10.5" fill="#5B6470" text-anchor="middle">${esc(lab)}</text>`);
    }
  }

  // ── węzły ──
  for (const n of placed.values()) {
    const cx = n.x + n.w / 2;
    parts.push(`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${NH}" rx="5" ry="5" fill="${n.p.fill}" stroke="${n.p.stroke}" stroke-width="1.3"/>`);
    if (n.sub) {
      parts.push(`<text x="${cx}" y="${n.y + 17}" font-size="12.5" fill="${n.p.text}" text-anchor="middle">${esc(clamp(n.label, 30))}</text>`);
      parts.push(`<text x="${cx}" y="${n.y + 31}" font-size="9.5" fill="${n.p.text}" text-anchor="middle" opacity="0.85">${esc(clamp(n.sub, 42))}</text>`);
    } else {
      parts.push(`<text x="${cx}" y="${n.y + 25}" font-size="12.5" fill="${n.p.text}" text-anchor="middle">${esc(clamp(n.label, 30))}</text>`);
    }
  }

  // ── legenda ──
  const ly = 832;
  let lx = 30;
  const legend: [Palette, string][] = [
    [CENTER_P, clamp(g.center.label, 28)],
    ...g.clusters.slice(0, 8).map((cl, ci) => [CLUSTER_P[ci % CLUSTER_P.length], clamp(cl.name, 38)] as [Palette, string]),
  ];
  for (const [p, lab] of legend) {
    parts.push(`<rect x="${lx}" y="${ly - 10}" width="16" height="12" rx="2" fill="${p.fill}" stroke="${p.stroke}"/>`);
    parts.push(`<text x="${lx + 22}" y="${ly}" font-size="10.5" fill="#3A3A3A">${esc(lab)}</text>`);
    lx += 40 + lab.length * 6.0;
    if (lx > W - 260) break; // nie wychodź poza kadr
  }
  parts.push(`<text x="30" y="${ly + 22}" font-size="9.5" fill="#6B7280">${esc("linia ciągła — powiązanie bezpośrednie (funkcja / kapitał / obrót);  linia przerywana — powiązanie pośrednie / rachunek własny.  Źródła: rejestry, akta sprawy, źródła jawne.")}</text>`);

  parts.push(`</svg>`);
  return parts.join("");
}
