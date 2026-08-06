"""Ścieżka „skan strony → pozycje → 17 wartości własnych rubryki" (SK Bank).

DLACZEGO TEN TEST ISTNIEJE
Rubryka SK Banku ma 17 wartości WŁASNYCH policzonych z pozycji odczytanych z OBRAZU
stron sprawozdania. Silnik tej ścieżki był w repozytorium, ale SPIS PLIKÓW I STRON
— nie: artefakt `pozyskane/tabele_sprawozdan.json` dało się odtworzyć wyłącznie
z pamięci sesji, która go wytworzyła. Ten test zamyka krok: pilnuje spisu
(scripts/bilans_z_obrazu.py) i pilnuje LICZB, na których stoi opinia.

Tabele są WBUDOWANE — golden testy silnika już raz padły, gdy katalog źródłowy
uporządkowano (patrz tests/conftest.py). Pełny artefakt akt sprawdza osobny test,
pomijany, gdy kopii lokalnej nie ma.
"""
import json
import pathlib
import sys

import pytest

from engine.analiza_ekonomiczna import WSKAZNIKI_EF, wartosc
from engine.sprawozdania import pozycje_z_tabel

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "scripts"))

import bilans_z_obrazu as bzo  # noqa: E402

# ── Wartości własne rubryki: 17 liczb z opinii SKOK ──────────────────────────
# Zgodne z `subanalyses.data.table` sprawy ce80420d (kolumny bez gwiazdki, czyli
# policzone przez silnik, a nie wykazane przez Bank BPS).
WLASNE = {
    "2013-12-31": {
        "roe": 5.87, "naleznosci_zagrozone": 6.73, "zagrozone_do_aktywow": 3.56,
        "roa": 0.40, "marza_odsetkowa": 1.98, "koszty_do_wyniku": 60.70,
        "rezerwy_do_wyniku": 15.42, "kredyty_do_depozytow": 62.75,
    },
    "2014-12-31": {
        "roe": 2.38, "fundusz_udzialowy": 3.66, "naleznosci_zagrozone": 21.84,
        "zagrozone_do_aktywow": 14.08, "roa": 0.20, "marza_odsetkowa": 2.72,
        "koszty_do_wyniku": 47.24, "rezerwy_do_wyniku": 26.46,
        "kredyty_do_depozytow": 76.83,
    },
}

# Pliki i strony odczytu — utrwalone w `data.zrodla` subanalizy `analiza_ekonomiczna`.
ZRODLA_W_BAZIE = {
    "ebi14_14.ocr.pdf": [1, 2, 3, 4, 5, 7, 8],
    "ebi14_08.ocr.pdf": [1, 2, 22],
}


def _tabele_sk():
    """Tabele wzorcowe: po jednej pozycji na każdy licznik i mianownik z WLASNE."""
    return [
        {  # bilans, aktywa
            "plik": "ebi14_14.ocr.pdf", "strona": 1, "jednostka": "w złotych",
            "kolumny": ["31.12.2013 r.", "31.12.2014 r."],
            "wiersze": [
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
        {  # pasywa, kontynuacja — bez nagłówków kolumn, dziedziczy ze str. 2
            "plik": "ebi14_14.ocr.pdf", "strona": 3, "kolumny": ["", ""],
            "wiersze": [
                {"etykieta": "Zysk (strata) netto", "wartosci": ["12 392 161,20", "7 690 268,83"]},
                {"etykieta": "Pasywa razem",
                 "wartosci": ["3 105 176 764,07", "3 828 641 287,62"]},
                {"etykieta": "Współczynnik wypłacalności", "wartosci": ["13,16%", "13,84%"]},
            ],
        },
        {  # RZiS — kolumny roczne przypisywane do dnia bilansowego
            "plik": "ebi14_14.ocr.pdf", "strona": 4, "jednostka": "w złotych",
            "kolumny": ["2013 r.", "2014 r."],
            "wiersze": [
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
        {  # zestawienie zmian w kapitale własnym
            "plik": "ebi14_14.ocr.pdf", "strona": 7, "jednostka": "w złotych",
            "kolumny": ["2013 r.", "2014 r."],
            "wiersze": [
                {"etykieta": "Kapitał własny na początek okresu (BO)",
                 "wartosci": ["132 002 707,11", "210 994 184,46"]},
            ],
        },
        {  # kontynuacja zestawienia — dziedziczy kolumny ze str. 7
            "plik": "ebi14_14.ocr.pdf", "strona": 8, "kolumny": [],
            "wiersze": [
                {"etykieta": "Kapitał własny na koniec okresu (BZ)",
                 "wartosci": ["210 994 184,46", "323 564 755,20"]},
            ],
        },
        {  # fundusze wg art. 127 Prawa bankowego
            "plik": "ebi14_08.ocr.pdf", "strona": 1, "metodyka": "pb",
            "kolumny": ["31.12.2014"],
            "wiersze": [
                {"etykieta": "Fundusze podstawowe", "wartosci": ["320.807.001,27"]},
                {"etykieta": "Udziałowy", "wartosci": ["11.752.840,00"]},
                {"etykieta": "Fundusze własne", "wartosci": ["396.347.390,10"]},
            ],
        },
        {  # nota klasyfikacyjna — mianownik NOMINALNY wskaźników jakości
            "plik": "ebi14_08.ocr.pdf", "strona": 22, "jednostka": "zł",
            "kolumny": ["Wartość na 31.12.2013r. zł", "Wartość na 31.12.2013r. %",
                        "Wartość na 31.12.2014r. zł", "Wartość na 31.12.2014r. %"],
            "wiersze": [
                {"etykieta": "Należności od sektora niefinansowego brutto",
                 "wartosci": ["1 644 687 085,45", "100,00%", "2 468 794 764,57", "100,00%"]},
                {"etykieta": "3. Należności zagrożone:",
                 "wartosci": ["110 626 541,71", "6,73%", "539 225 717,51", "21,84%"]},
                # Wiersze podrzędne liczą udział od SWOJEJ kategorii, nie od sumy portfela.
                {"etykieta": "- poniżej standardu",
                 "wartosci": ["43 456 231,08", "39,28%", "156 537 725,29", "29,03%"]},
            ],
        },
    ]


def _wskazniki(poz):
    out = {}
    for p in poz:
        for w in WSKAZNIKI_EF:
            v = wartosc(w, p)
            if v is not None:
                out.setdefault(p.dzien, {})[w.kod] = round(v, 2)
    return out


def test_siedemnascie_wartosci_wlasnych_z_tabel():
    """Odczyt tabel daje DOKŁADNIE te 17 wartości, które stoją w opinii SKOK."""
    uwagi = []
    poz, wykazane, zastrz, _ = pozycje_z_tabel(_tabele_sk(), uwagi=uwagi)

    assert [p.dzien for p in poz] == ["2013-12-31", "2014-12-31"]
    assert zastrz == []
    assert _wskazniki(poz) == WLASNE
    assert sum(len(v) for v in WLASNE.values()) == 17

    # Współczynnik wypłacalności idzie kanałem WYKAZANYM — silnik nie ma RWA.
    assert wykazane == [("2013-12-31", 13.16), ("2014-12-31", 13.84)]
    # Ścieżka opiera się na dziedziczeniu kolumn i kolumnach rocznych — obie odnotowane.
    assert any("kontynuacja tabeli ze str. 2" in u for u in uwagi)
    assert any("kontynuacja tabeli ze str. 7" in u for u in uwagi)
    assert any("kolumna roczna" in u for u in uwagi)


def test_spis_odczytu_zgodny_ze_zrodlami_w_bazie():
    """Rejestr ODCZYTY musi opisywać te pliki i strony, które zapisano w `data.zrodla`.

    ⚠️ TO JEST CAŁY SENS TEGO KROKU. Wartości w bazie mają źródło; gdyby spis
    w repozytorium rozjechał się z nim po cichu, „odtworzenie" czytałoby inne
    strony niż te, z których liczby faktycznie pochodzą.
    """
    spis = {o.plik: [s.nr for s in o.strony] for o in bzo.ODCZYTY["SKOK"]}
    assert spis == ZRODLA_W_BAZIE

    # Kolejność rosnąca jest wymogiem, nie estetyką: strony 3, 5 i 8 nie mają
    # nagłówków kolumn i dziedziczą je ze strony poprzedniej.
    for plik, strony in spis.items():
        assert strony == sorted(strony), f"{plik}: strony muszą być rosnąco"


def test_metodyka_funduszy_deklarowana_per_tabela():
    """Strona 1 raportu EBI 8/2014 mieści DWA rachunki funduszy — po jednym kluczu
    na tabelę. Zadeklarowanie innej liczby metodyk niż tabel musi przerwać przebieg,
    bo klucz trafiłby na niewłaściwy rachunek."""
    s = bzo.Strona(1, ["pb", "crr"])
    assert s.metodyki(2) == ["pb", "crr"]
    with pytest.raises(SystemExit, match="metodyki dla 2 tabel"):
        s.metodyki(1)

    # Jedna metodyka rozciąga się na wszystkie tabele strony; brak — na żadną.
    assert bzo.Strona(2, "crr").metodyki(1) == ["crr"]
    assert bzo.Strona(3).metodyki(2) == [None, None]


def test_kolizja_funduszy_podstawowych_jest_zglaszana():
    """⚠️ „Fundusze podstawowe" mają IDENTYCZNĄ etykietę w rachunku art. 127 pb
    (320 807 001,27) i wg CRR (313 665 638,25) — inaczej niż „Fundusze własne",
    które silnik rozstrzyga kluczem `metodyka`. Rozstrzyga je wyłącznie kolejność
    odczytu („pierwsza wygrywa") plus zastrzeżenie.

    Test PRZYPINA dzisiejszy wynik (3,66 % z rachunku pb, spójny z licznikiem
    „Udziałowy" 11 752 840, który też jest z pb) i pilnuje, żeby kolizja BYŁA
    zgłoszona. Gdyby kolejność tabel się odwróciła, wskaźnik wyszedłby 3,75 % —
    licznik z pb przez mianownik z CRR, czyli iloraz dwóch różnych metodyk.
    """
    pb = {"plik": "e.pdf", "strona": 1, "metodyka": "pb", "kolumny": ["31.12.2014"],
          "wiersze": [
              {"etykieta": "Fundusze podstawowe", "wartosci": ["320.807.001,27"]},
              {"etykieta": "Udziałowy", "wartosci": ["11.752.840,00"]}]}
    crr = {"plik": "e.pdf", "strona": 1, "metodyka": "crr", "kolumny": ["31.12.2014"],
           "wiersze": [
               {"etykieta": "Fundusze podstawowe", "wartosci": ["313.665.638,25"]},
               {"etykieta": "Udziałowy (amortyzowany)", "wartosci": ["4.638.816,45"]}]}

    poz, _, zastrz, _ = pozycje_z_tabel([pb, crr], uwagi=[])
    assert any("Fundusze podstawowe" in z and "odczytana dwukrotnie" in z for z in zastrz)
    assert poz[0].fundusze_podstawowe == 320_807_001.27
    # „Udziałowy (amortyzowany)" z rachunku CRR nie wchodzi (wzorzec z `$`).
    assert poz[0].fundusz_udzialowy == 11_752_840.00
    assert _wskazniki(poz)["2014-12-31"]["fundusz_udzialowy"] == 3.66


def test_kontrola_udzialow_potwierdza_liczby_naglowkowe():
    """Kontrola krzyżowa liczy udział z kolumny złotowej i zestawia z procentową
    podaną przez dokument — 6,73 % i 21,84 % potwierdzają się same."""
    uwagi = bzo.kontrola_udzialow(_tabele_sk())
    assert len(uwagi) == 2
    assert all("zgodność ✓" in u for u in uwagi)
    assert any("6.73 %, dokument podaje 6.73 %" in u for u in uwagi)
    assert any("21.84 %, dokument podaje 21.84 %" in u for u in uwagi)


def test_kontrola_udzialow_nie_krzyczy_na_wierszach_podrzednych():
    """REGRESJA: pierwsza wersja kontroli liczyła KAŻDY wiersz noty od sumy portfela
    i dawała 19 fałszywych alarmów — „- poniżej standardu 39,28 %" to udział
    w należnościach zagrożonych, nie w portfelu ogółem."""
    for u in bzo.kontrola_udzialow(_tabele_sk()):
        assert "poniżej standardu" not in u
        assert "ROZBIEŻNOŚĆ" not in u


def test_kontrola_udzialow_zglasza_rozbieznosc():
    tabele = [{
        "plik": "x.pdf", "strona": 22,
        "kolumny": ["Wartość na 31.12.2014r. zł", "Wartość na 31.12.2014r. %"],
        "wiersze": [
            {"etykieta": "Należności od sektora niefinansowego brutto",
             "wartosci": ["1 000 000,00", "100,00%"]},
            # 100 000 / 1 000 000 = 10 %, a dokument podaje 25 %.
            {"etykieta": "Należności zagrożone:", "wartosci": ["100 000,00", "25,00%"]},
        ],
    }]
    uwagi = bzo.kontrola_udzialow(tabele)
    assert len(uwagi) == 1
    assert "ROZBIEŻNOŚĆ" in uwagi[0]
    assert "10.00 %" in uwagi[0] and "25.00 %" in uwagi[0]


# ── Golden: pełny artefakt akt sprawy ────────────────────────────────────────
GOLDEN = pathlib.Path(__file__).resolve().parent.parent / ".fixtures" / "tabele_sprawozdan_SKOK.json"


def test_golden_artefakt_daje_te_same_17_wartosci():
    """Pełny odczyt akt (11 tabel, ~240 wierszy) → te same 17 wartości.

    Pomijany, gdy kopii lokalnej nie ma — brak pliku dowodowego to „nie ma czym
    testować", nie regresja kodu. Odtworzenie:
        python3 scripts/bilans_z_obrazu.py SKOK --fixture
    """
    if not GOLDEN.exists():
        pytest.skip(
            f"Brak golden: {GOLDEN}\n"
            "Odtwórz: python3 scripts/bilans_z_obrazu.py SKOK --fixture"
        )
    tabele = json.loads(GOLDEN.read_text(encoding="utf8"))
    poz, wykazane, zastrz, _ = pozycje_z_tabel(tabele, uwagi=[])

    assert _wskazniki(poz) == WLASNE
    assert wykazane == [("2013-12-31", 13.16), ("2014-12-31", 13.84)]
    # Jedyne dopuszczone zastrzeżenie to znana kolizja dwóch rachunków funduszy
    # podstawowych na stronie 1 (patrz test wyżej). Każde inne = regresja odczytu.
    assert all("Fundusze podstawowe" in z for z in zastrz), zastrz
    # Kontrola krzyżowa noty musi wyjść zgodnie na obu datach.
    krzyzowe = bzo.kontrola_udzialow(tabele)
    assert len(krzyzowe) == 2 and all("zgodność ✓" in u for u in krzyzowe)
