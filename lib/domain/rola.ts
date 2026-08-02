// Rola procesowa sprawy — CZYJE ZACHOWANIE oceniamy. Trzecia oś obok dziedziny i trybu.
//
// DLACZEGO TO NIE MIEŚCI SIĘ W DZIEDZINIE ANI W TRYBIE
// Dziedzina mówi, CO się bada (manipulacja instrumentem / ryzyko bankowe). Tryb mówi,
// KOMU biegły odpowiada (prokuratura / sąd cywilny). Żadne z nich nie mówi, KOGO
// dotyczy zarzut — a to zmienia zarówno pytanie, jak i to, jakie dokumenty są dla
// opinii niezbędne:
//
//   MBR  (PO III Ds 84.2020) — oceniano decyzję BANKU o ulokowaniu środków u kontrahenta
//                              zagranicznego. Rdzeniem akt są dokumenty wewnętrzne banku:
//                              metodyka limitów, protokoły komitetu, ustalenia audytu.
//   SK Bank (II C 595/23)    — oceniane jest zachowanie NADZORCY wobec banku. Rdzeniem
//                              akt jest zapis czynności nadzorczych; metodyki limitów
//                              nie ma, bo leży u syndyka upadłego banku i nikt o nią nie pyta.
//
// CO WYSZŁO NA SPRAWIE SK BANKU
// Cała aplikacja miała zaszyte domyślne ustawienie pierwszej sprawy — „badamy bank
// oceniający kontrahenta". Objawiało się to w miejscach, które z pozoru nie mają ze
// sobą nic wspólnego:
//   • wniosek do sądu prosił o „spready CDS ocenianego kontrahenta" — dla niegiełdowego
//     banku spółdzielczego materiał nieistniejący;
//   • rozdział z kwotami odczytanymi z harmonogramu UKNF nosił tytuł „Analiza sprawozdań
//     finansowych kontrahenta";
//   • brak metodyki limitów banku był wykazywany jako brak KRYTYCZNY w sprawie, w której
//     pozwanym jest nadzorca — czyli raport twierdził, że opinii nie da się wydać.
// Żaden z nich nie był błędem logiki. Wszystkie były domyślnym ustawieniem, które nie
// miało gdzie być zapisane, więc siedziało w treści.

export type Rola = "ocena_kontrahenta" | "nadzor_nad_bankiem" | "organy_banku";

export type OpisRoli = {
  /** Etykieta do interfejsu. */
  label: string;
  /** Czyje zachowanie jest przedmiotem oceny — pierwsze zdanie promptu. */
  przedmiotOceny: string;
  /**
   * Jak nazywać podmiot, którego liczby analizujemy. NIE „kontrahent" wszędzie:
   * w sprawie o nadzór badanym podmiotem jest sam bank, a kontrahenta nie ma.
   */
  podmiotLiczb: string;
  /** Tytuł rozdziału o kwotach — zależy od tego, czyje to sprawozdania. */
  tytulKwot: string;
  /** Czego w tej roli biegły NIE ustala, choć w innej by ustalał. */
  pozaZakresem: string;
};

export const ROLE: Record<Rola, OpisRoli> = {
  ocena_kontrahenta: {
    label: "Ocena kontrahenta przez bank",
    przedmiotOceny:
      "przedmiotem oceny jest proces decyzyjny BANKU, który angażował środki wobec innego " +
      "podmiotu — badasz, czy bank rozpoznał ryzyko, którym się obciążył",
    podmiotLiczb: "podmiot, wobec którego bank oceniał ryzyko (kontrahent)",
    tytulKwot: "Analiza sprawozdań finansowych kontrahenta",
    pozaZakresem:
      "ocena prawidłowości nadzoru sprawowanego nad bankiem przez organ państwowy — " +
      "przedmiotem tej opinii jest zachowanie banku, nie organu",
  },
  nadzor_nad_bankiem: {
    label: "Nadzór nad bankiem",
    przedmiotOceny:
      "przedmiotem oceny jest zachowanie ORGANU NADZORU (i ewentualnie banku zrzeszającego) " +
      "wobec banku — badasz, jakimi danymi o sytuacji banku dysponował nadzorca i w którym " +
      "momencie, a nie jak bank oceniał swoich kontrahentów",
    podmiotLiczb: "bank objęty nadzorem",
    tytulKwot: "Wielkości bilansowe banku w okresach sprawozdawczych",
    pozaZakresem:
      "ocena wewnętrznego procesu kredytowego banku w oderwaniu od tego, co było widoczne " +
      "dla nadzorcy — dokumenty wewnętrzne banku są tu materiałem pomocniczym, nie przedmiotem",
  },
  organy_banku: {
    label: "Odpowiedzialność organów banku",
    przedmiotOceny:
      "przedmiotem oceny jest działanie ORGANÓW BANKU (zarządu, rady nadzorczej, komitetów) — " +
      "badasz, czy osoby zarządzające prowadziły sprawy banku z zachowaniem wymaganej staranności",
    podmiotLiczb: "bank, którego organy są przedmiotem oceny",
    tytulKwot: "Analiza sprawozdań finansowych banku",
    pozaZakresem:
      "ocena zachowania organu nadzoru — chyba że postanowienie wyraźnie obejmuje ją zakresem",
  },
};

/**
 * Rola sprawy. Brak wartości → ocena kontrahenta, bo tak działały wszystkie sprawy
 * bankowe sprzed migracji 0015 i ich opinie mają zostać nietknięte.
 */
export function rolaDla(rola?: string | null): OpisRoli {
  return ROLE[(rola ?? "") as Rola] ?? ROLE.ocena_kontrahenta;
}

/** Kod roli po normalizacji — do porównań z listami w wymogach kompletności. */
export function kodRoli(rola?: string | null): Rola {
  return (rola ?? "") in ROLE ? (rola as Rola) : "ocena_kontrahenta";
}

/**
 * Blok promptu opisujący rolę — wspólny dla redakcji rozdziałów i wniosków.
 *
 * Trzymany razem z `blokTrybu`, bo obie rzeczy odpowiadają na pytanie „o czym ta
 * opinia w ogóle jest" i rozjazd między nimi byłby widoczny w gotowym dokumencie.
 */
export function blokRoli(rola?: string | null): string {
  const r = rolaDla(rola);
  return (
    `W TEJ SPRAWIE ${r.przedmiotOceny}. Podmiot, którego wielkości finansowe analizujesz, ` +
    `to ${r.podmiotLiczb} — nazywaj go po imieniu, ustalonym z akt, i nie używaj określenia ` +
    `„kontrahent”, jeżeli w tej sprawie nikt takiej roli nie pełni. ` +
    `POZA ZAKRESEM TEJ OPINII pozostaje: ${r.pozaZakresem}.`
  );
}
