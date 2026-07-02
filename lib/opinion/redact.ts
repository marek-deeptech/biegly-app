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
      "Napisz wstęp teoretyczny o technikach manipulacji instrumentem finansowym: transakcje wzajemne (wash trades), " +
        "layering i spoofing, niewłaściwe dopasowania zleceń (matched orders) oraz schemat pump&dump — w świetle art. 12 MAR " +
        "i wskaźników z załącznika II do rozporządzenia 2016/522. To rozdział OGÓLNY — nie odwołuj się do konkretnych liczb tej sprawy.",
    );
  if (inp.chapter === "V")
    parts.push(
      "Napisz podsumowanie syntetyzujące ustalenia analizy. Wyraźnie oddziel ustalenia faktyczne (co pokazują dane) od ocen " +
        "zastrzeżonych dla sądu (kwalifikacja prawnokarna, zamiar, wina konkretnych osób).",
    );

  parts.push("Objętość: 2–4 akapity. Styl: formalny, bezosobowy, prawniczy. Zwróć samą treść rozdziału.");
  return { system: SYSTEM, user: parts.join("\n\n") };
}

// ── Redakcja rozdziałów IV (analiza) — narracja wokół liczb z silnika ──
export const IV_REDACT_KINDS = [
  "ekofin", "espi", "aktywnosc", "relacje", "wash", "imo", "layering", "pumpdump",
] as const;
export type IvRedactKind = (typeof IV_REDACT_KINDS)[number];

const IV_PURPOSE: Record<IvRedactKind, string> = {
  ekofin:
    "Analiza ekonomiczno-finansowa i otoczenie rynkowe — czy zmiana kursu i wolumenu znajduje uzasadnienie w sytuacji finansowej spółki oraz informacjach publicznych, czy jest oderwana od fundamentów (test falsyfikacji).",
  espi:
    "Analiza raportów bieżących ESPI/EBI — czy komunikaty spółki były cenotwórcze, czy wypełniały definicję informacji poufnej, czy nosiły znamiona manipulacji informacją.",
  aktywnosc:
    "Aktywność podmiotów z Grupy — dynamika kursu (OHLC) i wolumenu w powiązaniu ze skalą i koncentracją obecności Grupy w obrocie; omów tabelę kursu sesja po sesji (wzrosty, spadki, kurs maksymalny) oraz zestawienia per podmiot odrębnie po stronie sprzedaży i po stronie kupna.",
  relacje:
    "Identyfikacja relacji między podmiotami Grupy — powiązania osobowe, zbieżność adresów IP, wspólni pełnomocnicy — jako przesłanki działania wspólnie i w porozumieniu.",
  wash:
    "Wash trades (sztuczny obrót) — transakcje wewnątrzgrupowe generujące pozorny obrót; omów udziały dzień po dniu.",
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
  tableText: string | null; // wygenerowana tabela jako tekst (dzień/podmiot × wartość)
  findings: string[];
  inventory: string[]; // inwentarz dokumentów w aktach
  legalRefs: string[];
};

export function buildIvRedactPrompt(inp: IvRedactInput): { system: string; user: string } {
  const parts: string[] = [];
  parts.push(`Zredaguj rozdział analizy (część IV opinii biegłego): „${inp.title}".`);
  parts.push(`Sprawa: ${inp.caseName}${inp.signature ? ` (sygn. ${inp.signature})` : ""}.`);
  if (inp.period) parts.push(`Okres objęty analizą: ${inp.period}.`);
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
  parts.push(
    "Napisz gęstą analizę w stylu opinii biegłego: (1) wprowadzenie z odesłaniem do rozdziału III (ujęcie teoretyczne), " +
      "(2) omówienie danych pozycja po pozycji z interpretacją (dni/podmioty szczytowe, tendencje), " +
      "(3) zakotwiczenie w art. 12 MAR oraz załączniku II do rozporządzenia 2016/522, (4) wniosek cząstkowy. " +
      "Objętość: 6–12 akapitów. Liczby wyłącznie z podanych danych — nie wymyślaj żadnych; czego brak, oznacz [do uzupełnienia]. " +
      "Nie przesądzaj o winie ani zamiarze. Zwróć samą treść rozdziału, bez nagłówka.",
  );
  return { system: SYSTEM, user: parts.join("\n\n") };
}
