// TAKSONOMIA I WYMOGI KOMPLETNOŚCI DLA AKT BANKOWYCH.
//
// Reguły wyprowadzone z realnych akt sprawy PO III Ds 84.2020 (84 pliki), nie
// wymyślone — tak jak słownictwo technik w repozytorium wiedzy zostało zmierzone
// na korpusie, zamiast zgadnięte. Test `tests/…` sprawdza je wobec tej listy plików.
//
// Zestaw reguł jest ODDZIELNY od GPW, a nie doklejony: klasyfikacja spraw
// manipulacyjnych działa dziś poprawnie na trzech sprawach i nie ma powodu, by
// ryzykować jej regresję przez dopisywanie fraz do wspólnej listy. Wybór zestawu
// robi `classifyPath` na podstawie typu sprawy.
import type { DocType } from "@/lib/intake/taxonomy";
import type { Wymog } from "@/lib/intake/completeness";

/** Typy dokumentów właściwe dla akt bankowych (poza wspólnym rdzeniem). */
export const DOC_TYPES_BANK: Record<string, DocType> = {
  METODYKA_LIMITOW: { label: "Metodyka wyznaczania limitów zaangażowania", source: "bank", provenance: "wejście" },
  UCHWALA_WEWNETRZNA: { label: "Uchwała organu banku (kompetencje, procedury)", source: "bank", provenance: "wejście" },
  PROTOKOL_KOMITETU: { label: "Protokół komitetu (KZAiP, kredytowy, ryzyka)", source: "bank", provenance: "wejście" },
  AUDYT_WEWNETRZNY: { label: "Ustalenia audytu wewnętrznego", source: "bank", provenance: "wejście" },
  KORESPONDENCJA_WEWN: { label: "Korespondencja wewnętrzna departamentów", source: "bank", provenance: "wejście" },
  NADZOR_KNF: { label: "Materiał organu nadzoru (BION, postępowanie, raporty sektorowe)", source: "KNF / KNB", provenance: "wejście" },
  SPRAWOZDANIE_BANK: { label: "Sprawozdanie finansowe banku (emitenta lub kontrahenta)", source: "bank", provenance: "wejście" },
  RAPORT_BANK_CENTRALNY: { label: "Raport banku centralnego (stabilność finansowa, biuletyn)", source: "bank centralny", provenance: "wejście" },
  DANE_RYNKOWE_SZEREG: { label: "Szereg danych rynkowych (CDS, kursy, stopy, indeksy)", source: "źródło rynkowe", provenance: "wejście" },
  RATING_AGENCJA: { label: "Rating / komunikat agencji ratingowej", source: "agencja ratingowa", provenance: "wejście" },
  PRASA: { label: "Publikacja prasowa (dowód stanu wiedzy powszechnej)", source: "media", provenance: "wejście" },
  AKT_PRAWNY: { label: "Akt prawny (ustawa, rozporządzenie, uchwała nadzorcza)", source: "źródło prawa", provenance: "wejście" },
  RACHUNEK_BIEGLEGO: { label: "Rachunek / karta pracy biegłego (dokument rozliczeniowy)", source: "biegły sądowy", provenance: "wyjście" },
  GRAFIKA: { label: "Wykres / ilustracja do opinii", source: "biegły sądowy", provenance: "wyjście" },
};

// Kolejność ma znaczenie — pierwsze trafienie wygrywa, od szczegółu do ogółu.
// Pułapki wychwycone na realnych nazwach z akt MBR, opisane przy regułach.
export const RULES_BANK: { phrases: string[]; code: string }[] = [
  // Wytwory biegłego i dokumenty rozliczeniowe — przed wszystkim, bo „opinia"
  // i „rachunek" trafiają się też w nazwach materiałów wejściowych.
  { phrases: ["rachunek i karta", "karta biegłego", "karta bieglego"], code: "RACHUNEK_BIEGLEGO" },
  { phrases: ["opinia po ", "opinia_po", "opinia biegłego", "opinia bieglego", "km finał", "michrowski"], code: "OPINIA_BIEGLEGO" },

  // Grafika MUSI iść przed regułami merytorycznymi: „grafika/CDS Glitnir.jpg" trafiał
  // do danych rynkowych, bo podciąg „cds" pasował wcześniej. To wykres sporządzony
  // do opinii — wyjście, nie dowód, i nie może zawyżać kompletności akt.
  // Kompromis świadomy: gdyby sprawa niosła dowody fotograficzne, wymagałyby ręcznej
  // reklasyfikacji — w tych aktach wszystkie obrazy to wykresy biegłego.
  { phrases: ["grafika/", "wykres ", ".png", ".jpg", ".jpeg"], code: "GRAFIKA" },

  { phrases: ["postanowienie o powołaniu", "postanowienie o powolaniu", "postanowienie"], code: "POSTANOWIENIE" },
  { phrases: ["zawiadomienie knf", "zawiadomienie o podejrzeniu"], code: "ZAWIADOMIENIE_KNF" },

  // Dokumenty wewnętrzne banku. „uchwała metodyka limitow" i „tabela limity"
  // muszą wyprzedzić ogólną regułę uchwał, bo obie zawierają słowo „uchwała".
  { phrases: ["metodyka limit", "tabela limity", "limity zaangażowania", "limity zaangazowania", "limit koncentracji"], code: "METODYKA_LIMITOW" },
  { phrases: ["kzaip", "protokoł", "protokół", "protokoly", "protokoły", "komitet zarządzania", "komitet kredytowy"], code: "PROTOKOL_KOMITETU" },
  { phrases: ["audyt wew", "audyt-wew", "audytu wewnętrznego", "audytorów", "audytorow"], code: "AUDYT_WEWNETRZNY" },

  // Materiały organu nadzoru PRZED aktami prawnymi: „KNB bankispoldzielcze 2006"
  // to raport sektorowy nadzoru, a nie źródło prawa, choć zawiera skrót KNB.
  { phrases: ["bion", "postępowanie wyjaśniające", "postepowanie wyjasniajace", "raport_banki", "raport banki",
              "informacja_o_sytuacji_bankow", "sytuacji banków", "bankispoldzielcze", "banki spółdzielcze 200",
              "synteza", "rekomendacja "], code: "NADZOR_KNF" },

  // Akty prawne. „rozporządzenie - rating" to regulacja DOTYCZĄCA ratingów, więc
  // musi wyprzedzić regułę agencji ratingowych.
  { phrases: ["prawo bankowe", "funkcjonowanie banków spółdzielczych", "funkcjonowanie bankow spoldzielczych",
              "575/2013", "2013/36", " crr", " crd", "uchwała nr", "uchwala nr", "komisji nadzoru bankowego",
              "rozporządzenie", "rozporzadzenie", "ustawa"], code: "AKT_PRAWNY" },
  { phrases: ["moody", "fitch", "standard & poor", "s&p", "rating"], code: "RATING_AGENCJA" },

  // Sprawozdania kontrahenta. „SF-GLITNIR-2008-2q" — stąd prefiks „sf-".
  // Uwaga: „sprawozdawczość" NIE zawiera podciągu „sprawozdanie", więc nie koliduje.
  { phrases: ["sf-", "sprawozdanie finansowe", "financial statement", "annual report", "interim report",
              "raport roczny", "raport półroczny"], code: "SPRAWOZDANIE_BANK" },
  { phrases: ["financial stability", "monetary bulletin", "biuletyn monetarny", "stabilność finansowa",
              "bank centralny", "central bank", "cbi "], code: "RAPORT_BANK_CENTRALNY" },

  // Szeregi danych rynkowych — wejście silnika.
  { phrases: ["cds", "icex", "_d.csv", "inflation outlook", "notowania", "kursy walut", "stopy procentowe"], code: "DANE_RYNKOWE_SZEREG" },

  // Prasa: dowód na stan wiedzy POWSZECHNEJ, nie na wiedzę banku.
  { phrases: ["financial times", "gazeta wyborcza", "rzeczpospolita", "puls biznesu", "bloomberg", "reuters",
              "w tarapatach", "whispers"], code: "PRASA" },

  { phrases: ["pismo z dnia", "notatka służbowa", "notatka sluzbowa", "korespondencja", "departament ryzyka"], code: "KORESPONDENCJA_WEWN" },
  { phrases: ["uchwała", "uchwala"], code: "UCHWALA_WEWNETRZNA" },

  // Literatura na końcu — najszersza reguła, ma łapać resztę materiału naukowego.
  { phrases: ["bibliografia/", "podręcznik", "podrecznik", "monografia", "praca magisterska", "praca_magisterska",
              "rozprawa doktorska", "zarządzanie ryzykiem", "zarzadzanie ryzykiem", "zarz ryzykiem", "basel",
              "ryzyko kredytowe", "ryzyka", "bankowość", "bankowosc", "instrumenty pochodne", "inst. pochodne",
              "sprawozdawczość", "sprawozdawczosc", "decyzje finansowe", "interbank", "subprime", "upadku"], code: "LITERATURA" },
];

/** Wymogi kompletności akt bankowych — moduły z pakietu `ryzyko_bankowe`. */
export const WYMOGI_BANK: Wymog[] = [
  {
    id: "postanowienie",
    label: "Postanowienie o powołaniu biegłego (z pytaniami organu)",
    docTypes: ["POSTANOWIENIE"],
    namePatterns: [/postanowieni/i, /powołani[ue] biegłego/i],
    unlocks: ["pytania"],
    zamow: "Postanowienie o dopuszczeniu dowodu z opinii biegłego wraz z pełną treścią pytań.",
    krytyczny: true,
  },
  {
    id: "sprawozdania_kontrahenta",
    label: "Sprawozdania finansowe podmiotu ocenianego (min. 2 okresy)",
    docTypes: ["SPRAWOZDANIE_BANK"],
    namePatterns: [/\bsf-/i, /sprawozdanie finansowe/i, /financial statement/i, /annual report/i],
    unlocks: ["sprawozdania", "adekwatnosc"],
    zamow:
      "Sprawozdania finansowe podmiotu, wobec którego oceniano ryzyko, za co najmniej dwa kolejne okresy poprzedzające zdarzenie — wraz z notą o funduszach własnych i aktywach ważonych ryzykiem.",
    krytyczny: true,
  },
  {
    id: "metodyka_limitow",
    label: "Metodyka wyznaczania limitów zaangażowania",
    docTypes: ["METODYKA_LIMITOW"],
    namePatterns: [/metodyk\w* limit/i, /limit\w* zaangażowan/i],
    unlocks: ["limity"],
    zamow:
      "Obowiązująca w dacie zdarzenia metodyka wyznaczania limitów zaangażowania wraz z uchwałą wprowadzającą i wysokością limitów dla ocenianego kontrahenta.",
    krytyczny: true,
  },
  {
    id: "protokoly",
    label: "Protokoły komitetu zatwierdzającego limity i decyzje",
    docTypes: ["PROTOKOL_KOMITETU"],
    namePatterns: [/protoko[łl]/i, /kzaip/i],
    unlocks: ["procedury", "limity"],
    zamow:
      "Protokoły posiedzeń komitetu zarządzania aktywami i pasywami (lub równoważnego) z okresu obejmującego zatwierdzenie limitów i podjęcie ocenianej decyzji.",
    krytyczny: true,
  },
  {
    id: "uchwaly",
    label: "Uchwały określające kompetencje decyzyjne",
    docTypes: ["UCHWALA_WEWNETRZNA"],
    namePatterns: [/uchwa[łl]\w* kompetencj/i, /regulamin/i],
    unlocks: ["procedury"],
    zamow: "Uchwały określające podział kompetencji do podejmowania decyzji o zaangażowaniu środków.",
    krytyczny: false,
  },
  {
    id: "szeregi_rynkowe",
    label: "Szeregi danych rynkowych (CDS, kursy, stopy, indeksy)",
    docTypes: ["DANE_RYNKOWE_SZEREG"],
    namePatterns: [/\bcds\b/i, /icex/i, /\.csv$/i, /inflation/i],
    unlocks: ["makro", "sygnaly_rynkowe"],
    zamow:
      "Notowania spreadów CDS ocenianego podmiotu oraz szeregi kursów walutowych, stóp procentowych i inflacji za okres poprzedzający zdarzenie.",
    krytyczny: false,
  },
  {
    id: "raporty_bc",
    label: "Raporty banku centralnego i o stabilności finansowej",
    docTypes: ["RAPORT_BANK_CENTRALNY"],
    namePatterns: [/financial stability/i, /monetary bulletin/i, /biuletyn monetarny/i],
    unlocks: ["makro", "ekspozycja_sektor"],
    zamow: "Raporty o stabilności finansowej i biuletyny monetarne kraju siedziby kontrahenta z okresu badanego.",
    krytyczny: false,
  },
  {
    id: "nadzor",
    label: "Materiały organu nadzoru (BION, postępowanie wyjaśniające)",
    docTypes: ["NADZOR_KNF"],
    namePatterns: [/\bbion\b/i, /postępowani\w* wyjaśniając/i],
    unlocks: ["procedury", "otoczenie_prawne"],
    zamow: "Materiały organu nadzoru dotyczące banku: ocena BION, ustalenia postępowania wyjaśniającego, zalecenia.",
    krytyczny: false,
  },
  {
    id: "audyt",
    label: "Ustalenia audytu wewnętrznego",
    docTypes: ["AUDYT_WEWNETRZNY"],
    namePatterns: [/audyt\w* wew/i],
    unlocks: ["procedury"],
    zamow: "Raporty audytu wewnętrznego dotyczące procesu identyfikacji ryzyka i limitów zaangażowania.",
    krytyczny: false,
  },
  {
    id: "prasa",
    label: "Publikacje prasowe z okresu poprzedzającego zdarzenie",
    docTypes: ["PRASA"],
    namePatterns: [/financial times/i, /gazeta/i, /rzeczpospolita/i],
    unlocks: ["media"],
    zamow:
      "Publikacje prasowe dotyczące sytuacji kontrahenta i jego rynku, opublikowane przed dniem ocenianej decyzji (dowód stanu wiedzy powszechnie dostępnej).",
    krytyczny: false,
  },
];
