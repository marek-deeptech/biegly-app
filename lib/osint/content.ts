// Treść analizy OSINT — model danych + kuratorowana zawartość dla sprawy MLM
// (Grupa Milisystem). "Hybryda": kuratorowany szkielet o pełnej jakości + opcjonalne
// wstrzyknięcie powiązań zapisanych w panelu OSINT (zakładki A/B) do tabeli relacji.
//
// Warstwa renderu (lib/osint/pdf.ts) mapuje te bloki na pdfmake. Treść jest
// deklaratywna i edytowalna; inne sprawy mogą dostać własny builder analogicznie.

export type Run = string | { b: string } | { i: string } | { link: string; url: string };
export type Block =
  | { t: "p"; runs: Run[]; bullet?: boolean }
  | { t: "h2"; text: string; toc?: boolean }
  | { t: "h3"; text: string }
  | { t: "arrow"; runs: Run[] }
  | { t: "rel"; title: string; rows: [string, Run[]][] }
  | { t: "data"; headers: string[]; rows: string[][]; widths?: number[] }
  | { t: "src"; label: string; url: string }
  | { t: "graph" };
export type Section = { heading: string; blocks: Block[] };
export type OsintContent = {
  meta: { sygn: string; dotyczy: string; przedmiot: string; podtytul: string; zrodla: string };
  sections: Section[];
};
export type PanelLink = { typ: string; podmioty: string; opis: string; zrodlo: string; data: string };

const KNF = "https://www.knf.gov.pl";

export function milisystemOsint(panelLinks: PanelLink[] = []): OsintContent {
  // ── sekcja: WNIOSKI ZE ZGROMADZONEGO MATERIAŁU (+ hybryda) ──
  const wnioskiBlocks: Block[] = [
    { t: "p", runs: ["Zebrane w toku analizy OSINT informacje pozwalają stwierdzić, że osoby i podmioty wskazane we wniosku są ze sobą związane, a znaczna ich część tworzy ", { b: "trzy odrębne, lecz zbieżne czasowo klastry" }, ", skupione wokół tego samego emitenta."] },
    { t: "p", runs: [{ b: "Klaster I — toruński (P. Międlar). " }, "Emitent Milisystem S.A. oraz Ragnar Trade sp. z o.o. dzielą ", { b: "ten sam adres rejestrowy (Toruń, ul. Gorzowska 19)" }, ", a Piotr Międlar pełnił funkcję prezesa zarządu obu podmiotów. Ragnar Trade przejął pakiet 22,73% akcji emitenta w transakcji pozarynkowej."] },
    { t: "p", runs: [{ b: "Klaster II — katowicki (rodziny Boszko i Ochman). " }, "Centurion Finance ASI S.A. działała rachunkami, którymi dysponowali Bartosz Boszko (prezes) i Łukasz Ochman (wiceprezes); równolegle na rachunkach własnych działały Joanna Boszko (do 2024 r. główna akcjonariuszka Centurion) oraz Marcin Ochman."] },
    { t: "p", runs: [{ b: "Klaster III — offshore (rachunki w DM Intercapital). " }, "Osiem podmiotów zagranicznych (Singapur, Bułgaria, Cypr, Nevis) o cechach spółek wydmuszkowych, dysponujących rachunkami w ", { b: "tym samym domu maklerskim (DM Intercapital)" }, ", powiązanych wspólnymi adresami rejestracji i wspólnymi dysponentami."] },
    { t: "p", runs: ["Tabele poniżej przedstawiają zidentyfikowane relacje; graf stanowi załącznik."] },
    { t: "h2", text: "MILISYSTEM S.A. (emitent)" },
    { t: "rel", title: "MILISYSTEM S.A. — KRS 0000449009, Toruń, ul. Gorzowska 19", rows: [
      ["Piotr Międlar", ["Powiązanie bezpośrednie: ", { b: "Prezes Zarządu 26.05.2022–17.01.2023" }, " — jednocześnie prezes i wspólnik Ragnar Trade, która przejęła 22,73% akcji emitenta."]],
      ["Ragnar Trade sp. z o.o.", ["Powiązanie kapitałowe i adresowe: podmiot ", { b: "pod tym samym adresem (Toruń, Gorzowska 19)" }, " co emitent; nabył 10.05.2022 — 500.000 akcji (22,73%) w transakcji pozarynkowej."]],
      ["Tomasz Nowak", ["Powiązanie kapitałowe: ", { b: "zbywca całego pakietu 22,73% (500.000 akcji) na rzecz Ragnar Trade" }, " w transakcji pakietowej z 10.05.2022."]],
      ["Ivan Hanamov", ["Powiązanie osobowe: ", { b: "prezes zarządu emitenta 18.06.2020–26.05.2022" }, " (poprzednik P. Międlara); nazwisko wskazujące na pochodzenie bułgarskie — przy bułgarskich spółkach klastra offshore."]],
    ] },
    { t: "src", label: "GLEIF — LEI 259400FKQ5WP8BWRWZ57; odpis KRS 0000449009; zawiadomienia art. 69 — akta sprawy", url: "https://api.gleif.org/api/v1/lei-records/259400FKQ5WP8BWRWZ57" },
    { t: "h2", text: "Klaster I — Ragnar Trade sp. z o.o. / P. Międlar" },
    { t: "rel", title: "RAGNAR TRADE sp. z o.o. — KRS 0000602579, Toruń, ul. Gorzowska 19", rows: [
      ["Piotr Międlar", ["Powiązanie bezpośrednie: ", { b: "Prezes Zarządu" }, " Ragnar Trade — zarazem prezes emitenta oraz członek RN Labcanna S.A. i Prime Bit Games S.A."]],
      ["Milisystem S.A.", ["Powiązanie adresowe i osobowe: ten sam adres (Toruń, Gorzowska 19), ta sama osoba w zarządzie; Ragnar Trade — akcjonariusz emitenta (22,73%)."]],
      ["Michał Jura", ["Powiązanie pośrednie: ", { b: "poprzedni prezes Ragnar Trade" }, ", prezes Labcanna S.A., RN Foxbuy.com — działał na rachunku własnym (mBank 15000942)."]],
      ["Cezary Jasiński", ["Powiązanie pośrednie: ", { b: "pierwszy prezes i wspólnik Ragnar Trade" }, " (4.099 udziałów), RN Foxbuy.com."]],
    ] },
    { t: "src", label: "Odpis pełny KRS Ragnar Trade (0000602579) — akta sprawy; ceo.com.pl — P. Międlar", url: "https://ceo.com.pl/dyrektor-prezes/piotr-miedlar" },
    { t: "h2", text: "Klaster II — Centurion Finance ASI S.A. / rodziny Boszko i Ochman" },
    { t: "rel", title: "CENTURION FINANCE ASI S.A. — KRS 0000396580, Katowice, ul. A. Zająca 22", rows: [
      ["Bartosz Boszko", ["Powiązanie bezpośrednie: ", { b: "Prezes Zarządu" }, " Centurion (od 12.01.2021) — rachunki Centurion, sesje 28–29.06 i 21.09.2022."]],
      ["Łukasz Ochman", ["Powiązanie bezpośrednie: ", { b: "Wiceprezes Zarządu" }, " Centurion (od 23.10.2014) — rachunki Centurion (mBank 10519719, Intercapital)."]],
      ["Joanna Boszko", ["Powiązanie kapitałowe: ", { b: "do sierpnia 2024 r. główna akcjonariuszka Centurion" }, "; działała na rachunku własnym (Alior 140614) w 5 sesjach."]],
      ["Marcin Ochman", ["Powiązanie osobowe (zbieżność nazwiska z wiceprezesem Centurion): rachunek własny (PEKAO 91967958), sesja 13.05.2022."]],
      ["Krzysztof Barczyk", ["Powiązanie międzyklastrowe: ", { b: "członek RN Centurion oraz RN Labcanna S.A." }, " (KRS 0000383038) — łącznik klastra katowickiego z toruńskim (zbieżność imienia i nazwiska; do potwierdzenia numerem PESEL)."]],
    ] },
    { t: "src", label: "GLEIF — LEI 259400DW7VB1QWHO0V35; odpisy KRS Centurion (396580) i Labcanna (383038) — akta sprawy", url: "https://rejestr.io/krs/396580/centurion-finance-asi" },
    { t: "h2", text: "Klaster III — podmioty zagraniczne (DM Intercapital)" },
    { t: "rel", title: "Podmioty zagraniczne — wspólny dom maklerski, wspólne adresy i dysponenci", rows: [
      ["Texla + Texolla (SG)", ["Powiązanie adresowe: obie spółki singapurskie pod ", { b: "tym samym adresem (60 Paya Lebar Road, Paya Lebar Square)" }, "; obie dziś ", { b: "wykreślone/nieaktywne" }, "."]],
      ["NVA Trading 1 + 5 (BG)", ["Powiązanie rejestrowe: obie spółki bułgarskie ", { b: "utworzone tego samego dnia — 17.05.2021" }, ", kolejne numery rejestru; ten sam dysponent — N. Amzina."]],
      ["NVM (SG) + ICM Trade 1 (BG)", ["Powiązanie osobowe: obiema spółkami dysponował ", { b: "ten sam Nicolay V. Mayster" }, "."]],
      ["Mamavale (CY), Alpha (Nevis)", ["Jurysdykcje o podwyższonej poufności: Cypr i ", { b: "Nevis (Dixcart House)" }, "; Alpha — LEI „LAPSED”, Mamavale — brak rekordu LEI."]],
      ["Wspólny mianownik", [{ b: "Wszystkie osiem podmiotów oraz Ragnar Trade i Centurion — rachunki w DM Intercapital" }, "."]],
    ] },
    { t: "src", label: "GLEIF — rekordy LEI (Texla/Texolla/NVA/NVM/ICM/Alpha)", url: "https://api.gleif.org" },
  ];

  // Hybryda: dołącz zapisane w panelu powiązania (jeśli są) jako dodatkową tabelę.
  const cleanLinks = panelLinks
    .map((l) => ({ ...l, podmioty: (l.podmioty || "").trim(), zrodlo: (l.zrodlo || "").trim() }))
    .filter((l) => l.podmioty && l.zrodlo);
  if (cleanLinks.length) {
    wnioskiBlocks.push(
      { t: "h2", text: "Powiązania zarejestrowane w panelu OSINT", toc: true },
      { t: "p", runs: [`Poniższe ${cleanLinks.length} powiązań ustalono i zapisano w toku pracy w panelu OSINT (zakładki „Informacje” i „Powiązania”); każde z cytowanym źródłem.`] },
      { t: "data", headers: ["Typ", "Podmioty / osoby", "Opis", "Źródło", "Data"],
        rows: cleanLinks.map((l) => [l.typ, l.podmioty, l.opis, l.zrodlo, l.data]),
        widths: [22, 24, 30, 16, 8] },
      { t: "src", label: "Panel OSINT (Krok 5) — powiązania zapisane w aktach sprawy", url: KNF },
    );
  }

  return {
    meta: {
      sygn: "RP I Ds 4.2019",
      dotyczy: "Grupa Milisystem (d. Intelligent Gaming Solutions S.A. / 2intellect.com S.A.)",
      przedmiot: "rynek NewConnect (GPW) — akcje Milisystem S.A., ISIN PL2INTC00018",
      podtytul: "Ustalenie powiązań osobowych, kapitałowych i organizacyjnych pomiędzy podmiotami i osobami wskazanymi w postanowieniu",
      zrodla: "Źródła jawne: KRS · GLEIF · KNF · ESPI · rejestry zagraniczne · media",
    },
    sections: [
      // ── 1. INFORMACJE DO USTALENIA ──
      { heading: "INFORMACJE DO USTALENIA", blocks: [
        { t: "p", runs: ["Przedmiotem analizy jest ustalenie — na podstawie ", { b: "źródeł ogólnodostępnych (OSINT)" }, " oraz dokumentów zgromadzonych w aktach sprawy — powiązań osobowych, kapitałowych i organizacyjnych pomiędzy podmiotami i osobami, które w okresie od 5 maja 2022 r. do 21 września 2022 r. składały zlecenia i zawierały transakcje na akcjach spółki notowanej na rynku NewConnect prowadzonym przez Giełdę Papierów Wartościowych w Warszawie S.A.:"] },
        { t: "p", runs: [{ b: "MILISYSTEM S.A." }, " (KRS 0000449009, LEI 259400FKQ5WP8BWRWZ57, ISIN PL2INTC00018) — spółka działająca uprzednio pod firmą ", { i: "Intelligent Gaming Solutions S.A." }, " (do października 2022 r.), a pierwotnie ", { i: "2intellect.com S.A." }, " (debiut na NewConnect 13 marca 2014 r.)."] },
        { t: "p", runs: ["Zgodnie z treścią postanowienia z 30 listopada 2023 r. analizie podlegają następujące osoby fizyczne, działające na rachunkach prowadzonych na rzecz wskazanych podmiotów albo na rachunkach własnych:"] },
        { t: "data", headers: ["Osoba fizyczna", "Podmiot / rachunek (za postanowieniem)"], widths: [26, 74], rows: [
          ["Łukasz Ochman", "Centurion Finance ASI S.A. (LEI 259400DW7VB1QWHO0V35) — rach. 10519719 (mBank), 0002214-Bl-86328 (Intercapital)"],
          ["Bartosz Boszko", "Centurion Finance ASI S.A. — rach. 0002214-Bl-86328 (Intercapital)"],
          ["Piotr Międlar", "Ragnar Trade sp. z o.o. (LEI 259400SBP5G9QA7QTY84) — rach. 0002209-Bl-8623 (Intercapital)"],
          ["Irina Sargsyan", "TEXLA PTE. LTD. (Singapur) — rach. BGB1001754 (Intercapital)"],
          ["Natalia Amzina", "NVA TRADING 1 EOOD + NVA TRADING 5 EOOD (Bułgaria) — rach. 0002133-Bl-86498, 0002138-Bl-86503 (Intercapital)"],
          ["Mesrop Hoveyan", "Texolla Pte. Ltd. (Singapur) — rach. BGB1001876 (Intercapital)"],
          ["Mariusz Błaszczyk", "Mamavale LTD (Cypr) — rach. 0002114-B1 (Intercapital)"],
          ["Nicolay V. Mayster", "NVM Trading Pte. Ltd. (Singapur) + ICM TRADE 1 EOOD (Bułgaria) — rach. BGB1001868, 0001582-Bl (Intercapital)"],
          ["Jocelyn M. Bennett", "Alpha Trading Limited (Nevis) — rach. 0000842-Bl (Intercapital)"],
          ["Joanna Boszko", "rachunek własny 140614 (BM Alior)"],
          ["Patrik Dimitrov-Aleksandrov", "rachunek własny BGB1001973 (Intercapital)"],
          ["Maciej Rudnicki", "rachunek własny 2460125 (BM Millenium)"],
          ["Łukasz Karpiński", "rachunek własny BGB1002001 (DM Banku BPS)"],
          ["Paweł Kiciński", "rachunek własny BGB1002001 (Intercapital)"],
          ["Michał Jura", "rachunek własny 15000942 (mBank)"],
          ["Magdalena Kwapisz", "rachunek własny 15001635 (mBank)"],
          ["Marcin Ochman", "rachunek własny 91967958 (BM PEKAO)"],
          ["Sebastian Greń", "rachunek własny 116834 (DM BOŚ)"],
        ] },
        { t: "p", runs: ["W polu zainteresowania pozostają nadto: ", { b: "Tomasz Nowak" }, " (zbywca pakietu 22,73%), ", { b: "Ivan Hanamov" }, " (prezes emitenta do 26.05.2022) oraz ", { b: "Grzegorz Borowy" }, " (przewodniczący rady nadzorczej emitenta, zbywający akcje) — omówieni w dalszej części."] },
        { t: "src", label: "Postanowienie Prokuratury Regionalnej w Warszawie z 30.11.2023, sygn. RP I Ds 4.2019 (akta sprawy)", url: KNF },
      ] },
      // ── 2. WNIOSKI ZE ZGROMADZONEGO MATERIAŁU ──
      { heading: "WNIOSKI ZE ZGROMADZONEGO MATERIAŁU", blocks: wnioskiBlocks },
      // ── 3. CHRONOLOGIA ──
      { heading: "CHRONOLOGIA PRZEJĘCIA KONTROLI", blocks: [
        { t: "p", runs: ["Zawiadomienia o zmianie stanu posiadania (art. 69 ustawy o ofercie), powiadomienia menedżerskie (art. 19 MAR) oraz wpisy w KRS pozwalają odtworzyć ", { b: "przejęcie kontroli nad emitentem — kapitałowej i zarządczej — u progu i w trakcie okresu objętego analizą" }, ":"] },
        { t: "data", headers: ["Data", "Podmiot / osoba", "Zdarzenie", "Skutek"], widths: [11, 22, 23, 44], rows: [
          ["06.05.2022", "Centurion Finance ASI S.A.", "zbycie akcji na rynku (art. 69)", "15,60% → 14,61% (343 129 → 321 418 akcji)"],
          ["10.05.2022", "Tomasz Nowak → Ragnar Trade", "transakcja pakietowa/pozarynkowa", "przeniesienie 500 000 akcji (22,73%): Nowak 22,73% → 0%, Ragnar Trade 0% → 22,73%"],
          ["26.05.2022", "Piotr Międlar", "objęcie funkcji Prezesa Zarządu emitenta (KRS)", "Międlar zastępuje Ivana Hanamova — kontrola zarządcza"],
          ["07.06.2022", "Ragnar Trade sp. z o.o.", "zbycie części (art. 19 MAR)", "26 464 akcji, śr. 4,37 zł"],
          ["23.09.2022", "Milisystem S.A.", "zmiana składu RN (KRS)", "wejście m.in. J. Błaszczykowskiego; wyjście G. Borowego"],
        ] },
        { t: "p", runs: ["Zestawienie ujawnia sekwencję przejęcia kontroli: ", { b: "10 maja 2022 r." }, " — na dzień przed pierwszymi sesjami o skrajnych parametrach — cały pakiet 22,73% przeszedł od Tomasza Nowaka do Ragnar Trade (podmiotu P. Międlara) w transakcji pozarynkowej; ", { b: "26 maja 2022 r." }, " — w środku okresu objętego analizą — ", { b: "Piotr Międlar objął funkcję prezesa zarządu emitenta" }, ", zastępując dotychczasowego prezesa Ivana Hanamova. W ciągu trzech tygodni ten sam podmiot uzyskał zatem kontrolę kapitałową (22,73%) i zarządczą nad spółką, której akcje były przedmiotem analizowanej aktywności."] },
        { t: "p", runs: ["Wartości ", { b: "15,60%, 14,61% i 22,73%" }, " pojawiające się w analizie transakcyjnej sprawy mają bezpośrednie źródło w zawiadomieniach o stanie posiadania i odzwierciedlają realne przesunięcia pakietów akcji między wskazanymi podmiotami."] },
        { t: "src", label: "Zawiadomienia art. 69 (Nowak, Centurion, Ragnar Trade); odpis KRS emitenta 0000449009 — akta sprawy", url: KNF },
      ] },
      // ── 4. ŁAŃCUCHY POWIĄZAŃ OSOBOWYCH ──
      { heading: "ŁAŃCUCHY POWIĄZAŃ OSOBOWYCH W REJESTRZE KRS", blocks: [
        { t: "p", runs: ["Analiza pełnych odpisów KRS spółek Ragnar Trade, Labcanna, Foxbuy.com, Milisystem oraz Centurion ujawnia powtarzalną, rotacyjną obsadę tych samych osób w organach — z datami obejmowania i utraty funkcji. Poniżej łańcuchy per osoba."] },
        { t: "h3", text: "PIOTR MIĘDLAR (PESEL 87051613157)" },
        { t: "arrow", runs: [{ b: "MIĘDLAR" }, " / Prezes Zarządu ", { b: "26.05.2022–17.01.2023" }, " / → ", { b: "MILISYSTEM S.A." }, " (KRS 449009) — objęcie w trakcie okresu manipulacji, po I. Hanamovie"] },
        { t: "arrow", runs: [{ b: "MIĘDLAR" }, " / Prezes Zarządu (od wpisu 18) i wspólnik / → ", { b: "RAGNAR TRADE sp. z o.o." }, " (KRS 602579) — akcjonariusz emitenta 22,73%"] },
        { t: "arrow", runs: [{ b: "MIĘDLAR" }, " / Rada Nadzorcza od 06.09.2021 / → ", { b: "LABCANNA S.A." }, " (KRS 383038) ← / Rada Nadzorcza / ", { b: "P. KICIŃSKI, M. JURA, A. NOGA" }] },
        { t: "arrow", runs: [{ b: "MIĘDLAR" }, " / Rada Nadzorcza / → ", { b: "PRIME BIT GAMES S.A." }] },
        { t: "p", runs: [{ b: "Sekwencja prezesów Ragnar Trade: " }, "Cezary Jasiński (wpis 1–14) → Michał Jura (wpis 14–18) → ", { b: "Piotr Międlar (od wpisu 18)" }, " — funkcję przejmowały kolejno te same trzy osoby powiązanej sieci."] },
        { t: "p", runs: [{ b: "Sekwencja prezesów Milisystem: " }, "Dariusz Grześkowiak (2013–18.06.2020) → Ivan Hanamov (18.06.2020–26.05.2022) → ", { b: "Piotr Międlar (26.05.2022–17.01.2023)" }, " → Marian Ślimak → Jan Kempara."] },
        { t: "h3", text: "MICHAŁ JURA (PESEL 81061611833) — działał na rachunku własnym" },
        { t: "arrow", runs: [{ b: "JURA" }, " / Prezes Zarządu (wpis 14–18) / → ", { b: "RAGNAR TRADE" }, " (602579) — poprzednik P. Międlara"] },
        { t: "arrow", runs: [{ b: "JURA" }, " / Prezes Zarządu ", { b: "30.12.2020–06.09.2021" }, " / → ", { b: "LABCANNA S.A." }, " (383038)"] },
        { t: "arrow", runs: [{ b: "JURA" }, " / Rada Nadzorcza / → ", { b: "FOXBUY.COM" }, " (893815) ← / Rada Nadzorcza / ", { b: "C. JASIŃSKI, A. NOGA" }] },
        { t: "h3", text: "PAWEŁ KICIŃSKI (PESEL 87123102835) — działał na rachunku własnym" },
        { t: "arrow", runs: [{ b: "KICIŃSKI" }, " / Prezes Zarządu ", { b: "04.03.2019–30.12.2020" }, ", następnie Rada Nadzorcza 30.12.2020–17.03.2022 / → ", { b: "LABCANNA S.A." }, " (383038)"] },
        { t: "arrow", runs: [{ b: "KICIŃSKI" }, " / Prezes Zarządu (wpis 1) / → ", { b: "FOXBUY.COM" }, " (893815)"] },
        { t: "h3", text: "CEZARY JASIŃSKI (PESEL 87011811612) oraz SEBASTIAN GREŃ — rachunek własny" },
        { t: "arrow", runs: [{ b: "JASIŃSKI" }, " / Prezes Zarządu (wpis 1–14) i wspólnik (4.099 udziałów, 204.950 zł) / → ", { b: "RAGNAR TRADE" }, " (602579); Rada Nadzorcza → ", { b: "FOXBUY.COM" }] },
        { t: "arrow", runs: [{ b: "S. GREŃ" }, " / rachunek własny (DM BOŚ 116834) / — Zarząd ", { b: "DIROX" }, " z ", { b: "ROKSANĄ GREŃ" }, " (Dirox; Rada Nadzorcza Foxbuy.com)"] },
        { t: "p", runs: ["Nakładanie się tych samych nazwisk (Międlar, Jura, Jasiński, Kiciński, Noga, Greń) w organach Ragnar Trade, Labcanna, Foxbuy.com i Dirox — w kolejno przejmowanych funkcjach — dokumentuje istnienie ", { b: "trwałej, zorganizowanej sieci osobowej" }, ", w ramach której część osób jednocześnie uczestniczyła w obrocie akcjami emitenta na rachunkach własnych."] },
        { t: "src", label: "Odpisy pełne KRS: Ragnar Trade (602579), Labcanna (383038), Foxbuy.com (893815), Milisystem (449009), Centurion (396580) — akta sprawy", url: "https://rejestr.io" },
      ] },
      // ── 5. PODMIOTY I OSOBY Z WNIOSKU ──
      { heading: "PODMIOTY I OSOBY Z WNIOSKU", blocks: [
        { t: "h2", text: "MILISYSTEM S.A. (emitent)", toc: false },
        { t: "data", headers: ["Cecha", "Ustalenie"], widths: [26, 74], rows: [
          ["Firma", "Milisystem S.A. (d. Intelligent Gaming Solutions S.A., d. 2intellect.com S.A.)"],
          ["KRS / LEI", "0000449009 / 259400FKQ5WP8BWRWZ57"],
          ["Instrument", "akcje ISIN PL2INTC00018, rynek NewConnect (GPW); 2 200 000 akcji"],
          ["Siedziba", "Toruń, ul. Gorzowska 19 (wg GLEIF); w okresie transakcji ul. Jasielska 16, Poznań"],
          ["Debiut / rejestracja", "debiut NewConnect 13.03.2014 (kurs 0,87 zł); rejestracja SR Poznań 31.01.2013"],
          ["Prezesi (KRS)", "Grześkowiak (2013–2020) → Hanamov (2020–26.05.2022) → Międlar (26.05.2022–2023) → Ślimak → Kempara"],
        ] },
        { t: "p", runs: ["Spółka do 2019 r. działała w segmencie gier (2intellect.com). W kwietniu 2020 r. zbyła zorganizowaną część przedsiębiorstwa i zmieniła firmę na Intelligent Gaming Solutions S.A. W maju 2022 r. — równolegle z okresem objętym postanowieniem — nastąpiła ", { b: "zmiana akcjonariatu i zarządu oraz ogłoszenie nowej strategii (technologie szkolenia strzeleckiego, obrót bronią/amunicją)" }, "; w październiku 2022 r. przyjęła firmę Milisystem S.A. W dniu 18 listopada 2022 r. KNF zawiesiła i odwiesiła obrót akcjami, kierując zawiadomienie o podejrzeniu manipulacji."] },
        { t: "src", label: "stockwatch.pl — zawiadomienie KNF (Milisystem, Inno-Gene); prawainwestora.pl — zawieszenie 18.11.2022", url: "https://www.stockwatch.pl/wiadomosci/knf-zglosila-podejrzenie-popelnienia-przestepstwa-manipulacji-w-obrocie-akcjami-milisystem-i-inno-gene,akcje,307640" },
        { t: "h2", text: "Tomasz Nowak — zbywca pakietu kontrolnego" },
        { t: "p", runs: ["Osoba fizyczna (adres w Sochaczewie), która przed 10 maja 2022 r. posiadała ", { b: "500.000 akcji emitenta = 22,73% kapitału i głosów" }, " — pakiet o rozmiarze identycznym z pakietem, który tego samego dnia nabyła Ragnar Trade sp. z o.o. Tomasz Nowak zbył cały posiadany pakiet w transakcji pakietowej, po której nie posiadał żadnych akcji spółki."] },
        { t: "arrow", runs: [{ b: "TOMASZ NOWAK" }, " / 22,73% do 10.05.2022 / — zbycie 500.000 akcji (transakcja pakietowa) → ", { b: "RAGNAR TRADE sp. z o.o." }, " (P. Międlar) / nabycie 22,73% / → ", { b: "MILISYSTEM S.A." }] },
        { t: "p", runs: ["Poza tą transakcją pakietową osoba o tym imieniu i nazwisku nie posiada rozpoznawalnego śladu publicznego związanego z emitentem — co odpowiada roli ", { b: "dotychczasowego posiadacza pakietu przekazanego podmiotowi przejmującemu kontrolę" }, "."] },
        { t: "src", label: "Zawiadomienie T. Nowaka o zmianie udziału (art. 69), 11.05.2022 — akta sprawy", url: KNF },
        { t: "h2", text: "Podmioty zagraniczne — dane rejestrowe, dysponenci" },
        { t: "p", runs: ["Osiem podmiotów zagranicznych działało rachunkami prowadzonymi przez DM Intercapital, przy udziale osób fizycznych o odmiennych nazwiskach pełniących rolę dysponentów. Dane rejestrowe ustalono w globalnym rejestrze GLEIF oraz rejestrach krajowych:"] },
        { t: "data", headers: ["Podmiot", "Jurysdykcja / rejestr", "Dysponent", "Status"], widths: [20, 34, 26, 20], rows: [
          ["Texla Pte. Ltd.", "Singapur, 201812331R, Paya Lebar Square #08-57", "Irina Sargsyan", "INACTIVE / RETIRED"],
          ["Texolla Pte. Ltd.", "Singapur, 201905252M, Paya Lebar Square #05-40B", "Mesrop Hoveyan", "INACTIVE / RETIRED"],
          ["NVA Trading 1 EOOD", "Bułgaria, 206505221, Sofia (utw. 17.05.2021)", "Natalia Amzina", "ACTIVE"],
          ["NVA Trading 5 EOOD", "Bułgaria, 206505328, Sofia (utw. 17.05.2021)", "Natalia Amzina", "ACTIVE"],
          ["NVM Trading Pte. Ltd.", "Singapur, 201936446D, 33 Ubi Ave 3", "Nicolay V. Mayster", "ACTIVE"],
          ["ICM Trade 1 EOOD", "Bułgaria, 205058041, Sofia", "Nicolay V. Mayster", "ACTIVE"],
          ["Mamavale Ltd", "Cypr", "Mariusz Błaszczyk", "brak rekordu LEI"],
          ["Alpha Trading Limited", "Nevis (KN), C31279, Dixcart House", "Jocelyn M. Bennett", "LAPSED"],
        ] },
        { t: "p", runs: [{ b: "(1) " }, "Texla i Texolla — ten sam adres w Singapurze, obie wykreślone; ", { b: "(2) " }, "NVA 1 i NVA 5 — utworzone tego samego dnia (17.05.2021), ten sam dysponent; ", { b: "(3) " }, "NVM i ICM — ten sam dysponent (N. Mayster); ", { b: "(4) " }, "wszystkie osiem plus Ragnar Trade i Centurion — jeden dom maklerski (DM Intercapital)."] },
        { t: "p", runs: [{ i: "Nota metodyczna: publiczne rejestry (ACRA Singapur, rejestr handlowy Bułgarii, rejestry Nevis i Cypru) nie ujawniają — poza dysponentami wskazanymi w postanowieniu — beneficjentów rzeczywistych ani zarządów tych podmiotów; próby automatycznego zapytania rejestrów napotykają zabezpieczenia (CAPTCHA). Ograniczona przejrzystość struktur, w połączeniu z jurysdykcjami o podwyższonej poufności, sama w sobie stanowi okoliczność istotną dla oceny charakteru klastra." }] },
        { t: "src", label: "GLEIF — api.gleif.org/api/v1/lei-records/{LEI}; ACRA Bizfile (SG); rejestr handlowy (BG)", url: "https://api.gleif.org" },
        { t: "h3", text: "Powiązanie klastra offshore z domem maklerskim — Nicolay Mayster / InterCapital" },
        { t: "p", runs: ["Ustalenie OSINT o istotnym znaczeniu: ", { b: "Nicolay V. Mayster" }, " — wskazany w postanowieniu jako dysponent rachunków dwóch podmiotów klastra (NVM Trading Pte. Ltd. i ICM Trade 1 EOOD) — jest, według jawnych źródeł, ", { b: "założycielem (2001), dyrektorem wykonawczym i partnerem domu maklerskiego InterCapital Markets" }, " z siedzibą w Bułgarii (Sofia)."] },
        { t: "p", runs: ["Jednocześnie rachunki maklerskie ", { b: "wszystkich podmiotów klastra offshore, a także Ragnar Trade i Centurion" }, ", prowadzone były — zgodnie z postanowieniem — przez ", { b: "DM Intercapital" }, ", a ich oznaczenia noszą prefiks „BGB…” / sufiks „-Bl” wskazujący na bułgarskiego brokera. Zbieżność firmy (InterCapital / DM Intercapital), jurysdykcji (Bułgaria) oraz tożsamości osoby (Mayster — zarazem dysponent spółek klastra i założyciel/dyrektor brokera) uprawdopodabnia, że ", { b: "dom maklerski obsługujący cały klaster jest podmiotem powiązanym z jednym z dysponentów spółek biorących udział w obrocie" }, "."] },
        { t: "p", runs: [{ i: "Ustalenie wymaga potwierdzenia pełną firmą i danymi rejestrowymi domu maklerskiego wskazanego w dokumentacji rachunkowej akt; zbieżność nazwy, jurysdykcji i osoby jest jednak na tyle wyraźna, że stanowi istotny trop co do centralnego ogniwa organizacyjnego klastra offshore." }] },
        { t: "src", label: "intercapitalmarkets.com — Nicolay Mayster, CFA (założyciel, dyr. wykonawczy); postanowienie — rachunki DM Intercapital (akta)", url: "https://www.intercapitalmarkets.com/en/content/mr-nicolay-mayster-cfa" },
        { t: "h2", text: "Mapa aktywności rachunków w kluczowych sesjach" },
        { t: "p", runs: ["Zestawienie dat aktywności poszczególnych rachunków (za postanowieniem) ujawnia ", { b: "koncentrację wielu podmiotów w tych samych sesjach" }, ":"] },
        { t: "data", headers: ["Sesja", "Aktywne podmioty / osoby (za postanowieniem)", "Liczba"], widths: [14, 72, 14], rows: [
          ["10.05.2022", "NVA (Amzina), J. Boszko, Rudnicki, Karpiński, Kiciński, Jura, Greń — oraz transfer pakietu Nowak → Ragnar Trade", "7 (+transfer)"],
          ["20.05.2022", "Texla (Sargsyan), NVA (Amzina), Mamavale (Błaszczyk), Alpha (Bennett), J. Boszko, Dimitrov, Rudnicki", "7"],
          ["01.06.2022", "Texla (Sargsyan), Texolla (Hoveyan), NVA (Amzina), Rudnicki", "4"],
          ["28.06.2022", "Centurion (Ochman, B. Boszko), NVM+ICM (Mayster), Dimitrov, Karpiński", "5"],
          ["29.06.2022", "Centurion (Ochman, B. Boszko), NVA (Amzina)", "3"],
          ["21.09.2022", "Centurion (Ochman, B. Boszko), Texla (Sargsyan)", "3"],
        ] },
        { t: "p", runs: ["Sesje ", { b: "10 i 20 maja 2022 r." }, " skupiają po siedem rachunków z trzech klastrów jednocześnie, a sesja 10 maja zbiega się z pozarynkowym przejęciem pakietu kontrolnego — co wskazuje na ", { b: "skoordynowane" }, " wejście grupy w obrót akcjami emitenta."] },
        { t: "src", label: "Postanowienie z 30.11.2023 — daty aktywności rachunków; zawiadomienia stanu posiadania — akta sprawy", url: KNF },
      ] },
      // ── 6. WNIOSKI KOŃCOWE ──
      { heading: "WNIOSKI KOŃCOWE", blocks: [
        { t: "p", runs: ["Mając na względzie powiązania przedstawione w niniejszej analizie, uzasadnione jest ustalenie, że osoby i podmioty wskazane we wniosku były ze sobą powiązane w stopniu wykraczającym poza przypadkowy zbieg uczestników obrotu, a struktura tych powiązań układa się w trzy zbieżne klastry skupione wokół jednego emitenta:"] },
        { t: "p", bullet: true, runs: [{ b: "1. " }, "W okresie od 10 do 26 maja 2022 r. — u progu i w trakcie analizowanej aktywności — ", { b: "podmiot i osoba (Ragnar Trade / Piotr Międlar) uzyskali kontrolę kapitałową (22,73%, przejęte pozarynkowo od T. Nowaka) i zarządczą (funkcja prezesa emitenta) nad spółką" }, ", której akcje były przedmiotem obrotu."] },
        { t: "p", bullet: true, runs: [{ b: "2. " }, "Wokół P. Międlara funkcjonuje ", { b: "trwała sieć osobowa" }, " (Jura, Jasiński, Kiciński, Noga, Greń), rotacyjnie obsadzająca organy Ragnar Trade, Labcanna, Foxbuy.com i Dirox — a część tych osób jednocześnie działała w obrocie na rachunkach własnych."] },
        { t: "p", bullet: true, runs: [{ b: "3. " }, "Centurion Finance ASI S.A. była reprezentowana w obrocie przez osoby zarządzające (B. Boszko, Ł. Ochman), a na rachunkach własnych działały osoby powiązane z nią kapitałowo i rodzinnie (J. Boszko, M. Ochman); osoba K. Barczyka łączy organy Centurion i Labcanna."] },
        { t: "p", bullet: true, runs: [{ b: "4. " }, "Klaster ośmiu podmiotów zagranicznych o cechach spółek wydmuszkowych działał ", { b: "rachunkami w jednym domu maklerskim (DM Intercapital)" }, " — tożsamym z obsługującym Ragnar Trade i Centurion; dysponent dwóch spółek klastra (N. Mayster) jest zarazem ", { b: "założycielem i dyrektorem wykonawczym brokera InterCapital Markets" }, " (Bułgaria), co wskazuje na centralne ogniwo organizacyjne tego klastra."] },
        { t: "p", bullet: true, runs: [{ b: "5. " }, "Mapa aktywności rachunków ujawnia ", { b: "koncentrację podmiotów z różnych klastrów w tych samych sesjach" }, " (10 i 20 maja — po siedem rachunków), zbieżną z przejęciem pakietu kontrolnego."] },
        { t: "p", runs: ["Ustalone powiązania — rozpatrywane łącznie z przejęciem kontroli nad emitentem oraz zbieżnością czasową aktywności rachunków — uprawdopodabniają, że wskazane osoby i podmioty mogły ", { b: "działać wspólnie i w porozumieniu" }, ", którego celem mogło być wywarcie wpływu na kształtowanie się kursu akcji Milisystem S.A."] },
        { t: "p", runs: [{ i: "Niniejsza analiza opiera się wyłącznie na źródłach ogólnodostępnych (KRS, GLEIF, komunikaty KNF/ESPI, rejestry zagraniczne, publikacje prasowe) oraz na dokumentach zgromadzonych w aktach sprawy. Przedstawione ustalenia mają charakter faktyczny i nie przesądzają o wypełnieniu znamion czynu zabronionego ani o odpowiedzialności którejkolwiek z wymienionych osób — ocena należy do organu prowadzącego postępowanie oraz sądu." }] },
      ] },
      // ── ZAŁĄCZNIK — GRAF ──
      { heading: "ZAŁĄCZNIK — GRAF POWIĄZAŃ", blocks: [
        { t: "p", runs: ["Graf obrazuje ustalone powiązania. Węzeł centralny — emitent Milisystem S.A.; kolory oznaczają trzy klastry; linia ciągła — powiązanie bezpośrednie (funkcja / kapitał / obrót), linia przerywana — powiązanie pośrednie lub działanie na rachunku własnym."] },
        { t: "graph" },
        { t: "src", label: "Opracowanie własne na podstawie: KRS, GLEIF, postanowienia prok. z 30.11.2023 i akt sprawy", url: "https://api.gleif.org" },
      ] },
    ],
  };
}
