// Wybór AUTORYTATYWNEGO, głównego pliku UTP spośród wielu wariantów w aktach.
//
// W aktach bywa kilka wersji tego samego, skonsolidowanego arkusza „Transakcje_i_Zlecenia"
// (np. „…prok.xlsx", „…prok-4.xlsx", „…prok-4_pop.xlsx", „…prok-4_pop2.xlsx") oraz cząstkowe
// pliki źródłowe per dzień („…zrodlo_8.10.2020.xlsx"). Do analizy MUSI trafić NAJNOWSZY,
// najpełniejszy wariant konsolidowany — nie plik cząstkowy ani starsza wersja.
//
// Kolejność sygnałów (znacznik czasu z bazy jest bezużyteczny — pliki wgrywa się jednym
// syncem folderu, więc created_at jest identyczny):
//   1) TYLKO plik konsolidowany (nie „zrodlo") — filtr isMainUtp,
//   2) najwyższa WERSJA w nazwie (-4, _pop, _pop2, „final") — „ostatni wariant",
//   3) największy ROZMIAR (proxy kompletności) — „najpełniejszy", gdy w nazwach brak wersji.
//
// UWAGA: bliźniacza logika w Pythonie — engine/uslugi/spoofing.py (_is_main, _utp_version_key). Zmiana
// tu wymaga zmiany tam (test: tests/test_utp_pick.py blokuje wybór dla HUBTECH i MLM).

function base(p: string): string {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

/** Czy plik to GŁÓWNY, skonsolidowany arkusz UTP (Transakcje+Zlecenia, wiele sesji),
 *  a nie cząstkowy plik źródłowy per dzień („…zrodlo_8.10.2020"). */
export function isMainUtp(relPath: string): boolean {
  const b = base(relPath).toLowerCase();
  if (b.includes("zrodlo") || b.includes("źródło") || b.includes("zrodł")) return false;
  return b.includes("transakcje_i_zlecenia") || (b.includes("transakcje") && b.includes("zlecenia"));
}

/** Klucz wersji z nazwy pliku — wyższy = nowszy wariant. [final, rev, corr]:
 *  rewizja bazowa (-4), etap korekty (_pop, _pop2), znacznik final/ostateczna.
 *  Daty i sygnatury (2020, 4.2019, 8.10.2020) są maskowane, by nie mylić z numerem wersji. */
export function utpVersionKey(relPath: string): [number, number, number] {
  const b = base(relPath)
    .toLowerCase()
    .replace(/\.(xlsx|xlsm|xls)$/i, "")
    .replace(/\d{1,2}[.\-]\d{1,2}[.\-]\d{2,4}/g, " ") // 8.10.2020 / 2020-09-11
    .replace(/\d{1,2}[.\-]\d{4}/g, " ") // 4.2019 (sygnatura)
    .replace(/\b(19|20)\d{2}\b/g, " "); // rok 2020/2019
  const final = /final|ostateczn/.test(b) ? 1 : 0;
  const revs = [
    ...[...b.matchAll(/[-_(](\d+)/g)].map((m) => parseInt(m[1], 10)),
    ...[...b.matchAll(/\b(?:v|ver|rev|wersja)\.?\s*(\d+)/g)].map((m) => parseInt(m[1], 10)),
  ];
  const rev = revs.length ? Math.max(...revs) : 0;
  let corr = 0;
  for (const m of b.matchAll(/[-_ ](?:pop|popr|poprawion\w*|korekt\w*|skoryg\w*)(\d*)/g)) {
    corr = Math.max(corr, m[1] ? parseInt(m[1], 10) : 1);
  }
  return [final, rev, corr];
}

/** Komparator sortowania kandydatów: NAJNOWSZY wariant najpierw; przy równej wersji — NAJWIĘKSZY. */
export function cmpMainUtp(
  a: { rel_path: string; size_bytes: number | null },
  b: { rel_path: string; size_bytes: number | null },
): number {
  const ka = utpVersionKey(a.rel_path);
  const kb = utpVersionKey(b.rel_path);
  for (let i = 0; i < ka.length; i++) if (kb[i] !== ka[i]) return kb[i] - ka[i];
  return (b.size_bytes ?? 0) - (a.size_bytes ?? 0);
}

/** Krótka etykieta wariantu do UI, np. „wer. 4 · korekta 2 · final". */
export function utpVariantLabel(relPath: string): string {
  const [final, rev, corr] = utpVersionKey(relPath);
  const parts: string[] = [];
  if (rev) parts.push(`wer. ${rev}`);
  if (corr) parts.push(`korekta ${corr}`);
  if (final) parts.push("final");
  return parts.join(" · ");
}
