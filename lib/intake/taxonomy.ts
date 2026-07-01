// Taksonomia dokumentów sprawy — port z Pythona (intake/taxonomy.py).
// Klasyfikacja po nazwie/ścieżce pliku, więc czysta logika (bez parsowania treści).

export type Provenance = "wejście" | "wyjście" | "?";

export type DocType = {
  label: string;
  source: string;
  provenance: Provenance;
};

export const DOC_TYPES: Record<string, DocType> = {
  POSTANOWIENIE: { label: "Postanowienie o powołaniu biegłego", source: "prokuratura", provenance: "wejście" },
  ZAWIADOMIENIE_KNF: { label: "Zawiadomienie o podejrzeniu przestępstwa", source: "UKNF", provenance: "wejście" },
  OPINIA_UKNF: { label: "Opinia biegłego UKNF (teza do weryfikacji)", source: "biegły UKNF", provenance: "wejście" },
  OPINIA_INNY_BIEGLY: { label: "Opinia / analiza innego biegłego (materiał wejściowy)", source: "inny biegły / organ", provenance: "wejście" },
  ANALIZA_OSINT: { label: "Analiza OSINT / graf powiązań", source: "UKNF", provenance: "wejście" },
  DANE_IP: { label: "Dane logowań / mapowanie IP", source: "UKNF / brokerzy", provenance: "wejście" },
  ZALACZNIK_OSOBOWY: { label: "Załącznik osobowy (dane identyfikacyjne)", source: "prokuratura", provenance: "wejście" },
  DANE_UTP: { label: "Źródłowe dane UTP (transakcje i zlecenia)", source: "GPW / prokuratura", provenance: "wejście" },
  DANE_TREM: { label: "Dane TREM (transakcje doidentyfikowane)", source: "UKNF", provenance: "wejście" },
  DANE_BROKERSKIE: { label: "Dane z firm inwestycyjnych (rachunki)", source: "dom maklerski", provenance: "wejście" },
  STOR: { label: "Raport STOR (podejrzane zlecenia/transakcje)", source: "GPW", provenance: "wejście" },
  SPEC_TECHNICZNA: { label: "Specyfikacja formatu danych (UTP/FIX)", source: "GPW", provenance: "wejście" },
  NOTOWANIA_REF: { label: "Notowania referencyjne (rynek/branża)", source: "źródło zewnętrzne", provenance: "wejście" },
  KRS_REJESTR: { label: "Odpis z rejestru (KRS / zagraniczny)", source: "rejestr", provenance: "wejście" },
  SPRAWOZDANIE_FIN: { label: "Sprawozdanie finansowe / plan rozwoju", source: "spółka", provenance: "wejście" },
  RAPORT_ESPI_EBI: { label: "Raport bieżący/okresowy ESPI/EBI", source: "spółka", provenance: "wejście" },
  ZAWIAD_STAN_POSIADANIA: { label: "Zawiadomienie o zmianie stanu posiadania", source: "podmiot", provenance: "wejście" },
  UMOWA_CYWILNA: { label: "Umowa cywilnoprawna (zbycie/nabycie akcji)", source: "podmiot", provenance: "wejście" },
  OPINIA_BIEGLEGO: { label: "Opinia biegłego sądowego (robocza/finalna)", source: "biegły sądowy", provenance: "wyjście" },
  SUBANALIZA: { label: "Subanaliza / analiza robocza", source: "biegły sądowy", provenance: "wyjście" },
  RECENZJA_UWAGI: { label: "Recenzja / uwagi do opinii", source: "biegły sądowy / zespół", provenance: "wyjście" },
  UNKNOWN: { label: "Niesklasyfikowany (do ręcznej oceny)", source: "?", provenance: "?" },
};

// Reguły: pierwsze trafienie wygrywa, od szczegółu do ogółu (jak w Pythonie).
export const RULES: { phrases: string[]; code: string }[] = [
  { phrases: ["uwagi"], code: "RECENZJA_UWAGI" },
  { phrases: ["kupis", "odpwiedź uknf", "odpowiedź uknf", "odpowiedz uknf"], code: "OPINIA_UKNF" },
  // Wytwory Krzysztofa Michrowskiego (WYJŚCIE) — tylko z wyraźnym oznaczeniem autorstwa (KM / Michrowski).
  { phrases: ["km finał", "km final", "hub.tech km", "hub.tech 2", "wnioski km", "michrowski", "k. michrowski"], code: "OPINIA_BIEGLEGO" },
  // Opinie i analizy INNYCH biegłych otrzymane z prokuratury = materiał WEJŚCIOWY (nie wytwór Michrowskiego).
  { phrases: ["opinia biegłego", "opinia bieglego", "opinia biegłej", "opinia bieglej", "opinia sądowa", "opinia sadowa", "opinia final", "opinia uzupełniająca", "opinia uzupelniajaca", "ekspertyza", "opinia z zakresu", "analiza biegłego", "analiza bieglego"], code: "OPINIA_INNY_BIEGLY" },
  { phrases: ["opinia_mk", "/poprawione/", "wash trade", "wash-trades", "pump&dump", "pump and dump", "layering", "grup-grup", "obrótwolumen", "obrotwolumen", "analiza_anulowane", "analiza czasu", "kurs_wolumen", "tabele dzienne", "tabele per podmiot", "ekon-fin", "ekon_fin", "espi_ebi_powiązania", "wnioski.docx", "podsumowanie.docx", "sekwencje zleceń", "wykresy", "imo.xlsx", "imo_", "transakcje_2", "załączniki/", "zalaczniki/", "_aktywnosc", "_aktywność", "pomiędzy grupą", "pomiedzy grupa", "wew. grupy", "wew grupy", "wew. podmiot", "wew podmiot", "podział podmiotowy", "podzial podmiotowy"], code: "SUBANALIZA" },
  { phrases: ["postanowienie"], code: "POSTANOWIENIE" },
  { phrases: ["zał. osobowy", "załącznik osobowy", "zalacznik osobowy", "1. załącznik osobowy"], code: "ZALACZNIK_OSOBOWY" },
  { phrases: ["osint", "graf powiazan", "graf powiązań"], code: "ANALIZA_OSINT" },
  { phrases: ["ip_all", "ip_wspolne", "logins_users", "infront users", "zbieznosc", "zbieżność"], code: "DANE_IP" },
  { phrases: ["stanu_posiadania", "zmiana_stanu", "zejscie_z_progow", "zejście_z_progów", "zwiększenie_zawiadomienie", "zawiadomienie_o_transakcji", "zawiadomienie_o_traskacji", "rejestracja_akcji", "going_below", "powiadomienie-mar", "powiadomienie_mar", "-mar-", "zawiadomienie-igs", "zawiadomienie-rgr"], code: "ZAWIAD_STAN_POSIADANIA" },
  { phrases: ["block trade", "block_trade", "blocktrade"], code: "DANE_UTP" },
  { phrases: ["zawiadomienie knf", "zawiadomienie hub", "zawiadomienie milis", "icm-lcn", "zawiadomienie 1", "zawiadomienie 2", "zawiadomienie 3"], code: "ZAWIADOMIENIE_KNF" },
  { phrases: ["output file specification", "fix_message", "fix message", "wse cde", "wse _cde"], code: "SPEC_TECHNICZNA" },
  // TREM przed UTP (nazwy zaczynają się od "UTP_TREM"), a UTP przed danymi
  // brokerskimi — inaczej "_zlec" z reguły brokerskiej łapie "transakcje_i_zlecenia".
  { phrases: ["utp_trem", "trem_id", "_trem"], code: "DANE_TREM" },
  { phrases: ["transakcje_i_zlecenia", "zlecenia i transakcje", "zlecenia_zrodlo", "utp_", "pliki transakcyjne", "mil_two_tko", "transakcje_pakietowe", "transakcje pakietowe"], code: "DANE_UTP" },
  { phrases: ["os. fizyczne", "zał. 4", "intercapital", "bm ing", "bm alior", "dm boś", "dm bps", "dm millennium", "dm pekao", "bm mbank", "_mbank", "_ing", "santander", "_bdm", "histfin", "histpap", "histpod", "histap", "umowa brok", "pit 8c", "pit_8c", "historia rachunku", "zestawienie transakcji", "zestawienie zleceń", "zestawienie zlecen", "umowa cywilnoprawna", "_logi", "_zlec", "_trans"], code: "DANE_BROKERSKIE" },
  { phrases: ["stor"], code: "STOR" },
  { phrases: ["odpis_pelny", "odpis_pełny", "odpis pełny", "krs", "dane z rejestrów", "rejestrow", " eik", "eik ", "firma "], code: "KRS_REJESTR" },
  { phrases: ["sprawozdanie", "spr-zarzadu", "wyniki_", "plan_rozwoju", "plan rozwoju", "plan-rozwoju", "strategia", "aktualizacja_planow", "plany_rozwoju"], code: "SPRAWOZDANIE_FIN" },
  { phrases: ["raport", "espi", "ebi", "projekty_uchwal", "nwza", "zwz", "uchwał", "uchwal"], code: "RAPORT_ESPI_EBI" },
  { phrases: ["umowa kupna", "umowa sprzedaży", "umowa sprzedazy", "umowy_cywilne"], code: "UMOWA_CYWILNA" },
  { phrases: ["notowania chemia", "stooq", "hub_d"], code: "NOTOWANIA_REF" },
];

// Double-check kompletności (proces.docx): DANE_IP wymagane (Krok 4 — korelacja IP);
// TREM i notowania zalecane (Krok 6 — analiza liczbowa; IV.1 — dynamika kursu).
export const REQUIRED = ["POSTANOWIENIE", "ZAWIADOMIENIE_KNF", "OPINIA_UKNF", "DANE_UTP", "DANE_BROKERSKIE", "KRS_REJESTR", "DANE_IP"];
export const RECOMMENDED = ["ANALIZA_OSINT", "DANE_TREM", "NOTOWANIA_REF", "SPRAWOZDANIE_FIN", "RAPORT_ESPI_EBI", "SPEC_TECHNICZNA", "ZALACZNIK_OSOBOWY"];
