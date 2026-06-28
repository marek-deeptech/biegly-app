"""Taksonomia dokumentów sprawy + kanon dokumentów obowiązkowych.

To jest zasiana wersja oparta na realnej zawartości spraw HubTech i Milisystem.
DOCELOWO kanon (REQUIRED/RECOMMENDED) zatwierdza biegły Krzysztof Michrowski.

Każdy typ dokumentu ma: etykietę, domyślne źródło/autora oraz proweniencję
(WEJŚCIE = materiał dowodowy; WYJŚCIE = wytwór biegłego sądowego/DIO).
"""
from __future__ import annotations

INPUT = "wejście"
OUTPUT = "wyjście"

# kod -> (etykieta, źródło/autor, proweniencja)
DOC_TYPES: dict[str, tuple[str, str, str]] = {
    # --- WEJŚCIE: procesowe / organy ---
    "POSTANOWIENIE": ("Postanowienie o powołaniu biegłego", "prokuratura", INPUT),
    "ZAWIADOMIENIE_KNF": ("Zawiadomienie o podejrzeniu przestępstwa", "UKNF", INPUT),
    "OPINIA_UKNF": ("Opinia biegłego UKNF (teza do weryfikacji)", "biegły UKNF", INPUT),
    "ANALIZA_OSINT": ("Analiza OSINT / graf powiązań", "UKNF", INPUT),
    "DANE_IP": ("Dane logowań / mapowanie IP", "UKNF / brokerzy", INPUT),
    "ZALACZNIK_OSOBOWY": ("Załącznik osobowy (dane identyfikacyjne)", "prokuratura", INPUT),
    # --- WEJŚCIE: dane rynkowe / brokerskie ---
    "DANE_UTP": ("Źródłowe dane UTP (transakcje i zlecenia)", "GPW / prokuratura", INPUT),
    "DANE_BROKERSKIE": ("Dane z firm inwestycyjnych (rachunki)", "dom maklerski", INPUT),
    "STOR": ("Raport STOR (podejrzane zlecenia/transakcje)", "GPW", INPUT),
    "SPEC_TECHNICZNA": ("Specyfikacja formatu danych (UTP/FIX)", "GPW", INPUT),
    "NOTOWANIA_REF": ("Notowania referencyjne (rynek/branża)", "źródło zewnętrzne", INPUT),
    # --- WEJŚCIE: rejestry / emitent ---
    "KRS_REJESTR": ("Odpis z rejestru (KRS / zagraniczny)", "rejestr", INPUT),
    "SPRAWOZDANIE_FIN": ("Sprawozdanie finansowe / plan rozwoju", "spółka", INPUT),
    "RAPORT_ESPI_EBI": ("Raport bieżący/okresowy ESPI/EBI", "spółka", INPUT),
    "ZAWIAD_STAN_POSIADANIA": ("Zawiadomienie o zmianie stanu posiadania", "podmiot", INPUT),
    "UMOWA_CYWILNA": ("Umowa cywilnoprawna (zbycie/nabycie akcji)", "podmiot", INPUT),
    # --- WYJŚCIE: wytwory biegłego sądowego ---
    "OPINIA_BIEGLEGO": ("Opinia biegłego sądowego (robocza/finalna)", "biegły sądowy", OUTPUT),
    "SUBANALIZA": ("Subanaliza / analiza robocza", "biegły sądowy", OUTPUT),
    "RECENZJA_UWAGI": ("Recenzja / uwagi do opinii", "biegły sądowy / zespół", OUTPUT),
    # --- nierozpoznane ---
    "UNKNOWN": ("Niesklasyfikowany (do ręcznej oceny)", "?", "?"),
}

# Reguły klasyfikacji: (lista fraz w ścieżce [lowercase], kod typu).
# Kolejność MA ZNACZENIE — pierwsze trafienie wygrywa, od szczegółu do ogółu.
RULES: list[tuple[list[str], str]] = [
    # wytwory biegłego — markery jednoznaczne (przed regułami ogólnymi)
    (["uwagi"], "RECENZJA_UWAGI"),
    (["kupis", "odpwiedź uknf", "odpowiedź uknf", "odpowiedz uknf"], "OPINIA_UKNF"),
    (["km finał", "km final", "opinia final", "opinia biegłego", "opinia bieglego",
      "hub.tech km", "hub.tech 2", "wnioski km"], "OPINIA_BIEGLEGO"),
    (["opinia_mk", "/poprawione/", "wash trade", "wash-trades", "pump&dump", "pump and dump",
      "layering", "grup-grup", "obrótwolumen", "obrotwolumen", "analiza_anulowane",
      "analiza czasu", "kurs_wolumen", "tabele dzienne", "tabele per podmiot",
      "ekon-fin", "ekon_fin", "espi_ebi_powiązania", "wnioski.docx", "podsumowanie.docx",
      "sekwencje zleceń", "wykresy", "imo.xlsx", "imo_", "transakcje_2",
      "załączniki/", "zalaczniki/", "_aktywnosc", "_aktywność", "pomiędzy grupą",
      "pomiedzy grupa", "wew. grupy", "wew grupy", "wew. podmiot", "wew podmiot",
      "podział podmiotowy", "podzial podmiotowy", "podział podmiotowypdf"], "SUBANALIZA"),
    # procesowe / organy
    (["postanowienie"], "POSTANOWIENIE"),
    (["zał. osobowy", "załącznik osobowy", "zalacznik osobowy", "1. załącznik osobowy"],
     "ZALACZNIK_OSOBOWY"),
    (["osint", "graf powiazan", "graf powiązań"], "ANALIZA_OSINT"),
    (["ip_all", "ip_wspolne", "logins_users", "infront users", "zbieznosc", "zbieżność"],
     "DANE_IP"),
    # zawiadomienia o zmianie stanu posiadania (przed ogólnym 'zawiadomienie')
    (["stanu_posiadania", "zmiana_stanu", "zejscie_z_progow", "zejście_z_progów",
      "zwiększenie_zawiadomienie", "zawiadomienie_o_transakcji", "zawiadomienie_o_traskacji",
      "rejestracja_akcji", "going_below", "powiadomienie-mar", "powiadomienie_mar",
      "-mar-", "zawiadomienie-igs", "zawiadomienie-rgr"], "ZAWIAD_STAN_POSIADANIA"),
    (["block trade", "block_trade", "blocktrade"], "DANE_UTP"),
    (["zawiadomienie knf", "zawiadomienie hub", "zawiadomienie milis", "icm-lcn",
      "zawiadomienie 1", "zawiadomienie 2", "zawiadomienie 3"], "ZAWIADOMIENIE_KNF"),
    # specyfikacje techniczne (przed danymi UTP)
    (["output file specification", "fix_message", "fix message", "wse cde", "wse _cde"],
     "SPEC_TECHNICZNA"),
    # dane brokerskie (markery rachunków/firm; przed UTP i umowami)
    (["os. fizyczne", "zał. 4", "intercapital", "bm ing", "bm alior", "dm boś", "dm bps",
      "dm millennium", "dm pekao", "bm mbank", "_mbank", "_ing", "santander", "_bdm",
      "histfin", "histpap", "histpod", "histap", "umowa brok", "pit 8c", "pit_8c",
      "historia rachunku", "zestawienie transakcji", "zestawienie zleceń", "zestawienie zlecen",
      "umowa cywilnoprawna", "_logi", "_zlec", "_trans"], "DANE_BROKERSKIE"),
    # źródłowe dane UTP
    (["transakcje_i_zlecenia", "zlecenia i transakcje", "zlecenia_zrodlo", "utp_",
      "pliki transakcyjne", "mil_two_tko", "transakcje_pakietowe", "transakcje pakietowe"],
     "DANE_UTP"),
    # STOR
    (["stor"], "STOR"),
    # rejestry
    (["odpis_pelny", "odpis_pełny", "odpis pełny", "krs", "dane z rejestrów", "rejestrow",
      " eik", "eik ", "firma "], "KRS_REJESTR"),
    # sprawozdania / plany / strategie
    (["sprawozdanie", "spr-zarzadu", "wyniki_", "plan_rozwoju", "plan rozwoju",
      "plan-rozwoju", "strategia", "aktualizacja_planow", "plany_rozwoju"], "SPRAWOZDANIE_FIN"),
    # raporty ESPI/EBI
    (["raport", "espi", "ebi", "projekty_uchwal", "nwza", "zwz", "uchwał", "uchwal"],
     "RAPORT_ESPI_EBI"),
    # umowy cywilne (zbycie/nabycie pakietów)
    (["umowa kupna", "umowa sprzedaży", "umowa sprzedazy", "umowy_cywilne"], "UMOWA_CYWILNA"),
    # notowania referencyjne
    (["notowania chemia", "stooq", "hub_d"], "NOTOWANIA_REF"),
]

# Kanon dokumentów: co MUSI / POWINNO być, by wydać opinię (do zatwierdzenia przez biegłego).
REQUIRED = ["POSTANOWIENIE", "ZAWIADOMIENIE_KNF", "OPINIA_UKNF", "DANE_UTP",
            "DANE_BROKERSKIE", "KRS_REJESTR"]
RECOMMENDED = ["ANALIZA_OSINT", "DANE_IP", "SPRAWOZDANIE_FIN", "RAPORT_ESPI_EBI",
               "SPEC_TECHNICZNA", "ZALACZNIK_OSOBOWY"]
