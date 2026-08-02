"""Chronologia nadzorcza — testy na realnych danych z akt SK Banku (II C 595/23).

Liczby pochodzą z Harmonogramu działań UKNF wobec Spółdzielczego Banku Rzemiosła
i Rolnictwa w Wołominie (załącznik nr 20 do odpowiedzi UKNF na pozew). Wiersz za
I kwartał 2013 jest w nich FAKTYCZNIE skażony — OCR przeplótł kolumny dwóch tabel
sąsiadujących na stronie — i to on jest tu przypadkiem testowym.
"""
import pytest

from engine.chronologia import (
    OkresNadzorczy,
    dynamika,
    przekroczenia,
    sprawdz_okresy,
    stan_wiedzy_na_dzien,
    udzial,
)

K = "wg stanu na koniec kwartału"


def _okresy():
    return [
        # ⚠ portfel_utrata przywędrował z okresu 2013-12-31 — iloraz nie zgadza się z 6,30%
        OkresNadzorczy("2013-03-31", K, 2429334, 1222476, 115338, 6.30, 2200285, 154148, 9.61, 2710),
        OkresNadzorczy("2013-12-31", K, 3105177, 1655286, 115338, 6.97, 2789863, 248473, 13.16, 12392),
        OkresNadzorczy("2014-09-30", K, None, 2265833, 421588, 18.61, None, 367109, 14.14, None),
        OkresNadzorczy("2014-12-31", K, 3828641, 2500215, 560663, 22.42, 3346830, 389566, 13.84, 7690),
        OkresNadzorczy("2015-09-30", K, None, 2891671, 1336012, 46.20, 2210952, 301011, 8.61, -115446),
    ]


def test_wykrywa_wiersz_zlozony_z_dwoch_tabel():
    # Jedyny sygnał, jaki w ogóle występuje: obie liczby z osobna wyglądają wiarygodnie,
    # a niezgodny jest dopiero ich iloraz z udziałem podanym w dokumencie.
    uwagi = sprawdz_okresy(_okresy())
    assert any("2013-03-31" in u and "nie zgadza się z ilorazem" in u for u in uwagi)
    assert not any("2014-12-31" in u for u in uwagi)


def test_pozostale_okresy_domykaja_sie():
    uwagi = [u for u in sprawdz_okresy(_okresy()) if "nie zgadza się" in u]
    assert len(uwagi) == 1


def test_brak_kontekstu_daty_jest_zglaszany():
    # Bez fragmentu narracji nie da się sprawdzić, czy okres przypisano właściwie —
    # a data w tym module pochodzi ze zdania, nie z nagłówka kolumny.
    o = OkresNadzorczy("2014-12-31", "", portfel_kredytowy=100, portfel_utrata=10, udzial_utrata_pct=10)
    assert any("brak fragmentu narracji" in u for u in sprawdz_okresy([o]))


def test_udzial_liczony_a_nie_przepisany():
    o = _okresy()[0]
    assert udzial(o) == 9.43  # a nie 6.30 podane w dokumencie


@pytest.mark.parametrize("dzien,oczekiwany,zwloka", [
    ("2015-03-16", "2014-12-31", 75),   # dzień ostatniej lokaty powoda
    ("2014-09-30", "2014-09-30", 0),
    ("2013-06-01", "2013-03-31", 62),
])
def test_stan_wiedzy_bierze_okres_NIE_POZNIEJSZY(dzien, oczekiwany, zwloka):
    # Sprawozdanie za III kwartał 2015 opisuje stan, o którym w marcu 2015 nikt wiedzieć
    # nie mógł. Wzięcie najbliższego okresu w obie strony byłoby wnioskowaniem wstecznym
    # wpisanym w arytmetykę.
    s = stan_wiedzy_na_dzien(_okresy(), dzien)
    assert s is not None
    assert s.okres.dzien == oczekiwany
    assert s.dni_zwloki == zwloka


def test_stan_wiedzy_wskazuje_nastepny_okres_ale_go_nie_uzywa():
    s = stan_wiedzy_na_dzien(_okresy(), "2015-03-16")
    assert s.nastepny.dzien == "2015-09-30"      # widoczny dla biegłego…
    assert s.okres.dzien == "2014-12-31"         # …ale ocena stoi na danych sprzed daty


def test_przed_pierwszym_okresem_nie_ma_stanu_wiedzy():
    assert stan_wiedzy_na_dzien(_okresy(), "2012-01-01") is None


def test_przekroczenie_progu_liczone_z_wartosci_policzonej():
    # Moment przekroczenia jest odpowiedzią na pytanie „kiedy", więc nie może zależeć
    # od liczby przepisanej z dokumentu.
    p = przekroczenia(_okresy(), 15.0)
    assert [d for d, _ in p] == ["2014-09-30", "2014-12-31", "2015-09-30"]


def test_dynamika_pomija_okresy_bez_wartosci():
    d = dict(dynamika(_okresy(), "portfel_utrata"))
    assert d["2014-09-30"] == pytest.approx(265.6, abs=0.1)
    assert "2013-03-31" not in d  # pierwszy okres nie ma z czym się porównać
