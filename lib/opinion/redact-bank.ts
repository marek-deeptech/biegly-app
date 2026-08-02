// Redakcja prozy rozdziałów ANALIZY w dziedzinie bankowej — OSOBNY builder promptu.
//
// DLACZEGO OSOBNY, A NIE GAŁĄŹ W redact.ts:
// Prompt GPW każe zakotwiczyć wywód w art. 12 MAR i załączniku II do rozporządzenia
// 2016/522, a rozbicie per sesja opisać dzień po dniu. W opinii o ryzyku kredytowym
// banku nie ma ani sesji giełdowych, ani MAR — jest data zdarzenia, stan prawny z tej
// daty i proces decyzyjny. Wspólny prompt z warunkami rozjechałby się przy pierwszej
// zmianie w którejkolwiek dziedzinie, a te opinie idą do sądu w toczących się sprawach.
//
// ZASADA WSPÓLNA obu dziedzinom i tu powtórzona: model REDAGUJE, ale NIE LICZY.
// Liczby pochodzą z tabel silnika i mają być przepisane dokładnie.
import type { BankModul } from "@/lib/domain/prawo-bankowe";

export const BANK_REDACT_KINDS = [
  "makro",
  "sygnaly_rynkowe",
  "media",
  "ekspozycja_sektor",
  "sprawozdania",
  "wskazniki_bank",
  "limity",
  "procedury",
  "otoczenie_prawne",
] as const;
export type BankRedactKind = (typeof BANK_REDACT_KINDS)[number];

/** Cel rozdziału — co ma rozstrzygnąć, a czego nie wolno mu przesądzać. */
const CEL: Record<BankRedactKind, string> = {
  makro:
    "Otoczenie makroekonomiczne kraju kontrahenta w okresie poprzedzającym zdarzenie: inflacja, kursy " +
    "walutowe, stopy procentowe. Rozdział ustala, JAKIE SYGNAŁY BYŁY PUBLICZNIE DOSTĘPNE w dniu decyzji — " +
    "nie to, czy bank je znał (to wynika z dokumentów wewnętrznych, rozdział o procesie decyzyjnym).",
  sygnaly_rynkowe:
    "Rynkowa wycena ryzyka kontrahenta: spready CDS oraz ratingi i ich perspektywy. Spread CDS jest ceną " +
    "zabezpieczenia przed niewypłacalnością, więc jego skokowy wzrost to sygnał dostępny każdemu " +
    "uczestnikowi rynku. Omów poziomy i dynamikę, a nie samą wartość końcową.",
  media:
    "Publikacje prasowe dostępne przed dniem zdarzenia. Rozdział ustala stan wiedzy POWSZECHNIE DOSTĘPNEJ. " +
    "Referuj treść publikacji, nie oceniaj ich trafności ani nie wnioskuj z nich o wiedzy banku.",
  ekspozycja_sektor:
    "Skala sektora bankowego kraju kontrahenta wobec jego gospodarki — relacja aktywów sektora do PKB " +
    "oraz zdolność banku centralnego do pełnienia roli pożyczkodawcy ostatniej instancji. To rozdział " +
    "o granicy wsparcia publicznego, a nie o kondycji pojedynczego banku.",
  sprawozdania:
    "Analiza pozycji sprawozdań finansowych kontrahenta za okresy poprzedzające zdarzenie: wynik odsetkowy, " +
    "zysk netto, struktura finansowania (depozyty wobec finansowania hurtowego), jakość portfela. " +
    "Wskaż, co dało się odczytać ze sprawozdań DOSTĘPNYCH W DNIU DECYZJI.",
  wskazniki_bank:
    "Współczynniki kapitałowe KONTRAHENTA w szeregu czasowym wraz z progami obowiązującymi W DANYM "
    + "OKRESIE. " +
    "Omów zarówno poziom, jak i TENDENCJĘ — spadek bufora przy formalnie spełnionym progu jest ustaleniem " +
    "istotnym. Gdy dla wskaźnika w danym okresie progu nie było, powiedz to wprost zamiast milczeć.",
  limity:
    "Metodyka wyznaczania limitów zaangażowania, ich wysokość względem funduszy własnych i tryb " +
    "zatwierdzania, zestawione z limitem regulacyjnym obowiązującym w dacie zdarzenia.",
  procedury:
    "Chronologia procesu decyzyjnego odtworzona z dokumentów wewnętrznych: kto, kiedy i na jakiej podstawie " +
    "decydował, co zgłaszały jednostki ryzyka i audyt. Referuj ustalenia dokumentów; ocena prawidłowości " +
    "procesu należy do rozdziału o otoczeniu prawnym i do wniosków.",
  otoczenie_prawne:
    "Przepisy obowiązujące W DACIE ZDARZENIA oraz wymagane standardy identyfikacji i oceny ryzyka " +
    "kredytowego. To jest miejsce na zestawienie praktyki banku z wymogiem prawnym.",
};

export type BankRedactInput = {
  kind: BankRedactKind;
  title: string;
  caseName: string;
  signature: string | null;
  /** Data ocenianego zdarzenia — wyznacza właściwy stan prawny. */
  dzienZdarzenia: string | null;
  tableText: string | null;
  findings: string[];
  inventory: string[];
  /** Przepisy z DATOWANEGO katalogu, właściwe dla tego modułu i tej daty. */
  przepisy: string[];
  /** Przepisy późniejsze niż zdarzenie — do jawnego zakazu powoływania. */
  anachroniczne: string[];
  /** Wartości doliczone z tożsamości — użyteczne, wymagają ujawnienia pochodzenia. */
  uwagi?: string[];
  /** Odczyt niewiarygodny — na takiej wartości nie wolno budować oceny. */
  zastrzezenia?: string[];
  /**
   * Pliki, z których policzono wartości — WYMAGANE przy modułach liczbowych.
   *
   * ⚠️ POWÓD: bez nich model nie wie, CZYJE są te liczby, i przypisuje je bankowi
   * z nazwy sprawy. W sprawie MBR wygenerowana proza mówiła o „współczynnikach
   * kapitałowych banku MBR” i stosowała do nich Uchwałę nr 1/2007 KNB — a były to
   * współczynniki Glitnira, odczytane z jego sprawozdań. Opinia przypisywałaby
   * pozycję kapitałową islandzkiego kontrahenta oskarżonemu polskiemu bankowi
   * i osądzała ją polskim prawem.
   */
  zrodla?: string[];
};

const SYSTEM =
  "Jesteś biegłym sądowym z zakresu bankowości i finansów, sporządzającym opinię w sprawie karnej " +
  "na zlecenie prokuratury. Piszesz rzeczowo, bezosobowo, w czasie przeszłym, bez ozdobników. " +
  "ZASADY BEZWZGLĘDNE: (1) NIE LICZYSZ — wszystkie wartości liczbowe pochodzą z podanych tabel silnika " +
  "i przepisujesz je dokładnie; czego nie ma w danych, oznaczasz [do uzupełnienia] zamiast zmyślać. " +
  "(2) NIE PRZESĄDZASZ o winie ani zamiarze — ustalasz fakty i oceniasz je wobec wymogu prawnego; " +
  "kwalifikacja czynu należy do organu. (3) Stan prawny bierzesz z DATY ZDARZENIA, nigdy z dnia " +
  "sporządzania opinii. (4) Piszesz o tym, co było dostępne w dniu decyzji — nie oceniasz z perspektywy " +
  "późniejszych zdarzeń, bo to byłoby wnioskowanie wsteczne.";

export function buildBankRedactPrompt(inp: BankRedactInput): { system: string; user: string } {
  const parts: string[] = [];
  parts.push(`Zredaguj rozdział analizy opinii biegłego: „${inp.title}".`);
  parts.push(`Sprawa: ${inp.caseName}${inp.signature ? ` (sygn. ${inp.signature})` : ""}.`);
  if (inp.dzienZdarzenia)
    parts.push(
      `Data ocenianego zdarzenia: ${inp.dzienZdarzenia}. Cała ocena odnosi się do stanu wiedzy i stanu ` +
        "prawnego z TEGO dnia.",
    );
  parts.push(`Cel rozdziału: ${CEL[inp.kind]}`);

  if (inp.przepisy.length)
    parts.push(
      "Przepisy OBOWIĄZUJĄCE w dacie zdarzenia — powołuj wyłącznie te:\n" +
        inp.przepisy.map((p) => "- " + p).join("\n"),
    );
  if (inp.anachroniczne.length)
    parts.push(
      "ZAKAZ POWOŁYWANIA — poniższe przepisy weszły w życie PÓŹNIEJ niż oceniane zdarzenie. " +
        "Odwołanie się do nich byłoby błędem merytorycznym:\n" +
        inp.anachroniczne.map((p) => "- " + p).join("\n"),
    );

  // CZYJE SĄ TE LICZBY — przed tabelą, bo to warunek poprawnego odczytania tabeli.
  if (inp.zrodla?.length)
    parts.push(
      "PODMIOT, KTÓREGO DOTYCZĄ WARTOŚCI. Wartości w tabeli policzono ze sprawozdań:\n" +
        inp.zrodla.map((z) => "- " + z).join("\n") +
        "\nPodmiotem, którego dotyczą, jest WYSTAWCA tych sprawozdań. NIE zakładaj, że jest nim bank " +
        "wskazany w nazwie sprawy: nazwa sprawy oznacza POSTĘPOWANIE, a w sprawach o ryzyko kredytowe " +
        "analizowane sprawozdania należą z reguły do KONTRAHENTA, którego kondycję bank miał ocenić. " +
        "Nazywaj podmiot tak, jak wynika ze wskazanych plików, a gdy nie da się tego ustalić — pisz " +
        "„kontrahent” zamiast zgadywać.",
    );
  if (inp.przepisy.length && inp.zrodla?.length)
    parts.push(
      "PRÓG REGULACYJNY A PODMIOT ZAGRANICZNY. Podane progi wynikają z prawa polskiego i wiążą bank " +
        "polski. Jeżeli analizowane sprawozdania należą do podmiotu zagranicznego, odnoś jego wskaźniki " +
        "do progu jako do MIARY PORÓWNAWCZEJ, a nie jako do normy, której ten podmiot podlegał — " +
        "napisanie, że kontrahent zagraniczny „spełniał” albo „naruszał” polski próg, byłoby błędem.",
    );
  if (inp.tableText)
    parts.push(
      "Dane z deterministycznego silnika. Przepisz wartości DOKŁADNIE i omów tabelę pozycja po pozycji — " +
        "okres po okresie — wskazując poziomy, tendencję i ich znaczenie:\n" +
        inp.tableText,
    );
  if (inp.zastrzezenia?.length)
    parts.push(
      "ODCZYT NIEWIARYGODNY — te wartości mogą być błędne i NIE WOLNO na nich opierać oceny. " +
        "Wymień je w tekście jako wymagające weryfikacji w oryginale sprawozdania:\n" +
        inp.zastrzezenia.map((u) => "- " + u).join("\n"),
    );
  if (inp.uwagi?.length)
    parts.push(
      "WARTOŚCI DOLICZONE Z TOŻSAMOŚCI — wolno ich używać, ale przy powołaniu ujawnij, że pochodzą " +
        "z odejmowania składników, a nie z odczytu wprost:\n" +
        inp.uwagi.map((u) => "- " + u).join("\n"),
    );
  if (inp.findings.length)
    parts.push("Ustalenia cząstkowe do rozwinięcia w prozę:\n" + inp.findings.map((f) => "- " + f).join("\n"));
  if (inp.inventory.length)
    parts.push(
      "Dokumenty w aktach (powołuj się rodzajowo; nie zmyślaj innych):\n" +
        inp.inventory.map((f) => "- " + f).join("\n"),
    );

  parts.push(
    "Struktura rozdziału: (1) wprowadzenie — czego rozdział dotyczy i z jakiego materiału wynika, " +
      "(2) omówienie danych pozycja po pozycji z interpretacją, (3) zestawienie z wymogiem prawnym " +
      "obowiązującym w dacie zdarzenia, (4) wniosek cząstkowy — co z tego wynika dla oceny procesu " +
      "identyfikacji ryzyka. Objętość: 6–12 akapitów. Zwróć samą treść rozdziału, bez nagłówka.",
  );
  return { system: SYSTEM, user: parts.join("\n\n") };
}

/** Moduł analizy pakietu bankowego, do którego należy dany rodzaj rozdziału. */
export function modulDla(kind: BankRedactKind): BankModul | "adekwatnosc" {
  return kind === "wskazniki_bank" ? "adekwatnosc" : (kind as BankModul);
}

type Tbl = { caption?: string; head?: string[]; rows?: string[][] };
type ZapisanaSub = { kind: string; title: string; data?: Record<string, unknown> | null };

const MAX_W = 120;

/**
 * Tekst wszystkich tabel modułu do promptu.
 *
 * WSZYSTKICH, nie tylko pierwszej: moduły zapisują ich kilka i druga bywa tą istotną —
 * publikacje PO zdarzeniu oraz przepisy późniejsze mają w podpisie ostrzeżenie, że nie
 * wolno ich użyć do oceny stanu z dnia decyzji. Ucięcie długiej tabeli jest WIDOCZNE
 * w promptcie; milczące skrócenie czytałoby się jak komplet danych.
 */
function tabeleModulu(data: Record<string, unknown> | null | undefined): string | null {
  const wiele = (data?.tables as Tbl[] | undefined) ?? [];
  const tabele = (wiele.length ? wiele : ([data?.table as Tbl | undefined].filter(Boolean) as Tbl[])).filter(
    (x) => x?.head?.length && x.rows?.length,
  );
  const bloki = tabele.map((x) => {
    const widoczne = (x.rows ?? []).slice(0, MAX_W);
    const ogon =
      (x.rows?.length ?? 0) > MAX_W
        ? `\n[…] pominięto ${(x.rows?.length ?? 0) - MAX_W} dalszych wierszy — omów zakres, nie każdy wiersz`
        : "";
    return `${x.caption ? x.caption + ":\n" : ""}${(x.head ?? []).join(" | ")}\n${widoczne
      .map((r) => r.join(" | "))
      .join("\n")}${ogon}`;
  });
  return bloki.length ? bloki.join("\n\n") : null;
}

/**
 * Wejście promptu redakcji bankowej — CZYSTA funkcja, bez bazy.
 *
 * Wspólna dla trasy i dla uruchomienia wsadowego. Wcześniej trasa składała to wejście
 * u siebie, a każde uruchomienie poza serwerem odtwarzało je w skrypcie — i przy
 * pierwszej poprawce (dodaniu `zrodla`, po którym model przestał przypisywać
 * sprawozdania kontrahenta oskarżonemu bankowi) kopia się rozjechała.
 */
export function wejscieBankowe(args: {
  kind: BankRedactKind;
  sub: ZapisanaSub;
  caseRow: { name: string; signature: string | null };
  /** Wszystkie subanalizy sprawy — z `limity` bierzemy datę zdarzenia. */
  subs: { kind: string; data?: Record<string, unknown> | null }[];
  /** doc_type → liczba dokumentów w aktach. */
  licznikTypow: Record<string, number>;
  przepisyNaDzien: (dzien: string, modul?: never) => { ref: string; zakres: string }[];
  przepisyAnachroniczne: (dzien: string) => { ref: string; od: string; moduly: string[] }[];
}): BankRedactInput {
  const { kind, sub, caseRow, subs, licznikTypow } = args;
  const dzien =
    (subs.find((s) => s.kind === "limity")?.data as { dzienZdarzenia?: string | null } | undefined)
      ?.dzienZdarzenia ?? null;
  const modul = modulDla(kind);
  const d = sub.data ?? {};
  return {
    kind,
    title: sub.title,
    caseName: caseRow.name,
    signature: caseRow.signature,
    dzienZdarzenia: dzien,
    tableText: tabeleModulu(d),
    findings: (d.findings ?? []) as string[],
    inventory: Object.entries(licznikTypow)
      .filter(([k]) => !["UNKNOWN", "GRAFIKA"].includes(k))
      .map(([k, v]) => `${v} × ${k}`),
    przepisy: dzien ? args.przepisyNaDzien(dzien, modul as never).map((x) => `${x.ref} — ${x.zakres}`) : [],
    // ⚠️ WSZYSTKIE akty późniejsze, nie tylko przypisane do tego modułu.
    // Filtrowanie po module zostawiało luki: rozdział `makro` nie dostawał w zakazie
    // dyrektywy CRD IV, bo nie jest ona tagowana jako moduł makroekonomiczny — i model
    // powołał „CRD IV, art. 84, 2013" jako miernik oceny zdarzenia z 2008 r. Zakaz
    // powoływania przepisu późniejszego nie zależy od tego, którego rozdziału dotyczy.
    anachroniczne: dzien
      ? args.przepisyAnachroniczne(dzien).map((x) => `${x.ref} (obowiązuje od ${x.od})`)
      : [],
    uwagi: (d.uwagi ?? []) as string[],
    zastrzezenia: (d.zastrzezenia ?? []) as string[],
    // Pliki źródłowe → z nich model ustala, CZYJE są liczby. Bez tego przypisywał
    // sprawozdania kontrahenta bankowi z nazwy sprawy.
    zrodla: ((d.zrodla ?? []) as { plik?: string }[]).map((z) => String(z?.plik ?? "")).filter(Boolean),
  };
}

/**
 * Wstęp teoretyczny opinii bankowej (rozdz. IV).
 *
 * ⚠️ POWÓD ISTNIENIA: bez niego rozdział IV opinii bankowej powstawał promptem GPW.
 * W sprawie MBR dało to 14 504 znaki wywodu o integralności rynku regulowanego,
 * rozporządzeniu MAR, wash trades i spoofingu — w opinii o lokacie międzybankowej,
 * bez ani jednego słowa o banku. Rozdział wyglądał na kompletny i przeszedłby do sądu.
 *
 * Rozdział jest TEORETYCZNY: buduje aparat pojęciowy, którym posługują się rozdziały
 * analizy. Nie wolno mu przesądzać ustaleń tej sprawy — te należą do rozdziału V.
 */
export function buildBankProzaIIIPrompt(inp: {
  caseName: string;
  signature: string | null;
  dzienZdarzenia: string | null;
  /** Przepisy obowiązujące w dacie zdarzenia — aparat pojęciowy ma być z tego stanu prawnego. */
  przepisy: string[];
  anachroniczne: string[];
  /** Moduły analizy obecne w sprawie — wstęp ma przygotować pojęcia właśnie do nich. */
  moduly: string[];
}): { system: string; user: string } {
  const system =
    "Jesteś biegłym sądowym z zakresu bankowości i finansów. Piszesz rozdział WSTĘPNY opinii " +
    "w sprawie karnej — ujęcie teoretyczne, które buduje aparat pojęciowy dla dalszej analizy. " +
    "ZASADY BEZWZGLĘDNE: (1) NIE PRZYTACZASZ ustaleń tej sprawy ani żadnych jej liczb — rozdział " +
    "jest ogólny, ustalenia należą do rozdziału analizy. (2) NIE PRZESĄDZASZ oceny postępowania " +
    "banku. (3) Stan prawny i standardy opisujesz z DATY OCENIANEGO ZDARZENIA; instytucje " +
    "wprowadzone później możesz wymienić wyłącznie z zaznaczeniem, że wówczas nie obowiązywały. " +
    "(4) Piszesz rzeczowo i bezosobowo, bez ozdobników.";

  const p: string[] = [];
  p.push(
    `Napisz rozdział „Wstęp — ujęcie teoretyczne" opinii biegłego w sprawie ${inp.caseName}` +
      `${inp.signature ? ` (sygn. ${inp.signature})` : ""}. Przedmiotem sprawy jest ocena sposobu ` +
      "identyfikacji ryzyka przez bank przy ekspozycji wobec innej instytucji finansowej.",
  );
  if (inp.dzienZdarzenia)
    p.push(`Stan prawny i standardy opisujesz według stanu na ${inp.dzienZdarzenia}.`);
  p.push(
    "Zakres rozdziału — omów kolejno:\n" +
      "1. Ryzyko kredytowe i ryzyko kontrahenta w działalności bankowej; lokata międzybankowa " +
      "jako EKSPOZYCJA KREDYTOWA, a nie operacja płynnościowa pozbawiona ryzyka.\n" +
      "2. Obowiązek identyfikacji, pomiaru, monitorowania i kontroli ryzyka jako element systemu " +
      "zarządzania bankiem — czemu służy i na czym polega.\n" +
      "3. Miary kondycji kontrahenta: adekwatność kapitałowa i jej składniki, struktura finansowania " +
      "(baza depozytowa wobec finansowania hurtowego), jakość portfela, rentowność. Co każda z nich " +
      "mówi, a czego nie mówi.\n" +
      "4. Limity zaangażowania i koncentracji jako narzędzie ograniczania ryzyka; relacja limitu " +
      "wewnętrznego do regulacyjnego.\n" +
      "5. Źródła informacji o kontrahencie dostępne bankowi: sprawozdania finansowe, oceny agencji " +
      "ratingowych, rynkowa wycena ryzyka (spread CDS), publikacje prasowe, raporty banku centralnego " +
      "kraju kontrahenta. Ich dostępność i ograniczenia.\n" +
      "6. ZASADA OCENY NA DATĘ ZDARZENIA — dlaczego postępowanie ocenia się wiedzą i prawem z dnia " +
      "decyzji, a nie z perspektywy tego, co wydarzyło się później.",
  );
  if (inp.moduly.length)
    p.push(
      "Rozdziały analizy, do których wstęp ma przygotować pojęcia (nie streszczaj ich ustaleń):\n" +
        inp.moduly.map((m) => "- " + m).join("\n"),
    );
  if (inp.przepisy.length)
    p.push(
      "Przepisy obowiązujące w dacie zdarzenia — z nich buduj aparat pojęciowy:\n" +
        inp.przepisy.map((x) => "- " + x).join("\n"),
    );
  if (inp.anachroniczne.length)
    p.push(
      "Akty PÓŹNIEJSZE niż oceniane zdarzenie. Możesz wspomnieć o nich wyłącznie dla pokazania " +
        "ciągłości regulacji i ZAWSZE z zaznaczeniem, że wówczas nie obowiązywały; nie wolno ich " +
        "przedstawić jako miernika oceny:\n" +
        inp.anachroniczne.map((x) => "- " + x).join("\n"),
    );
  p.push(
    "Objętość: 10–16 akapitów. Zwróć samą treść rozdziału, bez nagłówka. Nie używaj pojęć z zakresu " +
      "manipulacji instrumentami finansowymi (MAR, wash trades, spoofing, sesja giełdowa) — nie mają " +
      "one w tej sprawie zastosowania.",
  );
  return { system, user: p.join("\n\n") };
}
