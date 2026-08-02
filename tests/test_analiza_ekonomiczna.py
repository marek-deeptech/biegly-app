"""Rubryka analizy ekonomiczno-finansowej — odczyt ze skanu uchwały BPS."""
import pytest

from engine.analiza_ekonomiczna import (
    OBSZARY,
    WSKAZNIKI_EF,
    brakujace_pozycje,
    ocena_czastkowa,
    ocena_globalna,
    przedzial_dla,
    punktacja,
    wartosc,
    wskaznik_czastkowy,
    wskaznik_syntetyczny,
)
from engine.bank import Pozycje


def test_szesnascie_wskaznikow_w_czterech_obszarach():
    # OCR dał 15 — zgubił „fundusz udziałowy/fundusze podstawowe". Odczyt z obrazu
    # pokazał 16. Liczba jest kontrolą tego, czy rubryka jest kompletna.
    assert len(WSKAZNIKI_EF) == 16
    assert len(OBSZARY) == 4
    for o in OBSZARY:
        assert len([w for w in WSKAZNIKI_EF if w.obszar == o]) == 4


@pytest.mark.parametrize("obszar", list(OBSZARY))
def test_wagi_w_obszarze_sumuja_sie_do_jednosci(obszar):
    """Kontrola poprawności ODCZYTU, nie tylko danych.

    Wagi w każdym obszarze muszą dawać 1,00. Gdy pierwszy odczyt (z OCR) dał
    w obszarze adekwatności 0,90, to właśnie ta suma pokazała, że brakuje wiersza.
    """
    assert round(sum(w.waga for w in WSKAZNIKI_EF if w.obszar == obszar), 4) == 1.0


def test_drugi_wskaznik_jakosci_liczy_sie_do_aktywow_nie_do_naleznosci():
    # OCR przekręcił go na „aktywa zagrożone/aktywa ogółem". Dokument mówi
    # „należności zagrożone/aktywa ogółem" — inny licznik, inny wskaźnik.
    w = next(x for x in WSKAZNIKI_EF if x.kod == "zagrozone_do_aktywow")
    assert (w.licznik, w.mianownik) == ("kredyty_zagrozone", "aktywa_ogolem")


def test_wartosc_liczy_sie_z_pozycji_sprawozdawczych():
    p = Pozycje(dzien="2014-12-31", kredyty_zagrozone=560_663_000, kredyty_brutto=2_500_215_000)
    w = next(x for x in WSKAZNIKI_EF if x.kod == "naleznosci_zagrozone")
    assert wartosc(w, p) == 22.42


def test_brak_pozycji_daje_None_i_NAZWANY_brak():
    """Brak danych ma być brakiem danych, a nie zerem ani „wskaźnikiem nieobsługiwanym"."""
    p = Pozycje(dzien="2014-12-31", aktywa_ogolem=3_828_641_000)
    w = next(x for x in WSKAZNIKI_EF if x.kod == "aktywa_pracujace")
    assert wartosc(w, p) is None
    assert brakujace_pozycje(w, p) == ["aktywa_pracujace"]


def test_wspolczynnik_wyplacalnosci_wymaga_RWA():
    # W aktach SK Banku aktywa ważone ryzykiem nie występują ani razu — dostępna
    # jest tylko wartość WYKAZANA przez bank, o innym statusie dowodowym.
    p = Pozycje(dzien="2014-12-31", fundusze_wlasne=389_566_000)
    w = next(x for x in WSKAZNIKI_EF if x.kod == "wsp_wyplacalnosci")
    assert wartosc(w, p) is None
    assert brakujace_pozycje(w, p) == ["aktywa_wazone_ryzykiem"]


def test_przedzialy_z_przykladu_uchwaly():
    # Uchwała podaje jeden przykład: 7,42% → trzeci przedział.
    assert przedzial_dla("naleznosci_zagrozone", 7.42) == 3
    assert przedzial_dla("naleznosci_zagrozone", 1.20) == 1
    assert przedzial_dla("naleznosci_zagrozone", 46.20) == 5


def test_skala_jest_odwrocona_gorszy_wskaznik_to_wyzsza_liczba():
    assert przedzial_dla("naleznosci_zagrozone", 0.9) < przedzial_dla("naleznosci_zagrozone", 30.0)


def test_przedzialow_pozostalych_wskaznikow_dokument_nie_podaje():
    """Nie udajemy punktacji tam, gdzie nie znamy przedziałów."""
    assert przedzial_dla("roa", 0.2) is None
    w = next(x for x in WSKAZNIKI_EF if x.kod == "roa")
    assert punktacja(w, 0.2) is None


def test_punktacja_to_iloczyn_przedzialu_i_wagi():
    w = next(x for x in WSKAZNIKI_EF if x.kod == "naleznosci_zagrozone")
    assert punktacja(w, 7.42) == round(3 * 0.30, 4)


def test_obszar_bez_kompletu_wskaznikow_nie_dostaje_oceny():
    # Suma po części składników udawałaby ocenę obszaru, a jest oceną jego fragmentu.
    assert wskaznik_czastkowy("jakosc_aktywow", {"naleznosci_zagrozone": 0.9}) is None
    pelne = {w.kod: 1.0 for w in WSKAZNIKI_EF if w.obszar == "jakosc_aktywow"}
    assert wskaznik_czastkowy("jakosc_aktywow", pelne) == 4.0


def test_ocena_globalna_ma_odwrocona_skale():
    """1 = bardzo dobra, 5 = zagrożenie funkcjonowania banku."""
    dobre = {o: 1.0 for o in OBSZARY}
    zle = {o: 5.0 for o in OBSZARY}
    assert ocena_globalna(wskaznik_syntetyczny(dobre)) == 1
    assert ocena_globalna(wskaznik_syntetyczny(zle)) == 5


def test_ocena_czastkowa_zaokragla_do_najblizszej_calkowitej():
    assert ocena_czastkowa(2.4) == 2
    assert ocena_czastkowa(2.6) == 3
    assert ocena_czastkowa(None) is None


def test_brak_jednego_obszaru_wyklucza_ocene_globalna():
    assert wskaznik_syntetyczny({"adekwatnosc": 1.0}) is None
    assert ocena_globalna(None) is None
