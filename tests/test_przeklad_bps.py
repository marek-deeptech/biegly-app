"""Przekład nazw wskaźników BPS na kody rubryki — pułapki znalezione na realnych aktach.

⚠️ POWÓD ISTNIENIA: rubryka 16 wskaźników miała policzone 4, bo silnik odtwarzał je
z pozycji sprawozdawczych nieobecnych w aktach. Wartości leżały tam od początku —
Bank BPS policzył je własną metodyką i wpisał do kwartalnych ocen. Przekład podnosi
wypełnienie do 15/16, ale KAŻDE błędne dopasowanie wstawia do opinii sądowej liczbę
pod niewłaściwym wskaźnikiem, gdzie jest nie do wychwycenia bez sięgnięcia do akt.

Dopasowanie po zbieżności słów dawało 14/16 i myliło pozycje. Testy poniżej pilnują
konkretnych pomyłek, które wtedy wyszły — wszystkie na danych z akt SK Banku.
"""
import importlib.util
import os

import pytest

_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _mod(nazwa, sciezka):
    s = importlib.util.spec_from_file_location(nazwa, os.path.join(_HERE, sciezka))
    m = importlib.util.module_from_spec(s)
    s.loader.exec_module(m)
    return m


pb = _mod("przeklad_bps", "engine/przeklad_bps.py")


def test_kazdy_kod_przekladu_istnieje_w_rubryce():
    """Kod spoza rubryki znaczy, że wartość nie trafi nigdzie — cicho przepadnie."""
    import sys
    sys.path.insert(0, _HERE)
    from engine.analiza_ekonomiczna import WSKAZNIKI_EF

    kody = {w.kod for w in WSKAZNIKI_EF}
    assert set(pb.PRZEKLAD) == kody, "tablica przekładu rozjechała się z rubryką"


def test_warianty_nazw_tego_samego_wskaznika_trafiaja_w_ten_sam_kod():
    # BPS pisze inaczej w każdym kwartale: „relacja obliga kredytowego do depozytów"
    # i „…do stanu depozytów" to jeden wskaźnik rubryki.
    assert pb.kod_rubryki("Relacja obliga kredytowego do depozytów") == "kredyty_do_depozytow"
    assert pb.kod_rubryki("relacja obliga kredytowego do stanu depozytów") == "kredyty_do_depozytow"
    assert pb.kod_rubryki("ROE netto") == pb.kod_rubryki("ROE") == "roe"


def test_wskaznik_grupy_NIE_wchodzi_pod_wskaznik_banku():
    """Rubryka ocenia TEN bank, nie grupę.

    BPS podaje obok siebie 48,87% (bank) i 58,08% (grupa) na 31.03.2014. Wciągnięcie
    wartości grupowej podstawiłoby cudzą wielkość pod ocenę banku — i nikt by tego
    w tabeli nie odróżnił.
    """
    assert pb.kod_rubryki("Koszty działania / wynik działalności bankowej") == "koszty_do_wyniku"
    for grupowy in [
        "Koszty działania / wynik działalności bankowej - grupa",
        "koszty działania / wynik - średnia w grupie",
        "koszty działania do wyniku - średni w grupie",
        "koszty działania do wyniku w grupie",
    ]:
        assert pb.kod_rubryki(grupowy) is None, f"wartość grupowa weszła do rubryki: {grupowy}"


def test_kwota_NIE_wchodzi_pod_wskaznik_procentowy():
    """„Saldo odpisów aktualizujących" to kwota w tys. zł, nie relacja.

    Wpisana pod „wynik z rezerw / wynik działalności bankowej" dałaby w opinii
    wskaźnik rzędu 12 000% zamiast 12% — liczbę absurdalną, ale wyglądającą jak dana.
    """
    assert pb.kod_rubryki("Saldo odpisów aktualizujących") is None
    assert pb.kod_rubryki("saldo odpisów aktualizujących z tytułu utraty wartości aktywów finansowych") is None
    # Postać relacyjna — ta wchodzi.
    assert pb.kod_rubryki("Saldo odpisów / wynik działalności bankowej") == "rezerwy_do_wyniku"
    assert pb.kod_rubryki("Udział salda odpisów w wyniku działalności bankowej") == "rezerwy_do_wyniku"


def test_udzial_w_funduszach_NIE_jest_odpisem_rocznym():
    """Dwie różne pozycje o podobnej nazwie, obie w tej samej ocenie BPS.

    „Zobowiązanie podporządkowane w funduszach własnych" = 17,67% (udział w funduszach).
    „Roczny odpis zobowiązania podporządkowanego / wynik netto" = 66,64% (wskaźnik rubryki).
    """
    assert pb.kod_rubryki("Zobowiązanie podporządkowane w funduszach własnych") is None
    assert (
        pb.kod_rubryki("Roczny odpis zobowiązań podporządkowanych do zannualizowanego wyniku finansowego netto")
        == "odpis_podporzadkowane"
    )


def test_dwa_mianowniki_naleznosci_zagrozonych_sa_rozdzielone():
    """Rubryka ma DWA wiersze o różnych wagach: do należności i do aktywów."""
    assert pb.kod_rubryki("Zagrożone ekspozycje kredytowe w obligu kredytowym") == "naleznosci_zagrozone"
    assert pb.kod_rubryki("Zagrożone ekspozycje kredytowe w aktywach ogółem") == "zagrozone_do_aktywow"


def test_pokrycie_rezerwami_zostaje_puste():
    """BPS nie podaje relacji rezerwy utworzone/wymagane — i nie wolno jej podstawić.

    To ma pozostać brakiem widocznym w rejestrze rubryki, a nie zostać wypełnione
    najbliższą liczbą o podobnej nazwie.
    """
    assert pb.PRZEKLAD["pokrycie_rezerwami"] == ()


@pytest.mark.parametrize(
    "zapis,oczekiwane",
    [
        ("12,85%", 12.85), ("3,79", 3.79), ("1,38", 1.38), ("197,42%", 197.42),
        ("3 529 130 tys. zł", 3529130.0), ("453tys", 453.0), (10.5, 10.5), (None, None),
    ],
)
def test_odczyt_liczby_z_zapisu_bps(zapis, oczekiwane):
    assert pb.liczba(zapis) == oczekiwane


def test_niejednoznaczny_zapis_daje_None_a_nie_zgadywanie():
    # Wartość zgadnięta trafiłaby do tabeli w opinii jako liczba pewna.
    assert pb.liczba("b.d.") is None
    assert pb.liczba("") is None
    assert pb.liczba("1.2.3") is None


def test_pozycja_bez_przekladu_jest_pomijana_a_nie_zgadywana():
    oceny = [{
        "dzien": "2014-06-30",
        "wskazniki": [
            {"nazwa": "Marża odsetkowa", "wartosc": "3,11", "jednostka": "%"},
            {"nazwa": "Luka płynności krótkoterminowej", "wartosc": "691 800", "jednostka": "tys. zł"},
        ],
    }]
    w = pb.wartosci_wykazane(oceny)
    assert w == {"marza_odsetkowa": {"2014-06-30": 3.11}}, "pozycja spoza rubryki weszła do wyniku"
