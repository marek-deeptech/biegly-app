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
