/**
 * Historia zmian w akcjonariacie — rdzeń deterministyczny.
 *
 * Krok odpowiada na pytanie „kto, kiedy i ile akcji nabył albo zbył”. Buduje go
 * z dwóch źródeł o różnej wadze dowodowej:
 *
 *   1. **Bankier.pl** — tabela „Historia zmian w akcjonariacie” (stan po każdej
 *      zmianie) oraz historia emisji kapitału. Źródło wtórne: wygodne, ale
 *      opisuje stan według serwisu, nie według dokumentu.
 *   2. **Sprawozdanie opisowe zarządu** — stan na koniec roku obrotowego,
 *      publikowane zwykle w maju/czerwcu roku następnego. Źródło pierwotne
 *      (dokument emitenta), ale rzadkie: jeden punkt w roku.
 *
 * ⚠️ TRZY PUŁAPKI, KTÓRE MUSI ROZSTRZYGAĆ KOD, NIE CZYTELNIK:
 *
 * • **Spadek procentu bez zbycia akcji.** Rejestracja nowej emisji rozwadnia
 *   wszystkich dotychczasowych akcjonariuszy: liczba akcji bez zmian, udział
 *   spada. W tabeli Bankiera wygląda to identycznie jak sprzedaż („10,39
 *   (-4,45)"). Dla opinii to różnica między „wyszedł z akcjonariatu” a „został
 *   rozwodniony" — rozstrzyga zestawienie z datą rejestracji emisji w KRS.
 *
 * • **Znak zmiany nie jest w tekście.** Bankier oznacza wzrost kolorem
 *   (`-positive`), a nie plusem: „404 834 164 (200 000 000)” to NABYCIE
 *   200 mln akcji. Parser czyta klasę, nie treść.
 *
 * • **Data zmiany bywa datą zmiany kapitału, nie transakcji.** Mówi o tym sam
 *   serwis w podpowiedzi przy kolumnie. Każdy wiersz stąd niesie tę adnotację.
 */

export type ZmianaAkcjonariatu = {
  data: string; // RRRR-MM-DD
  akcjonariusz: string;
  akcje: number | null;
  akcjeZmiana: number | null; // ze znakiem; null = serwis nie podał zmiany
  procent: number | null;
  procentZmiana: number | null;
  glosy: number | null;
  glosyZmiana: number | null;
  zrodlo: "bankier" | "sprawozdanie" | "zawiadomienie" | "wykaz_wza";
  plik?: string;
  /**
   * ⚠️ CZYJE AKCJE. W sprawie wieloinstrumentowej (ZASTAL: CSY i RSY) ten sam
   * podmiot bywa i akcjonariuszem, i emitentem: ZASTAL S.A. ma 61,48 % akcji RSY,
   * a jednocześnie 94,16 % akcji CSY należy do ZASTAL-u. Zestawienie bez tego
   * pola kładzie oba stany w jednej tabeli i sugeruje ciąg zmian tam, gdzie mowa
   * o dwóch różnych spółkach.
   */
  emitentAkcji?: string | null;
};

export type Emisja = {
  opis: string;
  akcjeEmisji: number | null;
  kapitalPoSzt: number | null;
  dataKrs: string | null;
  dataWza: string | null;
};

export type Kwalifikacja =
  | "nabycie" | "zbycie" | "rozwodnienie" | "objęcie emisji" | "bez zmiany" | "nieokreślone"
  /** Stan wykazany w raporcie z art. 70 pkt 3 — GŁOSY ZAREJESTROWANE NA WZA, nie stan posiadania. */
  | "stan na WZA";

export type ZdarzenieAkcjonariatu = ZmianaAkcjonariatu & {
  kwalifikacja: Kwalifikacja;
  uzasadnienie: string;
};

export type Tabela = { caption: string; head: string[]; rows: string[][] };

const pl = (v: number | null, frac = 0) =>
  v == null ? "—" : v.toLocaleString("pl-PL", { minimumFractionDigits: frac, maximumFractionDigits: frac });
const zeZnakiem = (v: number | null, frac = 0) => (v == null ? "—" : `${v > 0 ? "+" : ""}${pl(v, frac)}`);

// ── Parser strony Bankiera ────────────────────────────────────────────────

const bezZnacznikow = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** „404 834 164” → 404834164; „60,65” → 60.65; puste/„--” → null. */
export function liczba(tekst: string): number | null {
  const t = tekst.replace(/ /g, " ").replace(/[^\d,.\-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
  if (!t || t === "-" || t === ".") return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/**
 * Komórka Bankiera: wartość + opcjonalna zmiana w nawiasie, ze znakiem z KLASY.
 * Wzrost nie ma plusa w treści — `-positive` jest jedyną informacją o kierunku.
 */
function komorka(html: string): { wartosc: number | null; zmiana: number | null } {
  const wartosc = liczba(bezZnacznikow((html.match(/-value">([^<]*)</) ?? [])[1] ?? bezZnacznikow(html)));
  const zm = html.match(/-value-change\s+(-positive|-negative)">\(([^)]*)\)</);
  if (!zm) return { wartosc, zmiana: null };
  const surowa = liczba(zm[2]);
  if (surowa == null) return { wartosc, zmiana: null };
  const znak = zm[1] === "-negative" ? -1 : 1;
  return { wartosc, zmiana: znak * Math.abs(surowa) };
}

function wierszeTabeli(html: string): string[][] {
  return [...html.matchAll(/<tr[^>]*>([^]*?)<\/tr>/g)].map((m) =>
    [...m[1].matchAll(/<t[dh][^>]*>([^]*?)<\/t[dh]>/g)].map((c) => c[1]),
  );
}

/** Wszystkie tabele strony, w kolejności wystąpienia (surowy HTML komórek). */
function tabeleStrony(html: string): string[][][] {
  return [...html.matchAll(/<table[^>]*>([^]*?)<\/table>/g)].map((m) => wierszeTabeli(m[1]));
}

/**
 * Historia zmian w akcjonariacie ze strony „<spółka>/akcjonariat”.
 *
 * Rozpoznajemy tabelę po nagłówkach, nie po pozycji — układ strony serwisu
 * potrafi się zmienić, a cicho sparsowana nie ta tabela dałaby opinię opartą
 * na przypadkowych liczbach.
 */
export function parsujHistorieBankier(html: string): ZmianaAkcjonariatu[] {
  for (const tab of tabeleStrony(html)) {
    if (!tab.length) continue;
    const naglowek = tab[0].map((c) => bezZnacznikow(c).toLowerCase());
    const ma = (frag: string) => naglowek.some((h) => h.includes(frag));
    if (!(ma("nazwa") && ma("procent akcji") && ma("data zmiany"))) continue;
    const out: ZmianaAkcjonariatu[] = [];
    for (const w of tab.slice(1)) {
      if (w.length < 6) continue;
      const data = bezZnacznikow(w[5]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) continue; // „-- --” = brak daty (wiersz „Pozostali”)
      const akcje = komorka(w[1]);
      const proc = komorka(w[2]);
      const glosy = komorka(w[3]);
      const procG = komorka(w[4]);
      out.push({
        data,
        akcjonariusz: bezZnacznikow(w[0]),
        akcje: akcje.wartosc,
        akcjeZmiana: akcje.zmiana,
        procent: proc.wartosc,
        procentZmiana: proc.zmiana,
        glosy: glosy.wartosc,
        glosyZmiana: glosy.zmiana ?? procG.zmiana,
        zrodlo: "bankier",
      });
    }
    if (out.length) return out.sort((a, b) => b.data.localeCompare(a.data) || a.akcjonariusz.localeCompare(b.akcjonariusz));
  }
  return [];
}

/** Historia emisji kapitału — potrzebna, by odróżnić rozwodnienie od zbycia. */
export function parsujEmisjeBankier(html: string): Emisja[] {
  for (const tab of tabeleStrony(html)) {
    if (!tab.length) continue;
    const naglowek = tab[0].map((c) => bezZnacznikow(c).toLowerCase());
    if (!(naglowek.some((h) => h.includes("emisja")) && naglowek.some((h) => h.includes("kapitał")))) continue;
    const out: Emisja[] = [];
    for (const w of tab.slice(1)) {
      if (w.length < 5) continue;
      const daty = bezZnacznikow(w[4]);
      const krs = (daty.match(/KRS:\s*(\d{4}-\d{2}-\d{2})/) ?? [])[1] ?? null;
      const wza = (daty.match(/WZA:\s*(\d{4}-\d{2}-\d{2})/) ?? [])[1] ?? null;
      out.push({
        opis: bezZnacznikow(w[0]),
        akcjeEmisji: liczba((bezZnacznikow(w[1]).match(/([\d  .]+)\s*szt/) ?? [])[1] ?? ""),
        kapitalPoSzt: liczba((bezZnacznikow(w[3]).match(/([\d  .]+)\s*szt/) ?? [])[1] ?? ""),
        dataKrs: krs,
        dataWza: wza,
      });
    }
    if (out.length) return out;
  }
  return [];
}

// ── Kwalifikacja zdarzeń ──────────────────────────────────────────────────

/**
 * Nadaje każdej zmianie kwalifikację i jej uzasadnienie.
 *
 * Reguła rozwodnienia: procent spadł, liczba akcji się NIE zmieniła, a w oknie
 * `dniTolerancji` od daty zmiany zarejestrowano w KRS emisję. Wtedy spadek
 * udziału wynika z powiększenia kapitału, nie z rozporządzenia akcjami.
 */
export function kwalifikuj(zmiany: ZmianaAkcjonariatu[], emisje: Emisja[], dniTolerancji = 3): ZdarzenieAkcjonariatu[] {
  // ⚠️ TYLKO WIERSZE, KTÓRE FAKTYCZNIE EMITUJĄ AKCJE. Tabela operacji Bankiera
  // zawiera też wpisy bez emisji (np. „zmiana firmy z Boruta-Zachem SA na
  // Hub.Tech SA”, KRS 2021-02-23). Bez tego filtru wzrost pakietu Joyfix
  // uzasadniano zmianą nazwy spółki — zdanie prawdziwe co do daty i bezsensowne
  // co do treści. Gdy w oknie jest kilka emisji, bierzemy NAJBLIŻSZĄ.
  const dni = emisje
    .filter((e) => e.dataKrs && (e.akcjeEmisji ?? 0) > 0)
    .map((e) => ({ ...e, ts: Date.parse(e.dataKrs as string) }));
  const emisjaPrzy = (data: string) => {
    const ts = Date.parse(data);
    const wOknie = dni.filter((e) => Math.abs(e.ts - ts) <= dniTolerancji * 86400000);
    if (!wOknie.length) return null;
    return wOknie.reduce((a, b) => (Math.abs(b.ts - ts) < Math.abs(a.ts - ts) ? b : a));
  };
  return zmiany.map((z) => {
    // ⚠️ WYKAZ Z WZA TO NIE STAN POSIADANIA. Raport z art. 70 pkt 3 podaje głosy
    // ZAREJESTROWANE na zgromadzeniu; akcjonariusz może zgłosić część pakietu albo
    // nie przyjść wcale. Liczby stąd nie wchodzą do rachunku nabyć i zbyć.
    if (z.zrodlo === "wykaz_wza")
      return {
        ...z,
        kwalifikacja: "stan na WZA" as const,
        uzasadnienie:
          `wykaz akcjonariuszy z walnego zgromadzenia (art. 70 pkt 3): ${pl(z.akcje)} głosów ` +
          `zarejestrowanych, ${z.procent == null ? "udziału nie podano" : `${pl(z.procent, 2)} % ogólnej liczby głosów`}` +
          " — wielkość odnosi się do zgromadzenia, nie do stanu posiadania na ten dzień",
      };
    const em = emisjaPrzy(z.data);
    if (z.akcjeZmiana != null && z.akcjeZmiana > 0)
      return {
        ...z,
        kwalifikacja: em ? ("objęcie emisji" as const) : ("nabycie" as const),
        uzasadnienie: em
          ? `wzrost o ${pl(z.akcjeZmiana)} akcji zbiegł się z rejestracją emisji w KRS (${em.dataKrs}, ${em.opis}) — do rozstrzygnięcia, czy objęcie nowych akcji, czy nabycie na rynku`
          : `wzrost stanu posiadania o ${pl(z.akcjeZmiana)} akcji`,
      };
    if (z.akcjeZmiana != null && z.akcjeZmiana < 0)
      return { ...z, kwalifikacja: "zbycie", uzasadnienie: `spadek stanu posiadania o ${pl(Math.abs(z.akcjeZmiana))} akcji` };
    if (z.procentZmiana != null && z.procentZmiana < 0 && (z.akcjeZmiana == null || z.akcjeZmiana === 0))
      return {
        ...z,
        kwalifikacja: em ? "rozwodnienie" : "nieokreślone",
        uzasadnienie: em
          ? `udział spadł o ${pl(Math.abs(z.procentZmiana), 2)} p.p. przy NIEZMIENIONEJ liczbie akcji — skutek rejestracji emisji w KRS ${em.dataKrs} (${em.opis}), a nie rozporządzenia akcjami`
          : `udział spadł o ${pl(Math.abs(z.procentZmiana), 2)} p.p. przy niezmienionej liczbie akcji, a w aktach nie ma emisji zarejestrowanej w tym czasie — wymaga wyjaśnienia`,
      };
    if (z.procentZmiana != null && z.procentZmiana > 0 && (z.akcjeZmiana == null || z.akcjeZmiana === 0))
      return {
        ...z,
        kwalifikacja: "nieokreślone",
        uzasadnienie: `udział wzrósł o ${pl(z.procentZmiana, 2)} p.p. bez zmiany liczby akcji — możliwe umorzenie akcji albo korekta danych serwisu`,
      };
    return { ...z, kwalifikacja: "bez zmiany", uzasadnienie: "serwis odnotował stan bez zmiany względem poprzedniego wpisu" };
  });
}

// ── Tabele ────────────────────────────────────────────────────────────────

const KIERUNEK: Record<Kwalifikacja, string> = {
  "stan na WZA": "stan wykazany na WZA",
  nabycie: "nabycie",
  zbycie: "zbycie",
  rozwodnienie: "rozwodnienie (emisja)",
  "objęcie emisji": "objęcie emisji",
  "bez zmiany": "bez zmiany",
  nieokreślone: "do wyjaśnienia",
};

/** Tabela główna kroku: wiersz na każdą odnotowaną zmianę, dzień po dniu. */
export function tabelaHistorii(zdarzenia: ZdarzenieAkcjonariatu[], emitent?: string): Tabela | null {
  if (!zdarzenia.length) return null;
  return {
    caption:
      `Tabela. Historia zmian w stanie posiadania akcji${emitent ? ` ${emitent}` : ""} — stan po każdej ` +
      "odnotowanej zmianie, z kwalifikacją zdarzenia i źródłem",
    head: ["Data zmiany", "Akcjonariusz", "Liczba akcji", "Zmiana akcji", "Udział w kapitale", "Zmiana udziału", "Kwalifikacja", "Źródło"],
    // Chronologicznie od najnowszego — zdarzenia z różnych źródeł wpadają w kolejności
    // odczytu plików, a czytelnik tabeli akcjonariatu szuka ciągu dat, nie kolejności biegu.
    rows: [...zdarzenia]
      .sort((a, b) => b.data.localeCompare(a.data) || a.akcjonariusz.localeCompare(b.akcjonariusz))
      .map((z) => [
      z.data,
      z.akcjonariusz,
      pl(z.akcje),
      zeZnakiem(z.akcjeZmiana),
      z.procent == null ? "—" : `${pl(z.procent, 2)} %`,
      z.procentZmiana == null ? "—" : `${zeZnakiem(z.procentZmiana, 2)} p.p.`,
      KIERUNEK[z.kwalifikacja],
      z.zrodlo === "bankier"
        ? "Bankier.pl"
        : `${
            z.zrodlo === "zawiadomienie"
              ? "zawiadomienie o stanie posiadania"
              : z.zrodlo === "wykaz_wza"
                ? "wykaz akcjonariuszy na WZA"
                : "sprawozdanie zarządu"
          }` +
          `${z.plik ? ` (${z.plik})` : ""}`,
    ]),
  };
}

/** Dni, w których cokolwiek się zmieniło — skrót dla czytelnika opinii. */
export function tabelaDni(zdarzenia: ZdarzenieAkcjonariatu[]): Tabela | null {
  const wg = new Map<string, ZdarzenieAkcjonariatu[]>();
  for (const z of zdarzenia) {
    if (z.kwalifikacja === "bez zmiany") continue;
    if (!wg.has(z.data)) wg.set(z.data, []);
    wg.get(z.data)!.push(z);
  }
  if (!wg.size) return null;
  const dni = [...wg.keys()].sort((a, b) => b.localeCompare(a));
  return {
    caption: "Tabela. Dni, w których odnotowano zmianę w akcjonariacie — podmioty i charakter zmiany",
    head: ["Data", "Liczba zmian", "Podmioty", "Charakter"],
    rows: dni.map((d) => {
      const lista = wg.get(d)!;
      const rodzaje = [...new Set(lista.map((z) => KIERUNEK[z.kwalifikacja]))];
      return [d, String(lista.length), lista.map((z) => z.akcjonariusz).join(", "), rodzaje.join(", ")];
    }),
  };
}

export function tabelaEmisji(emisje: Emisja[]): Tabela | null {
  if (!emisje.length) return null;
  return {
    caption:
      "Tabela. Emisje akcji i zmiany kapitału zakładowego — podstawa odróżnienia spadku udziału wskutek " +
      "rozwodnienia od spadku wskutek zbycia akcji",
    head: ["Operacja", "Akcje emisji", "Kapitał po emisji (szt.)", "Uchwała WZA", "Rejestracja w KRS"],
    rows: emisje.map((e) => [e.opis, pl(e.akcjeEmisji), pl(e.kapitalPoSzt), e.dataWza ?? "—", e.dataKrs ?? "—"]),
  };
}

// ── Scalenie źródeł ───────────────────────────────────────────────────────

export type Rozbieznosc = {
  data: string;
  akcjonariusz: string;
  wgBankiera: number | null;
  wgSprawozdania: number | null;
  roznica: number | null;
};

/**
 * Zestawia stan wykazany w sprawozdaniu zarządu ze stanem, jaki na ten dzień
 * wynika z historii Bankiera. Rozbieżność NIE jest błędem do ukrycia — to
 * ustalenie: dwa źródła podają różne liczby i opinia musi to powiedzieć.
 */
export function porownajZeSprawozdaniem(
  bankier: ZmianaAkcjonariatu[],
  sprawozdania: ZmianaAkcjonariatu[],
): Rozbieznosc[] {
  const out: Rozbieznosc[] = [];
  const ten = (x?: string | null) => (x ?? "").trim().toLowerCase();
  for (const s of sprawozdania) {
    const wczesniejsze = bankier
      .filter(
        (b) =>
          b.akcjonariusz.toLowerCase() === s.akcjonariusz.toLowerCase() &&
          // porównujemy stan akcji TEGO SAMEGO emitenta
          (!ten(s.emitentAkcji) || !ten(b.emitentAkcji) || ten(b.emitentAkcji) === ten(s.emitentAkcji)) &&
          b.data <= s.data,
      )
      .sort((a, b) => b.data.localeCompare(a.data));
    const stan = wczesniejsze[0]?.akcje ?? null;
    // ⚠️ BRAK PUNKTU ODNIESIENIA TO NIE ROZBIEŻNOŚĆ. Gdy dla akcjonariusza nie ma
    // wcześniejszego zdarzenia, sprawozdanie jest pierwszym ujęciem jego stanu —
    // wpisywanie tego do tabeli różnic sugerowałoby sprzeczność źródeł tam,
    // gdzie jedno źródło po prostu milczy.
    if (stan == null) continue;
    if (s.akcje == null) continue;
    if (stan !== s.akcje)
      out.push({
        data: s.data,
        akcjonariusz: s.akcjonariusz,
        wgBankiera: stan,
        wgSprawozdania: s.akcje,
        roznica: stan != null && s.akcje != null ? s.akcje - stan : null,
      });
  }
  return out;
}

export function tabelaRozbieznosci(r: Rozbieznosc[]): Tabela | null {
  if (!r.length) return null;
  return {
    caption:
      "Tabela. Rozbieżności między stanem wykazanym w sprawozdaniu opisowym zarządu a stanem wynikającym " +
      "z historii serwisu Bankier.pl na ten sam dzień",
    head: ["Dzień bilansowy", "Akcjonariusz", "Wg sprawozdania zarządu", "Wg Bankier.pl", "Różnica"],
    rows: r.map((x) => [x.data, x.akcjonariusz, pl(x.wgSprawozdania), pl(x.wgBankiera), zeZnakiem(x.roznica)]),
  };
}

/** Uwagi metodyczne — wchodzą do rozdziału razem z tabelami. */
export function uwagiZrodel(zdarzenia: ZdarzenieAkcjonariatu[]): string[] {
  const ma = (z: ZmianaAkcjonariatu["zrodlo"]) => zdarzenia.some((x) => x.zrodlo === z);
  const uwagi: string[] = [];
  // Uwaga o serwisie ma sens tylko wtedy, gdy serwis w ogóle był źródłem. Spółki
  // wykluczone z obrotu (ZASTAL: CSY, RSY) nie mają strony w Bankier.pl i cała
  // historia pochodzi wtedy z dokumentów.
  if (ma("bankier"))
    uwagi.push(
      "Kolumna „Data zmiany” w serwisie Bankier.pl niesie jedną z dwóch dat: dzień zmiany liczby akcji " +
        "posiadanych przez akcjonariusza albo dzień zmiany wielkości kapitału spółki, która wpłynęła na jego " +
        "udział procentowy. Data z tej kolumny nie jest zatem tożsama z datą transakcji.",
      "Serwis Bankier.pl jest źródłem wtórnym — podaje stan według własnego opracowania zawiadomień. " +
        "Dowodem pozostają zawiadomienia o stanie posiadania i sprawozdania emitenta; zestawienie służy " +
        "ustaleniu dni, w których stan posiadania się zmienił.",
    );
  if (ma("zawiadomienie"))
    uwagi.push(
      "Zawiadomienia o stanie posiadania (art. 69 ustawy o ofercie publicznej) są źródłem PIERWOTNYM: " +
        "podają stan przed transakcją i po niej wprost, wraz z datą zdarzenia. Zmiany liczby akcji i udziału " +
        "wyliczono z tych dwóch stanów, nie przepisano z narracji dokumentu.",
    );
  if (ma("wykaz_wza"))
    uwagi.push(
      "Wykazy akcjonariuszy publikowane na podstawie art. 70 pkt 3 ustawy o ofercie podają liczbę głosów " +
        "ZAREJESTROWANYCH na walnym zgromadzeniu oraz jej stosunek do ogólnej liczby głosów. Akcjonariusz może " +
        "zgłosić do udziału część posiadanego pakietu albo nie stawić się wcale, dlatego wielkości te wyznaczają " +
        "DOLNĄ granicę stanu posiadania i nie służą do obliczania nabyć ani zbyć.",
    );
  if (ma("sprawozdanie"))
    uwagi.push(
      "Sprawozdania opisowe zarządu podają STAN na dzień bilansowy, a nie zmianę — służą kontroli " +
        "punktowej: czy stan wynikający z ciągu zawiadomień zgadza się z tym, co emitent wykazał na koniec roku.",
    );
  if (!ma("bankier"))
    uwagi.push(
      "Historii nie zasilono serwisem Bankier.pl. Dla instrumentu wykluczonego z obrotu serwis nie prowadzi " +
        "strony spółki, więc kompletność zestawienia zależy wyłącznie od dokumentów zgromadzonych w aktach — " +
        "brak zdarzenia w tabeli NIE oznacza, że zmiana nie nastąpiła.",
    );
  const doWyjasnienia = zdarzenia.filter((z) => z.kwalifikacja === "nieokreślone");
  if (doWyjasnienia.length)
    uwagi.push(
      `${doWyjasnienia.length} zmian(y) nie dają się zakwalifikować z samych danych serwisu ` +
        `(${[...new Set(doWyjasnienia.map((z) => z.data))].slice(0, 6).join(", ")}) — wymagają zestawienia ` +
        "z zawiadomieniami o stanie posiadania z akt sprawy.",
    );
  return uwagi;
}

/**
 * Dawne firmy (nazwy) emitenta — z tabeli operacji kapitałowych.
 *
 * ⚠️ POWÓD. Sprawozdania z akt są podpisane nazwą Z DNIA PUBLIKACJI. Hub.Tech S.A.
 * do 2021 r. nazywał się Boruta-Zachem S.A., więc kontrola „czy dokument dotyczy
 * emitenta” odrzucała jego własne sprawozdania sprzed zmiany firmy. Nazwy historyczne
 * stoją w danych, które i tak pobieramy: „zmiana firmy z Boruta-Zachem SA na Hub.Tech SA”.
 */
export function dawneNazwy(emisje: Emisja[]): string[] {
  const out: string[] = [];
  for (const e of emisje) {
    const m = e.opis.match(/zmiana firmy z\s+(.+?)\s+na\s+(.+?)\s*$/i);
    if (m) out.push(m[1].trim(), m[2].trim());
  }
  return [...new Set(out)];
}

/** Czy nazwa spółki z dokumentu pasuje do emitenta albo którejś z jego dawnych firm. */
export function toSamaSpolka(zDokumentu: string, nazwy: string[]): boolean {
  const rdzen = (s: string) => s.toLowerCase().replace(/[^a-ząćęłńóśźż0-9]/g, "");
  const d = rdzen(zDokumentu);
  if (!d) return true; // model nie podał nazwy — nie zgadujemy, przepuszczamy
  return nazwy.some((n) => {
    const r = rdzen(n);
    return r.length >= 5 && (d.includes(r) || r.includes(d));
  });
}

/** Emitenci, których akcji dotyczą zdarzenia (puste = nieoznaczone). */
export function emitenciZdarzen(zdarzenia: ZdarzenieAkcjonariatu[]): string[] {
  return [...new Set(zdarzenia.map((z) => (z.emitentAkcji ?? "").trim()).filter(Boolean))].sort();
}

/**
 * Tabele historii ODRĘBNIE DLA AKCJI KAŻDEGO EMITENTA.
 *
 * ⚠️ Bez tego podziału w jednym zestawieniu stoją obok siebie akcjonariusze RSY
 * (CSY S.A. 32,98 %) i akcjonariusze CSY (ZASTAL S.A. 94,16 %) — czytelnik widzi
 * ciąg zmian, a to dwie niezależne struktury właścicielskie.
 */
export function tabeleHistoriiWgEmitenta(zdarzenia: ZdarzenieAkcjonariatu[]): Tabela[] {
  const emitenci = emitenciZdarzen(zdarzenia);
  if (emitenci.length <= 1) {
    const t = tabelaHistorii(zdarzenia, emitenci[0]);
    return t ? [t] : [];
  }
  const out: Tabela[] = [];
  for (const e of emitenci) {
    const t = tabelaHistorii(zdarzenia.filter((z) => (z.emitentAkcji ?? "").trim() === e), e);
    if (t) out.push(t);
  }
  const bez = zdarzenia.filter((z) => !(z.emitentAkcji ?? "").trim());
  if (bez.length) {
    const t = tabelaHistorii(bez);
    // Zdarzenia bez wskazanego emitenta idą osobno i są tak podpisane — cicho
    // dołożone do którejkolwiek spółki byłyby przypisaniem bez podstawy.
    if (t) out.push({ ...t, caption: `${t.caption} [emitenta nie ustalono z dokumentu]` });
  }
  return out;
}
