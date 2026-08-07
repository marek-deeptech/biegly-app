"""Szeregi tła toru bankowego — zgodność trasy pozyskiwania z silnikiem makro/sygnałów.

Trasa pozyskiwania (lib/opinion/szeregi-bank-run.ts) NAZYWA pliki, a silnik
(engine/uslugi/makro.py, sygnaly.py) rozpoznaje po nazwach sloty, etykiety
i przynależność modułową. Rozjazd nazw = szereg pozyskany, ale niewidoczny
w brakach/slotach — czyli dokładnie ta cicha klasa błędu, którą łapał już
most TS↔PY katalogu wskaźników. Nazwy plików trasy są tu WBUDOWANE.
"""
import pathlib

from engine.szeregi import czytaj_csv
from engine.uslugi.makro import OCZEKIWANE, _etykieta
from engine.uslugi.sygnaly import _istotny

# Lustro SERIE_BANKOWE z lib/opinion/szeregi-bank-run.ts (nazwy plików).
PLIKI_TRASY = [
    "inflacja_cpi_pl.csv",
    "stopy_procentowe_pl.csv",
    "indeks_wig_banki.csv",
    "surowce_ropa_wti.csv",
    "surowce_zloto_nbp.csv",
]


def test_nazwy_trasy_sa_wbudowane_zgodnie_z_konfiguracja_ts():
    ts = (pathlib.Path(__file__).resolve().parent.parent / "lib/opinion/szeregi-bank-run.ts").read_text(
        encoding="utf8"
    )
    for p in PLIKI_TRASY:
        assert f"pozyskane/szeregi/{p}" in ts, f"trasa nie tworzy pliku {p} — zaktualizuj lustro testu"


def test_kazdy_plik_trasy_trafia_w_slot_oczekiwanych_szeregow():
    """Slot braków gaśnie po pozyskaniu — inaczej moduł mówiłby „brak inflacji"
    przy szeregu inflacji leżącym w aktach."""
    for plik in PLIKI_TRASY:
        etykieta = _etykieta(plik).lower()
        trafione = [slot for slot, frazy, _ in OCZEKIWANE if any(f in etykieta for f in frazy)]
        assert trafione, f"{plik}: etykieta „{etykieta}” nie trafia w żaden slot OCZEKIWANE"


def test_etykiety_sa_polskie_a_nie_techniczne():
    # Etykieta idzie do tytułu tabeli i wykresu w opinii sądowej.
    assert _etykieta("inflacja_cpi_pl.csv") == "Inflacja CPI r/r (Polska)"
    assert _etykieta("stopy_procentowe_pl.csv") == "Stopa referencyjna NBP (Polska)"
    assert _etykieta("surowce_zloto_nbp.csv") == "Cena złota (NBP, PLN za 1 g)"
    assert _etykieta("surowce_ropa_wti.csv") == "Cena ropy naftowej WTI"
    # Fraza węższa przed szerszą: WIG-banki nie może wpaść w ogólny „Indeks WIG".
    assert _etykieta("indeks_wig_banki.csv") == "Indeks WIG-banki (GPW)"
    assert _etykieta("^wig_d.csv") == "Indeks WIG"


def test_szereg_obligacji_nalezy_do_sygnalow_a_nie_do_tla_makro():
    """Ten sam plik nie może wejść do dwóch rozdziałów opinii jako dwie tabele."""
    # Sygnały GO biorą…
    assert _istotny("pozyskane/szeregi/obligacje_bsw0424.csv", "DANE_RYNKOWE_SZEREG")
    assert _istotny("CDS default.xlsx", "DANE_RYNKOWE_SZEREG")
    # …ale rozporządzenie O ratingach to podstawa prawna, nie dane.
    assert not _istotny("rozporządzenie - rating.pdf", "AKT_PRAWNY")
    # Tło makro nie jest sygnałem:
    assert not _istotny("pozyskane/szeregi/inflacja_cpi_pl.csv", "DANE_RYNKOWE_SZEREG")
    assert not _istotny("pozyskane/szeregi/surowce_zloto_nbp.csv", "DANE_RYNKOWE_SZEREG")


def test_surowce_maja_slot_brakow():
    sloty = [s for s, _, _ in OCZEKIWANE]
    assert "surowce" in sloty
    # …a kursy walutowe ZOSTAJĄ w slotach (pominięte w pozyskiwaniu decyzją klienta,
    # ale brak kursu w aktach nadal jest ustaleniem, nie przemilczeniem).
    assert "kurs" in sloty


def test_czytaj_csv_przyjmuje_format_nbp_i_stooq():
    nbp = b"Data,Cena zlota (PLN za 1 g)\n2014-01-02,116.35\n2014-01-03,119.41\n2014-01-07,121.12\n"
    s = czytaj_csv(nbp, "surowce_zloto_nbp.csv")
    assert s and len(s.punkty) == 3 and s.punkty[0].wartosc == 116.35
    stooq = (
        b"Data,Otwarcie,Najwyzszy,Najnizszy,Zamkniecie\n"
        b"2014-01-02,49.0,50.0,48.5,49.5\n2014-01-03,49.5,50.5,49.0,50.1\n2014-01-07,50.1,51.0,49.8,50.9\n"
    )
    s2 = czytaj_csv(stooq, "surowce_ropa_wti.csv")
    assert s2 and len(s2.punkty) == 3 and s2.punkty[-1].wartosc == 50.9
