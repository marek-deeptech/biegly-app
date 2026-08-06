// KALENDARIUM WYDARZEŃ MAKROEKONOMICZNYCH — krok „Otoczenie makro" toru bankowego.
//
// WZORZEC: rozdz. V.K finalnej opinii MBR (PO III Ds 84.2020, s. 73–92) — datowany
// przegląd wydarzeń światowych POPRZEDZAJĄCYCH oceniane zdarzenie, obok szeregów
// liczbowych (inflacja, kursy, stopy) i wykresów (ropa WTI, Case-Shiller). Ustala
// tło i stan wiedzy POWSZECHNIE DOSTĘPNEJ w dniu decyzji — nie stan wiedzy banku.
//
// ⚠️ TO JEST TŁO, NIE MATERIAŁ DOWODOWY. Wpisy kalendarium są wiedzą powszechną
// z podanym źródłem — jak katalog przepisów, a nie jak odczyt z akt. W opinii wolno
// je przywołać wyłącznie jako kontekst, po zweryfikowaniu źródła; ustalenia sprawy
// (co bank wiedział, co było w aktach) pochodzą z modułów liczonych z akt.
// Fakty WŁASNE sprawy (decyzje KNF wobec badanego banku itp.) NIE wchodzą do tego
// katalogu — muszą pochodzić z akt (chronologia nadzorcza), inaczej kalendarium
// przemyciłoby ustalenie bez dowodu.
//
// ⚠️ WPISY „PO ZDARZENIU" SĄ PUŁAPKĄ WNIOSKOWANIA WSTECZNEGO. Panel pokazuje je
// wyłącznie za jawnym przełącznikiem i z ostrzeżeniem — opisują następstwa, nie
// stan wiedzy z dnia decyzji (ta sama zasada co podział publikacji w warsztacie).

export type KategoriaWydarzenia = "kryzys" | "wojna" | "pandemia" | "polityka_pieniezna" | "rynek";

export const KATEGORIE_WYDARZEN: { id: KategoriaWydarzenia; label: string }[] = [
  { id: "kryzys", label: "Kryzys finansowy" },
  { id: "wojna", label: "Konflikt zbrojny" },
  { id: "pandemia", label: "Pandemia" },
  { id: "polityka_pieniezna", label: "Polityka pieniężna" },
  { id: "rynek", label: "Rynki i surowce" },
];

export type WydarzenieMakro = {
  dzien: string;
  opis: string;
  kategoria: KategoriaWydarzenia;
  zrodlo: string;
};

const MBR = "Opinia MBR (PO III Ds 84.2020), rozdz. V.K, s. 73–92";
// Wpisy spoza wzorca MBR: fakt powszechnie znany, ale numer strony/komunikat trzeba
// wskazać dopiero przy cytowaniu w opinii — kalendarium podaje, GDZIE szukać.
const W = (gdzie: string) => `wiedza powszechna — przy cytowaniu w opinii zweryfikuj: ${gdzie}`;

export const KALENDARIUM_MAKRO: WydarzenieMakro[] = [
  // ── Kryzys subprime i upadek Glitnira (2007–2008) — przepisane z opinii MBR ──
  { dzien: "2007-04-02", opis: "Upadłość New Century Financial — drugiej co do wielkości firmy rynku kredytów subprime w USA.", kategoria: "kryzys", zrodlo: MBR },
  { dzien: "2007-07-19", opis: "Dow Jones po raz pierwszy w historii przekracza 14 tys. punktów — szczyt hossy przed kryzysem.", kategoria: "rynek", zrodlo: MBR },
  { dzien: "2007-08-31", opis: "Prezydent USA ogłasza program pomocy dla kredytobiorców hipotecznych; system finansowy od sierpnia w zaburzeniach wywołanych rynkiem subprime.", kategoria: "kryzys", zrodlo: MBR },
  { dzien: "2007-11-01", opis: "Fed zasila rynek płynnością wobec narastających strat banków na papierach zabezpieczonych hipotekami.", kategoria: "polityka_pieniezna", zrodlo: MBR },
  { dzien: "2008-01-02", opis: "Rok zaczynają rekordy cen surowców — baryłka ropy crude przekracza 100 USD.", kategoria: "rynek", zrodlo: MBR },
  { dzien: "2008-01-15", opis: "Spadki na giełdach po słowach A. Greenspana o recesji w USA; Citigroup ogłasza 9,8 mld USD straty za IV kw. 2007.", kategoria: "kryzys", zrodlo: MBR },
  { dzien: "2008-01-21", opis: "Najgorszy dzień na światowych giełdach od zamachu na WTC — WIG traci 5,5%, podobnie FTSE i Hongkong.", kategoria: "rynek", zrodlo: MBR },
  { dzien: "2008-01-24", opis: "Société Générale ujawnia stratę ponad 4,9 mld euro na ryzykownych pozycjach.", kategoria: "kryzys", zrodlo: MBR },
  { dzien: "2008-02-16", opis: "Rząd brytyjski nacjonalizuje Northern Rock po runie klientów na bank.", kategoria: "kryzys", zrodlo: MBR },
  { dzien: "2008-03-11", opis: "Fed zasila system bankowy kwotą 200 mld USD dla podtrzymania płynności rynku.", kategoria: "polityka_pieniezna", zrodlo: MBR },
  { dzien: "2008-03-16", opis: "Z braku płynności upada Bear Stearns — piąty bank inwestycyjny USA; przejęty przez JP Morgan za ułamek wartości.", kategoria: "kryzys", zrodlo: MBR },
  { dzien: "2008-04-08", opis: "MFW potwierdza w raporcie rosnące zagrożenie globalną recesją.", kategoria: "kryzys", zrodlo: MBR },
  { dzien: "2008-04-18", opis: "Citigroup ogłasza rekordową stratę ponad 5 mld USD za I kw. 2008 i zwolnienia 20 tys. osób.", kategoria: "kryzys", zrodlo: MBR },
  { dzien: "2008-05-09", opis: "AIG ogłasza rekordową stratę 7,8 mld USD za I kw. 2008.", kategoria: "kryzys", zrodlo: MBR },
  { dzien: "2008-06-06", opis: "Bezrobocie w USA skacze z 5,0% do 5,5%; ropa sięga 139 USD za baryłkę.", kategoria: "rynek", zrodlo: MBR },
  { dzien: "2008-06-30", opis: "Irlandia jako pierwszy kraj strefy euro wchodzi w recesję (PKB I kw. −1,5% r/r).", kategoria: "kryzys", zrodlo: MBR },
  { dzien: "2008-07-30", opis: "Prezydent USA podpisuje plan ratowania sektora nieruchomości wart ok. 300 mld USD.", kategoria: "kryzys", zrodlo: MBR },
  { dzien: "2008-08-08", opis: "AIG informuje o 5,4 mld USD straty w II kw. — trzeci stratny kwartał z rzędu.", kategoria: "kryzys", zrodlo: MBR },
  { dzien: "2008-08-15", opis: "Eurostat: PKB strefy euro w II kw. spada o 0,2% kw/kw, inflacja sięga 4%.", kategoria: "kryzys", zrodlo: MBR },
  { dzien: "2008-09-07", opis: "Rząd USA przejmuje kontrolę nad Fannie Mae i Freddie Mac — filarami rynku hipotecznego.", kategoria: "kryzys", zrodlo: MBR },
  { dzien: "2008-09-08", opis: "Bezrobocie w USA skacze do 6,1%; od początku roku gospodarka straciła 605 tys. miejsc pracy.", kategoria: "kryzys", zrodlo: MBR },
  { dzien: "2008-09-11", opis: "Bank centralny Rosji ujawnia topnienie rezerw walutowych po wojnie z Gruzją — odpływ kapitału z rynków wschodzących.", kategoria: "wojna", zrodlo: MBR },
  { dzien: "2008-09-15", opis: "Upadłość Lehman Brothers — kulminacja kryzysu finansowego; zamrożenie rynku międzybankowego.", kategoria: "kryzys", zrodlo: W("komunikaty SEC/Fed z 15.09.2008, prasa światowa") },
  { dzien: "2008-10-07", opis: "Islandia przejmuje Glitnir i Landsbanki; nadzór przejmuje Kaupthing dzień później — upadek islandzkiego sektora bankowego.", kategoria: "kryzys", zrodlo: W("komunikaty FME (islandzki nadzór) z 7–9.10.2008") },
  // ── Kryzys strefy euro (2010–2013) ──────────────────────────────────────────
  { dzien: "2010-05-02", opis: "Pierwszy program pomocowy dla Grecji (UE/MFW) — początek kryzysu zadłużeniowego strefy euro.", kategoria: "kryzys", zrodlo: W("komunikat Eurogrupy z 2.05.2010") },
  { dzien: "2011-08-05", opis: "S&P odbiera USA rating AAA — pierwsza obniżka w historii; turbulencje na rynkach długu.", kategoria: "rynek", zrodlo: W("komunikat S&P z 5.08.2011") },
  { dzien: "2012-07-26", opis: "„Whatever it takes\" — deklaracja prezesa EBC M. Draghiego o obronie euro; odwrót kryzysu zadłużeniowego.", kategoria: "polityka_pieniezna", zrodlo: W("wystąpienie prezesa EBC, Londyn 26.07.2012") },
  { dzien: "2013-03-25", opis: "Program ratunkowy dla Cypru z przymusowym umorzeniem części depozytów (bail-in) — precedens w strefie euro.", kategoria: "kryzys", zrodlo: W("komunikat Eurogrupy z 25.03.2013") },
  // ── Okres 2014–2015 (tło spraw SK Banku i podobnych) ───────────────────────
  { dzien: "2014-03-18", opis: "Aneksja Krymu przez Rosję — sankcje, odpływ kapitału z regionu, osłabienie rubla.", kategoria: "wojna", zrodlo: W("prasa światowa, komunikaty UE o sankcjach III–VII 2014") },
  { dzien: "2014-06-05", opis: "EBC jako pierwszy duży bank centralny wprowadza ujemną stopę depozytową (−0,10%).", kategoria: "polityka_pieniezna", zrodlo: W("decyzja Rady Prezesów EBC z 5.06.2014") },
  { dzien: "2014-10-09", opis: "RPP obniża stopę referencyjną NBP do 2,00% — środowisko rekordowo niskich stóp uciska wynik odsetkowy banków.", kategoria: "polityka_pieniezna", zrodlo: W("komunikat RPP z 8–9.10.2014") },
  { dzien: "2014-12-31", opis: "Cena ropy Brent spada w II półroczu 2014 z ok. 110 do ok. 55 USD — szok podażowy na rynku surowców.", kategoria: "rynek", zrodlo: W("notowania ICE Brent, podsumowania roczne 2014") },
  { dzien: "2015-01-15", opis: "SNB uwalnia kurs franka („frankogeddon\") — skokowe umocnienie CHF, wzrost rat kredytów frankowych w Polsce.", kategoria: "rynek", zrodlo: W("komunikat SNB z 15.01.2015") },
  { dzien: "2015-01-22", opis: "EBC ogłasza program skupu aktywów (QE) o skali 60 mld euro miesięcznie.", kategoria: "polityka_pieniezna", zrodlo: W("decyzja Rady Prezesów EBC z 22.01.2015") },
  { dzien: "2015-03-04", opis: "RPP obniża stopę referencyjną NBP do 1,50% — najniżej w historii; koniec cyklu obniżek.", kategoria: "polityka_pieniezna", zrodlo: W("komunikat RPP z 4.03.2015") },
  { dzien: "2015-06-28", opis: "Grecja zamyka banki i wprowadza kontrolę przepływu kapitału — kulminacja kryzysu greckiego.", kategoria: "kryzys", zrodlo: W("dekret rządu Grecji z 28.06.2015") },
  // ── Pandemia i lata 2020+ ──────────────────────────────────────────────────
  { dzien: "2020-03-11", opis: "WHO ogłasza pandemię COVID-19 — zamrożenie gospodarek, przecena aktywów, skok awersji do ryzyka.", kategoria: "pandemia", zrodlo: W("oświadczenie WHO z 11.03.2020") },
  { dzien: "2020-03-17", opis: "RPP tnie stopy (początek cyklu do 0,10%) i uruchamia skup obligacji — pandemiczne luzowanie w Polsce.", kategoria: "polityka_pieniezna", zrodlo: W("komunikaty RPP z 17.03, 8.04 i 28.05.2020") },
  { dzien: "2021-10-06", opis: "RPP rozpoczyna cykl podwyżek stóp wobec inflacji — z 0,10% do 6,75% we IX 2022.", kategoria: "polityka_pieniezna", zrodlo: W("komunikaty RPP X 2021 – IX 2022") },
  { dzien: "2022-02-24", opis: "Pełnoskalowa inwazja Rosji na Ukrainę — szok energetyczny, sankcje, skok cen surowców i awersji do ryzyka.", kategoria: "wojna", zrodlo: W("prasa światowa, komunikaty UE z 24–25.02.2022") },
  { dzien: "2023-03-10", opis: "Upadek Silicon Valley Bank — największa upadłość banku w USA od 2008 r.; tydzień później przymusowe przejęcie Credit Suisse przez UBS.", kategoria: "kryzys", zrodlo: W("komunikaty FDIC z 10.03.2023 i FINMA/SNB z 19.03.2023") },
];

/**
 * Wydarzenia w oknie czasowym, podzielone względem daty zdarzenia.
 *
 * `przed` to materiał na tło opinii (stan wiedzy dostępnej w dniu decyzji);
 * `po` — wyłącznie za przełącznikiem, z ostrzeżeniem o wnioskowaniu wstecznym.
 * Bez daty zdarzenia wszystko trafia do `przed` — panel mówi wtedy wprost,
 * że podział nastąpi po podaniu daty.
 */
export function wydarzeniaWzgledemDnia(dzienZdarzenia?: string | null): {
  przed: WydarzenieMakro[];
  po: WydarzenieMakro[];
} {
  const posortowane = [...KALENDARIUM_MAKRO].sort((a, b) => a.dzien.localeCompare(b.dzien));
  if (!dzienZdarzenia) return { przed: posortowane, po: [] };
  return {
    przed: posortowane.filter((w) => w.dzien <= dzienZdarzenia),
    po: posortowane.filter((w) => w.dzien > dzienZdarzenia),
  };
}
