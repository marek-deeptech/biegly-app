/**
 * Rozpoznanie adresów źródeł w tekście ustaleń i komórek tabel.
 *
 * ⚠️ ZAMKNIĘTA LISTA DOMEN NAJWYŻSZEGO POZIOMU. Kuszące jest dopasowanie
 * „cokolwiek.cokolwiek/…", ale w tych tabelach stoją nazwy spółek („Hub.Tech S.A."),
 * skróty prawne („art. 69 ust. 1") i nazwy plików („UTP TREM CSY.xlsx"). Wzorzec
 * otwarty zamieniałby je w martwe odnośniki — a odnośnik, który nigdzie nie prowadzi,
 * jest gorszy niż zwykły tekst, bo sugeruje, że coś sprawdzono.
 */
const TLD = "pl|com|eu|org|net|info|io";
// ⚠️ GOŁA DOMENA WYMAGA ŚCIEŻKI. „espiebi.pap.pl/node/372228" wskazuje konkretny
// dokument i jest odsyłaczem; samo „Bankier.pl" w zdaniu „Bankier.pl — historia
// zmian (https://…)" to nazwa serwisu, a nie miejsce do kliknięcia — linkowanie
// obu dawało dwa odnośniki obok siebie, z czego pierwszy prowadził na stronę główną.
const WZORZEC = new RegExp(
  String.raw`(https?://[^\s<>"')\]]+|(?:[a-z0-9-]+\.)+(?:${TLD})/[^\s<>"')\]]*)`,
  "gi",
);

export type CzescTekstu = { tekst: string; link?: string };

/** Dzieli tekst na fragmenty zwykłe i adresy (z gotowym `href`). */
export function podzielNaLinki(tekst: string): CzescTekstu[] {
  const s = String(tekst ?? "");
  if (!s) return [];
  const out: CzescTekstu[] = [];
  let ostatni = 0;
  for (const m of s.matchAll(WZORZEC)) {
    const start = m.index ?? 0;
    let dopasowanie = m[0];
    // Znak interpunkcyjny na końcu należy do zdania, nie do adresu.
    const ogon = dopasowanie.match(/[.,;:)]+$/);
    if (ogon) dopasowanie = dopasowanie.slice(0, -ogon[0].length);
    if (!dopasowanie) continue;
    if (start > ostatni) out.push({ tekst: s.slice(ostatni, start) });
    out.push({
      tekst: dopasowanie,
      link: /^https?:\/\//i.test(dopasowanie) ? dopasowanie : `https://${dopasowanie}`,
    });
    ostatni = start + dopasowanie.length;
  }
  if (ostatni < s.length) out.push({ tekst: s.slice(ostatni) });
  return out;
}
