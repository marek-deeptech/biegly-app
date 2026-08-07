// REJESTR REGULACJI DOTYCZĄCYCH BANKÓW (w tym spółdzielczych) — krok „Baza wiedzy".
//
// CZYM TO JEST: przegląd całego krajobrazu regulacyjnego z ODNOŚNIKAMI do tekstów
// urzędowych (ISAP, EUR-Lex, KNF, BIS) — żeby przy każdej sprawie dało się sięgnąć
// do materiału źródłowego albo go pobrać. Linki ISAP/KNF/BIS zweryfikowane 7.08.2026;
// linki EUR-Lex to oficjalne permalinki CELEX (format kanoniczny, stały).
//
// CZYM TO NIE JEST: katalogiem przepisów do powołania w opinii. Tym pozostaje
// PRZEPISY_BANK (prawo-bankowe.ts) — datowany co do dnia i przypisany do modułów.
// Rejestr jest szerszy i bywa mniej precyzyjny (rekomendacje KNF mają WERSJE);
// pozycje oznaczone `wersjonowany` wymagają ustalenia wersji z daty zdarzenia,
// zanim cokolwiek trafi do opinii.
//
// ⚠️ DATY SĄ CZĘŚCIĄ ODPOWIEDZI, NIE METADANYMI. Pytanie „czy MiFID II powinien
// być w bazie wiedzy" ma odpowiedź dwuczęściową: TAK jako wiedza o krajobrazie,
// ale dla zdarzeń sprzed 3.01.2018 (MBR: 2008, SK Bank: 2012–2015) jest
// ANACHRONIZMEM — i rejestr musi to pokazywać, nie przemilczać.

export type RodzajAktu =
  | "ustawa"
  | "rozporzadzenie_krajowe"
  | "prawo_ue"
  | "nadzor"
  | "soft_law";

export const RODZAJE_AKTOW: { id: RodzajAktu; label: string }[] = [
  { id: "ustawa", label: "Ustawy" },
  { id: "rozporzadzenie_krajowe", label: "Rozporządzenia krajowe" },
  { id: "prawo_ue", label: "Prawo Unii Europejskiej" },
  { id: "nadzor", label: "Uchwały i rekomendacje nadzoru" },
  { id: "soft_law", label: "Standardy międzynarodowe (soft law)" },
];

/** Czy akt dotyczy banku spółdzielczego: wprost / pośrednio / tylko warunkowo. */
export type ZakresBS = "wprost" | "posrednio" | "warunkowo";

export type AktBankowy = {
  id: string;
  skrot: string;
  nazwa: string;
  rodzaj: RodzajAktu;
  /** Obowiązuje/stosowany od (ISO). Dla pozycji `wersjonowany` — data PIERWSZEJ wersji. */
  od: string;
  /** Koniec obowiązywania; brak = nadal. */
  do?: string;
  zakres: string;
  dotyczyBS: ZakresBS;
  uwagaBS?: string;
  link: string;
  /** Rekomendacje i normy nadzorcze mają kolejne wersje — przed powołaniem w opinii
   *  trzeba ustalić wersję obowiązującą w dacie zdarzenia. */
  wersjonowany?: boolean;
};

const ISAP = (id: string) => `https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=${id}`;
const CELEX = (nr: string) => `https://eur-lex.europa.eu/legal-content/PL/TXT/?uri=CELEX:${nr}`;
const KNF_REKOMENDACJE =
  "https://www.knf.gov.pl/dla_rynku/regulacje_i_praktyka/rekomendacje_i_wytyczne/rekomendacje_dla_bankow";

export const AKTY_BANKOWE: AktBankowy[] = [
  // ── Ustawy ──────────────────────────────────────────────────────────────────
  {
    id: "prawo_bankowe", skrot: "Prawo bankowe",
    nazwa: "Ustawa z dnia 29 sierpnia 1997 r. — Prawo bankowe (Dz.U. 1997 nr 140 poz. 939)",
    rodzaj: "ustawa", od: "1998-01-01",
    zakres: "ustrój banku, czynności bankowe, płynność (art. 8), zarządzanie ryzykiem (art. 9), zdolność kredytowa (art. 70), fundusze własne i nadzór",
    dotyczyBS: "wprost", link: ISAP("WDU19971400939"),
  },
  {
    id: "prawo_spoldzielcze", skrot: "Prawo spółdzielcze",
    nazwa: "Ustawa z dnia 16 września 1982 r. — Prawo spółdzielcze (Dz.U. 1982 nr 30 poz. 210)",
    rodzaj: "ustawa", od: "1983-01-01",
    zakres: "ustrój spółdzielni: organy, udziały, walne zgromadzenie, lustracja — bank spółdzielczy JEST spółdzielnią",
    dotyczyBS: "wprost",
    uwagaBS: "stosowane w zakresie nieuregulowanym ustawą o funkcjonowaniu banków spółdzielczych i Prawem bankowym",
    link: ISAP("WDU19820300210"),
  },
  {
    id: "ustawa_bs", skrot: "ustawa o funkcjonowaniu BS",
    nazwa: "Ustawa z dnia 7 grudnia 2000 r. o funkcjonowaniu banków spółdzielczych, ich zrzeszaniu się i bankach zrzeszających (Dz.U. 2000 nr 119 poz. 1252)",
    rodzaj: "ustawa", od: "2001-01-28",
    zakres: "zrzeszenia, obowiązki banku zrzeszającego (w tym monitorowanie sytuacji zrzeszonych banków), fundusze własne, od 2015 systemy ochrony instytucjonalnej (IPS)",
    dotyczyBS: "wprost", link: ISAP("WDU20001191252"),
  },
  {
    id: "ustawa_nbp", skrot: "ustawa o NBP",
    nazwa: "Ustawa z dnia 29 sierpnia 1997 r. o Narodowym Banku Polskim (Dz.U. 1997 nr 140 poz. 938)",
    rodzaj: "ustawa", od: "1998-01-01",
    zakres: "bank centralny: polityka pieniężna, rezerwa obowiązkowa, refinansowanie — tło stóp procentowych każdej analizy makro",
    dotyczyBS: "posrednio", link: ISAP("WDU19971400938"),
  },
  {
    id: "ustawa_nadzor", skrot: "ustawa o nadzorze",
    nazwa: "Ustawa z dnia 21 lipca 2006 r. o nadzorze nad rynkiem finansowym (Dz.U. 2006 nr 157 poz. 1119)",
    rodzaj: "ustawa", od: "2006-09-19",
    zakres: "utworzenie KNF i jej kompetencje wobec banków (wcześniej nadzór bankowy: KNB przy NBP)",
    dotyczyBS: "wprost", link: ISAP("WDU20061571119"),
  },
  {
    id: "bfg_1994", skrot: "ustawa o BFG (1994)",
    nazwa: "Ustawa z dnia 14 grudnia 1994 r. o Bankowym Funduszu Gwarancyjnym (Dz.U. 1995 nr 4 poz. 18)",
    rodzaj: "ustawa", od: "1995-02-17", do: "2016-10-08",
    zakres: "gwarantowanie depozytów i pomoc dla banków zagrożonych — reżim obowiązujący w okresie spraw MBR i SK Banku",
    dotyczyBS: "wprost", link: ISAP("WDU19950040018"),
  },
  {
    id: "bfg_2016", skrot: "ustawa o BFG (2016)",
    nazwa: "Ustawa z dnia 10 czerwca 2016 r. o Bankowym Funduszu Gwarancyjnym, systemie gwarantowania depozytów oraz przymusowej restrukturyzacji (Dz.U. 2016 poz. 996)",
    rodzaj: "ustawa", od: "2016-10-09",
    zakres: "gwarantowanie depozytów i resolution (implementacja BRRD i DGSD) — następca ustawy z 1994 r.",
    dotyczyBS: "wprost",
    uwagaBS: "upadłość SK Banku (XII 2015) biegła jeszcze pod ustawą z 1994 r.",
    link: ISAP("WDU20160000996"),
  },
  {
    id: "makroostroznosc", skrot: "ustawa makroostrożnościowa",
    nazwa: "Ustawa z dnia 5 sierpnia 2015 r. o nadzorze makroostrożnościowym nad systemem finansowym i zarządzaniu kryzysowym w systemie finansowym (Dz.U. 2015 poz. 1513)",
    rodzaj: "ustawa", od: "2015-11-01",
    zakres: "bufory kapitałowe (zabezpieczający, antycykliczny, ryzyka systemowego) — dopełnienie CRD IV",
    dotyczyBS: "wprost", link: ISAP("WDU20150001513"),
  },
  {
    id: "rachunkowosc", skrot: "ustawa o rachunkowości",
    nazwa: "Ustawa z dnia 29 września 1994 r. o rachunkowości (Dz.U. 1994 nr 121 poz. 591)",
    rodzaj: "ustawa", od: "1995-01-01",
    zakres: "sprawozdawczość finansowa, badanie sprawozdań przez biegłego rewidenta — rama każdej analizy sprawozdań w aktach",
    dotyczyBS: "wprost", link: ISAP("WDU19941210591"),
  },
  {
    id: "obrot_instrumentami", skrot: "ustawa o obrocie",
    nazwa: "Ustawa z dnia 29 lipca 2005 r. o obrocie instrumentami finansowymi (Dz.U. 2005 nr 183 poz. 1538)",
    rodzaj: "ustawa", od: "2005-10-24",
    zakres: "usługi inwestycyjne i obrót instrumentami (krajowa implementacja MiFID); do 2016 r. także zakaz manipulacji",
    dotyczyBS: "warunkowo",
    uwagaBS: "dotyczy banku spółdzielczego tylko gdy świadczy usługi inwestycyjne albo jest emitentem instrumentów notowanych",
    link: ISAP("WDU20051831538"),
  },
  {
    id: "obligacje", skrot: "ustawa o obligacjach",
    nazwa: "Ustawa z dnia 15 stycznia 2015 r. o obligacjach (Dz.U. 2015 poz. 238)",
    rodzaj: "ustawa", od: "2015-07-01",
    zakres: "emisja obligacji, obowiązki emitenta wobec obligatariuszy",
    dotyczyBS: "warunkowo",
    uwagaBS: "emisje sprzed 1.07.2015 — w tym BSW0424 SK Banku (Catalyst) — podlegały ustawie z 29.06.1995 r. (Dz.U. 1995 nr 83 poz. 420)",
    link: ISAP("WDU20150000238"),
  },
  // ── Rozporządzenia krajowe ──────────────────────────────────────────────────
  {
    id: "rezerwy_celowe", skrot: "rozp. MF o rezerwach celowych",
    nazwa: "Rozporządzenie Ministra Finansów z dnia 16 grudnia 2008 r. w sprawie zasad tworzenia rezerw na ryzyko związane z działalnością banków (Dz.U. 2008 nr 235 poz. 1589)",
    rodzaj: "rozporzadzenie_krajowe", od: "2009-01-01",
    zakres: "klasyfikacja ekspozycji (normalne/pod obserwacją/poniżej standardu/wątpliwe/stracone) i wymagane rezerwy celowe",
    dotyczyBS: "wprost",
    uwagaBS: "SEDNO sprawy SK Banku: wynik po dotworzeniu wymaganych rezerw; dla zdarzeń sprzed 2009 r. — poprzednik: rozp. MF z 10.12.2003 r.",
    link: ISAP("WDU20082351589"),
  },
  // ── Prawo UE ────────────────────────────────────────────────────────────────
  {
    id: "crd_2006", skrot: "CRD (2006/48/WE i 2006/49/WE)",
    nazwa: "Dyrektywy 2006/48/WE (podejmowanie i prowadzenie działalności przez instytucje kredytowe) i 2006/49/WE (adekwatność kapitałowa) — pakiet CRD / Bazylea II",
    rodzaj: "prawo_ue", od: "2007-04-01", do: "2013-12-31",
    zakres: "reżim ostrożnościowy sprzed CRR — w Polsce wdrożony pakietem uchwał KNB z 13.03.2007 (to stan prawny sprawy MBR)",
    dotyczyBS: "wprost", link: CELEX("32006L0048"),
  },
  {
    id: "crr", skrot: "CRR (575/2013)",
    nazwa: "Rozporządzenie Parlamentu Europejskiego i Rady (UE) nr 575/2013 w sprawie wymogów ostrożnościowych dla instytucji kredytowych (CRR)",
    rodzaj: "prawo_ue", od: "2014-01-01",
    zakres: "współczynniki kapitałowe (art. 92), duże ekspozycje (art. 395), dźwignia (art. 429), płynność (art. 412) — stosowane BEZPOŚREDNIO, także do banków spółdzielczych",
    dotyczyBS: "wprost", link: CELEX("32013R0575"),
  },
  {
    id: "crd_iv", skrot: "CRD IV (2013/36/UE)",
    nazwa: "Dyrektywa Parlamentu Europejskiego i Rady 2013/36/UE w sprawie warunków dopuszczenia instytucji kredytowych do działalności (CRD IV)",
    rodzaj: "prawo_ue", od: "2014-01-01",
    zakres: "zarządzanie ryzykiem (art. 74), bufory kapitałowe, nadzór — implementowana nowelizacją Prawa bankowego i ustawą makroostrożnościową",
    dotyczyBS: "wprost", link: CELEX("32013L0036"),
  },
  {
    id: "crr2", skrot: "CRR II (2019/876)",
    nazwa: "Rozporządzenie Parlamentu Europejskiego i Rady (UE) 2019/876 zmieniające CRR (CRR II)",
    rodzaj: "prawo_ue", od: "2021-06-28",
    zakres: "wiążący wskaźnik dźwigni 3%, NSFR — dla zdarzeń sprzed 2021 r. anachronizm",
    dotyczyBS: "wprost", link: CELEX("32019R0876"),
  },
  {
    id: "lcr_delegowane", skrot: "rozp. del. 2015/61 (LCR)",
    nazwa: "Rozporządzenie delegowane Komisji (UE) 2015/61 w odniesieniu do wymogu pokrycia wypływów netto (LCR)",
    rodzaj: "prawo_ue", od: "2015-10-01",
    zakres: "LCR dochodzący schodkami 60→70→80→100% (2015–2019)",
    dotyczyBS: "wprost", link: CELEX("32015R0061"),
  },
  {
    id: "brrd", skrot: "BRRD (2014/59/UE)",
    nazwa: "Dyrektywa Parlamentu Europejskiego i Rady 2014/59/UE ustanawiająca ramy naprawy oraz restrukturyzacji i uporządkowanej likwidacji (BRRD)",
    rodzaj: "prawo_ue", od: "2016-10-09",
    zakres: "resolution: plany naprawy, umorzenie i konwersja (bail-in) — w Polsce od ustawy o BFG z 2016 r.",
    dotyczyBS: "wprost",
    uwagaBS: "data = wejście w życie polskiej implementacji; dla upadłości SK Banku (XII 2015) reżim resolution jeszcze nie obowiązywał",
    link: CELEX("32014L0059"),
  },
  {
    id: "dgsd", skrot: "DGSD (2014/49/UE)",
    nazwa: "Dyrektywa Parlamentu Europejskiego i Rady 2014/49/UE w sprawie systemów gwarancji depozytów (DGSD)",
    rodzaj: "prawo_ue", od: "2016-10-09",
    zakres: "gwarantowanie depozytów do 100 tys. euro, terminy wypłat — w Polsce przez ustawę o BFG z 2016 r.",
    dotyczyBS: "wprost", link: CELEX("32014L0049"),
  },
  {
    id: "mifid1", skrot: "MiFID I (2004/39/WE)",
    nazwa: "Dyrektywa 2004/39/WE w sprawie rynków instrumentów finansowych (MiFID I)",
    rodzaj: "prawo_ue", od: "2007-11-01", do: "2018-01-02",
    zakres: "usługi inwestycyjne: klasyfikacja klienta, obowiązki informacyjne, best execution",
    dotyczyBS: "warunkowo",
    uwagaBS: "dotyczy banku tylko w zakresie usług inwestycyjnych; lokata międzybankowa (MBR→Glitnir) NIE jest instrumentem finansowym MiFID",
    link: CELEX("32004L0039"),
  },
  {
    id: "mifid2", skrot: "MiFID II (2014/65/UE)",
    nazwa: "Dyrektywa Parlamentu Europejskiego i Rady 2014/65/UE w sprawie rynków instrumentów finansowych (MiFID II)",
    rodzaj: "prawo_ue", od: "2018-01-03",
    zakres: "usługi inwestycyjne: zarządzanie produktowe, zachęty, ochrona inwestora — następca MiFID I",
    dotyczyBS: "warunkowo",
    uwagaBS: "stosowana od 3.01.2018 — dla zdarzeń MBR (2008) i SK Banku (2012–2015) ANACHRONIZM; właściwa czasowo bywa MiFID I (od XI 2007)",
    link: CELEX("32014L0065"),
  },
  {
    id: "mifir", skrot: "MiFIR (600/2014)",
    nazwa: "Rozporządzenie Parlamentu Europejskiego i Rady (UE) nr 600/2014 w sprawie rynków instrumentów finansowych (MiFIR)",
    rodzaj: "prawo_ue", od: "2018-01-03",
    zakres: "przejrzystość obrotu, raportowanie transakcji (TREM) — stosowane razem z MiFID II",
    dotyczyBS: "warunkowo",
    uwagaBS: "jak MiFID II — anachronizm dla zdarzeń sprzed 3.01.2018",
    link: CELEX("32014R0600"),
  },
  {
    id: "mar", skrot: "MAR (596/2014)",
    nazwa: "Rozporządzenie Parlamentu Europejskiego i Rady (UE) nr 596/2014 w sprawie nadużyć na rynku (MAR)",
    rodzaj: "prawo_ue", od: "2016-07-03",
    zakres: "informacje poufne, obowiązki emitenta, zakaz manipulacji — rdzeń dziedziny manipulacyjnej aplikacji",
    dotyczyBS: "warunkowo",
    uwagaBS: "dotyczy banku spółdzielczego jako EMITENTA instrumentów notowanych (SK Bank: obligacje BSW0424 na Catalyst); przed 3.07.2016 — ustawa o obrocie",
    link: CELEX("32014R0596"),
  },
  // ── Uchwały i rekomendacje nadzoru ─────────────────────────────────────────
  {
    id: "uchwaly_knb_2007", skrot: "pakiet uchwał KNB 1–6/2007",
    nazwa: "Uchwały nr 1–6/2007 Komisji Nadzoru Bankowego z dnia 13 marca 2007 r. (wymogi kapitałowe, fundusze własne, koncentracja, zarządzanie ryzykiem, ujawnienia)",
    rodzaj: "nadzor", od: "2007-04-01", do: "2013-12-31",
    zakres: "polska implementacja CRD/Bazylei II — stan prawny sprawy MBR; szczegóły per uchwała w katalogu przepisów kroku „Otoczenie prawne”",
    dotyczyBS: "wprost", link: KNF_REKOMENDACJE,
  },
  {
    id: "normy_plynnosci", skrot: "nadzorcze normy płynności (M1–M4)",
    nazwa: "Uchwała nr 9/2007 KNB z 13.03.2007 r., zastąpiona uchwałą nr 386/2008 KNF z 17.12.2008 r. w sprawie ustalenia wiążących banki norm płynności",
    rodzaj: "nadzor", od: "2008-03-26",
    zakres: "krajowe normy płynności M1–M4 (płynność krótkoterminowa i długoterminowa) — obowiązywały równolegle z dochodzącym LCR",
    dotyczyBS: "wprost",
    uwagaBS: "wersjonowane i wygaszane wraz z LCR — przed powołaniem w opinii ustal wersję i stan obowiązywania na dzień zdarzenia",
    link: KNF_REKOMENDACJE, wersjonowany: true,
  },
  {
    id: "rekomendacja_c", skrot: "Rekomendacja C",
    nazwa: "Rekomendacja C KNF dotycząca zarządzania ryzykiem koncentracji",
    rodzaj: "nadzor", od: "1999-01-01",
    zakres: "identyfikacja, pomiar i limitowanie koncentracji zaangażowań",
    dotyczyBS: "wprost", link: KNF_REKOMENDACJE, wersjonowany: true,
  },
  {
    id: "rekomendacja_s", skrot: "Rekomendacja S",
    nazwa: "Rekomendacja S KNF dotycząca ekspozycji kredytowych zabezpieczonych hipotecznie",
    rodzaj: "nadzor", od: "2006-07-01",
    zakres: "polityka kredytowa dla ekspozycji hipotecznych, LtV, ocena zdolności",
    dotyczyBS: "wprost", link: KNF_REKOMENDACJE, wersjonowany: true,
  },
  {
    id: "rekomendacja_t", skrot: "Rekomendacja T",
    nazwa: "Rekomendacja T KNF dotycząca zarządzania ryzykiem detalicznych ekspozycji kredytowych",
    rodzaj: "nadzor", od: "2010-08-23",
    zakres: "ocena zdolności kredytowej i limity DtI w kredytach detalicznych",
    dotyczyBS: "wprost", link: KNF_REKOMENDACJE, wersjonowany: true,
  },
  {
    id: "rekomendacja_p", skrot: "Rekomendacja P",
    nazwa: "Rekomendacja P KNF dotycząca zarządzania ryzykiem płynności finansowej banków",
    rodzaj: "nadzor", od: "1999-01-01",
    zakres: "system zarządzania płynnością, testy warunków skrajnych, plany awaryjne (nowa wersja: 2015)",
    dotyczyBS: "wprost", link: KNF_REKOMENDACJE, wersjonowany: true,
  },
  {
    id: "rekomendacja_h", skrot: "Rekomendacja H",
    nazwa: "Rekomendacja H KNF dotycząca systemu kontroli wewnętrznej w bankach",
    rodzaj: "nadzor", od: "1999-01-01",
    zakres: "kontrola wewnętrzna, audyt wewnętrzny, compliance",
    dotyczyBS: "wprost", link: KNF_REKOMENDACJE, wersjonowany: true,
  },
  {
    id: "rekomendacja_m", skrot: "Rekomendacja M",
    nazwa: "Rekomendacja M KNF dotycząca zarządzania ryzykiem operacyjnym w bankach",
    rodzaj: "nadzor", od: "2004-01-01",
    zakres: "identyfikacja i pomiar ryzyka operacyjnego, rejestr zdarzeń",
    dotyczyBS: "wprost", link: KNF_REKOMENDACJE, wersjonowany: true,
  },
  {
    id: "rekomendacja_g", skrot: "Rekomendacja G",
    nazwa: "Rekomendacja G KNF dotycząca zarządzania ryzykiem stopy procentowej w bankach",
    rodzaj: "nadzor", od: "1999-01-01",
    zakres: "pomiar i limitowanie ryzyka stopy procentowej księgi bankowej",
    dotyczyBS: "wprost", link: KNF_REKOMENDACJE, wersjonowany: true,
  },
  // ── Soft law ────────────────────────────────────────────────────────────────
  {
    id: "bazylea2", skrot: "Bazylea II (NUK)",
    nazwa: "Basel II: International Convergence of Capital Measurement and Capital Standards (Bazylejski Komitet Nadzoru Bankowego, 2004)",
    rodzaj: "soft_law", od: "2004-06-01",
    zakres: "trzy filary: minimalne wymogi kapitałowe, przegląd nadzorczy, dyscyplina rynkowa — w UE przez CRD, w Polsce przez uchwały KNB 2007 (rozdz. V.L opinii MBR)",
    dotyczyBS: "posrednio", link: "https://www.bis.org/publ/bcbs128.htm",
  },
  {
    id: "bazylea3", skrot: "Bazylea III",
    nazwa: "Basel III: ramy kapitałowe i płynnościowe (Bazylejski Komitet Nadzoru Bankowego, 2010)",
    rodzaj: "soft_law", od: "2010-12-01",
    zakres: "wyższa jakość kapitału, bufory, LCR i NSFR — w UE przez CRR/CRD IV",
    dotyczyBS: "posrednio", link: "https://www.bis.org/bcbs/basel3.htm",
  },
];

/** Status aktu względem daty zdarzenia — to on odpowiada na pytanie „czy MiFID II?”. */
export type StatusAktu = "obowiazywal" | "po_zdarzeniu" | "uchylony_przed";

export function statusNaDzien(akt: AktBankowy, dzien: string): StatusAktu {
  if (akt.od > dzien) return "po_zdarzeniu";
  if (akt.do && akt.do < dzien) return "uchylony_przed";
  return "obowiazywal";
}

/** Rejestr pogrupowany rodzajami, w stałej kolejności — do panelu Bazy wiedzy. */
export function rejestrWgRodzaju(): { rodzaj: (typeof RODZAJE_AKTOW)[number]; akty: AktBankowy[] }[] {
  return RODZAJE_AKTOW.map((r) => ({
    rodzaj: r,
    akty: AKTY_BANKOWE.filter((a) => a.rodzaj === r.id).sort((a, b) => a.od.localeCompare(b.od)),
  }));
}
