"""Wskaźniki dodatkowe — specyfikacja biegłego (Wskazniki.docx, 7.08.2026).

Fixture odwzorowuje mechanikę sesji: kolejne transakcje po rosnących cenach,
transakcja wzajemna wewnątrz Grupy i transakcja postronna, żeby każdy wskaźnik
miał zarówno odczyt Grupy, jak i odniesienie do reszty rynku.
"""
import pytest

from engine.wskazniki_dodatkowe import porzadek_transakcji, vwap, wskazniki_dodatkowe

GRUPA = ["omegia", "wieczorek", "zalewski"]


def t(czas, kurs, wol, kupujacy, sprzedajacy, dzien="2018-01-08", orderid_k=None, exid=1):
    return {
        "DATA_SESJI": dzien,
        "CZAS_TR": czas,
        "TRANSACTTIME": f"{dzien} {czas},000000",
        "KURS": kurs,
        "WOLUMEN": wol,
        "WARTOSC_TR": round(kurs * wol, 6),
        "ACCTOWNR_POPRAWIONY_K": kupujacy,
        "ACCTOWNR_POPRAWIONY_S": sprzedajacy,
        "ORDERID_K": orderid_k,
        "UTPEXID": exid,
    }


# 1,00 → 1,10 (Grupa kupuje, +0,10) → 1,05 (spadek) → 1,20 (postronny, +0,15)
# → 1,25 (transakcja wewnątrz Grupy, +0,05)
SESJA = [
    t("09:00:00", 1.00, 100, "obcy1", "obcy2", exid=1),
    t("09:05:00", 1.10, 200, "omegia", "obcy2", exid=2),
    t("09:10:00", 1.05, 50, "obcy1", "omegia", exid=3),
    t("09:15:00", 1.20, 300, "obcy3", "obcy2", exid=4),
    t("09:20:00", 1.25, 400, "wieczorek", "omegia", exid=5),
]


@pytest.fixture
def w():
    return wskazniki_dodatkowe(SESJA, GRUPA, etykieta="CSY")


def test_kolejnosc_nie_ufa_ukladowi_pliku():
    """⚠️ Wskaźniki 1–3 porównują z POPRZEDNIĄ transakcją, więc plik posortowany
    po rachunku dałby zmyślony ciąg zmian cen."""
    pomieszane = [SESJA[3], SESJA[0], SESJA[4], SESJA[1], SESJA[2]]
    assert [r["UTPEXID"] for r in porzadek_transakcji(pomieszane)] == [1, 2, 3, 4, 5]


def test_nmaxc_liczy_tylko_nowe_maksima(w):
    s = w["sesje"][0]
    # maksima: 1,10 (Grupa), 1,20 (postronny), 1,25 (Grupa) — 1,05 to spadek, nie maksimum
    assert s["nmaxc_razem"] == 3
    assert s["nmaxc_grupa"] == 2
    assert s["nmaxc_pozostali"] == 1
    assert w["okres"]["udzial_nmaxc"] == pytest.approx(66.67, abs=0.01)


def test_pierwsza_transakcja_sesji_nie_jest_nowym_maksimum():
    jedna = wskazniki_dodatkowe([t("09:00:00", 5.0, 10, "omegia", "obcy")], GRUPA)
    assert jedna["sesje"][0]["nmaxc_razem"] == 0
    assert jedna["sesje"][0]["wnk_pln_sesja"] == 0


def test_wnk_pln_sumuje_wylacznie_wzrosty(w):
    s = w["sesje"][0]
    # wzrosty: +0,10 (Grupa), +0,15 (postronny), +0,05 (Grupa) = 0,30; spadek pomijany
    assert s["wnk_pln_sesja"] == pytest.approx(0.30, abs=1e-6)
    assert s["wnk_pln_grupa"] == pytest.approx(0.15, abs=1e-6)
    assert s["wnk_pln_pozostali"] == pytest.approx(0.15, abs=1e-6)
    assert s["udzial_wnk_pln"] == pytest.approx(50.0, abs=0.01)


def test_wnk_procent_liczy_sie_wzgledem_poprzedniej_ceny(w):
    s = w["sesje"][0]
    # 0,10/1,00 = 10 % ; 0,15/1,05 = 14,29 % ; 0,05/1,20 = 4,17 %
    assert s["wnk_pct_grupa"] == pytest.approx(14.17, abs=0.01)
    assert s["wnk_pct_sesja"] == pytest.approx(28.45, abs=0.01)


def test_wnk_procent_nie_wazy_wolumenem():
    """UWAGA z dokumentu: 1 szt. i 10 000 szt. liczą się tak samo."""
    maly = wskazniki_dodatkowe(
        [t("09:00:00", 1.0, 1, "obcy", "obcy2"), t("09:01:00", 1.1, 1, "omegia", "obcy2", exid=2)], GRUPA
    )
    duzy = wskazniki_dodatkowe(
        [t("09:00:00", 1.0, 10000, "obcy", "obcy2"), t("09:01:00", 1.1, 10000, "omegia", "obcy2", exid=2)], GRUPA
    )
    assert maly["sesje"][0]["wnk_pct_grupa"] == duzy["sesje"][0]["wnk_pct_grupa"]


def test_vwap_wazony_wolumenem_nie_arytmetyczny(w):
    s = w["sesje"][0]
    # sesja: (100+220+52,5+360+500)/1050 = 1232,5/1050
    assert s["vwap_sesja"] == pytest.approx(1.1738, abs=1e-4)
    # Grupa kupno: (1,10×200 + 1,25×400)/600
    assert s["vwap_grupa_kupno"] == pytest.approx(1.2, abs=1e-4)
    assert w["okres"]["premia_vwap_kupno_pct"] == pytest.approx(2.23, abs=0.05)


def test_vwap_bez_obrotu_to_none_a_nie_zero():
    assert vwap(0, 0) is None
    bez = wskazniki_dodatkowe([t("09:00:00", 1.0, 10, "obcy", "obcy2")], GRUPA)
    assert bez["sesje"][0]["vwap_grupa_kupno"] is None


def test_wt_procent_to_wolumen_wzajemny_do_wolumenu_sesji(w):
    s = w["sesje"][0]
    # wewnątrz Grupy: 400 szt. z 1050 szt. sesji
    assert s["wol_wewn"] == 400
    assert s["wt_pct"] == pytest.approx(38.10, abs=0.01)


def test_taker_maker_nie_zgaduje():
    """⚠️ Zlecenie z wcześniejszej sesji to PEWNY maker; reszta zostaje nieokreślona,
    bo numery zleceń KNF nie łączą się z identyfikatorami TREM."""
    dane = [
        t("09:00:00", 1.0, 10, "obcy", "obcy2"),
        t("09:01:00", 1.1, 10, "omegia", "obcy2", orderid_k=20180105000012, exid=2),  # sprzed sesji
        t("09:02:00", 1.2, 10, "omegia", "obcy2", orderid_k=20180108000044, exid=3),  # tego dnia
    ]
    w = wskazniki_dodatkowe(dane, GRUPA)
    assert w["okres"]["taker_maker"] == {"maker_pewny": 1, "nieokreslone": 1}
    assert any("NIEOKREŚLONYCH" in u for u in w["uwagi"])


def test_sczas_t_raportowany_jako_niepoliczalny(w):
    assert any("ŚczasT" in u and "nie został policzony" in u for u in w["uwagi"])


def test_atrybucja_imienna_podmiotow(w):
    p = w["podmioty"]
    assert p["omegia"]["nmaxc"] == 1
    assert p["wieczorek"]["nmaxc"] == 1
    assert p["omegia"]["wnk_pln"] == pytest.approx(0.10, abs=1e-6)


def test_dwie_sesje_maja_wlasne_maksima_i_ciagi():
    """Maksimum jest DZIENNE — nowa sesja zaczyna liczenie od zera, a zmiana kursu
    nie przenosi się przez noc."""
    dane = SESJA + [
        t("09:00:00", 1.15, 100, "omegia", "obcy2", dzien="2018-01-09", exid=1),
        t("09:05:00", 1.30, 100, "omegia", "obcy2", dzien="2018-01-09", exid=2),
    ]
    w = wskazniki_dodatkowe(dane, GRUPA)
    assert [s["dzien"] for s in w["sesje"]] == ["2018-01-08", "2018-01-09"]
    d2 = w["sesje"][1]
    assert d2["nmaxc_razem"] == 1  # tylko 1,30; 1,15 to pierwsza transakcja dnia
    assert d2["wnk_pln_sesja"] == pytest.approx(0.15, abs=1e-6)


def test_pusty_arkusz_nie_wywraca_biegu():
    w = wskazniki_dodatkowe([], GRUPA)
    assert w["sesje"] == []
    assert w["okres"]["transakcji"] == 0
    assert w["okres"]["wt_pct"] is None
