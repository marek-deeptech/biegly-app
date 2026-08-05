// REJESTR PAKIETÓW DZIEDZINOWYCH.
//
// Jedna aplikacja, dwie dziedziny opinii. Podział przebiega tam, gdzie realnie
// przebiega różnica między sprawami — a nie tam, gdzie wygodnie byłoby postawić
// granicę repozytoriów.
//
// WSPÓLNE (platforma, ~65% kodu): wgrywanie i klasyfikacja akt, OCR, Storage,
// składanie opinii, eksport DOCX/PDF, generator tabel i wykresów, redakcja prozy
// z zasadą „LLM nie liczy", korpus wzorców stylu, korekty biegłego, audytor opinii,
// repozytorium wiedzy, kopia zapasowa, logowanie, model „pytania organu".
//
// DZIEDZINOWE (ten katalog): plan rozdziałów, moduły analizy, katalog prawny,
// taksonomia dokumentów, wymogi kompletności, wejście do silnika liczbowego.
//
// Podstawa empiryczna podziału — porównanie finalnych opinii tego samego biegłego:
//   HUBTECH (GPW):  I. Przedmiot i podstawa | II. Wnioski | III. Wstęp teoretyczny
//                   | IV. ANALIZA (7 modułów) | V. Podsumowanie | VI. Spisy
//   MBR (bank):     I. Przedmiot | II. Podstawa prawna | III. Wnioski | IV. Wstęp
//                   | V. ANALIZA (12 modułów A–L) | VI. Załączniki | VII/VIII. Spisy
// Powłoka ta sama, wnioski przed analizą w obu, różni się wyłącznie zawartość
// rozdziału ANALIZA i podstawa prawna.
import { CATALOG_KINDS, type IVKind } from "@/lib/opinion/chapters";
import type { BankModul } from "@/lib/domain/prawo-bankowe";
import { czyKrytyczny } from "@/lib/intake/completeness";
import { WYMOGI_BANK } from "@/lib/domain/taxonomy-bank";
import { RECOMMENDED, REQUIRED } from "@/lib/intake/taxonomy";

export type CaseType = "manipulacja_gpw" | "ryzyko_bankowe";

/** Rozdział główny — powłoka dokumentu, stała w obrębie dziedziny. */
export type RozdzialGlowny = { no: string; tytul: string; rola: RolaRozdzialu };

/**
 * Rola rozdziału decyduje o tym, jak jest wypełniany i jakiego wzorca stylu szuka.
 * Dzięki temu `wnioski` z opinii o manipulacji i `wnioski` z opinii bankowej
 * korzystają z TEGO SAMEGO korpusu stylu — bo to ten sam biegły i ten sam gatunek
 * wypowiedzi, niezależnie od dziedziny.
 */
export type RolaRozdzialu = "proza_i" | "proza_iii" | "proza_v" | "wnioski" | "analiza" | "spisy" | "zalaczniki";

export type ModulAnalizy = { id: string; tytul: string; opis: string };

/** Stan sprawy, na podstawie którego oceniamy ukończenie kroku. */
export type StanSprawy = {
  dokumentow: number;
  metryk: number;
  /** Rodzaje istniejących subanaliz. */
  subanalizy: string[];
  zatwierdzone: number;
  checklistOk: boolean;
};

export type Krok = {
  klucz: "overview" | "files" | "analysis" | "ekonomia" | "warsztat" | "opinion";
  label: string;
  /** Jednozdaniowy opis, co ten krok robi W TEJ dziedzinie. */
  opis: string;
  gotowy: (s: StanSprawy) => boolean;
};

/**
 * Kroki 3–5 różnią się między dziedzinami CO DO ISTOTY, nie tylko etykietą:
 * w manipulacjach krok 3 liczy wskaźniki z arkusza zleceń, a krok 4 rozstrzyga
 * techniki MAR. W sprawach bankowych krok 3 liczy współczynniki kapitałowe
 * ze sprawozdań, a krok 4 odtwarza proces decyzyjny i zestawia go z przepisami
 * obowiązującymi w DACIE ZDARZENIA — o technikach manipulacji nie ma tam mowy.
 *
 * Definicje są ROZDZIELNE, a nie sparametryzowane wspólną strukturą: zmiana
 * warunku ukończenia w jednej dziedzinie nie ma prawa dotknąć drugiej.
 */
const KROKI_GPW: Krok[] = [
  { klucz: "overview", label: "Sprawa", opis: "Pytania organu, roster Grupy, kompletność akt",
    gotowy: (s) => s.dokumentow > 0 && s.checklistOk },
  { klucz: "files", label: "Pliki", opis: "Wgranie i klasyfikacja akt",
    gotowy: (s) => s.dokumentow > 0 },
  { klucz: "analysis", label: "Analiza liczbowa", opis: "Wskaźniki manipulacji z arkusza zleceń i transakcji UTP",
    gotowy: (s) => s.metryk > 0 },
  // KROK 4 — wymóg klienta (sprawa ZASTAL, 2026-08): analiza ekonomiczno-finansowa
  // emitenta ma być osobnym krokiem PRZED konstruowaniem opinii, nie jej częścią.
  // Wzorzec: rozdz. IV.1 finału HubTech (kontrast obrotu, tło branżowe =100,
  // dynamika pozycji sprawozdawczych, wskaźniki wykazane przez portale).
  { klucz: "ekonomia", label: "Analiza IV.1–7",
    opis: "Rozdział IV opinii w siedmiu pod-zakładkach: ekonomia emitenta (stooq), ESPI/EBI (espiebi), aktywność Grupy, wash, IMO, layering/spoofing, relacje — wzorzec: finał HubTech",
    gotowy: (s) => s.subanalizy.includes("ekofin_dane") },
  { klucz: "warsztat", label: "Warsztat dowodowy", opis: "Techniki MAR, powiązania podmiotów, korelacja IP",
    gotowy: (s) => s.subanalizy.includes("techniki") && s.subanalizy.includes("powiazania_dane") },
  { klucz: "opinion", label: "Opinia", opis: "Rozdziały I–VI wg szkieletu opinii o manipulacji",
    gotowy: (s) => s.zatwierdzone > 0 },
];

const KROKI_BANK: Krok[] = [
  { klucz: "overview", label: "Sprawa", opis: "Pytania organu, podmioty i osoby, kompletność akt",
    gotowy: (s) => s.dokumentow > 0 && s.checklistOk },
  { klucz: "files", label: "Pliki", opis: "Wgranie i klasyfikacja akt (skany wymagają OCR)",
    gotowy: (s) => s.dokumentow > 0 },
  { klucz: "analysis", label: "Analiza ekonomiczno-finansowa",
    opis:
      "Współczynniki kapitałowe w czasie z progami z daty zdarzenia oraz rubryka 16 wskaźników " +
      "w 4 obszarach (adekwatność, jakość aktywów, efektywność, płynność) wraz z rejestrem pozycji, " +
      "których w aktach brakuje",
    gotowy: (s) => s.metryk > 0 || s.subanalizy.includes("wskazniki_bank") },
  { klucz: "warsztat", label: "Warsztat dowodowy",
    opis: "Proces decyzyjny, metodyka limitów, sygnały rynkowe i zestawienie z przepisami obowiązującymi w dacie zdarzenia",
    gotowy: (s) => s.subanalizy.includes("procedury") && s.subanalizy.includes("limity") },
  { klucz: "opinion", label: "Opinia", opis: "Rozdziały I–VIII wg szkieletu opinii bankowej",
    gotowy: (s) => s.zatwierdzone > 0 },
];

export type DomainPack = {
  id: CaseType;
  label: string;
  /** Powłoka dokumentu — rozdziały główne w kolejności. */
  szkielet: RozdzialGlowny[];
  /** Katalog modułów rozdziału ANALIZA; dobór per sprawa zawęża tę listę. */
  moduly: ModulAnalizy[];
  /** Typy dokumentów charakterystyczne dla dziedziny (poza wspólnym rdzeniem). */
  typyDokumentow: string[];
  /** Czy dziedzina ma deterministyczny silnik liczbowy. */
  silnik: "gpw_utp" | "bank_wskazniki" | null;
  /** Kroki procesu — etykiety, opisy i warunki ukończenia właściwe dla dziedziny. */
  kroki: Krok[];
};

// ── Dziedzina 1: manipulacja instrumentami finansowymi ───────────────────────
const GPW: DomainPack = {
  id: "manipulacja_gpw",
  label: "Manipulacja instrumentami finansowymi",
  szkielet: [
    { no: "I", tytul: "Przedmiot i podstawa prawna opinii", rola: "proza_i" },
    { no: "II", tytul: "Wnioski", rola: "wnioski" },
    { no: "III", tytul: "Wstęp — ujęcie teoretyczne", rola: "proza_iii" },
    { no: "IV", tytul: "Analiza", rola: "analiza" },
    { no: "V", tytul: "Podsumowanie", rola: "proza_v" },
    { no: "VI", tytul: "Spis tabel i wykresów", rola: "spisy" },
  ],
  // Moduły GPW żyją w chapters.ts (IVKind) — tu tylko je nazywamy, żeby rejestr
  // był jednym miejscem, w którym widać obie dziedziny obok siebie.
  moduly: (CATALOG_KINDS as IVKind[]).map((k) => ({ id: k, tytul: k, opis: "" })),
  typyDokumentow: ["DANE_UTP", "DANE_TREM", "DANE_BROKERSKIE", "STOR", "RAPORT_ESPI_EBI", "SPEC_TECHNICZNA"],
  silnik: "gpw_utp",
  kroki: KROKI_GPW,
};

// ── Dziedzina 2: ryzyko bankowe (sprawy karne) ───────────────────────────────
// Szkielet i moduły odtworzone z opinii MBR (PO III Ds 84.2020) — podrozdziały
// A–L uogólnione do modułów wielokrotnego użytku.
const BANK: DomainPack = {
  id: "ryzyko_bankowe",
  label: "Ryzyko bankowe — sprawy karne",
  szkielet: [
    { no: "I", tytul: "Przedmiot opinii", rola: "proza_i" },
    { no: "II", tytul: "Podstawa prawna opinii", rola: "proza_i" },
    { no: "III", tytul: "Wnioski", rola: "wnioski" },
    { no: "IV", tytul: "Wstęp", rola: "proza_iii" },
    { no: "V", tytul: "Analiza", rola: "analiza" },
    { no: "VI", tytul: "Załączniki", rola: "zalaczniki" },
    { no: "VII", tytul: "Spis tabel", rola: "spisy" },
    { no: "VIII", tytul: "Spis wykresów", rola: "spisy" },
  ],
  moduly: [
    {
      id: "makro",
      tytul: "Otoczenie makroekonomiczne",
      opis: "Inflacja, kursy walutowe i stopy procentowe kraju kontrahenta w okresie poprzedzającym zdarzenie — szeregi czasowe z bankowości centralnej. Ustala, jakie sygnały były dostępne publicznie w dniu decyzji.",
    },
    {
      id: "sygnaly_rynkowe",
      tytul: "Sygnały rynkowe: CDS i ratingi",
      opis: "Notowania spreadów CDS kontrahenta i banków porównywalnych oraz zmiany i perspektywy ratingów. Spread CDS jest rynkową wyceną prawdopodobieństwa niewypłacalności — jego skokowy wzrost to sygnał ostrzegawczy dostępny każdemu uczestnikowi rynku.",
    },
    {
      id: "media",
      tytul: "Publikacje prasowe i komunikaty",
      opis: "Doniesienia prasy krajowej i międzynarodowej dostępne przed dniem zdarzenia. Ustala stan wiedzy powszechnie dostępnej — nie stan wiedzy banku.",
    },
    {
      id: "ekspozycja_sektor",
      tytul: "Skala sektora bankowego wobec gospodarki",
      opis: "Relacja aktywów sektora bankowego kraju kontrahenta do jego PKB oraz zdolność banku centralnego do pełnienia roli pożyczkodawcy ostatniej instancji.",
    },
    {
      id: "chronologia_nadzoru",
      tytul: "Chronologia nadzorcza i wskaźniki banku w czasie",
      opis: "Datowane działania organu nadzoru i banku zrzeszającego wraz ze wskaźnikami banku w kolejnych okresach sprawozdawczych. Moduł dla pytań o CZAS („od kiedy dało się rozpoznać”), gdzie źródłem jest narracja nadzorcza, a nie sprawozdanie finansowe.",
    },
    {
      id: "analiza_ekonomiczna",
      tytul: "Analiza ekonomiczno-finansowa banku",
      opis:
        "Rubryka 16 wskaźników w czterech obszarach (adekwatność kapitałów, jakość aktywów, efektywność, " +
        "płynność) wraz z wagami istotności i punktacją — odtworzenie metodyki, którą oceniający był " +
        "zobowiązany stosować. Zawiera rejestr pozycji sprawozdawczych, których w aktach brakuje: " +
        "to on wyznacza granicę tego, co da się z materiału udowodnić.",
    },
    {
      id: "oceny_zrzeszajacego",
      tytul: "Oceny banku zrzeszającego wystawione bankowi spółdzielczemu",
      opis:
        "Kwartalne oceny sytuacji ekonomiczno-finansowej, jakie bank zrzeszający wystawił bankowi " +
        "spółdzielczemu w kolejnych okresach — z ocenami cząstkowymi per obszar i oceną globalną. " +
        "Moduł odpowiada na pytanie o STAN WIEDZY ZRZESZAJĄCEGO: nie co dało się policzyć z akt, " +
        "lecz co zrzeszający sam napisał i kiedy. Zestawienie tych ocen ze wskaźnikami policzonymi " +
        "przez silnik pokazuje, czy ocena nadążała za danymi — a okresy BEZ oceny są tu ustaleniem " +
        "równie istotnym jak same oceny.",
    },
    {
      id: "sprawozdania",
      tytul: "Analiza sprawozdań finansowych kontrahenta",
      opis: "Pozycje sprawozdań za okresy poprzedzające zdarzenie: wynik odsetkowy, zysk netto, struktura finansowania (depozyty vs finansowanie hurtowe), jakość portfela. Wskazuje, co dało się odczytać ze sprawozdań w dniu decyzji.",
    },
    {
      id: "adekwatnosc",
      tytul: "Współczynniki kapitałowe w czasie",
      opis: "Fundusze własne i współczynniki adekwatności (CET1, Tier 1, łączny współczynnik kapitałowy, dźwignia, LCR) liczone w szeregu czasowym wraz z progami regulacyjnymi obowiązującymi W DANYM OKRESIE. Liczby wyłącznie z silnika.",
    },
    {
      id: "limity",
      tytul: "Metodyka limitów i koncentracja zaangażowania",
      opis: "Wewnętrzna metodyka wyznaczania limitów, ich wysokość względem funduszy własnych, tryb zatwierdzania i faktyczne wykorzystanie. Zestawienie z regulacyjnym limitem dużych ekspozycji obowiązującym w dacie zdarzenia.",
    },
    {
      id: "procedury",
      tytul: "Proces decyzyjny i dokumenty wewnętrzne",
      opis: "Uchwały zarządu, protokoły komitetów zarządzania aktywami i pasywami, korespondencja departamentów ryzyka, ustalenia audytu wewnętrznego. Odtwarza, co bank wiedział i kiedy oraz kto podjął decyzję.",
    },
    {
      id: "otoczenie_prawne",
      tytul: "Otoczenie prawne i standardy identyfikacji ryzyka",
      opis: "Przepisy obowiązujące W DACIE ZDARZENIA oraz wymagane standardy identyfikacji i oceny ryzyka kredytowego. Podstawa oceny, czy proces banku był dostateczny.",
    },
  ] satisfies { id: BankModul; tytul: string; opis: string }[],
  typyDokumentow: [
    "SPRAWOZDANIE_BANK",
    "UCHWALA_WEWNETRZNA",
    "PROTOKOL_KOMITETU",
    "METODYKA_LIMITOW",
    "KORESPONDENCJA_WEWN",
    "AUDYT_WEWNETRZNY",
    "NADZOR_KNF",
    "RATING_AGENCJA",
    "DANE_RYNKOWE_SZEREG",
    "PRASA",
  ],
  silnik: "bank_wskazniki",
  kroki: KROKI_BANK,
};

const PAKIETY: Record<CaseType, DomainPack> = {
  manipulacja_gpw: GPW,
  ryzyko_bankowe: BANK,
};

/**
 * Pakiet dziedzinowy sprawy. Nieznany lub pusty typ → dziedzina GPW, bo trzy
 * sprawy założone przed migracją 0010 nie mają jeszcze ustawionego typu i muszą
 * działać bez zmian.
 */
export function packDla(typ: string | null | undefined): DomainPack {
  return PAKIETY[(typ ?? "") as CaseType] ?? GPW;
}

export const WSZYSTKIE_PAKIETY = Object.values(PAKIETY);

/**
 * Typy dokumentów wymagane i zalecane dla dziedziny — do prostej listy kontrolnej
 * na stronie sprawy.
 *
 * Dla dziedziny bankowej wyprowadzone z WYMOGI_BANK (krytyczne → wymagane), zamiast
 * utrzymywane jako druga lista. Dublowanie takich zestawień rozjeżdżało już w tym
 * projekcie cztery funkcje naraz.
 */
/**
 * Grupa typów spełniających JEDEN wymóg. Wymóg jest spełniony, gdy w aktach jest
 * KTÓRYKOLWIEK z nich.
 *
 * ⚠️ ALTERNATYWA, NIE KONIUNKCJA. Funkcja zwracała płaską listę kodów i lista
 * kontrolna traktowała każdy jako osobny wymóg. Wymóg „postanowienie o powołaniu
 * biegłego" spełnia POSTANOWIENIE (prokuratorskie), POSTANOWIENIE_SAD (sądowe)
 * albo PYTANIA_BIEGLY — a sprawa cywilna ma z natury tylko jeden z nich. Skutek:
 * w sprawie SK Banku aplikacja zgłaszała brak „Postanowienia o powołaniu biegłego"
 * i „Pytań / tezy dowodowej", choć postanowienie Sądu Okręgowego LEŻY w aktach
 * (k. 12340) i to z niego wyprowadzono pytania. Żądanie wszystkich trzech naraz
 * jest niespełnialne z definicji: prokurator i sąd nie wydają tego samego orzeczenia.
 */
export type GrupaTypow = { label: string; kody: string[] };

export function wymaganeTypy(
  typ?: string | null,
  rola?: string | null,
): { required: GrupaTypow[]; recommended: GrupaTypow[] } {
  // Dziedzina GPW: każdy kod JEST osobnym wymogiem (arkusz zleceń i odpisy KRS to
  // różne dokumenty, nie warianty tego samego), więc grupa jednoelementowa.
  if (typ !== "ryzyko_bankowe")
    return {
      required: REQUIRED.map((k) => ({ label: k, kody: [k] })),
      recommended: RECOMMENDED.map((k) => ({ label: k, kody: [k] })),
    };
  // Krytyczność zależy od ROLI procesowej: metodyka limitów jest rdzeniem opinii
  // o decyzji banku i materiałem pomocniczym w sprawie przeciwko nadzorcy.
  const grupy = (kryt: boolean) =>
    WYMOGI_BANK.filter((w) => czyKrytyczny(w, rola) === kryt && w.docTypes.length).map((w) => ({
      label: w.label,
      kody: w.docTypes,
    }));
  return { required: grupy(true), recommended: grupy(false) };
}
