// IV.4 (wash trades) i IV.6 (layering / spoofing) — tabele wzorca.
//
// WZORZEC (finał HubTech): IV.4 — miary obrotu wewnątrzgrupowego; IV.6 — tabele
// nr 38–40, tj. RELACJA WOLUMENU ANULOWANYCH ZLECEŃ DO ZŁOŻONYCH osobno dla
// każdego podmiotu, oraz sekwencje zleceń w sesjach oznaczonych jako manipulacyjne.
//
// ⚠️ ATRYBUCJA PER PODMIOT JEST SEDNEM, NIE OZDOBĄ. Zbiorczy wskaźnik „Grupa
// anulowała 74% zleceń kupna" nie odpowiada na pytanie organu, KTO to robił —
// a pytanie 1 postanowienia wymienia osoby z imienia i nazwiska. Dane zleceń
// niosą pole `entity`, więc rozbicie jest możliwe i musi się w opinii znaleźć.

export type ZlecenieSpoof = {
  entity: string;
  side: string;
  vol: number;
  cancelled: number;
  realised: number;
  entry?: string;
  cancel?: string | null;
  limit?: number | null;
  cls?: string;
  mod?: boolean;
};

export type DzienSpoof = {
  day: string;
  manip: boolean;
  declared_buy: number;
  cancelled_buy: number;
  cancel_ratio: number;
  layer_orders: number;
  price_levels: number;
  sell_exec_vol: number;
  entities: string[];
  orders: ZlecenieSpoof[];
};

export type Tabela = { caption: string; head: string[]; rows: string[][] };

const pl = (v: number, frac = 0) => v.toLocaleString("pl-PL", { maximumFractionDigits: frac });
const proc = (v: number | null | undefined, frac = 2) => (v == null ? "—" : `${pl(v, frac)} %`);

/**
 * IV.6 — relacja wolumenu anulowanego do zleconego PER PODMIOT (wzorzec: tabele 38–40).
 *
 * Liczone WYŁĄCZNIE ze zleceń kupna: technika polega na wystawianiu popytu, który
 * nie ma dojść do skutku. Wciągnięcie zleceń sprzedaży zaniżyłoby wskaźnik i zatarło
 * różnicę między podmiotem wystawiającym warstwy a podmiotem, który sprzedaje.
 */
export function tabelaAnulacjiPodmiotow(dni: DzienSpoof[], tylkoManip = false): Tabela | null {
  const agg = new Map<string, { zlecone: number; anulowane: number; zrealizowane: number; sesje: Set<string>; warstwy: number }>();
  for (const d of dni) {
    if (tylkoManip && !d.manip) continue;
    for (const o of d.orders ?? []) {
      if ((o.side ?? "").toUpperCase() !== "K") continue;
      const a = agg.get(o.entity) ?? { zlecone: 0, anulowane: 0, zrealizowane: 0, sesje: new Set<string>(), warstwy: 0 };
      a.zlecone += o.vol ?? 0;
      a.anulowane += o.cancelled ?? 0;
      a.zrealizowane += o.realised ?? 0;
      if (o.cls === "layer") a.warstwy += 1;
      a.sesje.add(d.day);
      agg.set(o.entity, a);
    }
  }
  if (!agg.size) return null;
  const rows = [...agg.entries()]
    .sort((a, b) => b[1].anulowane - a[1].anulowane)
    .map(([p, a]) => [
      p,
      String(a.sesje.size),
      pl(a.zlecone),
      pl(a.anulowane),
      a.zlecone ? proc((100 * a.anulowane) / a.zlecone) : "—",
      pl(a.zrealizowane),
      String(a.warstwy),
    ]);
  return {
    caption:
      "Tabela. Relacja wolumenu anulowanych zleceń KUPNA do wolumenu zleceń złożonych — " +
      `w podziale na podmioty${tylkoManip ? " (sesje oznaczone jako manipulacyjne)" : ""}`,
    head: [
      "Podmiot", "Sesji", "Wolumen zlecony (szt)", "Wolumen anulowany (szt)", "Udział anulacji",
      "Wolumen zrealizowany (szt)", "Zleceń warstwowych",
    ],
    rows,
  };
}

/** IV.6 — przegląd sesji z anulacjami: skala zjawiska sesja po sesji. */
export function tabelaSesjiLayering(dni: DzienSpoof[], tylkoManip = false): Tabela | null {
  const wybrane = dni.filter((d) => (tylkoManip ? d.manip : (d.cancelled_buy ?? 0) > 0));
  if (!wybrane.length) return null;
  return {
    caption:
      `Tabela. Sesje z anulowanymi zleceniami kupna podmiotów z Grupy${tylkoManip ? " — oznaczone jako manipulacyjne" : ""}: ` +
      "wolumen zlecony i anulowany, liczba zleceń warstwowych oraz sprzedaż zrealizowana w tym samym dniu",
    head: [
      "Sesja", "Wolumen zlecony (kupno)", "Wolumen anulowany", "Udział anulacji", "Zleceń warstwowych",
      "Poziomów cenowych", "Sprzedaż zrealizowana (szt)", "Podmioty",
    ],
    rows: wybrane
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((d) => [
        d.day,
        pl(d.declared_buy ?? 0),
        pl(d.cancelled_buy ?? 0),
        proc(100 * (d.cancel_ratio ?? 0)),
        String(d.layer_orders ?? 0),
        String(d.price_levels ?? 0),
        pl(d.sell_exec_vol ?? 0),
        (d.entities ?? []).join(", "),
      ]),
  };
}

/**
 * IV.6 — sekwencja zleceń jednej sesji manipulacyjnej.
 *
 * To jest materiał, na którym widać MECHANIZM (pytanie 2 postanowienia): wystawienie
 * warstw popytu, ich anulowanie i sprzedaż w tym samym czasie. Kolejność chronologiczna
 * po czasie złożenia — bez niej sekwencja przestaje być sekwencją.
 */
export function tabelaSekwencji(d: DzienSpoof, maks = 40): Tabela | null {
  const ord = [...(d.orders ?? [])].sort((a, b) => (a.entry ?? "").localeCompare(b.entry ?? ""));
  if (!ord.length) return null;
  const rows = ord.slice(0, maks).map((o) => [
    o.entry ?? "—",
    o.entity,
    (o.side ?? "").toUpperCase() === "K" ? "kupno" : "sprzedaż",
    o.limit != null ? pl(o.limit, 4) : "—",
    pl(o.vol ?? 0),
    pl(o.cancelled ?? 0),
    pl(o.realised ?? 0),
    o.cancel ?? "—",
    o.cls === "layer" ? "warstwa" : (o.mod ? "modyfikowane" : ""),
  ]);
  return {
    caption:
      `Tabela. Sekwencja zleceń w sesji ${d.day} — podmioty z Grupy (udział anulacji ` +
      `${proc(100 * (d.cancel_ratio ?? 0))}, ${d.layer_orders ?? 0} zleceń warstwowych na ${d.price_levels ?? 0} poziomach cenowych)` +
      (ord.length > maks ? `; pokazano ${maks} z ${ord.length} zleceń` : ""),
    head: ["Godz. złożenia", "Podmiot", "Strona", "Limit", "Wolumen", "Anulowano", "Zrealizowano", "Godz. anulowania", "Uwagi"],
    rows,
  };
}

// ── IV.4 — wash trades ─────────────────────────────────────────────────────

export type Metryka = { key: string; value: number | null; session_day?: string | null };

/** IV.4 — pary podmiotów handlujących ze sobą wewnątrz Grupy (metryki `pair_intra`). */
export function tabelaParWewnatrzgrupowych(metryki: Metryka[]): Tabela | null {
  const pary = metryki
    .filter((m) => m.key.startsWith("pair_intra::") && m.value != null)
    .map((m) => {
      const [a, b] = m.key.slice("pair_intra::".length).split("|");
      return { a, b, wartosc: m.value as number };
    })
    .sort((x, y) => y.wartosc - x.wartosc);
  if (!pary.length) return null;
  const suma = pary.reduce((s, p) => s + p.wartosc, 0);
  return {
    caption:
      "Tabela. Pary podmiotów z Grupy występujące po obu stronach tej samej transakcji — " +
      "wartość obrotu wewnątrzgrupowego",
    head: ["Podmiot A", "Podmiot B", "Wartość obrotu (zł)", "Udział w obrocie wewnątrzgrupowym"],
    rows: pary.map((p) => [p.a, p.b, pl(p.wartosc, 2), suma ? proc((100 * p.wartosc) / suma) : "—"]),
  };
}

/** IV.4 — sesje o najwyższym udziale obrotu wewnątrzgrupowego w wolumenie sesji. */
export function tabelaSesjiWash(metryki: Metryka[], prog = 20): Tabela | null {
  const wash = new Map<string, number>();
  for (const m of metryki) {
    if (!m.key.startsWith("wash_") || m.value == null) continue;
    const d = m.key.slice("wash_".length);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) wash.set(d, m.value);
  }
  const idx = new Map<string, Map<string, number>>();
  for (const m of metryki) {
    if (!m.session_day || m.value == null) continue;
    if (!idx.has(m.key)) idx.set(m.key, new Map());
    idx.get(m.key)!.set(m.session_day, m.value);
  }
  const wybrane = [...wash.entries()].filter(([, v]) => v >= prog).sort((a, b) => a[0].localeCompare(b[0]));
  if (!wybrane.length) return null;
  return {
    caption:
      `Tabela. Sesje, w których obrót wewnątrzgrupowy stanowił co najmniej ${prog} % wolumenu sesji ` +
      "(transakcje, w których obie strony należą do Grupy)",
    head: ["Sesja", "Udział obrotu wewnątrzgrupowego", "Wolumen sesji", "Wolumen wewnątrzgrupowy", "Kurs zamknięcia", "Zmiana kursu"],
    rows: wybrane.map(([d, v]) => {
      const g = (k: string) => idx.get(k)?.get(d) ?? null;
      const zm = g("day_change_pct");
      return [
        d,
        proc(v),
        g("day_sess_vol") != null ? pl(g("day_sess_vol")!) : "—",
        g("day_intra_vol") != null ? pl(g("day_intra_vol")!) : "—",
        g("day_close") != null ? pl(g("day_close")!, 4) : "—",
        zm != null ? `${zm > 0 ? "+" : ""}${proc(zm)}` : "—",
      ];
    }),
  };
}

// ── Fixing (zał. I lit. g MAR) i koncentracja zleceń (lit. e) ───────────────
//
// ⚠️ TE DWIE TECHNIKI TEŻ LICZĄ SIĘ PER INSTRUMENT. Udział w wolumenie fixingu
// i szczyt koncentracji odnoszą się do obrotu KONKRETNYM walorem; policzone na
// zestawie łącznym mieszałyby dwa arkusze zleceń w jeden.

/** Sesje, w których Grupa objęła istotną część wolumenu fixingu zamknięcia lub otwarcia. */
export function tabelaFixingu(metryki: Metryka[], prog = 50): Tabela | null {
  const idx = new Map<string, Map<string, number>>();
  for (const m of metryki) {
    if (!m.session_day || m.value == null) continue;
    if (!idx.has(m.key)) idx.set(m.key, new Map());
    idx.get(m.key)!.set(m.session_day, m.value);
  }
  const g = (k: string, d: string) => idx.get(k)?.get(d) ?? null;
  const dni = [...new Set(metryki.map((m) => m.session_day).filter((d): d is string => !!d))].sort();
  const wiersze = dni
    .filter((d) => Math.max(g("fix_close_share", d) ?? 0, g("fix_open_share", d) ?? 0) >= prog)
    .map((d) => [
      d,
      proc(g("fix_close_share", d)),
      proc(g("fix_open_share", d)),
      g("fix_close_vol", d) != null ? pl(g("fix_close_vol", d)!) : "—",
      g("day_close", d) != null ? pl(g("day_close", d)!, 4) : "—",
      g("day_change_pct", d) != null ? `${g("day_change_pct", d)! > 0 ? "+" : ""}${proc(g("day_change_pct", d))}` : "—",
    ]);
  if (!wiersze.length) return null;
  return {
    caption:
      `Tabela. Sesje, w których podmioty z Grupy objęły co najmniej ${prog} % wolumenu fixingu ` +
      "(ustalanie kursu otwarcia lub zamknięcia — zał. I lit. g rozporządzenia MAR)",
    head: ["Sesja", "Udział w fixingu zamknięcia", "Udział w fixingu otwarcia", "Wolumen fixingu zamk.", "Kurs zamknięcia", "Zmiana kursu"],
    rows: wiersze,
  };
}

/** Sesje o wysokiej koncentracji zleceń Grupy w oknie 15-minutowym. */
export function tabelaKoncentracji(metryki: Metryka[], prog = 50): Tabela | null {
  const idx = new Map<string, Map<string, number>>();
  for (const m of metryki) {
    if (!m.session_day || m.value == null) continue;
    if (!idx.has(m.key)) idx.set(m.key, new Map());
    idx.get(m.key)!.set(m.session_day, m.value);
  }
  const g = (k: string, d: string) => idx.get(k)?.get(d) ?? null;
  const dni = [...new Set(metryki.map((m) => m.session_day).filter((d): d is string => !!d))].sort();
  const wiersze = dni
    .filter((d) => (g("conc_peak_share", d) ?? 0) >= prog)
    .map((d) => {
      const volS = g("day_sess_vol", d);
      const volG = g("day_grp_vol", d);
      return [
        d,
        proc(g("conc_peak_share", d)),
        volS != null ? pl(volS) : "—",
        volG != null ? pl(volG) : "—",
        volS && volG != null ? proc((100 * volG) / volS) : "—",
        g("day_change_pct", d) != null ? `${g("day_change_pct", d)! > 0 ? "+" : ""}${proc(g("day_change_pct", d))}` : "—",
      ];
    });
  if (!wiersze.length) return null;
  return {
    caption:
      `Tabela. Sesje, w których zlecenia Grupy skupiły się w oknie 15 minut na poziomie co najmniej ${prog} % ` +
      "wolumenu sesji (zał. I lit. e rozporządzenia MAR)",
    head: ["Sesja", "Szczyt koncentracji (15 min)", "Wolumen sesji", "Wolumen Grupy", "Udział Grupy", "Zmiana kursu"],
    rows: wiersze,
  };
}
