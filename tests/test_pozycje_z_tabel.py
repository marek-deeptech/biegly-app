"""Pozycje z tabel odczytanych z obrazu stron sprawozdania (pozycje_z_tabel).

Dane wzorowane na realnym odczycie raportu EBI SBRiR za 2014 r. (akta SK Banku,
pozyskane/ebi14_14.ocr.pdf): bilans z kolumnami dat, strony-kontynuacje bez
nagłówków kolumn, RZiS i zestawienie zmian z kolumnami rocznymi („2013 r.”),
wiersz „Współczynnik wypłacalności” na końcu bilansu banku spółdzielczego.

Tabele są WBUDOWANE, nie czytane z dysku — golden testy silnika już raz padły,
gdy katalog źródłowy uporządkowano.
"""
from engine.sprawozdania import pozycje_z_tabel


def _tabele_wzorcowe():
    return [
        {  # bilans, aktywa
            "plik": "ebi14_14.ocr.pdf", "strona": 1, "jednostka": "w złotych",
            "kolumny": ["31.12.2013 r.", "31.12.2014 r."],
            "wiersze": [
                {"etykieta": "Kasa, operacje z Bankiem Centralnym",
                 "wartosci": ["17 775 590,07", "23 574 203,03"]},
                {"etykieta": "Należności od sektora niefinansowego",
                 "wartosci": ["1 629 549 228,01", "2 440 033 375,77"]},
                {"etykieta": "Aktywa razem",
                 "wartosci": ["3 105 176 764,07", "3 828 641 287,62"]},
            ],
        },
        {  # bilans, pasywa
            "plik": "ebi14_14.ocr.pdf", "strona": 2, "jednostka": "w złotych",
            "kolumny": ["31.12.2013 r.", "31.12.2014 r."],
            "wiersze": [
                {"etykieta": "Zobowiązania wobec sektora niefinansowego",
                 "wartosci": ["2 596 722 273,43", "3 175 825 943,31"]},
            ],
        },
        {  # pasywa, kontynuacja — model słusznie nie zgaduje kolumn, których nie widać
            "plik": "ebi14_14.ocr.pdf", "strona": 3,
            "kolumny": ["", ""],
            "wiersze": [
                {"etykieta": "Zysk (strata) netto", "wartosci": ["12 392 161,20", "7 690 268,83"]},
                {"etykieta": "Pasywa razem", "wartosci": ["3 105 176 764,07", "3 828 641 287,62"]},
                {"etykieta": "Współczynnik wypłacalności", "wartosci": ["13,16%", "13,84%"]},
            ],
        },
        {  # RZiS — kolumny roczne
            "plik": "ebi14_14.ocr.pdf", "strona": 4, "jednostka": "w złotych",
            "kolumny": ["2013 r.", "2014 r."],
            "wiersze": [
                {"etykieta": "Przychody z tytułu odsetek",
                 "wartosci": ["175 274 515,56", "222 558 870,98"]},
                {"etykieta": "Wynik z tytułu odsetek ( I-II)",
                 "wartosci": ["61 570 261,29", "104 117 545,25"]},
                {"etykieta": "Wynik działalności bankowej",
                 "wartosci": ["65 960 766,43", "107 745 125,30"]},
                {"etykieta": "Koszty działania banku",
                 "wartosci": ["40 037 845,85", "50 904 024,53"]},
                {"etykieta": "Różnica wartości rezerw i aktualizacji (XV-XVI)",
                 "wartosci": ["10 174 447,13", "28 513 289,40"]},
            ],
        },
        {  # RZiS, kontynuacja — zysk netto MUSI zgadzać się z pasywami
            "plik": "ebi14_14.ocr.pdf", "strona": 5,
            "kolumny": [],
            "wiersze": [
                {"etykieta": "Zysk (strata) netto", "wartosci": ["12 392 161,20", "7 690 268,83"]},
            ],
        },
        {  # zestawienie zmian w kapitale własnym
            "plik": "ebi14_14.ocr.pdf", "strona": 7, "jednostka": "w złotych",
            "kolumny": ["2013 r.", "2014 r."],
            "wiersze": [
                {"etykieta": "Kapitał własny na początek okresu (BO)",
                 "wartosci": ["132 002 707,11", "210 994 184,46"]},
            ],
        },
        {
            "plik": "ebi14_14.ocr.pdf", "strona": 8,
            "kolumny": [],
            "wiersze": [
                {"etykieta": "9. Wynik netto", "wartosci": ["12 392 161,20", "7 690 268,83"]},
                {"etykieta": "Kapitał własny na koniec okresu (BZ)",
                 "wartosci": ["210 994 184,46", "323 564 755,20"]},
                {"etykieta": "Kapitał własny po uwzględnieniu proponowanego podziału zysku",
                 "wartosci": ["220 907 913,42", "331 255 024,03"]},
            ],
        },
        {  # fundusze własne wg art. 127 pb — jedna kolumna, data z prozy nad tabelą
            "plik": "ebi14_08.ocr.pdf", "strona": 1,
            "kolumny": ["31.12.2014"],
            "wiersze": [
                {"etykieta": "Fundusze podstawowe", "wartosci": ["320.807.001,27"]},
                {"etykieta": "Udziałowy", "wartosci": ["11.752.840,00"]},
                {"etykieta": "Udziałowy (amortyzowany)", "wartosci": ["4.638.816,45"]},
            ],
        },
    ]


def test_odczyt_wzorcowy():
    uwagi = []
    poz, wykazane, zastrz, miejsca = pozycje_z_tabel(_tabele_wzorcowe(), uwagi=uwagi)

    assert [p.dzien for p in poz] == ["2013-12-31", "2014-12-31"]
    p13, p14 = poz

    # Bilans — kolumny z dat.
    assert p13.aktywa_ogolem == 3_105_176_764.07
    assert p14.aktywa_ogolem == 3_828_641_287.62
    assert p14.kredyty_brutto == 2_440_033_375.77
    assert p14.depozyty_klientow == 3_175_825_943.31
    # Kontynuacja strony dziedziczy kolumny (pasywa str. 3, RZiS str. 5, kapitał str. 8).
    assert p14.zysk_netto == 7_690_268.83
    assert p14.kapital_wlasny == 323_564_755.20
    # Kolumny roczne przypisane do dnia bilansowego.
    assert p13.przychody_odsetkowe == 175_274_515.56
    assert p14.wynik_dzialalnosci_bankowej == 107_745_125.30
    assert p14.koszty_dzialania == 50_904_024.53
    assert p14.wynik_z_rezerw == 28_513_289.40
    # Fundusze wg art. 127 pb; „Udziałowy (amortyzowany)” z rachunku CRR NIE wchodzi.
    assert p14.fundusz_udzialowy == 11_752_840.00
    assert p14.fundusze_podstawowe == 320_807_001.27
    assert p13.fundusz_udzialowy is None

    # Współczynnik wypłacalności idzie kanałem wartości WYKAZANYCH, nie do pozycji.
    assert wykazane == [("2013-12-31", 13.16), ("2014-12-31", 13.84)]

    # Bilans domyka się — zero zastrzeżeń; kontynuacje i kolumny roczne odnotowane.
    assert zastrz == []
    assert any("kontynuacja tabeli ze str. 2" in u for u in uwagi)
    assert any("kolumna roczna" in u for u in uwagi)
    assert miejsca["aktywa_ogolem"].startswith("ebi14_14.ocr.pdf, str. 1")
    assert miejsca["kapital_wlasny"].startswith("ebi14_14.ocr.pdf, str. 8")
    assert "_pasywa_razem" not in miejsca


def test_bilans_niedomkniety_odrzuca_pozycje_bilansowe():
    tabele = [
        {"plik": "x.pdf", "strona": 1, "kolumny": ["31.12.2014"],
         "wiersze": [
             {"etykieta": "Aktywa razem", "wartosci": ["3 828 641 287,62"]},
             {"etykieta": "Należności od sektora niefinansowego", "wartosci": ["2 440 033 375,77"]},
         ]},
        {"plik": "x.pdf", "strona": 2, "kolumny": ["31.12.2014"],
         "wiersze": [
             {"etykieta": "Pasywa razem", "wartosci": ["3 105 176 764,07"]},
             {"etykieta": "Zysk (strata) netto", "wartosci": ["7 690 268,83"]},
         ]},
    ]
    poz, _, zastrz, _ = pozycje_z_tabel(tabele)
    assert any("NIE DOMYKA SIĘ" in z for z in zastrz)
    # Pozycje bilansowe odrzucone, wynikowe zostają.
    assert len(poz) == 1
    assert poz[0].aktywa_ogolem is None
    assert poz[0].kredyty_brutto is None
    assert poz[0].zysk_netto == 7_690_268.83


def test_wartosc_absurdalnie_mala_odrzucona_glosno():
    # Dokładnie przypadek z akt SK: OCR dał „kredyty = 300” przy sumie 3,8 mld.
    tabele = [
        {"plik": "x.pdf", "strona": 1, "kolumny": ["31.12.2014"],
         "wiersze": [
             {"etykieta": "Aktywa razem", "wartosci": ["3 828 641 287,62"]},
             {"etykieta": "Pasywa razem", "wartosci": ["3 828 641 287,62"]},
             {"etykieta": "Należności od sektora niefinansowego", "wartosci": ["300,00"]},
         ]},
    ]
    poz, _, zastrz, _ = pozycje_z_tabel(tabele)
    assert any("absurdalnie mała" in z for z in zastrz)
    assert poz[0].kredyty_brutto is None
    assert poz[0].aktywa_ogolem == 3_828_641_287.62


def test_skladnik_wiekszy_od_sumy_odrzucony():
    tabele = [
        {"plik": "x.pdf", "strona": 1, "kolumny": ["31.12.2014"],
         "wiersze": [
             {"etykieta": "Aktywa razem", "wartosci": ["1 000 000,00"]},
             {"etykieta": "Pasywa razem", "wartosci": ["1 000 000,00"]},
             {"etykieta": "Zobowiązania wobec sektora niefinansowego", "wartosci": ["2 000 000,00"]},
         ]},
    ]
    poz, _, zastrz, _ = pozycje_z_tabel(tabele)
    assert any("przewyższa sumę bilansową" in z for z in zastrz)
    assert poz[0].depozyty_klientow is None


def test_konflikt_dwoch_odczytow_zgloszony_pierwszy_wygrywa():
    tabele = [
        {"plik": "x.pdf", "strona": 1, "kolumny": ["31.12.2014"],
         "wiersze": [{"etykieta": "Zysk (strata) netto", "wartosci": ["7 690 268,83"]}]},
        {"plik": "x.pdf", "strona": 2, "kolumny": ["31.12.2014"],
         "wiersze": [{"etykieta": "Zysk (strata) netto", "wartosci": ["9 999 999,99"]}]},
    ]
    poz, _, zastrz, _ = pozycje_z_tabel(tabele)
    assert any("odczytana dwukrotnie" in z for z in zastrz)
    assert poz[0].zysk_netto == 7_690_268.83


def test_kontynuacja_wymaga_ciaglosci_strony_i_zgodnej_liczby_wartosci():
    # Strona 5 po stronie 1 tego samego pliku — NIE jest kontynuacją; tabela bez
    # kolumn musi zostać pominięta głośno, nie doklejona do cudzych dat.
    tabele = [
        {"plik": "x.pdf", "strona": 1, "kolumny": ["31.12.2013", "31.12.2014"],
         "wiersze": [{"etykieta": "Aktywa razem",
                      "wartosci": ["3 105 176 764,07", "3 828 641 287,62"]}]},
        {"plik": "x.pdf", "strona": 5, "kolumny": [],
         "wiersze": [{"etykieta": "Zysk (strata) netto",
                      "wartosci": ["12 392 161,20", "7 690 268,83"]}]},
    ]
    poz, _, zastrz, _ = pozycje_z_tabel(tabele)
    assert any("pominięto" in z for z in zastrz)
    assert all(p.zysk_netto is None for p in poz)

    # Zgodna strona, ale inna liczba wartości w wierszu — też pominięcie.
    tabele2 = [
        {"plik": "x.pdf", "strona": 1, "kolumny": ["31.12.2013", "31.12.2014"],
         "wiersze": [{"etykieta": "Aktywa razem",
                      "wartosci": ["3 105 176 764,07", "3 828 641 287,62"]}]},
        {"plik": "x.pdf", "strona": 2, "kolumny": [],
         "wiersze": [{"etykieta": "Zysk (strata) netto", "wartosci": ["7 690 268,83"]}]},
    ]
    poz2, _, zastrz2, _ = pozycje_z_tabel(tabele2)
    assert any("pominięto" in z for z in zastrz2)
    assert all(p.zysk_netto is None for p in poz2)


def test_fundusze_wlasne_wchodza_tylko_z_metodyka_crr():
    """Dwie metodyki funduszy własnych w jednym sprawozdaniu (art. 127 pb i CRR)
    nie mogą trafić do jednego pola — do pozycji idzie CRR (z niego bank policzył
    wykazany współczynnik), art. 127 zostaje odnotowany, tabela bez oznaczenia
    nie wchodzi wcale."""
    def tabela(metodyka, kwota):
        t = {"plik": "x.pdf", "strona": 1, "kolumny": ["31.12.2014"],
             "wiersze": [{"etykieta": "Fundusze własne", "wartosci": [kwota]}]}
        if metodyka:
            t["metodyka"] = metodyka
        return t

    uwagi = []
    poz, _, zastrz, _ = pozycje_z_tabel([tabela("crr", "389.565.638,25")], uwagi=uwagi)
    assert poz[0].fundusze_wlasne == 389_565_638.25
    assert zastrz == []

    uwagi = []
    poz, _, zastrz, _ = pozycje_z_tabel([tabela("pb", "396.347.390,10")], uwagi=uwagi)
    assert poz == []  # wartość tylko w uwadze, nie w pozycjach
    assert any("art. 127" in u for u in uwagi)
    assert zastrz == []

    poz, _, zastrz, _ = pozycje_z_tabel([tabela(None, "396.347.390,10")])
    assert poz == []
    assert any("metodyka" in z for z in zastrz)


def test_klasyfikacja_naleznosci_z_kolumnami_procentowymi():
    """Nota klasyfikacyjna ma pod jedną datą dwie kolumny (zł i %) — procentowa
    niesie strukturę, nie kwotę, i musi być pominięta. Wiersz „…netto” nie może
    zostać połknięty przez wzorzec bilansowy należności."""
    tabele = [{
        "plik": "x.pdf", "strona": 22, "jednostka": "zł",
        "kolumny": ["Wartość na 31.12.2013r. zł", "Wartość na 31.12.2013r. %",
                    "Wartość na 31.12.2014r. zł", "Wartość na 31.12.2014r. %"],
        "wiersze": [
            {"etykieta": "Należności od sektora niefinansowego brutto",
             "wartosci": ["1 644 687 085,45", "100,00%", "2 468 794 764,57", "100,00%"]},
            {"etykieta": "3. Należności zagrożone:",
             "wartosci": ["110 626 541,71", "6,73%", "539 225 717,51", "21,84%"]},
            {"etykieta": "Rezerwy celowe na należności",
             "wartosci": ["25 737 129,43", "100,00%", "54 172 608,28", "100,00%"]},
            {"etykieta": "Należności od sektora niefinansowego netto (bez odsetek)",
             "wartosci": ["1 614 053 876,70", "x", "2 408 090 749,53", "x"]},
        ],
    }]
    poz, _, zastrz, _ = pozycje_z_tabel(tabele)
    assert zastrz == []
    p13, p14 = poz
    assert p14.naleznosci_nominalne == 2_468_794_764.57
    assert p14.kredyty_zagrozone == 539_225_717.51
    assert p14.rezerwy_utworzone == 54_172_608.28
    assert p13.kredyty_zagrozone == 110_626_541.71
    # „netto” nie weszło pod kredyty_brutto (bilansowe), a % nigdzie.
    assert p14.kredyty_brutto is None


def test_zagrozone_wieksze_od_nominalnych_odrzucone():
    tabele = [{
        "plik": "x.pdf", "strona": 22,
        "kolumny": ["31.12.2014"],
        "wiersze": [
            {"etykieta": "Należności od sektora niefinansowego brutto",
             "wartosci": ["1 000 000,00"]},
            {"etykieta": "Należności zagrożone:", "wartosci": ["2 000 000,00"]},
        ],
    }]
    poz, _, zastrz, _ = pozycje_z_tabel(tabele)
    assert any("przewyższa należności ogółem" in z for z in zastrz)
    assert poz[0].kredyty_zagrozone is None
    assert poz[0].naleznosci_nominalne == 1_000_000.00


def test_kolumna_z_przyszlosci_odrzucona():
    # OCR przekręcał daty („31.12.2018” → „31.12.2028”) — dzień bilansowy nie może
    # być w przyszłości, tak samo jak w odczycie tekstowym.
    tabele = [
        {"plik": "x.pdf", "strona": 1, "kolumny": ["31.12.2914"],
         "wiersze": [{"etykieta": "Aktywa razem", "wartosci": ["1 000,00"]}]},
    ]
    poz, _, zastrz, _ = pozycje_z_tabel(tabele)
    assert poz == []
    assert any("pominięto" in z for z in zastrz)
