// Budowa promptu dla redakcji rozdziałów „miękkich" (I, III, V) przez model.
// Zasada: model REDAGUJE prozę, ale NIE liczy i NIE wymyśla — liczby i fakty
// pochodzą z silnika i są wstrzykiwane do promptu; model ma ich nie zmieniać.
// Czysta funkcja (bez SDK), żeby dało się ją testować.

export type RedactChapter = "I" | "III" | "V";

export const REDACT_META: Record<RedactChapter, { kind: string; chapterNo: string; title: string }> = {
  I: { kind: "proza_i", chapterNo: "I", title: "Przedmiot i podstawa prawna opinii" },
  III: { kind: "proza_iii", chapterNo: "III", title: "Wstęp — ujęcie teoretyczne" },
  V: { kind: "proza_v", chapterNo: "V", title: "Podsumowanie" },
};

export type RedactInput = {
  chapter: RedactChapter;
  caseName: string;
  signature: string | null;
  period: string | null;
  facts: string[]; // ugruntowane fakty liczbowe z silnika
  approved: { title: string; findings: string[] }[]; // zatwierdzone wnioski IV.x
  legalBasis: string[];
  library?: string[]; // definicje z biblioteki prawnej (rozdz. III — do wiernego przytoczenia)
};

const SYSTEM =
  "Jesteś asystentem biegłego sądowego specjalizującego się w manipulacji instrumentami finansowymi na GPW. " +
  "Redagujesz fragment opinii dla prokuratury i sądu poprawną, formalną polszczyzną prawniczą. " +
  "ZASADY BEZWZGLĘDNE: " +
  "(1) Nie wymyślaj liczb, dat, nazw ani faktów — używaj wyłącznie danych podanych w poleceniu; liczby przepisuj dokładnie w tej samej postaci. " +
  "(2) Nie przesądzaj o winie, zamiarze ani o kwalifikacji prawnokarnej — to wyłączna domena sądu; oddzielaj ustalenia faktyczne od ocen. " +
  "(3) Czego nie wiesz, oznacz nawiasem kwadratowym, np. [oznaczenie spółki], [pytania postanowienia] — nigdy nie zmyślaj danych sprawy. " +
  "(4) Unikaj sformułowań przesądzających typu „jednoznacznie”, „bez wątpienia”, „udowodniono”. " +
  "(5) Zwróć wyłącznie treść rozdziału prozą, bez nagłówka i bez komentarzy od siebie.";

export function buildRedactPrompt(inp: RedactInput): { system: string; user: string } {
  const meta = REDACT_META[inp.chapter];
  const parts: string[] = [];
  parts.push(`Zredaguj rozdział „${meta.title}" opinii biegłego sądowego.`);
  parts.push(`Sprawa: ${inp.caseName}${inp.signature ? ` (sygn. ${inp.signature})` : ""}.`);
  if (inp.period) parts.push(`Okres objęty analizą: ${inp.period}.`);
  if (inp.facts.length)
    parts.push("Ustalone fakty liczbowe (z deterministycznego silnika — przepisz dokładnie, nie zmieniaj):\n" +
      inp.facts.map((f) => "- " + f).join("\n"));
  if (inp.library?.length)
    parts.push(
      "Biblioteka prawna — definicje technik do WIERNEGO przytoczenia i rozwinięcia (każda odrębnie):\n" +
        inp.library.map((l) => "- " + l).join("\n"),
    );
  if (inp.approved.length)
    parts.push("Zatwierdzone wnioski cząstkowe z rozdziału IV:\n" +
      inp.approved.map((a) => `• ${a.title}: ${a.findings.join(" ")}`).join("\n"));
  parts.push("Podstawa prawna sprawy: " + inp.legalBasis.join("; ") + ".");

  if (inp.chapter === "I")
    parts.push(
      "Opisz przedmiot opinii oraz podstawę prawną. Czego nie wiesz — oznaczenie spółki i instrumentu, " +
        "dokładny okres oraz pytania postanowienia o powołaniu biegłego — oznacz w nawiasach kwadratowych. Nie zmyślaj.",
    );
  if (inp.chapter === "III")
    parts.push(
      "Napisz obszerny wstęp teoretyczno-prawny (rozdział III opinii) o manipulacji instrumentami finansowymi, " +
        "w strukturze: (1) integralność rynku regulowanego i cel rozporządzenia MAR; (2) konstrukcja art. 12 MAR " +
        "(ust. 1 i 2) oraz wskaźniki manipulacji z załącznika I MAR i załącznika II rozporządzenia delegowanego " +
        "(UE) 2016/522; (3) odpowiedzialność karna — art. 183 ustawy o obrocie instrumentami finansowymi i relacja " +
        "prawa krajowego do unijnego; (4) mikrostruktura rynku: arkusz zleceń, kształtowanie kursu, płynność i " +
        "wolumen jako nośniki sygnałów dla uczestników obrotu; (5) KAŻDĄ technikę z biblioteki omów w 2–3 " +
        "akapitach — wierna definicja, mechanizm działania krok po kroku, właściwe wskaźniki z załącznika II " +
        "2016/522, wpływ na obraz podaży, popytu i płynności; (6) manipulacja informacją i jej związek z technikami " +
        "transakcyjnymi; (7) działanie wspólnie i w porozumieniu (koordynacja rachunków, znaczenie zbieżności " +
        "czasowej i technicznej); (8) metodyka badania biegłego — dane transakcyjne, wskaźniki ilościowe, granice " +
        "wnioskowania. To rozdział OGÓLNY — nie odwołuj się do liczb, dat ani podmiotów tej sprawy.",
    );
  if (inp.chapter === "V")
    parts.push(
      "Napisz podsumowanie syntetyzujące ustalenia analizy. Wyraźnie oddziel ustalenia faktyczne (co pokazują dane) od ocen " +
        "zastrzeżonych dla sądu (kwalifikacja prawnokarna, zamiar, wina konkretnych osób).",
    );

  parts.push(
    inp.chapter === "III"
      ? "Objętość: 14–20 akapitów (obszerny rozdział teoretyczny). Styl: formalny, bezosobowy, prawniczy. Zwróć samą treść rozdziału."
      : "Objętość: 2–4 akapity. Styl: formalny, bezosobowy, prawniczy. Zwróć samą treść rozdziału.",
  );
  return { system: SYSTEM, user: parts.join("\n\n") };
}

// ── Redakcja rozdziału II „Wnioski" — synteza odpowiedzi na pytania postanowienia ──
// Szkielet z generatora (liczby z silnika + odesłania do rozdziałów IV.x) jest
// jedynym źródłem faktów; model rozpisuje go w prozę odpowiadającą wprost na Q1–Q4.
export type WnioskiRedactInput = {
  caseName: string;
  signature: string | null;
  period: string | null;
  caseIntro?: string | null; // oznaczenie sprawy/spółki/instrumentu z rozdz. I
  questions: string[];
  skeleton: string; // szkielet ustaleń z generatora — liczby przepisywać dokładnie
  techniques: { title: string; findings: string[] }[]; // zatwierdzone rozdziały IV
  relations: string[]; // sygnały współdziałania (IP / pary IMO / KRS)
  events: string[]; // datowane zdarzenia korporacyjne (ESPI)
};

export function buildWnioskiRedactPrompt(inp: WnioskiRedactInput): { system: string; user: string } {
  const parts: string[] = [];
  parts.push(
    `Zredaguj rozdział II. „Wnioski" opinii biegłego sądowego — sekcję, którą prokurator czyta w pierwszej kolejności.`,
  );
  parts.push(`Sprawa: ${inp.caseName}${inp.signature ? ` (sygn. ${inp.signature})` : ""}.`);
  if (inp.period) parts.push(`Okres objęty analizą: ${inp.period}.`);
  if (inp.caseIntro)
    parts.push(
      "Oznaczenie sprawy, spółki i instrumentu (z rozdziału I — stosuj te oznaczenia; NIE używaj placeholderów " +
        "typu [oznaczenie spółki]):\n" + inp.caseIntro,
    );
  parts.push(
    "Pytania postanowienia — rozdział musi odpowiedzieć wprost na każde z nich, w tej kolejności:\n" +
      inp.questions.map((q) => "- " + q).join("\n"),
  );
  parts.push(
    "Szkielet ustaleń (liczby z deterministycznego silnika — przepisz DOKŁADNIE; zachowaj odesłania do rozdziałów IV.x):\n" +
      inp.skeleton,
  );
  if (inp.techniques.length)
    parts.push(
      "Zatwierdzone ustalenia rozdziałów IV:\n" +
        inp.techniques.map((t) => `• ${t.title}: ${t.findings.join(" ")}`).join("\n"),
    );
  if (inp.relations.length)
    parts.push("Sygnały współdziałania (z akt):\n" + inp.relations.map((r) => "- " + r).join("\n"));
  if (inp.events.length)
    parts.push("Datowane zdarzenia korporacyjne (z akt):\n" + inp.events.map((e) => "- " + e).join("\n"));
  parts.push(
    "Napisz rozdział w strukturze: (1) akapit metodyczny — wnioski wynikają wyłącznie z ustaleń rozdziału IV, " +
      "bez przejmowania tez zawiadomienia; (2) odpowiedź na pytanie 1 — 2–3 akapity: dynamika kursu, udział Grupy " +
      "w obrocie, transakcje wzajemne, saldo (akumulacja/wyprzedaż) i ocena uzasadnienia ekonomicznego; " +
      "(3) odpowiedź na pytanie 2 — każda technika odrębnym akapitem z liczbami i odesłaniem do rozdziału IV.x; " +
      "(4) odpowiedź na pytanie 3 — okoliczności współdziałania (wspólne IP, zbieżność czasowa zleceń, powiązania " +
      "osobowe, anulacje) z liczbami; (5) odpowiedź na pytanie 4 — pozostałe okoliczności (zbieżność zdarzeń " +
      "korporacyjnych z sesjami, koncentracja podaży i popytu); (6) sekcja „Atrybucja podmiotowa” — jeżeli szkielet " +
      "zawiera numerowany rejestr aktywności rachunków Grupy (podmiot — sesje — kwoty), przenieś go W CAŁOŚCI " +
      "i BEZ ZMIAN (każda pozycja w osobnej linii, z zachowaniem dat, kwot i numeracji); dopisz najwyżej 1–2 " +
      "zdania wprowadzające; (7) akapit końcowy rozgraniczający ustalenia " +
      "faktyczne od ocen zastrzeżonych dla sądu. " +
      "Objętość: 10–16 akapitów (rejestr atrybucji liczy się jako jeden). Liczby wyłącznie z podanych danych; " +
      "braki oznacz [do uzupełnienia]. " +
      "Nie przesądzaj o winie ani zamiarze. Zwróć samą treść rozdziału, bez nagłówka.",
  );
  return { system: SYSTEM, user: parts.join("\n\n") };
}

// ── Redakcja rozdziałów IV (analiza) — narracja wokół liczb z silnika ──
export const IV_REDACT_KINDS = [
  "ekofin", "espi", "aktywnosc", "relacje", "wash", "imo", "layering", "pumpdump",
] as const;
export type IvRedactKind = (typeof IV_REDACT_KINDS)[number];

const IV_PURPOSE: Record<IvRedactKind, string> = {
  ekofin:
    "Analiza ekonomiczno-finansowa i otoczenie rynkowe — czy zmiana kursu i wolumenu znajduje uzasadnienie w sytuacji finansowej spółki oraz informacjach publicznych, czy jest oderwana od fundamentów (test falsyfikacji). Omów fazy zmiany kursu (pump: zamknięcie początkowe → szczyt; dump: szczyt → zamknięcie końcowe) jako ramę analizy dynamiki.",
  espi:
    "Analiza raportów bieżących ESPI/EBI — czy komunikaty spółki były cenotwórcze, czy wypełniały definicję informacji poufnej, czy nosiły znamiona manipulacji informacją.",
  aktywnosc:
    "Aktywność podmiotów z Grupy — dynamika kursu (OHLC) i wolumenu w powiązaniu ze skalą i koncentracją obecności Grupy w obrocie; omów tabelę kursu sesja po sesji (wzrosty, spadki, kurs maksymalny), zestawienia per podmiot odrębnie po stronie sprzedaży i kupna, oraz saldo Grupy (skumulowane saldo wolumenu = pozycja, i gotówki = przychód) jako obraz akumulacji i wyprzedaży pakietu, oraz aktywność przy fixingu otwarcia/zamknięcia i koncentrację śródsesyjną (zał. I lit. A pkt g i e MAR). Zaznacz zbieżność czasową skoków kursu z raportami bieżącymi spółki (ESPI) obecnymi w aktach — odeślij do rozdz. IV.2 — bez wymyślania numerów ani dat komunikatów (oznacz [do uzupełnienia]).",
  relacje:
    "Identyfikacja relacji między podmiotami Grupy — powiązania osobowe, zbieżność adresów IP, wspólni pełnomocnicy — jako przesłanki działania wspólnie i w porozumieniu.",
  wash:
    "Wash trades (sztuczny obrót) — transakcje wewnątrzgrupowe generujące pozorny obrót; omów udziały dzień po dniu, ledger per (sesja, podmiot) oraz odwrócenia pozycji w tej samej sesji (zał. I lit. A pkt d MAR).",
  imo:
    "Improper matched orders — składanie zleceń o zbliżonych parametrach i czasie prowadzące do wzajemnego dopasowania.",
  layering:
    "Layering & spoofing — składanie i anulowanie zleceń bez zamiaru realizacji; omów anulacje sesja po sesji.",
  pumpdump:
    "Pump and dump — faza pompowania kursu i późniejszej wyprzedaży pakietu.",
};

export type IvRedactInput = {
  kind: IvRedactKind;
  title: string;
  caseName: string;
  signature: string | null;
  period: string | null;
  caseIntro?: string | null; // oznaczenie spółki/instrumentu z rozdz. I (bez placeholderów)
  tableText: string | null; // wygenerowana tabela jako tekst (dzień/podmiot × wartość)
  findings: string[];
  inventory: string[]; // inwentarz dokumentów w aktach
  legalRefs: string[];
  sessionFacts?: string[]; // fakty dnia (obrót/udział Grupy/kurs/anulacje) do akapitów sesyjnych
};

export function buildIvRedactPrompt(inp: IvRedactInput): { system: string; user: string } {
  const parts: string[] = [];
  parts.push(`Zredaguj rozdział analizy (część IV opinii biegłego): „${inp.title}".`);
  parts.push(`Sprawa: ${inp.caseName}${inp.signature ? ` (sygn. ${inp.signature})` : ""}.`);
  if (inp.period) parts.push(`Okres objęty analizą: ${inp.period}.`);
  if (inp.caseIntro)
    parts.push(
      "Oznaczenie spółki i instrumentu (z rozdziału I — używaj tych oznaczeń; NIE stosuj placeholderów " +
        "typu [oznaczenie spółki]):\n" + inp.caseIntro,
    );
  parts.push(`Cel rozdziału: ${IV_PURPOSE[inp.kind]}`);
  if (inp.legalRefs.length) parts.push(`Odniesienia prawne do wplecenia: ${inp.legalRefs.join("; ")}.`);
  if (inp.tableText)
    parts.push(
      "Dane liczbowe z deterministycznego silnika — poniżej jedna lub kilka tabel (każda z własnym tytułem). " +
        "Przepisz wartości DOKŁADNIE; omów KAŻDĄ tabelę pozycja po pozycji — dzień po dniu / podmiot po " +
        "podmiocie — wskazując wartości szczytowe i ich znaczenie; możesz odwoływać się do tabel po ich tytule:\n" +
        inp.tableText,
    );
  if (inp.findings.length)
    parts.push("Ustalenia cząstkowe do rozwinięcia w prozę:\n" + inp.findings.map((f) => "- " + f).join("\n"));
  if (inp.inventory.length)
    parts.push(
      "Dokumenty w aktach (możesz się na nie powołać rodzajowo; nie zmyślaj innych):\n" +
        inp.inventory.map((f) => "- " + f).join("\n"),
    );
  // Rozdziały z rozbiciem per sesja (wzorzec KM: strona-dwie analizy na sesję,
  // nie jedno zdanie) — wymagany odrębny akapit analityczny dla KAŻDEJ sesji.
  const perSession = (inp.kind === "layering" || inp.kind === "aktywnosc") && /w sesji \d{4}-\d{2}-\d{2}/.test(inp.tableText ?? "");
  if (perSession)
    parts.push(
      "ROZBICIE PER SESJA: dane zawierają zestawienia „Aktywność podmiotów z Grupy w sesji <data>”. " +
        "Dla KAŻDEJ takiej sesji napisz ODRĘBNY, pełny akapit analityczny zaczynający się od „Sesja giełdowa " +
        "w dniu <data>.”: kto dominował po stronie kupna i po stronie sprzedaży (podmioty i kwoty z tabeli tej " +
        "sesji), saldo wolumenu, oraz udział Grupy w obrocie sesji, zmiana kursu i skala anulacji z FAKTÓW SESJI " +
        "poniżej; zakończ zdaniem o znaczeniu sesji dla obrazu całości. Nie streszczaj sesji zbiorczo.",
    );
  if (perSession && inp.sessionFacts?.length)
    parts.push(
      "FAKTY SESJI (liczby dnia z silnika — przepisz je w akapitach sesyjnych DOKŁADNIE; NIE oznaczaj tych " +
        "wielkości jako [do uzupełnienia]):\n" + inp.sessionFacts.map((f) => "- " + f).join("\n"),
    );
  parts.push(
    "Napisz gęstą analizę w stylu opinii biegłego: (1) wprowadzenie z odesłaniem do rozdziału III (ujęcie teoretyczne), " +
      "(2) omówienie danych pozycja po pozycji z interpretacją (dni/podmioty szczytowe, tendencje), " +
      "(3) zakotwiczenie w art. 12 MAR oraz załączniku II do rozporządzenia 2016/522, (4) wniosek cząstkowy. " +
      `Objętość: ${perSession ? "12–24 akapity (w tym akapit na każdą sesję z rozbicia)" : "6–12 akapitów"}. ` +
      "Liczby wyłącznie z podanych danych — nie wymyślaj żadnych; czego brak, oznacz [do uzupełnienia]. " +
      "Nie przesądzaj o winie ani zamiarze. Zwróć samą treść rozdziału, bez nagłówka.",
  );
  return { system: SYSTEM, user: parts.join("\n\n") };
}
