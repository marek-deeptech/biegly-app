// Graf powiązań kapitałowo-osobowych (wektor SVG) — układ RADIALNY, forma jak
// kuratorowany graf Milisystem: emitent w centrum, podmioty Grupy w pierścieniu,
// osoby (wspólne organy KRS) jako satelity przy swoich podmiotach. Krawędzie:
// obrót wzajemny podmiotów (ciągła), funkcja w organie (ciągła, z rolą), powiązanie
// pośrednie / rachunek własny (przerywana). Wszystko GROUNDED: roster Grupy, KRS,
// obrót wewnątrzgrupowy (UTP). Font "IBMPlexSans" (zarejestrowany w pdfmake → glify PL).

export type RGroup = "emit" | "ent" | "krs" | "person" | "related";
export type RNode = { id: string; label: string; sub?: string; group: RGroup };
export type REdge = { a: string; b: string; label?: string; dashed?: boolean; thick?: boolean };
export type RelGraph = { title: string; nodes: RNode[]; edges: REdge[] };

type Pal = { fill: string; stroke: string; text: string };
const PAL: Record<RGroup, Pal> = {
  emit: { fill: "#F9DCE0", stroke: "#C0405A", text: "#8B1E3F" },
  ent: { fill: "#DCE6F2", stroke: "#6E86A8", text: "#24405F" },
  krs: { fill: "#EDE7DA", stroke: "#B39A6E", text: "#5C4A24" },
  related: { fill: "#F5E6D0", stroke: "#C79A5B", text: "#7A5320" },
  person: { fill: "#DEEFE0", stroke: "#7FA982", text: "#2F5D33" },
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clamp = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

const W = 1720, H = 1200;
const CX = W / 2, CY = 578;

type Placed = RNode & { x: number; y: number; w: number; h: number; ang: number };

function box(n: Placed): string {
  const p = PAL[n.group];
  const parts = [`<rect x="${(n.x - n.w / 2).toFixed(1)}" y="${(n.y - n.h / 2).toFixed(1)}" width="${n.w}" height="${n.h}" rx="6" fill="${p.fill}" stroke="${p.stroke}" stroke-width="${n.group === "emit" ? 2 : 1.3}"/>`];
  if (n.sub) {
    parts.push(`<text x="${n.x}" y="${(n.y - 2).toFixed(1)}" font-size="${n.group === "emit" ? 15 : 12.5}" font-weight="${n.group === "emit" ? "bold" : "normal"}" fill="${p.text}" text-anchor="middle">${esc(clamp(n.label, 30))}</text>`);
    parts.push(`<text x="${n.x}" y="${(n.y + 12).toFixed(1)}" font-size="9.5" fill="${p.text}" text-anchor="middle" opacity="0.85">${esc(clamp(n.sub, 40))}</text>`);
  } else {
    parts.push(`<text x="${n.x}" y="${(n.y + 4).toFixed(1)}" font-size="12.5" fill="${p.text}" text-anchor="middle">${esc(clamp(n.label, 30))}</text>`);
  }
  return parts.join("");
}

// Punkt na brzegu prostokąta w kierunku (tx,ty).
function edgeAnchor(n: Placed, tx: number, ty: number): [number, number] {
  const dx = tx - n.x, dy = ty - n.y;
  if (!dx && !dy) return [n.x, n.y];
  const s = Math.min(dx ? n.w / 2 / Math.abs(dx) : Infinity, dy ? n.h / 2 / Math.abs(dy) : Infinity);
  return [n.x + dx * s, n.y + dy * s];
}

export function relationGraphSvg(g: RelGraph): string {
  const placed = new Map<string, Placed>();
  const emit = g.nodes.find((n) => n.group === "emit");
  const ents = g.nodes.filter((n) => n.group === "ent" || n.group === "krs" || n.group === "related");
  const persons = g.nodes.filter((n) => n.group === "person");

  placed.set(emit!.id, { ...emit!, x: CX, y: CY, w: 268, h: 52, ang: 0 });

  // Pierścień podmiotów: elipsa wokół centrum; promień naprzemienny → mniej kolizji sąsiadów.
  const N = Math.max(ents.length, 1);
  const entPos = new Map<string, [number, number]>();
  ents.forEach((n, i) => {
    const a = -Math.PI / 2 + (i / N) * 2 * Math.PI;
    const rx = 500 + (i % 2 ? 40 : -40), ry = 322 + (i % 2 ? -26 : 26);
    const x = CX + rx * Math.cos(a), y = CY + ry * Math.sin(a);
    entPos.set(n.id, [x, y]);
    placed.set(n.id, { ...n, x, y, w: 188, h: n.sub ? 44 : 36, ang: a });
  });

  // Osoby: beneficjent → tuż za SWOIM podmiotem (radialnie na zewnątrz), więc para
  // podmiot–osoba czyta się razem; pozostali (rachunek własny / KRS, powiązani z
  // emitentem) na zewnętrznym pierścieniu w równych odstępach.
  const entLinks = (id: string) => g.edges.map((e) => (e.a === id ? e.b : e.b === id ? e.a : null)).filter((x): x is string => !!x && entPos.has(x));
  const outerN = Math.max(persons.filter((p) => entLinks(p.id).length !== 1).length, 1);
  let outerI = 0;
  persons.forEach((n) => {
    const linked = entLinks(n.id);
    if (linked.length === 1) {
      const [ex, ey] = entPos.get(linked[0])!;
      const dx = ex - CX, dy = ey - CY, d = Math.hypot(dx, dy) || 1;
      placed.set(n.id, { ...n, x: ex + (dx / d) * 182, y: ey + (dy / d) * 104, w: 204, h: 40, ang: 0 });
    } else {
      // start od dołu (offset π), by nie kolidować z beneficjentem górnego podmiotu
      const a = Math.PI / 2 + (outerI++ / outerN) * 2 * Math.PI + 0.18;
      placed.set(n.id, { ...n, x: CX + 700 * Math.cos(a), y: CY + 458 * Math.sin(a), w: 204, h: 40, ang: a });
    }
  });

  // Clamp do kadru — żaden węzeł nie wychodzi poza obszar (brzegi/tytuł/legenda/stopka).
  for (const n of placed.values()) {
    n.x = Math.max(n.w / 2 + 18, Math.min(W - n.w / 2 - 18, n.x));
    n.y = Math.max(116, Math.min(H - 66, n.y));
  }

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="IBMPlexSans">`);
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#FFFFFF"/>`);
  parts.push(`<text x="40" y="42" font-size="23" font-weight="bold" fill="#1F3864">${esc(clamp(g.title, 88))}</text>`);

  // Krawędzie (pod węzłami)
  for (const e of g.edges) {
    const A = placed.get(e.a), B = placed.get(e.b);
    if (!A || !B) continue;
    const [x1, y1] = edgeAnchor(A, B.x, B.y);
    const [x2, y2] = edgeAnchor(B, A.x, A.y);
    parts.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#8A93A0" stroke-width="${e.thick ? 2.6 : 1.2}"${e.dashed ? ` stroke-dasharray="5 4"` : ""}/>`);
    if (e.label) {
      const lab = clamp(e.label, 30), mx = (x1 + x2) / 2, my = (y1 + y2) / 2, w = lab.length * 5.6 + 8;
      parts.push(`<rect x="${(mx - w / 2).toFixed(1)}" y="${(my - 8).toFixed(1)}" width="${w.toFixed(1)}" height="15" fill="#FFFFFF" opacity="0.92"/>`);
      parts.push(`<text x="${mx.toFixed(1)}" y="${(my + 3.5).toFixed(1)}" font-size="10" fill="#5B6470" text-anchor="middle">${esc(lab)}</text>`);
    }
  }
  // Węzły
  for (const n of placed.values()) parts.push(box(n));

  // Legenda
  const ly = H - 40;
  let lx = 40;
  const leg: [RGroup, string][] = [
    ["emit", clamp(emit!.label, 24)],
    ["ent", "Podmiot Grupy"],
    ...(g.nodes.some((n) => n.group === "krs") ? [["krs", "Podmiot rejestrowy (KRS)"] as [RGroup, string]] : []),
    ...(g.nodes.some((n) => n.group === "related") ? [["related", "Podmiot powiązany"] as [RGroup, string]] : []),
    ["person", "Osoba (organ / rachunek)"],
  ];
  for (const [gr, lab] of leg) {
    parts.push(`<rect x="${lx}" y="${ly - 11}" width="16" height="13" rx="2" fill="${PAL[gr].fill}" stroke="${PAL[gr].stroke}"/>`);
    parts.push(`<text x="${lx + 22}" y="${ly}" font-size="11" fill="#3A3A3A">${esc(lab)}</text>`);
    lx += 42 + lab.length * 6.2;
  }
  parts.push(`<text x="40" y="${ly + 20}" font-size="9.5" fill="#6B7280">${esc("linia ciągła — powiązanie bezpośrednie (funkcja w organie / obrót wewnątrzgrupowy);  linia przerywana — powiązanie pośrednie / rachunek.  Źródła: KRS, roster Grupy z akt, dane transakcyjne UTP.")}</text>`);
  parts.push(`</svg>`);
  return parts.join("");
}

// ── Budowa grafu z danych ugruntowanych ─────────────────────────────────────
const jur = (s: string) =>
  /(cypr|cyprus|\(cy\))/i.test(s) ? "Cypr" : /(singapur|\(sg\)|pte)/i.test(s) ? "Singapur"
  : /(bułgar|bulgar|\(bg\)|eood)/i.test(s) ? "Bułgaria" : /(marshall)/i.test(s) ? "Wyspy Marshalla"
  : /(nevis)/i.test(s) ? "Nevis" : /(\(ch\)|szwaj)/i.test(s) ? "Szwajcaria" : "Polska";
const shortName = (s: string) => s.replace(/\s*\(.*?\)\s*/g, "").replace(/\s+/g, " ").trim();
const mlnZl = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1).replace(".", ",")} mln zł` : v >= 1e3 ? `${Math.round(v / 1e3)} tys. zł` : `${Math.round(v)} zł`);

export type RelInput = {
  caseName: string;
  signature: string | null;
  emitterLabel: string;
  entities: { name: string; kind: string; fragment?: string }[]; // roster (podmioty + osoby)
  pairs: { a: string; b: string; value: number }[]; // pair_intra (klucze = fragmenty)
  krs?: { name: string; role: string; entity: string }[]; // krs_boards.persons (uzupełnienie)
  maxTradeEdges?: number;
};

// Parsuje wpis osoby z rostera „Nazwisko Imię (Kontekst)" → { name, ctx }.
function parsePerson(raw: string): { name: string; ctx: string } {
  const m = raw.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  return m ? { name: m[1].trim(), ctx: m[2].trim() } : { name: raw.trim(), ctx: "" };
}

export function buildRelationGraph(inp: RelInput): { graph: RelGraph; stats: { entities: number; persons: number; edges: number } } {
  const nodes: RNode[] = [];
  const edges: REdge[] = [];
  const EMIT = "__emit";
  nodes.push({ id: EMIT, label: inp.emitterLabel, sub: "emitent", group: "emit" });

  const po = inp.entities.filter((e) => e.kind !== "osoba");
  const os = inp.entities.filter((e) => e.kind === "osoba");
  const fragToName = new Map<string, string>();
  for (const e of po) if (e.fragment) fragToName.set(e.fragment.toLowerCase(), e.name);
  const fragKind = new Map<string, "podmiot" | "osoba">();
  for (const e of inp.entities) if (e.fragment) fragKind.set(e.fragment.toLowerCase(), e.kind === "osoba" ? "osoba" : "podmiot");
  // Fragment osoby (np. „boszko joanna") → kanoniczna nazwa z rostera („Joanna Boszko"),
  // żeby ten sam trader nie powstał dwa razy (z rostera OS i z klucza obrotu).
  const fragToPerson = new Map<string, string>();
  for (const e of os) if (e.fragment) fragToPerson.set(e.fragment.toLowerCase(), parsePerson(e.name).name);

  const entId = (frag: string) => `e:${frag}`;
  const haveEnt = new Set<string>();
  const addEnt = (frag: string) => {
    if (haveEnt.has(frag)) return;
    haveEnt.add(frag);
    const nm = fragToName.get(frag) ?? frag;
    nodes.push({ id: entId(frag), label: shortName(nm), sub: jur(nm), group: "ent" });
  };
  // Wszystkie podmioty Grupy jako węzły (kręgosłup grafu).
  for (const e of po) addEnt((e.fragment ?? e.name).toLowerCase());

  // Osoby z rostera: beneficjent/reprezentant → krawędź do podmiotu z nawiasu; „rach. własny" → do emitenta.
  const persId = (name: string) => `p:${name}`;
  const havePers = new Set<string>();
  const addPers = (name: string, sub: string) => {
    if (havePers.has(name)) return;
    havePers.add(name);
    nodes.push({ id: persId(name), label: name, sub, group: "person" });
  };
  const matchFrag = (ctx: string): string | undefined => {
    const low = ctx.toLowerCase();
    return [...fragToName.keys()].find((f) => low.includes(f) || (fragToName.get(f) ?? "").toLowerCase().includes(f) && low.includes(f)) ||
      [...fragToName.entries()].find(([, nm]) => low.includes(shortName(nm).toLowerCase().split(" ")[0]))?.[0];
  };
  for (const e of os) {
    const { name, ctx } = parsePerson(e.name);
    if (/rach/i.test(ctx) || /własn/i.test(ctx)) {
      addPers(name, "rachunek własny");
      edges.push({ a: persId(name), b: EMIT, dashed: true, label: "rach. własny" });
    } else {
      const frag = matchFrag(ctx);
      addPers(name, ctx ? `powiązana z: ${shortName(fragToName.get(frag ?? "") ?? ctx)}` : "osoba powiązana");
      if (frag) edges.push({ a: persId(name), b: entId(frag), dashed: true });
    }
  }

  // Obrót wewnątrzgrupowy → krawędzie (najsilniejsze); fragment klasyfikowany wg rodzaju rostera.
  // Osoby-traderzy „rachunek własny" ograniczone do najaktywniejszych (czytelność) —
  // beneficjenci podmiotów (1 na wydmuszkę) zawsze zostają.
  const ownAcctTurnover = new Map<string, number>();
  for (const p of inp.pairs) for (const f of [p.a, p.b]) if (fragKind.get(f) === "osoba") ownAcctTurnover.set(f, (ownAcctTurnover.get(f) ?? 0) + (p.value || 0));
  const keepOwnAcct = new Set([...ownAcctTurnover.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([f]) => f));
  const nodeForFrag = (frag: string): string | null => {
    if (fragKind.get(frag) === "osoba") {
      if (!keepOwnAcct.has(frag)) return null; // pomiń drobnych traderów
      const nm = fragToPerson.get(frag) ?? shortName(frag);
      if (!havePers.has(nm)) { addPers(nm, "rachunek własny"); edges.push({ a: persId(nm), b: EMIT, dashed: true, label: "rach. własny" }); }
      return persId(nm);
    }
    if (fragToName.has(frag)) { addEnt(frag); return entId(frag); }
    return null;
  };
  const pairs = [...inp.pairs].filter((p) => p.value > 0).sort((a, b) => b.value - a.value).slice(0, inp.maxTradeEdges ?? 16);
  const turnover = new Map<string, number>();
  for (const p of pairs) {
    const A = nodeForFrag(p.a), B = nodeForFrag(p.b);
    if (!A || !B || A === B) continue;
    // Podpis kwotą tylko dla znaczących obrotów (≥0,5 mln) — drobne zostają samą linią.
    edges.push({ a: A, b: B, label: p.value >= 5e5 ? `obrót ${mlnZl(p.value)}` : undefined, thick: p.value >= 3e6 });
    if (fragToName.has(p.a)) turnover.set(p.a, (turnover.get(p.a) ?? 0) + p.value);
    if (fragToName.has(p.b)) turnover.set(p.b, (turnover.get(p.b) ?? 0) + p.value);
  }
  const hub = [...turnover.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (hub) edges.push({ a: EMIT, b: entId(hub), label: "obrót — węzeł", thick: true });

  // KRS (uzupełnienie): osoby zasiadające w organach ≥2 podmiotów, których jeszcze nie ma z rostera.
  if (inp.krs?.length) {
    const byP = new Map<string, Set<string>>();
    for (const r of inp.krs) if (r.name) (byP.get(r.name) ?? byP.set(r.name, new Set()).get(r.name)!).add(r.entity);
    for (const [name, ents] of [...byP.entries()].filter(([, s]) => s.size >= 3).sort((a, b) => b[1].size - a[1].size).slice(0, 4)) {
      if (havePers.has(name)) continue;
      addPers(name, `organ ${ents.size} podmiotów (KRS)`);
      edges.push({ a: persId(name), b: EMIT, dashed: true });
    }
  }

  return {
    graph: { title: `Graf powiązań kapitałowo-osobowych — ${inp.caseName} (${inp.signature ?? ""})`, nodes, edges },
    stats: { entities: haveEnt.size, persons: havePers.size, edges: edges.length },
  };
}
