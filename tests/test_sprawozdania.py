"""Odczyt pozycji ze sprawozdania — testy na fragmencie realnego dokumentu.

Fragment poniżej to dosłowny wynik ekstrakcji strony 20 sprawozdania Glitnir Bank Hf
za I półrocze 2008 (załącznik nr 5 do opinii PO III Ds 84.2020), wraz z całym jego
bałaganem: wiersze składnikowe pozbawione etykiet przez kropkowane wypełnienie,
przeplecione kolumny procentowe, etykiety zawierające cyfrę.

Tekst jest WBUDOWANY, nie czytany z dysku — golden testy silnika już raz padły,
gdy katalog źródłowy uporządkowano.
"""
import pytest

from engine.bank import Pozycje, wskazniki
from engine.sprawozdania import (
    _daty_kolumn,
    _liczba,
    _liczby,
    czytaj_tekst,
    sprawdz_bilans,
    sprawdz_spojnosc,
    uzupelnij_z_tozsamosci,
    zbuduj_pozycje,
    zestawienie,
)

STRONA_20 = """Notes to the Condensed Consolidated Interim Financial Statements
27.
Amount % of total Amount % of total
12,544 2% 15,531 2%
Deposits from customers total 709,584 100% 725,349 100%
Capital adequacy ratio
30.
30.06.2008 31.12.2007
199,708 169,201
727 768
Total shareholders' equity 200,435 169,969
61,564)(         45,574) (
Core capital 138,871 124,395
62,824 39,564
Tier 1 capital 201,695 163,959
81,529 61,617
Capital base 283,224 225,576
Risk-weighted assets
2,492,002 1,929,818
45,070 87,652
Total risk weighted assets 2,537,072 2,017,470
5.5% 6.2%
8% 8.1%
11.2% 11.2%
Intangible assets ..............................................................
"""


@pytest.mark.parametrize(
    "tekst,oczekiwana",
    [
        ("1,211,752", 1_211_752),   # zapis angielski
        ("2 537 072", 2_537_072),   # zapis polski
        ("(61,564)", -61_564),      # ujemna w nawiasach
        ("12.5", 12.5),             # ułamek
        ("2%", None),               # procent to nie pozycja bilansu
        ("30.", 30),                # odsyłacz — parsuje się, odsiew jest wyżej
    ],
)
def test_liczba(tekst, oczekiwana):
    assert _liczba(tekst) == oczekiwana


def test_liczby_rozstrzyga_styl_separatorow():
    """Spacja nie może znaczyć naraz „separator tysięcy" i „koniec kolumny"."""
    # przecinek na tysiące → spacja rozdziela kolumny
    assert _liczby("200,435 169,969") == [200_435, 169_969]
    # brak przecinków → spacja jest wewnątrz liczby
    assert _liczby("2 537 072 2 017 470") == [2_537_072, 2_017_470]


def test_daty_kolumn_bierze_wiersz_z_dwiema_datami():
    """Zbieranie wszystkich dat ze strony wciągało odwołania do okresu jako kolumny."""
    assert _daty_kolumn(STRONA_20) == ["2008-06-30", "2007-12-31"]
    assert _daty_kolumn("umowa z 1.1.2007 r.\nnic więcej") == []


def test_czyta_wiersze_sumaryczne_z_etykieta_zawierajaca_cyfre():
    """„Tier 1 capital" gubiło się, gdy etykietę cięto na pierwszej liczbie w wierszu."""
    o = czytaj_tekst(STRONA_20, strona=20)
    wg_pola = {k.pole: k for k in o.kandydaci}
    assert wg_pola["kapital_cet1"].wartosci[:2] == [138_871, 124_395]
    assert wg_pola["_tier1"].wartosci[:2] == [201_695, 163_959]
    assert wg_pola["fundusze_wlasne"].wartosci[:2] == [283_224, 225_576]
    assert wg_pola["aktywa_wazone_ryzykiem"].wartosci[:2] == [2_537_072, 2_017_470]
    # numer strony musi być stroną, nie indeksem tokenu — inaczej opinia cytuje źle
    assert all(k.strona == 20 for k in o.kandydaci)


def test_kolumny_procentowe_nie_wywalaja_wiersza():
    """„709,584 100% 725,349 100%" — odrzucamy procenty, nie cały wiersz."""
    o = czytaj_tekst(STRONA_20, strona=20)
    dep = next(k for k in o.kandydaci if k.pole == "depozyty_klientow")
    assert dep.wartosci[:2] == [709_584, 725_349]


def test_pelny_lancuch_odtwarza_wskazniki_z_opinii():
    """Odczyt → pozycje → wskaźniki musi dać liczby, które trafiły do sądu."""
    o = czytaj_tekst(STRONA_20, strona=20)
    poz = zbuduj_pozycje(o)
    uzupelnij_z_tozsamosci(o, poz)

    assert [p.dzien for p in poz] == ["2008-06-30", "2007-12-31"]
    # składniki odtworzone z tożsamości = wartości podane w sprawozdaniu
    assert poz[0].kapital_at1 == 62_824
    assert poz[0].kapital_tier2 == 81_529

    for p, (cet1, tier1, tcr) in zip(poz, [(5.5, 8.0, 11.2), (6.2, 8.1, 11.2)]):
        w = {x.kod: x.wartosc for x in wskazniki(p)}
        assert w["cet1"] == pytest.approx(cet1, abs=0.05)
        assert w["tier1"] == pytest.approx(tier1, abs=0.05)
        assert w["tcr"] == pytest.approx(tcr, abs=0.05)


def test_spojnosc_wykrywa_rozjazd_skladnikow():
    """Kontrola istnieje, bo w tabeli opinii jeden składnik RWA przepisano błędnie."""
    o = czytaj_tekst(STRONA_20, strona=20)
    poz = zbuduj_pozycje(o)
    uzupelnij_z_tozsamosci(o, poz)
    assert sprawdz_spojnosc(o, poz) == []

    poz[0].kapital_tier2 = 1.0  # symulacja błędu przepisania
    uwagi = sprawdz_spojnosc(o, poz)
    assert len(uwagi) == 1 and "fundusze własne" in uwagi[0]


# ── Zestawienie kwot do rozdziału o sprawozdaniach ───────────────────────────

def _trzy_okresy():
    """Odczyt z akt MBR — kolumna 2007 jest w nim faktycznie rozjechana."""
    return [
        Pozycje(dzien="2006-12-31", aktywa_ogolem=2246340, zobowiazania_ogolem=2100221,
                kapital_wlasny=144578, kredyty_brutto=1974907, zysk_netto=8636),
        Pozycje(dzien="2007-12-31", aktywa_ogolem=1043029, zobowiazania_ogolem=586381,
                kapital_wlasny=169969, depozyty_klientow=725349, kredyty_brutto=1974907, zysk_netto=16052),
        Pozycje(dzien="2008-06-30", aktywa_ogolem=3862797, zobowiazania_ogolem=3662362,
                kapital_wlasny=200435, depozyty_klientow=709584, zysk_netto=16052),
    ]


def test_zestawienie_pomija_pozycje_nieodczytane_zamiast_zerowac():
    # Pozycja nieobecna we WSZYSTKICH okresach nie ma się pojawić jako wiersz zer —
    # pusty wiersz w opinii sugerowałby, że bank nie miał kapitału Tier 2.
    z = zestawienie([Pozycje(dzien="2008-06-30", aktywa_ogolem=100000)])
    etykiety = [r[0] for r in z["rows"]]
    assert "Aktywa ogółem" in etykiety
    assert not any("Tier 2" in e for e in etykiety)


def test_zestawienie_nie_liczy_zmiany_z_jednego_okresu():
    z = zestawienie([Pozycje(dzien="2008-06-30", aktywa_ogolem=100000)])
    wiersz = next(r for r in z["rows"] if r[0] == "Aktywa ogółem")
    assert wiersz[-2] == "—"


def test_zestawienie_pokazuje_brak_jako_myslnik_a_nie_zero():
    z = zestawienie(_trzy_okresy())
    dep = next(r for r in z["rows"] if r[0] == "Depozyty klientów")
    assert dep[1] == "—"  # 2006 — pozycji nie odczytano
    # Separator tysięcy jest spacją NIEŁAMLIWĄ: liczba w opinii nie ma prawa
    # rozpaść się na dwa wiersze.
    assert dep[2] == "725\u00a0349"


def test_zestawienie_podaje_stron_zrodlowa():
    # Bez wskazania strony biegły nie zweryfikuje liczby w oryginale.
    z = zestawienie(_trzy_okresy(), {"aktywa_ogolem": "SF-2008.pdf, str. 11"})
    assert next(r for r in z["rows"] if r[0] == "Aktywa ogółem")[-1] == "SF-2008.pdf, str. 11"


def test_bilans_wykrywa_rozjechana_kolumne():
    # Regresja z akt MBR: aktywa 2007 odczytane ze złego zakresu, bilans nie domyka
    # się o 27,5%. Bez tej kontroli do opinii trafiłby spadek sumy bilansowej o połowę.
    uwagi = sprawdz_bilans(_trzy_okresy())
    assert any("2007-12-31" in u and "bilans nie domyka" in u for u in uwagi)
    assert not any("2008-06-30" in u and "bilans nie domyka" in u for u in uwagi)


def test_bilans_wykrywa_skladnik_wiekszy_od_calosci():
    uwagi = sprawdz_bilans(_trzy_okresy())
    assert any("depozyty klientów" in u and "przewyższają" in u for u in uwagi)


def test_bilans_wykrywa_powielona_kolumne():
    uwagi = sprawdz_bilans(_trzy_okresy())
    assert any("Kredyty" in u and "identyczną wartość" in u for u in uwagi)
    assert any("Zysk netto" in u and "identyczną wartość" in u for u in uwagi)


def test_bilans_milczy_gdy_odczyt_jest_spojny():
    uwagi = sprawdz_bilans([
        Pozycje(dzien="2007-12-31", aktywa_ogolem=1000, zobowiazania_ogolem=900, kapital_wlasny=100),
        Pozycje(dzien="2008-06-30", aktywa_ogolem=1200, zobowiazania_ogolem=1050, kapital_wlasny=150),
    ])
    assert uwagi == []


def test_uwaga_zachowuje_przecinki_w_zdaniu():
    # Formatowanie kwot podmieniało przecinki w CAŁYM zdaniu, więc uwaga brzmiała
    # „to niemożliwe  depozyty są ich składnikiem".
    uwagi = sprawdz_bilans([
        Pozycje(dzien="2008-06-30", zobowiazania_ogolem=1000, depozyty_klientow=2000),
    ])
    assert any("niemożliwe, depozyty" in u for u in uwagi)
    assert any("2\u00a0000" in u for u in uwagi)  # ten sam separator co w tabeli
