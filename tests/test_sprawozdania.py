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
    Kandydat,
    Odczyt,
    _daty_kolumn,
    _dopasuj,
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


# ── Reguły odczytu kolumn (regresja z akt MBR) ───────────────────────────────

@pytest.mark.parametrize("etykieta,oczekiwane", [
    # Fraza kończy etykietę — to ta pozycja.
    ("Net interest income", "wynik_odsetkowy"),
    ("Profit for the period ......", "zysk_netto"),
    ("Total Equity", "kapital_wlasny"),
    ("Loans to customers..........", "kredyty_brutto"),
    # Po frazie zostały LICZBY — etykieta wchłonęła dane wiersza, pozycja ta sama.
    ("Total assets 869,724 1,961,522 35,944", "aktywa_ogolem"),
    # Po frazie zostały SŁOWA — to INNA pozycja sprawozdania.
    ("Net profit from sale of subsidiaries and assets", None),
    ("Total equity and liabilities", None),
    ("Total equity attributable to the equity holders", None),
    ("Total assets on 30 June", None),
])
def test_fraza_musi_konczyc_etykiete(etykieta, oczekiwane):
    # Samo `startswith` brało „Net profit from sale of subsidiaries" jako zysk netto
    # i „Total equity and liabilities" jako kapitał własny. Obie mają sensowne liczby
    # w sensownej liczbie kolumn, więc przechodziły wszystkie kontrole i trafiały
    # do opinii jako pozycja, którą nie są.
    assert _dopasuj(etykieta) == oczekiwane


def _odczyt(*kandydaci, dni=("2008-06-30", "2007-12-31"), strona=1):
    o = Odczyt(dni=list(dni), strony=[strona], dni_stron={strona: list(dni)})
    o.kandydaci = list(kandydaci)
    return o


def test_wiersz_o_niezgodnej_liczbie_wartosci_nie_mapuje_sie_pozycyjnie():
    # Wiersz pięciowartościowy w sprawozdaniu dwukolumnowym pochodzi z innej tabeli.
    # W aktach MBR wstawiał do kolumny rocznej wartość kwartalną (1 043 029 zamiast
    # 2 948 910) i bilans nie domykał się o 27,5%.
    o = _odczyt(Kandydat("aktywa_ogolem", "Total assets", [1246099, 1043029, 699929, 873740, 3862797], 12))
    poz = zbuduj_pozycje(o)
    # Wartość kwartalna nie trafia do ŻADNEGO okresu. Drugi okres nie ma z czego powstać
    # i dlatego w ogóle nie istnieje — okres bez odczytanej pozycji nie jest okresem.
    assert all(p.aktywa_ogolem != 1043029 for p in poz)
    assert [p.dzien for p in poz] == ["2008-06-30"]


def test_ostatnia_wartosc_wiersza_segmentowego_jest_suma_okresu():
    # Kolejne wiersze o tej samej etykiecie opisują kolejne okresy, a ostatnia liczba
    # każdego z nich jest sumą. Sprawdzone na sześciu wierszach obu sprawozdań.
    o = _odczyt(
        Kandydat("aktywa_ogolem", "Total assets", [1246099, 1043029, 699929, 873740, 3862797], 12),
        Kandydat("aktywa_ogolem", "Total assets", [936185, 797021, 479448, 736257, 2948910], 12),
    )
    poz = zbuduj_pozycje(o)
    assert poz[0].aktywa_ogolem == 3862797
    assert poz[1].aktywa_ogolem == 2948910


def test_wiodacy_numer_noty_nie_psuje_odczytu_dokladnego():
    # „Total Equity 59 169,969 146,119" — 59 to odsyłacz do noty. Bez jego odcięcia
    # wiersz wyglądał na trzykolumnowy i szedł ścieżką domysłu, choć jest dokładny.
    o = _odczyt(Kandydat("kapital_wlasny", "Total Equity", [59, 169969, 146119], 72),
                dni=("2007-12-31", "2006-12-31"))
    poz = zbuduj_pozycje(o)
    assert (poz[0].kapital_wlasny, poz[1].kapital_wlasny) == (169969, 146119)


def test_czysta_etykieta_wygrywa_z_etykieta_wchlaniajaca_liczby():
    # Wiersz „Net interest income 13,521 23,198 ( 562) 2,9" daje [786, 39 082] i podstawia
    # 786 pod rok 2007; czysty wiersz kilka stron dalej ma [39 082, 37 084].
    o = _odczyt(
        Kandydat("wynik_odsetkowy", "Net interest income 13,521 23,198 ( 562) 2,9", [786, 39082], 87),
        Kandydat("wynik_odsetkowy", "Net interest income", [39082, 37084], 91),
        dni=("2007-12-31", "2006-12-31"),
    )
    poz = zbuduj_pozycje(o)
    assert (poz[0].wynik_odsetkowy, poz[1].wynik_odsetkowy) == (39082, 37084)


def test_pozycje_wynikowe_tylko_z_odczytu_dokladnego():
    # Kolumny rachunku wyników to OKRESY: sprawozdanie półroczne zestawia półrocze
    # z półroczem, mimo że nagłówek nosi datę 31.12. Wnioskowanie z układu strony
    # dałoby tu wynik półroczny podpisany jako roczny.
    o = _odczyt(Kandydat("zysk_netto", "Profit for the period", [16052, 16052, 477, 16529], 7))
    # Nic się nie odczytuje, więc nie zostaje ani jeden okres — a nie okres z pustym zyskiem.
    assert zbuduj_pozycje(o) == []
    # Ta sama sytuacja dla pozycji BILANSOWEJ jest dopuszczalna — bilans to stan na dzień.
    o2 = _odczyt(Kandydat("aktywa_ogolem", "Total assets", [1, 2, 3, 4, 3862797], 12))
    assert zbuduj_pozycje(o2)[0].aktywa_ogolem == 3862797


def test_odczyt_wywnioskowany_jest_odnotowany():
    uwagi = []
    o = _odczyt(Kandydat("aktywa_ogolem", "Total assets", [1, 2, 3, 4, 3862797], 12))
    zbuduj_pozycje(o, uwagi=uwagi)
    assert any("wywnioskowana z układu strony" in u for u in uwagi)


def test_data_z_przyszlosci_nie_jest_dniem_bilansowym():
    """Sprawozdanie opisuje stan, który już zaistniał.

    W informacji dodatkowej SK Banku OCR przekręcił „31.12.2018" na „31.12.2028"
    i silnik przyjął okres sprawozdawczy oddalony o dwanaście lat — wraz z pustymi
    wartościami poszedł do wskaźników jako pełnoprawny punkt szeregu.
    """
    from engine.sprawozdania import _daty_kolumn

    daty = _daty_kolumn("Saldo na 31.12.2016r. 31.12.2017r. 31.12.2028r.")
    assert daty == ["2016-12-31", "2017-12-31"]


def test_okres_bez_ani_jednej_pozycji_jest_pomijany_z_uwaga():
    uwagi = []
    o = _odczyt(Kandydat("aktywa_ogolem", "Total assets", [169969, 146119], 12))
    o.kandydaci = []          # kolumny dat są, treści nie ma
    poz = zbuduj_pozycje(o, uwagi=uwagi)
    assert poz == []
    assert sum("okres pominięty" in u for u in uwagi) == 2
