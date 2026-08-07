/**
 * Bramka przed wydrukiem: czy proza mówi o TYM okresie, co liczby.
 *
 * ⚠️ POWÓD. Wersja v5 opinii ZASTAL twierdziła w pięciu rozdziałach, że badanie
 * obejmuje okres „od dnia 4 grudnia 2017 r." — to data pierwszej sesji w policzonym
 * pliku, a postanowienie wskazuje 11 grudnia 2017 r. Liczby były poprawne, zdanie
 * o zakresie badania fałszywe, a wykryło się to dopiero przy czytaniu wydruku.
 * Ten moduł czyta prozę tak, jak zrobiłby to czytelnik: szuka zdań deklarujących
 * okres i porównuje daty z oknem badania.
 *
 * Moduł NIE poprawia tekstu — zgłasza rozbieżność biegłemu.
 */
export type Rozdzial = {
  kind: string;
  chapter_no?: string | null;
  body_md?: string | null;
  data?: Record<string, unknown> | null;
};

/** Rodzaje subanaliz, które MOGĄ być rozdziałem IV (reszta to rejestry danych). */
const ROZDZIALY_IV = new Set([
  "ekofin", "espi", "aktywnosc", "relacje", "wash", "imo", "layering",
  "pumpdump", "fixing", "reversal", "concentration", "infomanip",
]);

export type Zastrzezenie = {
  kind: string;
  chapter_no: string;
  rodzaj: "okres" | "proza-starsza" | "poza-planem";
  opis: string;
  fragment?: string;
};

const MIESIACE: Record<string, string> = {
  stycznia: "01", lutego: "02", marca: "03", kwietnia: "04", maja: "05", czerwca: "06",
  lipca: "07", sierpnia: "08", września: "09", wrzesnia: "09", października: "10",
  pazdziernika: "10", listopada: "11", grudnia: "12",
};

/** „4 grudnia 2017 r." → 2017-12-04; „2017-12-04" → bez zmian. */
export function naISO(tekst: string): string | null {
  const iso = tekst.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  const slowny = tekst.match(/(\d{1,2})\s+([a-ząćęłńóśźż]+)\s+(\d{4})/i);
  if (!slowny) return null;
  const mm = MIESIACE[slowny[2].toLowerCase()];
  if (!mm) return null;
  return `${slowny[3]}-${mm}-${String(slowny[1]).padStart(2, "0")}`;
}

// Zdanie deklarujące zakres badania. Separator [^.] rozbija się na „r." i na datach,
// więc granicą zdania jest tu koniec akapitu albo średnik.
const ZDANIA_OKRESU =
  /(?:okres(?:ie|u|em)?\s+(?:objęt\w+\s+)?(?:analizą|badani\w+|opinią)|okres\s+badany|badaniem\s+objęto|analiza\s+obejmuje)[^;\n]{0,200}/gi;

const DATA = String.raw`\d{4}-\d{2}-\d{2}|\d{1,2}\s+[a-ząćęłńóśźż]+\s+\d{4}`;
/** „od dnia X do dnia Y", „X – Y", „do Y" — data w roli granicy, nie wzmianki. */
const GRANICA = new RegExp(
  String.raw`(od|do|między|pomiędzy)\s+(?:dnia\s+)?(${DATA})(?:\s*(?:r\.)?\s*(?:–|-|do|a)\s*(?:dnia\s+)?(${DATA}))?`,
  "gi",
);

/**
 * Daty deklarowane jako granica okresu, których nie ma w oknie badania.
 * `dopuszczalne` to daty poboczne, które wolno wymieniać (np. koniec okresu
 * drugiego instrumentu) — bez nich każdy rozdział zgłaszałby fałszywy alarm.
 */
export function zleDatyOkresu(proza: string, okno: { od: string; do: string }, dopuszczalne: string[] = []): string[] {
  const ok = new Set([okno.od, okno.do, ...dopuszczalne]);
  const zle: string[] = [];
  for (const zdanie of proza.match(ZDANIA_OKRESU) ?? []) {
    // Tylko data będąca GRANICĄ okresu: po „od"/„do" albo w zakresie „X – Y".
    // Bez tego zawężenia alarm podnosiła każda data raportu wymieniona w zdaniu
    // o okresie badanym („w okresie badanym raport z 22 grudnia 2017 r.").
    for (const m of zdanie.matchAll(GRANICA)) {
      for (const kawalek of [m[2], m[3]]) {
        const iso = kawalek ? naISO(kawalek) : null;
        if (iso && !ok.has(iso) && !zle.includes(iso)) zle.push(iso);
      }
    }
  }
  return zle;
}

/**
 * Pełny audyt: rozjazd okresu, proza starsza od liczb, rozdziały IV z prozą
 * poza planem opinii (policzone i zredagowane, ale niedrukowane).
 */
export function audytOkresu(
  rozdzialy: Rozdzial[],
  okno: { od: string; do: string },
  planKinds: string[],
  dopuszczalne: string[] = [],
): Zastrzezenie[] {
  const out: Zastrzezenie[] = [];
  for (const r of rozdzialy) {
    const proza = String(r.body_md ?? "");
    const nr = String(r.chapter_no ?? "—");
    if (proza.length > 300) {
      const zle = zleDatyOkresu(proza, okno, dopuszczalne);
      if (zle.length)
        out.push({
          kind: r.kind,
          chapter_no: nr,
          rodzaj: "okres",
          opis:
            `proza deklaruje okres z datami ${zle.join(", ")}, a badanie obejmuje ${okno.od}–${okno.do}` +
            (dopuszczalne.length ? ` (dopuszczone poboczne: ${dopuszczalne.join(", ")})` : ""),
          fragment: (proza.match(ZDANIA_OKRESU) ?? []).find((z) => zle.some((d) => z.includes(d.slice(0, 4))))?.slice(0, 160),
        });
    }
    if ((r.data as { proza_sprzed_przeliczenia?: boolean } | null)?.proza_sprzed_przeliczenia && proza.length > 300)
      out.push({
        kind: r.kind,
        chapter_no: nr,
        rodzaj: "proza-starsza",
        opis: "liczby rozdziału przeliczono po napisaniu prozy — wymaga ponownej redakcji",
      });
    // Rejestry danych (`espi_events`, `powiazania_dane`, `techniki`) i kontener
    // wstępu też mają chapter_no „IV" — nie są rozdziałami i nie podlegają planowi.
    if (ROZDZIALY_IV.has(r.kind) && proza.length > 300 && !planKinds.includes(r.kind))
      out.push({
        kind: r.kind,
        chapter_no: nr,
        rodzaj: "poza-planem",
        opis:
          `rozdział ma ${proza.length} zn. prozy, ale nie wchodzi do opinii — technika spoza ` +
          "zatwierdzonego doboru biegłego; albo dopisz ją do doboru, albo usuń szkic",
      });
  }
  return out;
}
