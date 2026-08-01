"""Golden test silnika bankowego — na realnych danych z opinii PO III Ds 84.2020.

Źródłem jest Tabela 8 finalnej opinii biegłego (analiza sprawozdania Glitnir Bank Hf):
zawiera zarówno pozycje kapitałowe, jak i wyliczone przez biegłego wskaźniki, więc
pozwala sprawdzić silnik wobec liczby, która trafiła do sądu — a nie wobec wartości
wymyślonej na potrzeby testu.

                              30.06.2008   31.12.2007   [mln ISK]
  Kapitał bazowy                 138 871      124 395
  Hybrydowy kapitał bazowy        62 824       39 564
  Tier 1                         201 695      163 959
  Pożyczki podporządkowane        81 529       61 617
  Baza kapitałowa                283 224      225 576
  Całkowite aktywa ważone ryz.  2 537 072    2 017 470
  Wskaźnik kapitału bazowego        5,5%         6,2%
  Wskaźnik Tier 1                   8,0%         8,1%
  Współczynnik wypłacalności       11,2%        11,2%
"""
import pytest

from engine.bank import Pozycje, naruszenia, prog_na_dzien, szereg, wskazniki, zmiany

GLITNIR_1H2008 = Pozycje(
    dzien="2008-06-30",
    waluta="ISK",
    kapital_cet1=138_871,        # „kapitał bazowy" w nazewnictwie sprawozdania
    kapital_at1=62_824,          # „hybrydowy kapitał bazowy"
    kapital_tier2=81_529,        # pożyczki podporządkowane
    aktywa_wazone_ryzykiem=2_537_072,
)

GLITNIR_2007 = Pozycje(
    dzien="2007-12-31",
    waluta="ISK",
    kapital_cet1=124_395,
    kapital_at1=39_564,
    kapital_tier2=61_617,
    aktywa_wazone_ryzykiem=2_017_470,
)


def _kod(ws, kod):
    return next(w for w in ws if w.kod == kod)


@pytest.mark.parametrize(
    "pozycje,cet1,tier1,tcr",
    [(GLITNIR_1H2008, 5.5, 8.0, 11.2), (GLITNIR_2007, 6.2, 8.1, 11.2)],
)
def test_wspolczynniki_zgodne_z_opinia(pozycje, cet1, tier1, tcr):
    """Silnik odtwarza wskaźniki podane w opinii (zgodność do 0,1 pkt proc.)."""
    ws = wskazniki(pozycje)
    assert _kod(ws, "cet1").wartosc == pytest.approx(cet1, abs=0.05)
    assert _kod(ws, "tier1").wartosc == pytest.approx(tier1, abs=0.05)
    assert _kod(ws, "tcr").wartosc == pytest.approx(tcr, abs=0.05)


def test_tier1_sklada_sie_z_bazowego_i_hybrydowego():
    """201 695 = 138 871 + 62 824 — kontrola samego modelu danych, nie tylko dzielenia."""
    ws = wskazniki(GLITNIR_1H2008)
    t1 = _kod(ws, "tier1")
    assert t1.skladniki["Tier 1"] == 201_695
    assert _kod(ws, "tcr").skladniki["fundusze własne"] == 283_224


def test_w_2008_nie_bylo_progu_cet1():
    """Kluczowe dla poprawności prawnej: przed CRR próg CET1 nie istniał.

    Gdyby silnik podstawiał tu 4,5% z art. 92 CRR, opinia zarzucałaby bankowi
    niespełnienie wymogu, który wszedł w życie sześć lat po ocenianym zdarzeniu.
    """
    ws = wskazniki(GLITNIR_1H2008)
    assert _kod(ws, "cet1").prog is None
    assert _kod(ws, "cet1").spelniony is None
    assert _kod(ws, "tier1").prog is None
    # Obowiązywał natomiast współczynnik wypłacalności 8% (Uchwała nr 1/2007 KNB).
    tcr = _kod(ws, "tcr")
    assert tcr.prog == 8.0
    assert tcr.spelniony is True
    assert "1/2007" in tcr.podstawa_progu


def test_te_same_dane_po_2014_dostaja_progi_crr():
    """Ta sama sytuacja kapitałowa oceniana pod CRR — progi się pojawiają."""
    po_crr = Pozycje(
        dzien="2020-06-30",
        kapital_cet1=138_871,
        kapital_at1=62_824,
        kapital_tier2=81_529,
        aktywa_wazone_ryzykiem=2_537_072,
    )
    ws = wskazniki(po_crr)
    assert _kod(ws, "cet1").prog == 4.5
    assert _kod(ws, "tier1").prog == 6.0
    assert "CRR" in _kod(ws, "tcr").podstawa_progu


def test_brak_danych_pomija_wskaznik_zamiast_zerowac():
    """Pusta pozycja w tabeli opinii znaczy „brak danych"; zero znaczyłoby „policzono zero"."""
    ws = wskazniki(Pozycje(dzien="2008-06-30", kapital_cet1=100.0))  # brak RWA
    assert [w.kod for w in ws] == []


def test_szereg_i_zmiany_pokazuja_trend():
    """Trend bywa istotniejszy niż poziom — spadek bufora przy spełnionym progu."""
    s = szereg([GLITNIR_1H2008, GLITNIR_2007])  # celowo w odwrotnej kolejności
    assert [w.dzien for w in s["cet1"]] == ["2007-12-31", "2008-06-30"]
    # kapitał bazowy: 6,2% → 5,5%, czyli spadek o 0,7 pkt proc.
    assert zmiany(s["cet1"]) == [("2008-06-30", pytest.approx(-0.69, abs=0.05))]


def test_naruszenia_tylko_ponizej_progu_obowiazujacego():
    # Bank z samym kapitałem podstawowym: 30/1000 = 3,0%. Wszystkie trzy współczynniki
    # są równe, bo Tier 1 zawiera CET1, a łączny zawiera Tier 1 — więc wszystkie trzy
    # progi CRR (4,5 / 6 / 8) są przekroczone w dół. Kaskada jest poprawna, nie jest błędem.
    slaby = Pozycje(dzien="2020-12-31", kapital_cet1=30.0, aktywa_wazone_ryzykiem=1000.0)
    n = naruszenia([slaby])
    assert sorted(w.kod for w in n) == ["cet1", "tcr", "tier1"]
    assert all(w.wartosc == 3.0 for w in n)

    # Ta sama sytuacja kapitałowa w 2008 r.: obowiązywał wyłącznie współczynnik
    # wypłacalności 8%, więc silnik stwierdza JEDNO niespełnienie, nie trzy.
    w2008 = naruszenia([Pozycje(dzien="2008-12-31", kapital_cet1=30.0, aktywa_wazone_ryzykiem=1000.0)])
    assert [w.kod for w in w2008] == ["tcr"]
    assert "1/2007" in w2008[0].podstawa_progu


def test_struktura_finansowania_os_ustalen_w_sprawie_mbr():
    """Zależność Glitnira od finansowania hurtowego była osią wniosków biegłego."""
    p = Pozycje(
        dzien="2008-06-30",
        depozyty_klientow=300_000,
        finansowanie_hurtowe=700_000,
        zobowiazania_ogolem=1_000_000,
        kredyty_brutto=600_000,
    )
    ws = wskazniki(p)
    assert _kod(ws, "udzial_depozytow").wartosc == 30.0
    assert _kod(ws, "udzial_hurtu").wartosc == 70.0
    assert _kod(ws, "kredyty_do_depozytow").wartosc == 200.0


def test_prog_lcr_dochodzi_do_100_procent_etapami():
    assert prog_na_dzien("lcr", "2014-06-30") is None       # jeszcze nie obowiązywał
    assert prog_na_dzien("lcr", "2016-06-30").minimum == 60.0
    assert prog_na_dzien("lcr", "2018-06-30").minimum == 80.0
    assert prog_na_dzien("lcr", "2024-06-30").minimum == 100.0


def test_udzial_powyzej_100_procent_dostaje_ostrzezenie():
    """Udział nie może przekroczyć całości — to znak, że licznik i mianownik
    pochodzą z różnych zakresów sprawozdania (skonsolidowany vs jednostkowy).

    Na realnych danych Glitnira wyszło 123,7% udziału depozytów w zobowiązaniach.
    Arytmetyka była poprawna, dane nie — i taka liczba nie może trafić do opinii
    bez uwagi.
    """
    p = Pozycje(dzien="2007-12-31", depozyty_klientow=1_237, zobowiazania_ogolem=1_000)
    w = _kod(wskazniki(p), "udzial_depozytow")
    assert w.wartosc == 123.7
    assert w.ostrzezenie and "przekracza 100%" in w.ostrzezenie


def test_udzial_w_normie_nie_ostrzega():
    p = Pozycje(dzien="2007-12-31", depozyty_klientow=300, zobowiazania_ogolem=1_000)
    assert _kod(wskazniki(p), "udzial_depozytow").ostrzezenie is None
