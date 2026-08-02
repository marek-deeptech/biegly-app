// Tryb postępowania — karne albo cywilne. JEDNO miejsce, w którym zapisane jest,
// czym różni się opinia dla prokuratora od opinii dla sądu cywilnego.
//
// DLACZEGO TO NIE JEST CECHA DZIEDZINY
// Dziedzina mówi, CO się bada (manipulacja instrumentem / ryzyko bankowe). Tryb mówi,
// KOMU i w jakim postępowaniu odpowiada biegły — a to są osie niezależne: sprawa
// bankowa może być karna (MBR, PO III Ds 84.2020) albo cywilna (SK Bank, II C 595/23),
// tak samo manipulacyjna.
//
// CO WYSZŁO NA SPRAWIE SK BANKU
// Wszystkie prompty bankowe mówiły „opinia w sprawie karnej na zlecenie prokuratury"
// i odsyłały do organu „kwalifikację czynu", powołując art. 296 k.k. W sprawie
// II C 595/23 (powództwo o zapłatę przeciwko UKNF i Bankowi BPS) taka opinia byłaby
// adresowana do nieistniejącego adresata i zastrzegałaby się co do rzeczy, o które
// nikt nie pyta — a milczałaby o granicy, która tam obowiązuje naprawdę: ocena
// odpowiedzialności odszkodowawczej należy do sądu, nie do biegłego.

export type Tryb = "karne" | "cywilne";

export type OpisTrybu = {
  /** Etykieta do interfejsu. */
  label: string;
  /** Kto zleca i czyta opinię — wchodzi w pierwsze zdanie promptu. */
  rola: string;
  /** Skąd biorą się pytania, na które opinia odpowiada. */
  zrodloPytan: string;
  /** Czego biegłemu NIE WOLNO przesądzać — granica kompetencji w tym trybie. */
  pozaKompetencja: string;
  /** Jak nazywać uczestników. Podsunięcie nazewnictwa, nie ustaleń. */
  strony: string;
  /**
   * Klauzula zamykająca dokument, nad podpisem biegłego.
   *
   * ⚠️ SPRAWDZONE, WBREW PIERWSZEMU WRAŻENIU: powołanie na art. 233 § 4 k.k. jest
   * właściwe TAKŻE w sprawie cywilnej. Przepis dotyczy fałszywej opinii mającej
   * służyć za dowód „w postępowaniu sądowym lub w innym postępowaniu prowadzonym
   * na podstawie ustawy" (§ 1), a więc obejmuje postępowanie cywilne — nie jest to
   * formuła zarezerwowana dla spraw karnych.
   *
   * Pole istnieje mimo to, bo klauzula bywa uzupełniana o powołanie na przyrzeczenie
   * złożone przy objęciu funkcji, a podstawa tego powołania jest inna w każdym
   * z trybów. Treść takiego uzupełnienia MUSI podać biegły — to formuła procesowa
   * w dokumencie, który on podpisuje, a nie miejsce na domysł aplikacji.
   */
  klauzulaKoncowa: string;
  /**
   * Jak nazywa się orzeczenie powołujące biegłego w tym trybie — wchodzi do formuły
   * wstępnej na stronie tytułowej. Sąd cywilny DOPUSZCZA DOWÓD z opinii biegłego
   * (art. 278 k.p.c.), organ postępowania karnego POWOŁUJE BIEGŁEGO (art. 193–194 k.p.k.).
   */
  podstawaPowolania: string;
};

const KLAUZULA_233 =
  "Świadom odpowiedzialności karnej za złożenie fałszywej opinii (art. 233 § 4 k.k.) " +
  "oświadczam, że opinię sporządziłem zgodnie z najlepszą wiedzą.";

export const TRYBY: Record<Tryb, OpisTrybu> = {
  karne: {
    label: "Karne",
    rola:
      "sporządzasz opinię w sprawie karnej na zlecenie organu prowadzącego postępowanie " +
      "(prokuratury albo sądu karnego)",
    zrodloPytan: "pytania organu z postanowienia o dopuszczeniu dowodu z opinii biegłego",
    pozaKompetencja:
      "wina, zamiar i kwalifikacja prawna czynu — te należą wyłącznie do organu procesowego " +
      "i nie wolno ich przesądzać ani sugerować",
    strony: "podejrzany/oskarżony, pokrzywdzony",
    klauzulaKoncowa: KLAUZULA_233,
    podstawaPowolania: "postanowienia o powołaniu biegłego",
  },
  cywilne: {
    label: "Cywilne",
    rola: "sporządzasz opinię na zlecenie sądu cywilnego, w sprawie z powództwa strony",
    zrodloPytan:
      "teza dowodowa z postanowienia sądu o dopuszczeniu dowodu z opinii biegłego oraz pytania " +
      "stron, jeżeli sąd dopuścił je do rozpoznania",
    pozaKompetencja:
      "ocena odpowiedzialności odszkodowawczej, wykładnia przepisów, ocena wiarygodności " +
      "świadków i rozstrzygnięcie o żądaniu pozwu — to należy do sądu; biegły dostarcza " +
      "wiadomości specjalnych, a nie ocenia roszczenia",
    strony: "powód, pozwani",
    klauzulaKoncowa: KLAUZULA_233,
    podstawaPowolania: "postanowienia o dopuszczeniu dowodu z opinii biegłego",
  },
};

/** Tryb sprawy; brak wartości = karne, bo tak działały wszystkie sprawy sprzed migracji 0014. */
export function trybDla(tryb?: string | null): OpisTrybu {
  return TRYBY[(tryb ?? "") as Tryb] ?? TRYBY.karne;
}

/**
 * Blok promptu opisujący tryb — wspólny dla redakcji rozdziałów, wniosków i wstępu.
 *
 * Trzyma się w jednym miejscu, bo rozjazd między rozdziałami byłby widoczny w gotowym
 * dokumencie: jeden rozdział zastrzegałby się co do kwalifikacji czynu, a sąsiedni
 * co do odpowiedzialności odszkodowawczej.
 */
export function blokTrybu(tryb?: string | null): string {
  const t = trybDla(tryb);
  return (
    `Jesteś biegłym sądowym: ${t.rola}. Odpowiadasz na ${t.zrodloPytan}. ` +
    `POZA TWOJĄ KOMPETENCJĄ pozostają: ${t.pozaKompetencja}. ` +
    `Strony postępowania nazywaj właściwie dla tego trybu (${t.strony}). ` +
    // ⚠️ Akta bywają MIESZANE. W sprawie SK Banku (cywilnej) leży akt oskarżenia
    // z art. 296 k.k., a model przeniósł z niego ramę karną: rozdział kończył się
    // zastrzeżeniem „kwalifikacja z art. 296 § 1 i 3 k.k. pozostaje w gestii sądu",
    // choć w tym postępowaniu nikogo nie oskarża się o przestępstwo.
    "AKTA MOGĄ ZAWIERAĆ MATERIAŁ Z INNEGO POSTĘPOWANIA (np. akt oskarżenia w sprawie " +
    "karnej). Możesz się na nie powoływać jako na DOWÓD, ale zastrzeżeń właściwych " +
    "tamtemu trybowi nie przenoś do tej opinii — granica Twojej kompetencji wynika " +
    "z postępowania, w którym Cię powołano, a nie z dokumentów leżących w aktach."
  );
}


// ── Formuła wstępna ──────────────────────────────────────────────────────────
const MIESIACE = [
  "stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca",
  "lipca", "sierpnia", "września", "października", "listopada", "grudnia",
];

/** Data po polsku, w dopełniaczu („12 lutego 2025 r."). */
export function dataSlownie(iso?: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? "").slice(0, 10));
  if (!m) return "";
  return `${Number(m[3])} ${MIESIACE[Number(m[2]) - 1]} ${m[1]} r.`;
}

/**
 * Nazwa organu w DOPEŁNIACZU („na zlecenie Sądu Okręgowego w Warszawie").
 *
 * ⚠️ ZAMKNIĘTY ZBIÓR, NIE ODMIANA OGÓLNA. Biegłego sądowego powołuje sąd albo
 * prokuratura — dwa słowa do odmiany, w kilku wariantach. Ogólna odmiana polskich
 * nazw własnych jest zawodna, a błąd gramatyczny stoi na stronie tytułowej
 * dokumentu procesowego. Gdy wzorzec nie pasuje, NIE ZGADUJEMY: zwracamy null,
 * a zdanie układa się z dwukropkiem, który dopuszcza mianownik.
 */
const ODMIANA: Record<string, string> = {
  sąd: "Sądu",
  prokuratura: "Prokuratury",
  okręgowy: "Okręgowego",
  rejonowy: "Rejonowego",
  apelacyjny: "Apelacyjnego",
  wojewódzki: "Wojewódzkiego",
  najwyższy: "Najwyższego",
  okręgowa: "Okręgowej",
  rejonowa: "Rejonowej",
  regionalna: "Regionalnej",
  krajowa: "Krajowej",
};

export function dopelniaczOrganu(nazwa: string): string | null {
  const slowa = nazwa.trim().split(/\s+/);
  if (slowa.length < 2) return null;
  const [pierwsze, drugie, ...reszta] = slowa;
  const a = ODMIANA[pierwsze.toLowerCase()];
  const b = ODMIANA[drugie.toLowerCase()];
  if (!a || !b) return null;
  return [a, b, ...reszta].join(" ");
}

/**
 * Zdanie otwierające opinię: kto ją zlecił i na jakiej podstawie.
 *
 * ⚠️ NIE ZGADUJEMY. Bez nazwy organu zwracamy pusty napis — dokument bez tej formuły
 * jest niekompletny, ale dokument z organem wymyślonym przez aplikację byłby
 * dokumentem nieprawdziwym. Braku pilnuje recenzent, a nie domysł.
 */
export function formulaWstepna(opts: {
  organ?: string | null;
  dataPowolania?: string | null;
  signature?: string | null;
  tryb?: string | null;
}): string {
  const organ = (opts.organ ?? "").trim();
  if (!organ) return "";
  const data = dataSlownie(opts.dataPowolania);
  const t = trybDla(opts.tryb);
  const odmieniony = dopelniaczOrganu(organ);
  const zlecenie = odmieniony ? `na zlecenie ${odmieniony}` : `na zlecenie: ${organ}`;
  return (
    `Opinia sporządzona ${zlecenie}` +
    (data ? `, na podstawie ${t.podstawaPowolania} z dnia ${data}` : `, na podstawie ${t.podstawaPowolania}`) +
    (opts.signature ? `, sygn. akt ${opts.signature}` : "") +
    "."
  );
}
