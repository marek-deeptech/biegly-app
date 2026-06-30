// Biblioteka prawna — jedno źródło odniesień i definicji technik manipulacji.
//
// Wyłuskane z finalnych opinii KM (HubTech, MLM). Zasila rozdział III (ujęcie
// teoretyczne) ORAZ zakotwiczenia prawne w rozdziałach IV i w Wnioskach (II).
// Raz zdefiniowane — re-używalne między sprawami (teoria jest taka sama).

export type TechniqueId = "wash" | "imo" | "layering" | "pumpdump" | "infomanip";

export type Technique = {
  id: TechniqueId;
  label: string; // nazwa rozdziału/techniki
  mar: string; // odniesienie do MAR
  rd: string; // odniesienie do RD 2016/522, zał. II
  definicja: string; // definicja wg RD/MAR (do rozdz. III) — bez liczb sprawy
};

// Definicje wprost z RD 2016/522, zał. II, sekcja 1 (cytowane w opiniach KM).
export const TECHNIQUES: Record<TechniqueId, Technique> = {
  wash: {
    id: "wash",
    label: "Wash trades",
    mar: "art. 12 ust. 1 lit. a MAR",
    rd: "załącznik II, sekcja 1, pkt 3 lit. a RD 2016/522",
    definicja:
      "Wash trades (sztuczny obrót) — przystępowanie do porozumień sprzedaży lub kupna " +
      "instrumentu finansowego, w przypadku gdy nie zachodzi żadna zmiana w udziałach w " +
      "korzyściach lub w ryzyku rynkowym, albo gdy udział w korzyściach bądź ryzyko rynkowe " +
      "zostaje przeniesione między stronami działającymi w porozumieniu lub w zmowie. " +
      "Transakcje takie nie zmieniają rzeczywistego właściciela ekonomicznego instrumentu i " +
      "wywołują mylne wrażenie obrotu oraz płynności.",
  },
  imo: {
    id: "imo",
    label: "Improper matched orders",
    mar: "art. 12 ust. 1 lit. a MAR",
    rd: "załącznik II, sekcja 1, pkt 3 lit. c RD 2016/522",
    definicja:
      "Niewłaściwe zlecenia dopasowane (improper matched orders) — składanie zleceń kupna i " +
      "sprzedaży o identycznych lub zbliżonych parametrach (cena, wolumen), w krótkich odstępach " +
      "czasu, z rachunków pozostających pod kontrolą lub działających w porozumieniu. Eliminują " +
      "rynkową losowość procesu dopasowania zleceń i wytwarzają mylące sygnały co do wolumenu i " +
      "płynności instrumentu.",
  },
  layering: {
    id: "layering",
    label: "Layering and spoofing",
    mar: "art. 12 ust. 1 lit. a MAR",
    rd: "załącznik II, sekcja 1, pkt 5 lit. e RD 2016/522",
    definicja:
      "Layering i spoofing — wprowadzanie zleceń, które wycofuje się przed ich wykonaniem, co " +
      "skutkuje lub może skutkować wywołaniem mylnego wrażenia popytu lub podaży instrumentu " +
      "finansowego w danej cenie — zazwyczaj znane jako składanie zleceń bez zamiaru ich " +
      "wykonania (placing orders with no intention of executing them).",
  },
  pumpdump: {
    id: "pumpdump",
    label: "Pump and dump",
    mar: "art. 12 ust. 2 lit. c MAR",
    rd: "załącznik II, sekcja 1, pkt 4 lit. c RD 2016/522",
    definicja:
      "Pump and dump — zajmowanie pozycji długiej w instrumencie finansowym, a następnie " +
      "podejmowanie dalszych działań (kupno lub szerzenie wprowadzających w błąd pozytywnych " +
      "informacji) w celu podwyższenia ceny przez przyciągnięcie innych kupujących. Gdy cena " +
      "znajduje się na sztucznie wysokim poziomie, zajęta pozycja długa jest wyprzedawana.",
  },
  infomanip: {
    id: "infomanip",
    label: "Manipulacja informacją",
    mar: "art. 12 ust. 1 lit. c MAR",
    rd: "—",
    definicja:
      "Manipulacja informacją — rozpowszechnianie za pośrednictwem mediów informacji, które " +
      "wprowadzają lub mogą wprowadzać w błąd co do instrumentu finansowego, w tym " +
      "komunikatów spółki tworzących fałszywy, pozytywny obraz emitenta w celu wywołania " +
      "zainteresowania jej instrumentami.",
  },
};

// Odniesienia pomocnicze przywoływane w Wnioskach (insider / informacja poufna).
export const LEGAL_REFS = {
  informacjaPoufna: "art. 7 ust. 1 MAR (definicja informacji poufnej)",
  obowiazekRaportowy: "art. 17 ust. 1 MAR (publikacja informacji poufnej)",
  insider: "art. 8 i art. 14 MAR (wykorzystanie informacji poufnej)",
  manipulacja: "art. 12 MAR oraz załącznik I do MAR (wskaźniki manipulacji)",
  uofi: "art. 183 ustawy z dnia 29 lipca 2005 r. o obrocie instrumentami finansowymi",
};

// Cztery pytania prokuratora (rozdz. I) — identyczne w obu opiniach KM.
// Wnioski (II) odpowiadają na każde z nich.
export const PROSECUTOR_QUESTIONS = [
  "Q1. Czy zlecenia i transakcje ustalały w sposób nienaturalny lub sztuczny cenę akcji, " +
    "wprowadzały lub mogły wprowadzić w błąd co do podaży, popytu bądź ceny, oraz czy były " +
    "racjonalne i uzasadnione ekonomicznie (danymi makro- i mikroekonomicznymi, strategią " +
    "inwestycyjną)?",
  "Q2. Czy i jakie techniki manipulacyjne stosowali wymienieni, w celu wywołania skutków z Q1?",
  "Q3. Jakie okoliczności (składanie zleceń i zawieranie transakcji) wskazują na działanie " +
    "wspólne i w porozumieniu wskazanych osób?",
  "Q4. Inne uwagi biegłego mające związek z przedmiotem postępowania.",
];

// UWAGA: nie przechowujemy tu „akapitu-mechanizmu" przejętego z opinii KM —
// byłaby to skopiowana KONKLUZJA, a wnioski muszą wynikać z materiału dowodowego
// (zob. zasada evidence-only). Prozę wniosków generuje się warunkowo z subanaliz.

export function techniqueRef(id: TechniqueId): string {
  const t = TECHNIQUES[id];
  return `${t.mar}; ${t.rd}`;
}
