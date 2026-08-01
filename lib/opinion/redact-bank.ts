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
    "Współczynniki kapitałowe w szeregu czasowym wraz z progami obowiązującymi W DANYM OKRESIE. " +
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
