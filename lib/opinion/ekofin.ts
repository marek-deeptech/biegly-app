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

/**
 * Kontrast WEWNĄTRZ dostępnego materiału — gdy historii od debiutu nie ma.
 *
 * ⚠️ POWÓD. Spółki wykluczone z obrotu (ZASTAL: CSY, RSY) nie mają kartoteki
 * notowań w serwisach, a notowania odtworzone z arkusza TREM zaczynają się razem
 * z okresem badanym. Wzorcowy kontrast „od debiutu wobec okresu badanego" jest
 * wtedy niepoliczalny i krok kończył się samą uwagą — 203 i 210 sesji leżało
 * nieużytych. Tu porównujemy okresy WEWNĄTRZ materiału (rok albo kwartał), co
 * odpowiada na to samo pytanie: czy obrót w okresie objętym postanowieniem
 * odstaje od obrotu w pozostałych okresach z akt.
 *
 * To NIE jest kontrast od debiutu i podpis tabeli musi to mówić wprost.
 */
export function kontrastOkresow(
  notowania: NotowanieDzienne[],
  granulacja: "rok" | "kwartal" = "rok",
): { okresy: (OkresObrotu & { etykieta: string; krotnoscWobecPierwszego: number | null })[]; uwagi: string[] } {
  const uwagi: string[] = [];
  if (!notowania.length) return { okresy: [], uwagi };
  const etykieta = (d: string) =>
    granulacja === "rok" ? d.slice(0, 4) : `${d.slice(0, 4)} kw. ${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;

  const wg = new Map<string, NotowanieDzienne[]>();
  for (const n of notowania) {
    const k = etykieta(n.dzien);
    if (!wg.has(k)) wg.set(k, []);
    wg.get(k)!.push(n);
  }
  const klucze = [...wg.keys()].sort();
  const okresy = klucze.map((k) => {
    const xs = wg.get(k)!;
    return {
      etykieta: k,
      od: xs[0].dzien,
      do: xs[xs.length - 1].dzien,
      dniSesyjnych: xs.length,
      ...srednie(xs),
      krotnoscWobecPierwszego: null as number | null,
    };
  });
  const baza = okresy[0]?.sredniWolumen ?? null;
  for (const o of okresy) {
    o.krotnoscWobecPierwszego = baza && o.sredniWolumen ? o.sredniWolumen / baza : null;
  }
  // Okres brzegowy bywa urwany (kilka sesji) i jego średnia nie jest porównywalna
  // z pełnym rokiem — mówimy o tym, zamiast liczyć krotność w milczeniu.
  const urwane = okresy.filter((o) => o.dniSesyjnych < 20);
  if (urwane.length)
    uwagi.push(
      `okresy o niepełnej liczbie sesji (${urwane.map((o) => `${o.etykieta}: ${o.dniSesyjnych}`).join(", ")}) ` +
        "obejmują fragment przedziału — ich średnie nie są porównywalne z okresami pełnymi",
    );
  return { okresy, uwagi };
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

/**
 * Mnożnik jednostki pieniężnej wobec złotego. `null` = jednostka spoza tej miary.
 *
 * ⚠️ POWÓD ISTNIENIA. Sprawozdania tej samej spółki podają te same pozycje raz
 * w tysiącach, raz w złotych (CSY S.A.: „kapitał własny" w „tys. zł" i w „zł").
 * Dynamika liczona na pomieszanych jednostkach dałaby zmianę o trzy rzędy
 * wielkości, a wyglądałaby wiarygodnie — dlatego wcześniej krok w ogóle
 * odmawiał liczenia. Odmowa była bezpieczna, ale zostawiała siedem pozycji bez
 * analizy; przeliczenie rozwiązuje to bez ryzyka, bo mnożnik jest ze słownika,
 * a nie zgadywany z rzędu wielkości.
 */
export function mnoznikJednostki(jednostka: string): number | null {
  const j = String(jednostka).toLowerCase().replace(/[\s\u00a0]+/g, " ").replace(/[.]/g, "").trim();
  if (!j) return null;
  if (/^(w )?(zł|zl|pln)$/.test(j)) return 1;
  if (/^(w )?(tys|tysi[ąa]c\w*) (zł|zl|pln)$/.test(j)) return 1e3;
  if (/^(w )?(mln|milion\w*) (zł|zl|pln)$/.test(j)) return 1e6;
  if (/^(w )?(mld|miliard\w*) (zł|zl|pln)$/.test(j)) return 1e9;
  return null;
}

/**
 * Sprowadza pozycje jednej serii do WSPÓLNEJ jednostki pieniężnej.
 *
 * Jednostką docelową jest ta, w której podano najwięcej okresów — dzięki temu
 * tabela zachowuje idiom dokumentu (sprawozdania mówią w tysiącach), a nie zamienia
 * wszystkiego na złote. Zwraca `null`, gdy choć jedna jednostka nie jest pieniężna:
 * procentu i sztuk nie wolno sprowadzać do złotych.
 */
export function doWspolnejJednostki(
  xs: { unit: string; value: string }[],
): { jednostka: string; wartosci: (number | null)[]; przeliczonych: number } | null {
  if (!xs.length) return null;
  const mn = xs.map((x) => mnoznikJednostki(x.unit));
  if (mn.some((m) => m == null)) return null;
  const licznik = new Map<string, number>();
  for (const x of xs) {
    const k = x.unit.trim();
    licznik.set(k, (licznik.get(k) ?? 0) + 1);
  }
  // Jednostka docelowa: najczęstsza, a przy remisie — najmniejszy mnożnik
  // (bliżej danych źródłowych, mniej zaokrągleń).
  const docelowa = [...licznik.entries()].sort(
    (a, b) => b[1] - a[1] || (mnoznikJednostki(a[0]) ?? 0) - (mnoznikJednostki(b[0]) ?? 0),
  )[0][0];
  const mDoc = mnoznikJednostki(docelowa) as number;
  let przeliczonych = 0;
  const wartosci = xs.map((x, i) => {
    const v = liczbaPl(x.value);
    if (v == null) return null;
    const m = mn[i] as number;
    if (m === mDoc) return v;
    przeliczonych += 1;
    return (v * m) / mDoc;
  });
  return { jednostka: docelowa, wartosci, przeliczonych };
}

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
): { rok: number; pod: number; rodzaj: "kw" | "pol" | "rok" | "dzien" | "narast" } | null {
  const p = period.toLowerCase().replace(/\s+/g, " ").replace(/[–—]/g, "-").trim();
  // ⚠️ OKRES NARASTAJĄCY („I-III kw. 2017") to WŁASNY rodzaj, nie kwartał.
  // Sprawozdania kwartalne podają obok siebie kwartał i narastająco od początku
  // roku; wrzucenie obu do jednego szeregu porównywałoby strumień trzymiesięczny
  // z dziewięciomiesięcznym. Wcześniej etykieta nie pasowała do żadnego wzorca,
  // więc obserwacja WYPADAŁA z tabeli bez śladu — dla CSY S.A. dwie z sześciu.
  let m = p.match(/^(i{1,3}|iv)\s*-\s*(i{1,3}|iv)\s*kw\w*\.?\s*(\d{4})/);
  if (m) return { rok: Number(m[3]), pod: KW[m[2]], rodzaj: "narast" };
  m = p.match(/^(narastaj\w*|od pocz\w+ roku)[^0-9]*(\d{4})/);
  if (m) return { rok: Number(m[2]), pod: 0, rodzaj: "narast" };
  m = p.match(/^(i{1,3}|iv)\s*kw\w*\.?\s*(\d{4})/);
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
    // ⚠️ JEDNOSTKI SPROWADZAMY, NIE ODRZUCAMY. Sprawozdania tej samej spółki podają
    // te same pozycje raz w tysiącach, raz w złotych. Dawniej pozycja z niejednolitą
    // jednostką zostawała bez dynamiki — bezpiecznie, ale siedem pozycji CSY S.A.
    // (kapitał własny, przychody, wynik operacyjny, brutto, netto, suma bilansowa,
    // przepływy) nie było w ogóle policzonych. Mnożnik bierzemy ze słownika jednostek,
    // nie z rzędu wielkości liczby, więc przeliczenie nie jest domysłem.
    const jednostki = new Set(xs.map((x) => x.unit.trim().toLowerCase()).filter(Boolean));
    const wspolne = jednostki.size > 1 ? doWspolnejJednostki(xs) : null;
    if (jednostki.size > 1 && !wspolne) {
      uwagi.push(
        `${etykieta}: jednostki różnej miary (${[...jednostki].join(", ")}) — dynamiki nie policzono; ` +
          "sprowadzić do wspólnej miary można wielkości pieniężne, nie procenty ani sztuki",
      );
      continue;
    }
    if (wspolne) {
      uwagi.push(
        `${etykieta}: wartości sprowadzono do jednostki „${wspolne.jednostka}” ` +
          `(przeliczono ${wspolne.przeliczonych} z ${xs.length} okresów podanych w innej jednostce).`,
      );
    }
    const wszystkieOkresy = xs.map((x, i) => ({
      x: wspolne ? { ...x, unit: wspolne.jednostka } : x,
      k: kluczOkresu(x.period),
      v: wspolne ? wspolne.wartosci[i] : liczbaPl(x.value),
    }));
    // Cisza tutaj oznaczałaby, że pozycji po prostu nie ma w sprawozdaniach.
    const nierozpoznane = wszystkieOkresy.filter((o) => !o.k).map((o) => o.x.period);
    if (nierozpoznane.length)
      uwagi.push(
        `${etykieta}: ${nierozpoznane.length} obserwacji pominięto — nie rozpoznano okresu ` +
          `(${[...new Set(nierozpoznane)].slice(0, 4).join(", ")}); do dopisania w kluczu okresów.`,
      );
    const okresy = wszystkieOkresy
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

// ── wskaźniki rentowności z pozycji sprawozdawczych ───────────────────────

/**
 * Rentowność emitenta liczona z pozycji, które już mamy w aktach.
 *
 * ⚠️ CZĘŚĆ TABELI NR 3 WZORCA. Finał HubTech ma „Wskaźniki wartości rynkowej ORAZ
 * rentowności". Część rynkowa (C/Z, C/WK) wymaga liczby akcji i danych portali —
 * to zostaje na liście braków. Część rentownościowa jest policzalna z materiału,
 * który leży w sprawie: przychody, wynik operacyjny, wynik netto, kapitał własny
 * i suma bilansowa są wśród 87 obserwacji odczytanych ze sprawozdań.
 *
 * Wskaźnik powstaje TYLKO wtedy, gdy obie pozycje pochodzą z tego samego okresu
 * i tego samego emitenta. Mieszanie okresów dałoby liczbę bez desygnatu.
 */
export type WskaznikRentownosci = {
  emitent: string;
  okres: string;
  nazwa: string;
  wartoscPct: number;
  licznik: string;
  mianownik: string;
};

const SYNONIMY: Record<string, RegExp> = {
  przychody: /przychody (netto )?ze sprzeda/i,
  operacyjny: /zysk\/?strata z dzia[łl]alno[śs]ci operacyjnej|wynik operacyjny|ebit/i,
  netto: /zysk\/?strata netto|wynik netto/i,
  kapital: /kapita[łl] w[łl]asny/i,
  aktywa: /suma bilansowa|aktywa razem/i,
};

export function wskaznikiRentownosci(items: PozycjaFin[]): {
  table: { caption: string; head: string[]; rows: string[][] } | null;
  wskazniki: WskaznikRentownosci[];
  uwagi: string[];
} {
  const uwagi: string[] = [];
  // emitent → okres → rola → wartość (po sprowadzeniu jednostek w obrębie serii)
  const wg = new Map<string, Map<string, Map<string, number>>>();
  const seria = new Map<string, PozycjaFin[]>();
  for (const it of items) {
    const rola = Object.entries(SYNONIMY).find(([, re]) => re.test(it.position))?.[0];
    if (!rola) continue;
    const k = `${(it.issuer ?? "—").trim()}||${rola}`;
    if (!seria.has(k)) seria.set(k, []);
    seria.get(k)!.push(it);
  }
  for (const [k, xs] of seria) {
    const [emitent, rola] = k.split("||");
    const wspolne = doWspolnejJednostki(xs);
    xs.forEach((x, i) => {
      const v = wspolne ? wspolne.wartosci[i] : liczbaPl(x.value);
      if (v == null) return;
      if (!wg.has(emitent)) wg.set(emitent, new Map());
      const okresy = wg.get(emitent)!;
      if (!okresy.has(x.period)) okresy.set(x.period, new Map());
      okresy.get(x.period)!.set(rola, v);
    });
  }

  const DEF: { nazwa: string; licznik: string; mianownik: string }[] = [
    { nazwa: "Rentowność operacyjna (EBIT / przychody)", licznik: "operacyjny", mianownik: "przychody" },
    { nazwa: "Rentowność netto (wynik netto / przychody)", licznik: "netto", mianownik: "przychody" },
    { nazwa: "ROE (wynik netto / kapitał własny)", licznik: "netto", mianownik: "kapital" },
    { nazwa: "ROA (wynik netto / suma bilansowa)", licznik: "netto", mianownik: "aktywa" },
  ];
  const wskazniki: WskaznikRentownosci[] = [];
  for (const [emitent, okresy] of [...wg.entries()].sort()) {
    for (const [okres, role] of [...okresy.entries()].sort()) {
      for (const d of DEF) {
        const l = role.get(d.licznik);
        const m = role.get(d.mianownik);
        if (l == null || m == null || m === 0) continue;
        wskazniki.push({
          emitent, okres, nazwa: d.nazwa,
          wartoscPct: Math.round((10000 * l) / m) / 100,
          licznik: d.licznik, mianownik: d.mianownik,
        });
      }
    }
  }
  if (!wskazniki.length) {
    uwagi.push(
      "Nie policzono wskaźników rentowności: w odczytanych pozycjach nie ma pary licznik–mianownik " +
        "z tego samego okresu i tego samego emitenta.",
    );
    return { table: null, wskazniki, uwagi };
  }
  uwagi.push(
    "Wskaźniki rentowności policzono z pozycji sprawozdawczych odczytanych z akt; wartości rynkowe " +
      "(C/Z, C/WK) wymagają liczby akcji i danych portali i pozostają do pozyskania.",
  );
  return {
    table: {
      caption:
        "Tabela. Wskaźniki rentowności emitentów policzone z pozycji sprawozdawczych " +
        "(licznik i mianownik z tego samego okresu i tej samej spółki)",
      head: ["Emitent", "Okres", "Wskaźnik", "Wartość"],
      rows: wskazniki.map((w) => [
        w.emitent, w.okres, w.nazwa,
        `${w.wartoscPct.toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`,
      ]),
    },
    wskazniki,
    uwagi,
  };
}
