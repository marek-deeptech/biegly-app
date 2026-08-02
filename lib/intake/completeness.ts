// RAPORT KOMPLETNOŚCI DANYCH WEJŚCIOWYCH — co da się udowodnić z tego, co jest w aktach.
//
// Powód powstania (lekcja ze sprawy ZASTAL): brak arkusza zleceń wykluczał layering,
// fixing przedzamknięciowy i matched orders — a plik BYŁ w aktach, tylko pod nazwą
// „Zestawienie zleceń (wszystkie instrumenty).xlsx" i z typem DANE_BROKERSKIE, więc
// żadna heurystyka po `doc_type` go nie widziała. Wniosek: wykrywamy DWUTOROWO —
// po typie dokumentu ORAZ po nazwie pliku — i mówimy wprost, którą drogą znaleziono.
//
// Raport odpowiada na trzy pytania, które biegły zadaje na wejściu sprawy:
//   1. Co mam? 2. Czego przez to NIE udowodnię? 3. O co wystąpić do organu?
// Jest w pełni deterministyczny (bez modelu) — to inwentaryzacja, nie ocena.

import { kodRoli, type Rola } from "@/lib/domain/rola";
import { WYMOGI_BANK } from "@/lib/domain/taxonomy-bank";

export type DocLite = {
  rel_path: string;
  doc_type: string;
  /** 'jest' | 'ocr' = treść czytelna maszynowo; 'brak' = skan bez OCR (migracja 0011). */
  warstwa_tekstu?: string | null;
};

export type Wymog = {
  id: string;
  label: string;
  /** Typy dokumentów, z których którykolwiek spełnia wymóg. */
  docTypes: string[];
  /** Wzorce nazw plików — ratunek, gdy dane są w aktach pod „obcym" typem. */
  namePatterns?: RegExp[];
  /** Moduły rozdziału IV odblokowywane przez ten wymóg. */
  unlocks: string[];
  /** Treść żądania do organu, gdy wymogu brak. */
  zamow: string;
  /**
   * Czy brak przekreśla rdzeń opinii (a nie tylko jeden rozdział).
   *
   * LISTA RÓL zamiast `true` znaczy: krytyczny WYŁĄCZNIE wtedy, gdy sprawa ma jedną
   * z nich. Metodyka limitów banku jest rdzeniem opinii o decyzji tego banku i
   * materiałem pomocniczym w sprawie przeciwko nadzorcy — ta sama pozycja, dwa różne
   * ciężary. Oznaczenie jej krytyczną niezależnie od roli sprawiało, że raport
   * sprawy SK Banku twierdził, iż opinii nie da się wydać.
   */
  krytyczny: boolean | Rola[];
  /**
   * Tryb postępowania, w którym wymóg w ogóle występuje. Brak = w każdym.
   *
   * Dokumenty wymagane zależą nie tylko od DZIEDZINY, ale i od tego, KTO pyta:
   * w powództwie deponenta o zapłatę trzeba wykazać wysokość szkody, a w sprawie
   * karnej o niegospodarność nie ma powoda ani roszczenia. Wymóg wypisany w złym
   * trybie to brak, którego nie da się uzupełnić — akta go nigdy nie będą zawierać.
   */
  tryb?: "karne" | "cywilne";
};

// Etykiety technik — spójne z lib/opinion/chapters.ts (IV_TITLE).
const TECH_LABEL: Record<string, string> = {
  wash: "Wash trades",
  layering: "Layering & spoofing",
  imo: "Improper matched orders",
  pumpdump: "Pump and dump",
  fixing: "Manipulacja na fixingu (marking the close)",
  concentration: "Koncentracja zleceń w krótkim odcinku sesji",
  reversal: "Odwrócenie pozycji w krótkim okresie",
  infomanip: "Manipulacja informacją",
  aktywnosc: "Aktywność podmiotów z Grupy",
  relacje: "Identyfikacja relacji między podmiotami",
  ekofin: "Analiza ekonomiczno-finansowa",
  espi: "Analiza raportów ESPI/EBI",
  pytania: "Pytania organu (podstawa opinii)",
  // Moduły dziedziny bankowej (pakiet `ryzyko_bankowe` w lib/domain).
  makro: "Otoczenie makroekonomiczne",
  sygnaly_rynkowe: "Sygnały rynkowe: CDS i ratingi",
  media: "Publikacje prasowe",
  ekspozycja_sektor: "Skala sektora bankowego wobec gospodarki",
  sprawozdania: "Analiza sprawozdań finansowych kontrahenta",
  analiza_ekonomiczna: "Analiza ekonomiczno-finansowa banku (rubryka 16 wskaźników)",
  adekwatnosc: "Współczynniki kapitałowe w czasie",
  chronologia_nadzoru: "Chronologia nadzorcza i wskaźniki banku w czasie",
  limity: "Metodyka limitów i koncentracja zaangażowania",
  procedury: "Proces decyzyjny i dokumenty wewnętrzne",
  otoczenie_prawne: "Otoczenie prawne i standardy identyfikacji ryzyka",
};

export const WYMOGI: Wymog[] = [
  {
    id: "transakcje",
    label: "Transakcje z identyfikacją właścicieli rachunków",
    docTypes: ["DANE_UTP", "DANE_TREM"],
    namePatterns: [/transakcje/i, /iad[_\s-]*c/i, /2_stronnie/i],
    unlocks: ["wash", "pumpdump", "aktywnosc", "reversal"],
    zamow:
      "Zestawienie transakcji giełdowych z identyfikacją właścicieli rachunków (dane UTP/TREM) " +
      "dla instrumentów i okresu objętych postanowieniem.",
    krytyczny: true,
  },
  {
    id: "zlecenia",
    label: "Arkusz / zestawienie ZLECEŃ (nie tylko transakcji)",
    docTypes: [],
    // Uwaga: bywa i w DANE_UTP („Zlecenia BO"), i pod DANE_BROKERSKIE jako
    // „Zestawienie zleceń…" — dlatego wykrywanie po nazwie jest tu podstawowe.
    namePatterns: [/zestawienie\s+zlece/i, /zlecenia/i, /transakcje_i_zlecenia/i, /order[\s_-]*book/i],
    unlocks: ["layering", "fixing"],
    zamow:
      "Zestawienie ZLECEŃ giełdowych podmiotów objętych postępowaniem (czas złożenia, limit, wolumen " +
      "zadeklarowany i zrealizowany, anulaty i modyfikacje z ich znacznikami czasu).",
    krytyczny: false,
  },
  {
    id: "srodczasowe",
    label: "Dane śróddzienne (czas transakcji + wolumen)",
    docTypes: ["DANE_UTP", "DANE_TREM"],
    namePatterns: [/transakcje/i, /2_stronnie/i],
    unlocks: ["concentration", "fixing"],
    zamow:
      "Dane transakcyjne ze znacznikami czasu śróddziennego (TRANSACTTIME / CZAS_TR) i wolumenem — " +
      "niezbędne do wskaźników koncentracji i fixingu (zał. I lit. e i g MAR).",
    krytyczny: false,
  },
  {
    id: "czas_zlecen",
    label: "Różnica czasu złożenia zleceń (TIME_DIFF)",
    // ŚWIADOMIE bez docTypes: kolumnę TIME_DIFF niesie wyłącznie pełny eksport UTP
    // („Transakcje_i_Zlecenia…"). Pliki TREM bywają oznaczone typem DANE_UTP, ale jej
    // NIE zawierają — dopasowanie po typie dawało fałszywy pozytyw (ZASTAL: raport
    // twierdził, że matched orders są wykonalne, choć detektor zwracał 0 z braku danych).
    docTypes: [],
    namePatterns: [/transakcje_i_zlecenia/i],
    unlocks: ["imo"],
    zamow:
      "Dane UTP zawierające różnicę czasu złożenia zleceń stron transakcji (TIME_DIFF) — " +
      "podstawa wskaźnika transakcji umówionych (matched orders).",
    krytyczny: false,
  },
  {
    id: "notowania",
    label: "Notowania / kurs odniesienia instrumentu",
    docTypes: ["NOTOWANIA_REF", "DANE_UTP", "DANE_TREM"],
    namePatterns: [/notowan/i, /kurs/i],
    unlocks: ["pumpdump", "ekofin"],
    zamow: "Notowania instrumentu (OHLC) za okres objęty postanowieniem — plik źródłowy GPW.",
    krytyczny: false,
  },
  {
    id: "espi",
    label: "Raporty bieżące ESPI / EBI",
    docTypes: ["RAPORT_ESPI_EBI"],
    namePatterns: [/espi/i, /ebi/i, /raport\s*bie/i],
    unlocks: ["espi", "infomanip"],
    zamow:
      "Raporty bieżące i okresowe emitenta (ESPI/EBI) za okres objęty postanowieniem — " +
      "do oceny cenotwórczości komunikatów i cross-linku ze skokami kursu.",
    krytyczny: false,
  },
  {
    id: "sprawozdania",
    label: "Sprawozdania finansowe emitenta",
    docTypes: ["SPRAWOZDANIE_FIN"],
    namePatterns: [/sprawozdanie/i, /rachunek\s*zysk/i, /bilans/i],
    unlocks: ["ekofin"],
    zamow:
      "Sprawozdania finansowe emitenta (roczne/okresowe) — test falsyfikacji: czy dynamika kursu " +
      "ma oparcie w fundamentach spółki.",
    krytyczny: false,
  },
  {
    id: "krs",
    label: "Odpisy KRS podmiotów z Grupy",
    docTypes: ["KRS_REJESTR"],
    namePatterns: [/krs/i, /odpis/i],
    unlocks: ["relacje"],
    zamow:
      "Pełne odpisy KRS podmiotów objętych postępowaniem — do ustalenia powiązań osobowych " +
      "(wspólne organy, prokurenci, wspólnicy).",
    krytyczny: false,
  },
  {
    id: "ip",
    label: "Logi logowań (adresy IP) do rachunków",
    docTypes: ["DANE_IP"],
    namePatterns: [/logowania/i, /logins/i, /\bip\b/i],
    unlocks: ["relacje"],
    zamow:
      "Zestawienia logowań do rachunków maklerskich (data, godzina, adres IP) od domów maklerskich — " +
      "do analizy zbieżności infrastruktury.",
    krytyczny: false,
  },
  {
    id: "postanowienie",
    label: "Postanowienie o powołaniu biegłego (pytania organu)",
    docTypes: ["POSTANOWIENIE", "POSTANOWIENIE_SAD", "PYTANIA_BIEGLY"],
    namePatterns: [/postanowienie/i, /pytania/i],
    unlocks: ["pytania"],
    zamow: "Postanowienie o dopuszczeniu dowodu z opinii biegłego wraz z pytaniami do biegłego.",
    krytyczny: true,
  },
];

export type WymogStatus = {
  wymog: Wymog;
  spelniony: boolean;
  /** Skąd wiadomo: dopasowanie po typie dokumentu czy po nazwie pliku. */
  via: "typ" | "nazwa" | null;
  /** Przykładowe pliki potwierdzające (do pokazania biegłemu). */
  przyklady: string[];
  liczba: number;
  /** Pliki, które wymóg by spełniły, gdyby nie brak warstwy tekstowej — do OCR. */
  bezOcr: string[];
};

export type TechnikaStatus = {
  kind: string;
  label: string;
  dostepna: boolean;
  brakujace: string[]; // etykiety niespełnionych wymogów
};

export type RaportKompletnosci = {
  wymogi: WymogStatus[];
  techniki: TechnikaStatus[];
  doZamowienia: string[];
  braki_krytyczne: string[];
  wynik: { spelnione: number; wszystkie: number; pct: number };
};

const basename = (p: string) => p.split(/[/\\]/).pop() ?? p;

/**
 * Nazwa DOKUMENTU, do którego należy plik — po odcięciu oznaczeń wariantu.
 *
 * ⚠️ WARIANT PO OCR BYWA PODZIELONY NA CZĘŚCI. Skan większy niż limit magazynu
 * zapisuje się jako `X.ocr.cz1.pdf` i `X.ocr.cz2.pdf`; oryginał `X.pdf` zostaje
 * bez warstwy tekstowej, ale DOKUMENT jest odczytany. Rozpoznanie szukające
 * wyłącznie `X.ocr.pdf` tych części nie widziało i aplikacja wzywała biegłego
 * do zrobienia OCR-u, który był już zrobiony — na dwóch największych dokumentach
 * sprawy SK Banku (akty oskarżenia, 342 strony każdy).
 */
export const rdzenDokumentu = (rel: string) =>
  basename(rel).normalize("NFC").replace(/\.ocr(\.cz\d+)?\.pdf$/i, ".pdf");

/**
 * Pliki bez warstwy tekstowej, dla których nie ma ŻADNEGO czytelnego wariantu.
 * To one są realną luką: ich treść nie wchodzi do analizy.
 */
export function doOcr<T extends DocLite>(documents: T[]): T[] {
  const czytelne = new Set(
    documents.filter((d) => d.warstwa_tekstu && d.warstwa_tekstu !== "brak").map((d) => rdzenDokumentu(d.rel_path)),
  );
  return documents.filter(
    (d) =>
      d.warstwa_tekstu === "brak" &&
      /\.pdf$/i.test(basename(d.rel_path)) &&
      !czytelne.has(rdzenDokumentu(d.rel_path)),
  );
}

// Wymogi zależą od dziedziny: akta bankowe niosą metodyki limitów i protokoły
// komitetów, a nie arkusze zleceń. Brak typu → GPW, bo sprawy sprzed migracji 0010
// nie mają ustawionego typu i ich raport musi wyglądać jak dotąd.
/** Czy brak tego wymogu przekreśla rdzeń opinii W TEJ ROLI procesowej. */
export function czyKrytyczny(w: Wymog, rola?: string | null): boolean {
  return Array.isArray(w.krytyczny) ? w.krytyczny.includes(kodRoli(rola)) : w.krytyczny;
}

export function buildCompleteness(
  documents: DocLite[],
  typ?: string | null,
  tryb?: string | null,
  rola?: string | null,
): RaportKompletnosci {
  const wszystkieWymogi = typ === "ryzyko_bankowe" ? WYMOGI_BANK : WYMOGI;
  // Brak trybu = karne (tak działały wszystkie sprawy sprzed migracji 0014).
  const trybSprawy = tryb === "cywilne" ? "cywilne" : "karne";
  const zestaw = wszystkieWymogi.filter((w) => !w.tryb || w.tryb === trybSprawy);
  const wymogi: WymogStatus[] = zestaw.map((w) => {
    // 1) dopasowanie po typie dokumentu (mocniejszy sygnał — świadoma klasyfikacja)
    const poTypie = w.docTypes.length
      ? documents.filter((d) => w.docTypes.includes(d.doc_type))
      : [];
    // 2) dopasowanie po nazwie pliku — łapie dane ukryte pod obcym typem
    const poNazwie = (w.namePatterns ?? []).length
      ? documents.filter((d) => (w.namePatterns ?? []).some((re) => re.test(basename(d.rel_path))))
      : [];

    const wszystkie = poTypie.length ? poTypie : poNazwie;
    // SKAN BEZ OCR NIE SPEŁNIA WYMOGU. Dokument bez warstwy tekstowej jest dla
    // analizy plikiem pustym — w sprawie MBR raport pokazywał 10/10, choć dziewięć
    // kluczowych dokumentów miało zero znaków na 125 stronach. Obecność pliku
    // w aktach to nie to samo co dostęp do jego treści.
    const trafienia = wszystkie.filter((d) => d.warstwa_tekstu !== "brak");
    const via: "typ" | "nazwa" | null = poTypie.length ? "typ" : poNazwie.length ? "nazwa" : null;
    // Dedup po nazwie pliku — te same pliki leżą w wielu TOM-ach akt.
    const nazwy = [...new Set(trafienia.map((d) => basename(d.rel_path)))];

    // Do OCR-u kwalifikuje się plik, którego DOKUMENT nie ma żadnego czytelnego
    // wariantu — inaczej lista wzywałaby do powtórzenia pracy już wykonanej.
    const bezOcr = [...new Set(doOcr(wszystkie).map((d) => basename(d.rel_path)))];
    return {
      wymog: w,
      spelniony: nazwy.length > 0,
      bezOcr,
      via,
      przyklady: nazwy.slice(0, 3),
      liczba: nazwy.length,
    };
  });

  const spelnioneIds = new Set(wymogi.filter((w) => w.spelniony).map((w) => w.wymog.id));

  // Moduł jest dostępny, gdy KAŻDY wymóg go odblokowujący jest spełniony.
  // Lista modułów pochodzi z AKTYWNEGO zestawu wymogów, nie ze stałej WYMOGI —
  // inaczej raport sprawy bankowej wypisywałby wash trades i layering, których
  // ta dziedzina w ogóle nie zna.
  const wszystkieTechniki = [...new Set(zestaw.flatMap((w) => w.unlocks))];
  const techniki: TechnikaStatus[] = wszystkieTechniki
    .map((kind) => {
      const potrzebne = zestaw.filter((w) => w.unlocks.includes(kind));
      const brakujace = potrzebne.filter((w) => !spelnioneIds.has(w.id)).map((w) => w.label);
      return { kind, label: TECH_LABEL[kind] ?? kind, dostepna: brakujace.length === 0, brakujace };
    })
    .sort((a, b) => Number(a.dostepna) - Number(b.dostepna) || a.label.localeCompare(b.label, "pl"));

  const niespelnione = wymogi.filter((w) => !w.spelniony);
  const spelnione = wymogi.length - niespelnione.length;

  return {
    wymogi,
    techniki,
    doZamowienia: niespelnione.map((w) => w.wymog.zamow),
    braki_krytyczne: niespelnione.filter((w) => czyKrytyczny(w.wymog, rola)).map((w) => w.wymog.label),
    wynik: {
      spelnione,
      wszystkie: wymogi.length,
      pct: Math.round((spelnione / wymogi.length) * 100),
    },
  };
}

/** Tekst wniosku do organu — gotowy do wklejenia w pismo. */
export function pismoDoOrganu(r: RaportKompletnosci, caseName: string, sygn: string | null): string {
  if (!r.doZamowienia.length) return "";
  const zablokowane = r.techniki.filter((t) => !t.dostepna).map((t) => t.label);
  return (
    `Wniosek o uzupełnienie materiału dowodowego — sprawa ${caseName}` +
    `${sygn ? ` (sygn. ${sygn})` : ""}\n\n` +
    `W celu wykonania opinii w pełnym zakresie niezbędne jest uzupełnienie akt o:\n\n` +
    r.doZamowienia.map((z, i) => `${i + 1}. ${z}`).join("\n\n") +
    (zablokowane.length
      ? `\n\nBez powyższych materiałów niemożliwe jest przeprowadzenie analizy w zakresie: ` +
        `${zablokowane.join(", ")}.`
      : "")
  );
}
