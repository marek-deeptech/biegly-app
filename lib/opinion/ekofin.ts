// KROK 4 DZIEDZINY GPW — analiza ekonomiczno-finansowa emitenta i otoczenia rynkowego.
//
// WZORZEC: rozdział IV.1 finalnej opinii HubTech (OPINIA Hub.Tech FINAL KM.pdf):
// (a) historia notowań od debiutu + KONTRAST okresu badanego (średni dzienny wolumen
//     i wartość obrotu liczona po kursach zamknięcia — 624 000 szt. wobec 9 409 400 szt.),
// (b) tło branżowe indeksowane do 100 na wspólną datę bazową (mediana branży),
// (c) dynamika pozycji sprawozdawczych kw/kw i r/r,
// (d) wskaźniki wartości rynkowej WYKAZANE przez portale (stooq/StockWatch/BiznesRadar)
//     — przepisywane ze źródła, nie liczone, bo do policzenia C/Z czy EV/P trzeba liczby
//     akcji i długu, których w aktach zwykle nie ma; status „wykazane" musi być widoczny.
//
// ⚠️ SEPARACJA DZIEDZIN: ten moduł należy WYŁĄCZNIE do pakietu manipulacyjnego (GPW).
// Bankowa „analiza_ekonomiczna" (rubryka 16 wskaźników) to inny byt o innej metodyce —
// wspólny kod tworzyłby sprzężenie, przed którym chroni cases.typ.
//
// LLM NIE LICZY: wszystkie liczby (średnie, indeksy, dynamiki) powstają tutaj,
// deterministycznie; model dostaje gotowe tabele do opisania.

export type NotowanieDzienne = {
  dzien: string; // YYYY-MM-DD
  otwarcie: number | null;
  najwyzszy: number | null;
  najnizszy: number | null;
  zamkniecie: number;
  wolumen: number | null;
};

const NAGLOWKI: Record<string, keyof NotowanieDzienne> = {
  data: "dzien", date: "dzien",
  otwarcie: "otwarcie", open: "otwarcie",
  najwyzszy: "najwyzszy", high: "najwyzszy",
  najnizszy: "najnizszy", low: "najnizszy",
  zamkniecie: "zamkniecie", close: "zamkniecie",
  wolumen: "wolumen", volume: "wolumen",
};

/** Liczba z zapisu CSV stooq — kropka dziesiętna; pusta/„-" → null. */
function liczba(s: string): number | null {
  const t = s.trim();
  if (!t || t === "-") return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/**
 * Parser dziennego CSV ze stooq (https://stooq.pl/q/d/l/?s=<ticker>&i=d).
 *
 * Nagłówek bywa polski („Data,Otwarcie,…") albo angielski („Date,Open,…") —
 * zależnie od wersji językowej serwisu; oba mapujemy na jeden kształt.
 * Wiersz bez daty albo bez kursu zamknięcia jest odrzucany Z UWAGĄ, nie po cichu:
 * dziura w serii zmienia średnie, więc biegły musi o niej wiedzieć.
 */
export function parsujStooqCsv(csv: string): { notowania: NotowanieDzienne[]; uwagi: string[] } {
  const uwagi: string[] = [];
  const linie = csv.split(/\r?\n/).filter((l) => l.trim());
  if (linie.length < 2) return { notowania: [], uwagi: ["plik notowań jest pusty"] };
  const kol = linie[0].split(",").map((h) => NAGLOWKI[h.trim().toLowerCase()]);
  if (!kol.includes("dzien") || !kol.includes("zamkniecie"))
    return { notowania: [], uwagi: [`nierozpoznany nagłówek notowań: „${linie[0].slice(0, 60)}”`] };

  const out: NotowanieDzienne[] = [];
  let odrzucone = 0;
  for (const l of linie.slice(1)) {
    const c = l.split(",");
    const w: Partial<NotowanieDzienne> = {};
    kol.forEach((k, i) => {
      if (!k) return;
      if (k === "dzien") w.dzien = (c[i] ?? "").trim();
      else (w as Record<string, number | null>)[k] = liczba(c[i] ?? "");
    });
    if (!w.dzien || !/^\d{4}-\d{2}-\d{2}$/.test(w.dzien) || w.zamkniecie == null) {
      odrzucone++;
      continue;
    }
    out.push({
      dzien: w.dzien,
      otwarcie: w.otwarcie ?? null,
      najwyzszy: w.najwyzszy ?? null,
      najnizszy: w.najnizszy ?? null,
      zamkniecie: w.zamkniecie,
      wolumen: w.wolumen ?? null,
    });
  }
  if (odrzucone) uwagi.push(`${odrzucone} wierszy notowań odrzucono (brak daty albo kursu zamknięcia)`);
  out.sort((a, b) => a.dzien.localeCompare(b.dzien));
  return { notowania: out, uwagi };
}

export type OkresObrotu = {
  od: string;
  do: string;
  dniSesyjnych: number;
  sredniWolumen: number | null;
  /** Średnia dzienna wartość obrotu licząc WG CEN ZAMKNIĘCIA — metodyka wzorca KM. */
  sredniaWartoscObrotu: number | null;
};

function srednie(n: NotowanieDzienne[]): Pick<OkresObrotu, "sredniWolumen" | "sredniaWartoscObrotu"> {
  const zWol = n.filter((x) => x.wolumen != null);
  if (!zWol.length) return { sredniWolumen: null, sredniaWartoscObrotu: null };
  const sw = zWol.reduce((a, x) => a + (x.wolumen as number), 0) / zWol.length;
  const swo = zWol.reduce((a, x) => a + (x.wolumen as number) * x.zamkniecie, 0) / zWol.length;
  return { sredniWolumen: sw, sredniaWartoscObrotu: swo };
}

/**
 * Kontrast obrotu: okres historyczny (od debiutu do dnia przed badanym) wobec
 * okresu badanego. To pierwsze ustalenie rozdziału we wzorcu KM — krotność
 * wolumenu jest miarą anomalii, którą dalej tłumaczą (albo nie) fundamenty.
 */
export function kontrastObrotu(
  notowania: NotowanieDzienne[],
  odBadany: string,
  doBadany: string,
): { przed: OkresObrotu; badany: OkresObrotu; krotnoscWolumenu: number | null } | null {
  if (!notowania.length) return null;
  const przedN = notowania.filter((x) => x.dzien < odBadany);
  const badanyN = notowania.filter((x) => x.dzien >= odBadany && x.dzien <= doBadany);
  if (!badanyN.length) return null;
  const przed: OkresObrotu = {
    od: przedN[0]?.dzien ?? odBadany,
    do: przedN[przedN.length - 1]?.dzien ?? odBadany,
    dniSesyjnych: przedN.length,
    ...srednie(przedN),
  };
  const badany: OkresObrotu = {
    od: badanyN[0].dzien,
    do: badanyN[badanyN.length - 1].dzien,
    dniSesyjnych: badanyN.length,
    ...srednie(badanyN),
  };
  const krotnoscWolumenu =
    przed.sredniWolumen && badany.sredniWolumen ? badany.sredniWolumen / przed.sredniWolumen : null;
  return { przed, badany, krotnoscWolumenu };
}

export type SeriaIndeksu = { ticker: string; nazwa?: string; notowania: NotowanieDzienne[] };

/**
 * Indeksowanie do 100 na wspólną datę bazową (wzorzec: „1.01.2020 = 100").
 *
 * Oś dni pochodzi z EMITENTA. Spółka porównawcza w dzień bez własnego notowania
 * dostaje OSTATNI znany kurs (LOCF) — to standard indeksów porównawczych, ale jest
 * przybliżeniem, więc wchodzi do uwag. Mediana branży liczona per dzień z dostępnych
 * spółek; dzień bazowy = pierwsza sesja emitenta ≥ zadanej daty bazowej.
 */
export function indeks100(
  emitent: SeriaIndeksu,
  peers: SeriaIndeksu[],
  bazaOd: string,
  maksPunktow = 420,
): {
  dni: string[];
  emitent: number[];
  medianaPeers: (number | null)[];
  perPeer: { ticker: string; wartosci: (number | null)[] }[];
  bazaDzien: string;
  uwagi: string[];
} | null {
  const uwagi: string[] = [];
  const em = emitent.notowania.filter((x) => x.dzien >= bazaOd);
  if (em.length < 2) return null;
  const bazaDzien = em[0].dzien;

  // Downsampling do renderowalnej liczby punktów — z zachowaniem pierwszego
  // i ostatniego dnia; przy 1500+ sesjach SVG i DOCX stają się nieczytelne.
  let dniAll = em.map((x) => x.dzien);
  if (dniAll.length > maksPunktow) {
    const krok = Math.ceil(dniAll.length / maksPunktow);
    dniAll = dniAll.filter((_, i) => i % krok === 0 || i === em.length - 1);
    uwagi.push(`serię indeksu spróbkowano co ${krok}. sesję (${em.length} → ${dniAll.length} punktów)`);
  }
  const emWg = new Map(em.map((x) => [x.dzien, x.zamkniecie]));
  const bazaEm = emWg.get(bazaDzien)!;
  const emIdx = dniAll.map((d) => (100 * (emWg.get(d) as number)) / bazaEm);

  const perPeer = peers.map((p) => {
    const not = p.notowania.filter((x) => x.dzien >= bazaOd);
    if (!not.length) {
      uwagi.push(`${p.ticker}: brak notowań od ${bazaOd} — spółka pominięta w indeksie`);
      return { ticker: p.ticker, wartosci: dniAll.map(() => null as number | null) };
    }
    const baza = not[0].zamkniecie;
    let j = 0;
    let ostatni: number | null = null;
    const wartosci = dniAll.map((d) => {
      while (j < not.length && not[j].dzien <= d) {
        ostatni = not[j].zamkniecie;
        j++;
      }
      return ostatni == null ? null : (100 * ostatni) / baza;
    });
    return { ticker: p.ticker, wartosci };
  });
  if (peers.length) uwagi.push("kursy spółek porównawczych w dni bez ich notowań: ostatni znany kurs (LOCF)");

  const medianaPeers = dniAll.map((_, i) => {
    const v = perPeer.map((p) => p.wartosci[i]).filter((x): x is number => x != null).sort((a, b) => a - b);
    if (!v.length) return null;
    const s = v.length >> 1;
    return v.length % 2 ? v[s] : (v[s - 1] + v[s]) / 2;
  });

  return { dni: dniAll, emitent: emIdx, medianaPeers, perPeer, bazaDzien, uwagi };
}

// ── dynamika pozycji sprawozdawczych (wejście: items z subanalizy fin_stats) ──

export type PozycjaFin = {
  position: string;
  period: string;
  value: string;
  unit: string;
  /**
   * Emitent, którego dotyczy pozycja.
   *
   * ⚠️ PRZY WIELU INSTRUMENTACH JEST OBOWIĄZKOWY. Sprawa ZASTAL dotyczy CSY S.A.
   * i RSY S.A. — grupowanie po samej nazwie pozycji zlewałoby „przychody netto"
   * obu spółek w jeden szereg i liczyło dynamikę między CUDZYMI liczbami.
   * Pozycje bez emitenta trafiają do wspólnego kubła „—" i nie mieszają się
   * z żadną spółką nazwaną.
   */
  issuer?: string;
};

/** „1 234,56" / „(123)" / „−45,3" → liczba; nawias księgowy = minus. */
export function liczbaPl(s: string): number | null {
  let t = String(s).replace(/[\s  ]/g, "").replace("−", "-");
  const nawias = /^\(.*\)$/.test(t);
  if (nawias) t = t.slice(1, -1);
  t = t.replace(/\./g, "").replace(",", ".");
  const v = Number(t);
  if (!Number.isFinite(v)) return null;
  return nawias ? -v : v;
}

const KW: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4 };

/**
 * Klucz sortowania okresu: kwartał > półrocze > rok > dzień bilansowy.
 *
 * ⚠️ DATY BILANSOWE („31-12-2017", „2017-09-30") TEŻ SĄ OKRESEM. Sprawozdania
 * podają część wielkości pod datą dzienną, a nie nazwą kwartału — pomijanie ich
 * odcinało w sprawie ZASTAL większość szeregu. Dzień dostaje własny `rodzaj`,
 * więc porównuje się wyłącznie z innym dniem: zestawienie stanu na 30.09 z
 * wielkością „III kw." (strumień za kwartał) mieszałoby zapas ze strumieniem.
 * Porównanie r/r trafia w ten sam dzień i miesiąc rok wcześniej.
 */
export function kluczOkresu(
  period: string,
): { rok: number; pod: number; rodzaj: "kw" | "pol" | "rok" | "dzien" } | null {
  const p = period.toLowerCase().replace(/\s+/g, " ").trim();
  let m = p.match(/^(i{1,3}|iv)\s*kw\w*\.?\s*(\d{4})/);
  if (m) return { rok: Number(m[2]), pod: KW[m[1]], rodzaj: "kw" };
  m = p.match(/^(i{1,2})\s*p[óo][łl]rocze\s*(\d{4})/);
  if (m) return { rok: Number(m[2]), pod: m[1] === "i" ? 1 : 2, rodzaj: "pol" };
  m = p.match(/^(\d{4})$/);
  if (m) return { rok: Number(m[1]), pod: 0, rodzaj: "rok" };
  // dzień bilansowy: DD-MM-RRRR / DD.MM.RRRR albo RRRR-MM-DD
  m = p.match(/^(\d{1,2})[-.](\d{1,2})[-.](\d{4})$/);
  if (m) return { rok: Number(m[3]), pod: Number(m[2]) * 100 + Number(m[1]), rodzaj: "dzien" };
  m = p.match(/^(\d{4})[-.](\d{1,2})[-.](\d{1,2})$/);
  if (m) return { rok: Number(m[1]), pod: Number(m[2]) * 100 + Number(m[3]), rodzaj: "dzien" };
  return null;
}

/**
 * Tabela dynamiki pozycji RZiS/bilansu — kw/kw (okres poprzedni tego samego rodzaju)
 * i r/r (ten sam podokres rok wcześniej). Wzorzec: Tabela nr 5 finału KM
 * („Analiza dynamiczna wybranych pozycji rachunku zysku i strat").
 *
 * Wartości NIE są przeliczane między jednostkami: pozycja z niejednolitą jednostką
 * w różnych okresach dostaje uwagę i NIE ma liczonej dynamiki — procent z pomieszanych
 * jednostek wyglądałby wiarygodnie i był fałszywy.
 */
export function dynamikaFin(items: PozycjaFin[]): {
  table: { caption: string; head: string[]; rows: string[][] } | null;
  uwagi: string[];
} {
  const uwagi: string[] = [];
  // Klucz grupowania: EMITENT + pozycja (patrz komentarz przy PozycjaFin.issuer).
  const wgPozycji = new Map<string, PozycjaFin[]>();
  for (const it of items) {
    const k = `${(it.issuer ?? "—").trim()} ${it.position.trim()}`;
    if (!wgPozycji.has(k)) wgPozycji.set(k, []);
    wgPozycji.get(k)!.push(it);
  }
  const rows: string[][] = [];
  const pl = (v: number) =>
    v.toLocaleString("pl-PL", { maximumFractionDigits: 2 });
  const proc = (a: number, b: number) =>
    b === 0 ? "—" : `${(((a - b) / Math.abs(b)) * 100).toFixed(1).replace(".", ",")}%`;

  for (const [, xs] of wgPozycji) {
    const emitent = (xs[0].issuer ?? "—").trim();
    const pozycja = xs[0].position.trim();
    const etykieta = emitent === "—" ? `„${pozycja}”` : `${emitent} — „${pozycja}”`;
    const jednostki = new Set(xs.map((x) => x.unit.trim().toLowerCase()).filter(Boolean));
    if (jednostki.size > 1) {
      uwagi.push(`${etykieta}: jednostki niejednolite (${[...jednostki].join(", ")}) — dynamiki nie policzono`);
      continue;
    }
    const okresy = xs
      .map((x) => ({ x, k: kluczOkresu(x.period), v: liczbaPl(x.value) }))
      .filter((o): o is { x: PozycjaFin; k: NonNullable<ReturnType<typeof kluczOkresu>>; v: number } => !!o.k && o.v != null)
      .sort((a, b) => a.k.rok - b.k.rok || a.k.pod - b.k.pod);
    if (okresy.length < 2) continue;
    for (let i = 0; i < okresy.length; i++) {
      const o = okresy[i];
      const poprz = i > 0 && okresy[i - 1].k.rodzaj === o.k.rodzaj ? okresy[i - 1] : null;
      const rr = okresy.find((p) => p.k.rodzaj === o.k.rodzaj && p.k.rok === o.k.rok - 1 && p.k.pod === o.k.pod) ?? null;
      rows.push([
        emitent,
        pozycja,
        o.x.period,
        `${pl(o.v)} ${o.x.unit}`.trim(),
        poprz ? proc(o.v, poprz.v) : "—",
        rr ? proc(o.v, rr.v) : "—",
      ]);
    }
  }
  if (!rows.length) return { table: null, uwagi };
  return {
    table: {
      caption:
        "Tabela. Analiza dynamiczna pozycji sprawozdawczych emitentów (zmiana wobec okresu poprzedniego i rok do roku)",
      head: ["Emitent", "Pozycja", "Okres", "Wartość", "Δ okres poprzedni", "Δ r/r"],
      rows: rows.sort((a, b) => a[0].localeCompare(b[0], "pl") || a[1].localeCompare(b[1], "pl") || a[2].localeCompare(b[2], "pl")),
    },
    uwagi,
  };
}

// ── wskaźniki wartości rynkowej WYKAZANE przez portale ───────────────────────

/**
 * CSV pozyskany przez biegłego z portali (stooq/StockWatch/BiznesRadar):
 *   wskaznik,emitent,mediana_branzy,na_dzien,zrodlo
 * Wartości są PRZEPISYWANE — to odczyt cudzej publikacji, nie obliczenie własne;
 * do policzenia C/Z czy EV/P trzeba liczby akcji i długu, których w aktach nie ma.
 */
export function mnoznikiWykazane(csv: string): {
  table: { caption: string; head: string[]; rows: string[][] } | null;
  uwagi: string[];
} {
  const linie = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (linie.length < 2) return { table: null, uwagi: ["plik wskaźników portali jest pusty"] };
  const naglowek = linie[0].toLowerCase();
  if (!naglowek.startsWith("wskaznik"))
    return { table: null, uwagi: [`nierozpoznany nagłówek wskaźników: „${linie[0].slice(0, 60)}”`] };
  const rows = linie.slice(1).map((l) => {
    const [wskaznik = "", emitent = "", mediana = "", naDzien = "", zrodlo = ""] = l.split(",").map((x) => x.trim());
    return [wskaznik, emitent || "—", mediana || "—", naDzien || "—", zrodlo || "—"];
  });
  return {
    table: {
      caption:
        "Tabela. Wskaźniki wartości rynkowej i rentowności — wartości WYKAZANE przez serwisy " +
        "(stooq.pl / stockwatch.pl / biznesradar.pl); wartości dla branży obliczane są w oparciu o medianę",
      head: ["Wskaźnik", "Emitent (wykazany)", "Mediana branży (wykazana)", "Na dzień", "Źródło"],
      rows,
    },
    uwagi: [],
  };
}
