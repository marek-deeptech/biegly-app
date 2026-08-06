// IV.3 — AKTYWNOŚĆ PODMIOTÓW Z GRUPY: dobór sesji istotnych i tabele.
//
// WZORZEC (finał HubTech, tabele nr 9–34): tabela zbiorcza za cały okres, tabele
// zbiorcze per podmiot oraz TABELA SZCZEGÓŁOWA NA KAŻDĄ SESJĘ. KM zrobił tak dla
// dwunastu dni sesyjnych objętych postanowieniem.
//
// ⚠️ DLACZEGO NIE KOPIUJEMY TEGO WPROST: postanowienie w sprawie ZASTAL obejmuje
// niecałe dwa lata (201 sesji CSY i 209 RSY), więc tabela na każdą sesję dałaby
// ~400 tabel — dokument nie do czytania, w którym sesje rozstrzygające utonęłyby
// wśród setek sesji bez zdarzeń. Tabele szczegółowe powstają zatem dla SESJI
// ISTOTNYCH, wybranych deterministycznie po przekroczeniu progu któregokolwiek
// ze wskaźników. Kryterium wyboru jest częścią opinii (jawne w podpisie tabeli),
// a nie ukrytą decyzją narzędzia — inaczej byłby to nieujawniony dobór materiału.

export type Metryka = { key: string; value: number | null; session_day?: string | null };

export type ProgiIstotnosci = {
  /** Udział wolumenu Grupy w wolumenie sesji [%]. */
  udzialGrupy: number;
  /** Udział wolumenu wewnątrzgrupowego w wolumenie sesji [%]. */
  wewnatrzgrupowy: number;
  /** Udział anulowanego wolumenu kupna Grupy w wolumenie zleconym [%]. */
  anulacje: number;
  /** Szczyt koncentracji zleceń w oknie 15 minut [%]. */
  koncentracja: number;
  /** Udział Grupy w wolumenie fixingu zamknięcia [%]. */
  fixing: number;
  /** Bezwzględna zmiana kursu zamknięcia wobec poprzedniej sesji [%]. */
  zmianaKursu: number;
};

export const PROGI_DOMYSLNE: ProgiIstotnosci = {
  udzialGrupy: 50,
  wewnatrzgrupowy: 20,
  anulacje: 50,
  koncentracja: 50,
  fixing: 50,
  zmianaKursu: 10,
};

export type SesjaIstotna = {
  dzien: string;
  powody: string[];
  /**
   * Waga istotności — do WYBORU sesji, gdy kryteria spełnia ich więcej, niż da się
   * opisać tabelami.
   *
   * ⚠️ POWÓD ISTNIENIA: w sprawie ZASTAL progi spełniło 219 z 270 sesji. Wzięcie
   * „pierwszych dwudziestu" dałoby rozdział o grudniu 2017 i milczenie o reszcie
   * okresu — cięcie arbitralne, nie do obrony w opinii. Waga = liczba spełnionych
   * kryteriów (sesja wyróżniona na kilku polach jest mocniejsza niż na jednym),
   * a przy remisie największe przekroczenie progu. Wybór zostaje jawny: kryterium
   * i waga trafiają do danych rozdziału.
   */
  waga: number;
  /** Największe względne przekroczenie progu na tej sesji (do rozstrzygania remisów). */
  szczyt: number;
};

const pl = (v: number, frac = 2) => v.toLocaleString("pl-PL", { maximumFractionDigits: frac });
const proc = (v: number | null | undefined) => (v == null ? "—" : `${pl(v)} %`);
const kwota = (v: number | null | undefined) => (v == null ? "—" : pl(v, 0));

/** Indeks metryk: klucz → dzień → wartość (dla kluczy sesyjnych). */
export function wgDnia(metryki: Metryka[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const m of metryki) {
    if (!m.session_day || m.value == null) continue;
    if (!out.has(m.key)) out.set(m.key, new Map());
    out.get(m.key)!.set(m.session_day, m.value);
  }
  return out;
}

/** Wartość metryki, której klucz zawiera dzień w nazwie (np. `cancel_2018-01-03`). */
function zKluczaZDniem(metryki: Metryka[], prefiks: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of metryki) {
    if (!m.key.startsWith(prefiks) || m.value == null) continue;
    const d = m.key.slice(prefiks.length);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) out.set(d, m.value);
  }
  return out;
}

/**
 * Sesje istotne — deterministyczny dobór do tabel szczegółowych.
 *
 * Sesja wchodzi, gdy PRZEKROCZY próg któregokolwiek wskaźnika; powód jest
 * zapisywany, bo w opinii trzeba powiedzieć, czym dana sesja się wyróżniła.
 */
export function sesjeIstotne(
  metryki: Metryka[],
  progi: ProgiIstotnosci = PROGI_DOMYSLNE,
): SesjaIstotna[] {
  const idx = wgDnia(metryki);
  const g = (k: string, d: string) => idx.get(k)?.get(d) ?? null;
  const wash = zKluczaZDniem(metryki, "wash_");
  const cancel = zKluczaZDniem(metryki, "cancel_");
  const dni = [...new Set(metryki.map((m) => m.session_day).filter((d): d is string => !!d))].sort();

  const out: SesjaIstotna[] = [];
  for (const d of dni) {
    const powody: string[] = [];
    let szczyt = 0;
    /** Zapisuje powód i mierzy, ile razy wartość przebiła próg (do wagi). */
    const sprawdz = (wartosc: number | null | undefined, prog: number, opis: (v: number) => string) => {
      if (wartosc == null || wartosc < prog) return;
      powody.push(opis(wartosc));
      if (prog > 0) szczyt = Math.max(szczyt, wartosc / prog);
    };

    const volS = g("day_sess_vol", d);
    const volG = g("day_grp_vol", d);
    sprawdz(volS && volG != null ? (100 * volG) / volS : null, progi.udzialGrupy,
      (v) => `udział Grupy w wolumenie sesji ${proc(v)}`);
    const intra = g("day_intra_vol", d);
    sprawdz(wash.get(d) ?? (volS && intra != null ? (100 * intra) / volS : null), progi.wewnatrzgrupowy,
      (v) => `obrót wewnątrzgrupowy ${proc(v)} wolumenu sesji`);
    sprawdz(cancel.get(d) ?? g("lay_share", d), progi.anulacje,
      (v) => `anulowany wolumen kupna Grupy ${proc(v)}`);
    sprawdz(g("conc_peak_share", d), progi.koncentracja, (v) => `koncentracja zleceń w 15 min ${proc(v)}`);
    sprawdz(g("fix_close_share", d), progi.fixing, (v) => `udział w fixingu zamknięcia ${proc(v)}`);
    const zm = g("day_change_pct", d);
    sprawdz(zm == null ? null : Math.abs(zm), progi.zmianaKursu,
      () => `zmiana kursu ${zm! > 0 ? "+" : "−"}${proc(Math.abs(zm!))}`);

    if (powody.length) out.push({ dzien: d, powody, waga: powody.length, szczyt: Math.round(szczyt * 100) / 100 });
  }
  return out;
}

/**
 * Sesje do tabel szczegółowych: najpierw najmocniejsze, ale ZWRACANE
 * chronologicznie — rozdział ma czytać się jak przebieg zdarzeń, a nie ranking.
 */
export function wybierzDoTabel(istotne: SesjaIstotna[], maks: number): SesjaIstotna[] {
  return [...istotne]
    .sort((a, b) => b.waga - a.waga || b.szczyt - a.szczyt || a.dzien.localeCompare(b.dzien))
    .slice(0, maks)
    .sort((a, b) => a.dzien.localeCompare(b.dzien));
}

export type Tabela = { caption: string; head: string[]; rows: string[][] };

/** Podpis z jawnym kryterium doboru — dobór materiału musi być widoczny w opinii. */
export function opisProgow(p: ProgiIstotnosci): string {
  return (
    `udział Grupy w wolumenie sesji ≥ ${p.udzialGrupy} %, obrót wewnątrzgrupowy ≥ ${p.wewnatrzgrupowy} %, ` +
    `anulowany wolumen kupna ≥ ${p.anulacje} %, koncentracja zleceń w 15 min ≥ ${p.koncentracja} %, ` +
    `udział w fixingu zamknięcia ≥ ${p.fixing} %, zmiana kursu ≥ ${p.zmianaKursu} %`
  );
}

/** Tabela zbiorcza: sesja po sesji — kurs, wolumen sesji i udział Grupy. */
export function tabelaPrzebiegu(metryki: Metryka[], instrument?: string): Tabela | null {
  const idx = wgDnia(metryki);
  const g = (k: string, d: string) => idx.get(k)?.get(d) ?? null;
  const dni = [...new Set(metryki.map((m) => m.session_day).filter((d): d is string => !!d))].sort();
  if (!dni.length) return null;
  const rows = dni.map((d) => {
    const volS = g("day_sess_vol", d);
    const volG = g("day_grp_vol", d);
    return [
      d,
      g("day_close", d) != null ? pl(g("day_close", d)!, 4) : "—",
      g("day_change_pct", d) != null ? `${g("day_change_pct", d)! > 0 ? "+" : ""}${proc(g("day_change_pct", d))}` : "—",
      kwota(volS),
      kwota(volG),
      volS && volG != null ? proc((100 * volG) / volS) : "—",
      kwota(g("day_intra_vol", d)),
      kwota(g("day_grp_net_vol", d)),
    ];
  });
  return {
    caption:
      `Tabela. Przebieg sesji${instrument ? ` — ${instrument}` : ""}: kurs zamknięcia, wolumen sesji oraz udział ` +
      "i saldo podmiotów z Grupy",
    head: [
      "Sesja", "Kurs zamk.", "Zmiana", "Wolumen sesji", "Wolumen Grupy", "Udział Grupy",
      "Wolumen wewnątrzgr.", "Saldo Grupy (kupno−sprzedaż)",
    ],
    rows,
  };
}

/** Zbiorcze zestawienie per podmiot za cały okres (z metryk `ede_*`). */
export function tabelaPodmiotow(metryki: Metryka[]): Tabela | null {
  const agg = new Map<string, { bval: number; bvol: number; sval: number; svol: number; sesje: Set<string> }>();
  for (const m of metryki) {
    const [pfx, podmiot] = m.key.split("::");
    if (!podmiot || m.value == null) continue;
    if (!["ede_bval", "ede_bvol", "ede_sval", "ede_svol"].includes(pfx)) continue;
    const a = agg.get(podmiot) ?? { bval: 0, bvol: 0, sval: 0, svol: 0, sesje: new Set<string>() };
    if (pfx === "ede_bval") a.bval += m.value;
    if (pfx === "ede_bvol") a.bvol += m.value;
    if (pfx === "ede_sval") a.sval += m.value;
    if (pfx === "ede_svol") a.svol += m.value;
    if (m.session_day) a.sesje.add(m.session_day);
    agg.set(podmiot, a);
  }
  if (!agg.size) return null;
  const rows = [...agg.entries()]
    .sort((a, b) => b[1].bval + b[1].sval - (a[1].bval + a[1].sval))
    .map(([p, a]) => [
      p,
      String(a.sesje.size),
      kwota(a.bvol), kwota(a.bval),
      kwota(a.svol), kwota(a.sval),
      kwota(a.bvol - a.svol),
      kwota(a.sval - a.bval),
    ]);
  return {
    caption:
      "Tabela. Aktywność podmiotów z Grupy w całym okresie badanym — kupno, sprzedaż, saldo wolumenu " +
      "(pozycja) i saldo gotówki (przychód ze sprzedaży pomniejszony o wydatki na kupno)",
    head: [
      "Podmiot", "Sesji z aktywnością", "Kupno (szt)", "Kupno (zł)", "Sprzedaż (szt)", "Sprzedaż (zł)",
      "Saldo wolumenu", "Saldo gotówki (zł)",
    ],
    rows,
  };
}

/** Tabela szczegółowa jednej sesji: podmiot × kupno/sprzedaż/saldo. */
export function tabelaSesji(metryki: Metryka[], dzien: string, powody: string[]): Tabela | null {
  const wg = new Map<string, { bval: number; bvol: number; sval: number; svol: number }>();
  for (const m of metryki) {
    if (m.session_day !== dzien || m.value == null) continue;
    const [pfx, podmiot] = m.key.split("::");
    if (!podmiot || !["ede_bval", "ede_bvol", "ede_sval", "ede_svol"].includes(pfx)) continue;
    const a = wg.get(podmiot) ?? { bval: 0, bvol: 0, sval: 0, svol: 0 };
    if (pfx === "ede_bval") a.bval += m.value;
    if (pfx === "ede_bvol") a.bvol += m.value;
    if (pfx === "ede_sval") a.sval += m.value;
    if (pfx === "ede_svol") a.svol += m.value;
    wg.set(podmiot, a);
  }
  if (!wg.size) return null;
  const rows = [...wg.entries()]
    .sort((a, b) => b[1].bval + b[1].sval - (a[1].bval + a[1].sval))
    .map(([p, a]) => [p, kwota(a.bvol), kwota(a.bval), kwota(a.svol), kwota(a.sval), kwota(a.bvol - a.svol)]);
  return {
    caption: `Tabela. Aktywność podmiotów z Grupy w sesji ${dzien} (${powody.join("; ")})`,
    head: ["Podmiot", "Kupno (szt)", "Kupno (zł)", "Sprzedaż (szt)", "Sprzedaż (zł)", "Saldo wolumenu"],
    rows,
  };
}
