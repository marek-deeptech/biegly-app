"""Obrót w trzech miarach — parytet z tabelami 24–36 finału HubTech.

⚠️ SEDNO: te same transakcje w trzech miarach dają RÓŻNE obrazy. Podmiot może
odpowiadać za jedną transakcję z dziesięciu (10 % liczby) i za 90 % wolumenu.
Fixture jest tak dobrany, żeby udziały w liczbie, wartości i wolumenie były
rozbieżne — tabela, która myli te miary, wywali się tutaj.
"""
import pytest

from engine.obrot_wg_miar import (
    hhmmss,
    kupno_sprzedaz,
    macierz_czasu,
    obrot_wg_miar,
    sekundy,
    wewnatrzgrupowy,
)

GRUPA = ["omegia", "wieczorek"]


def t(czas, kurs, wol, k, s, dzien="2018-01-08", exid=1):
    return {
        "DATA_SESJI": dzien, "CZAS_TR": czas, "TRANSACTTIME": f"{dzien} {czas},000000",
        "KURS": kurs, "WOLUMEN": wol, "WARTOSC_TR": round(kurs * wol, 6),
        "ACCTOWNR_POPRAWIONY_K": k, "ACCTOWNR_POPRAWIONY_S": s, "UTPEXID": exid,
    }


# 4 transakcje: 1 obca (mała), 1 kupno Grupy (ogromne), 1 sprzedaż Grupy, 1 wewnątrzgrupowa
SESJA = [
    t("09:00:00", 1.0, 100, "obcy1", "obcy2", exid=1),
    t("09:05:00", 1.0, 9000, "omegia", "obcy2", exid=2),
    t("09:10:00", 1.0, 300, "obcy1", "omegia", exid=3),
    t("09:20:00", 1.0, 600, "wieczorek", "omegia", exid=4),
]


def test_trzy_miary_daja_rozne_udzialy():
    o = obrot_wg_miar(SESJA, GRUPA)["okres"]
    assert o["transakcji"] == 4 and o["transakcji_grupa"] == 3
    assert o["udzial_transakcji"] == 75.0  # 3 z 4 transakcji
    assert o["wolumen"] == 10000 and o["wolumen_grupa"] == 9900
    assert o["udzial_wolumenu"] == 99.0  # …ale 99 % wolumenu
    # ⚠️ Gdyby wymiar liczby transakcji nie istniał, teza „Grupa dominowała obrót"
    # opierałaby się wyłącznie na wolumenie — a to dwie różne rzeczy.
    assert o["udzial_transakcji"] != o["udzial_wolumenu"]


def test_transakcja_wewnatrzgrupowa_liczy_sie_RAZ():
    """Sumowanie kupna i sprzedaży policzyłoby ją dwa razy i dało udział > 100 %."""
    o = obrot_wg_miar(SESJA, GRUPA)["okres"]
    ks = kupno_sprzedaz(SESJA, GRUPA)["sesje"][0]
    assert ks["kupno_transakcji"] + ks["sprzedaz_transakcji"] == 4  # 2 kupna + 2 sprzedaże
    assert o["transakcji_grupa"] == 3  # ale transakcji z udziałem Grupy jest 3
    assert o["udzial_transakcji"] <= 100


def test_kupno_i_sprzedaz_rozbite_na_dzien():
    s = kupno_sprzedaz(SESJA, GRUPA)["sesje"][0]
    assert s["kupno_wolumen"] == 9600 and s["sprzedaz_wolumen"] == 900
    assert s["saldo_wolumen"] == 8700  # kupno − sprzedaż
    assert s["udzial_kupna"] == 96.0


def test_wewnatrzgrupowy_w_trzech_miarach():
    w = wewnatrzgrupowy(SESJA, GRUPA)["okres"]
    assert w["transakcji"] == 1 and w["udzial_transakcji"] == 25.0
    assert w["wolumen"] == 600 and w["udzial_wolumenu"] == 6.0
    assert w["sesji_z_obrotem"] == 1


def test_sesja_bez_obrotu_wewnatrzgrupowego_nie_tworzy_wiersza():
    bez = [t("09:00:00", 1.0, 100, "obcy1", "obcy2")]
    assert wewnatrzgrupowy(bez, GRUPA)["sesje"] == []


def test_macierz_czasu_liczy_odstepy_par_w_obrebie_sesji():
    dane = [
        t("09:00:00", 1.0, 100, "omegia", "obcy2", exid=1),
        t("09:00:08", 1.0, 100, "omegia", "obcy2", exid=2),   # 8 s później
        t("09:02:08", 1.0, 300, "omegia", "obcy2", exid=3),   # 120 s później
        t("10:00:00", 1.0, 100, "omegia", "obcy2", dzien="2018-01-09", exid=1),  # inny dzień
    ]
    m = macierz_czasu(dane, GRUPA)
    para = m["pary"][0]
    assert para["odstepow"] == 2, "przerwa nocna NIE jest odstępem między transakcjami"
    assert para["sredni_odstep_s"] == pytest.approx(64.0)  # (8 + 120) / 2
    # ważenie wolumenem przesuwa średnią ku transakcji o większym wolumenie
    assert para["sredni_odstep_wazony_s"] == pytest.approx(92.0)  # (8×100 + 120×300)/400


def test_para_z_jedna_transakcja_nie_ma_odstepu():
    """Zero znaczyłoby „natychmiast" — a to brak drugiego punktu, nie tempo."""
    m = macierz_czasu([t("09:00:00", 1.0, 100, "omegia", "obcy2")], GRUPA)
    assert m["pary"] == []
    assert m["pary_bez_odstepu"] == [{"kupujacy": "omegia", "sprzedajacy": "obcy2", "transakcji": 1}]


def test_macierz_pomija_pary_bez_udzialu_grupy():
    dane = [t("09:00:00", 1.0, 100, "obcy1", "obcy2"), t("09:00:30", 1.0, 100, "obcy1", "obcy2", exid=2)]
    assert macierz_czasu(dane, GRUPA)["pary"] == []
    assert len(macierz_czasu(dane, GRUPA, tylko_grupa=False)["pary"]) == 1


def test_czas_i_format():
    assert sekundy("2017-12-04 12:04:14,644386") == pytest.approx(43454.644386)
    assert sekundy("12:04:14") == pytest.approx(43454)
    assert sekundy("") is None
    assert hhmmss(243) == "0:04:03"
    assert hhmmss(None) == "—"
    # ⚠️ poniżej minuty precyzja do 0,1 s — „0:00:00" czytałoby się jak błąd formatu,
    # a to najmocniejszy sygnał tabeli: transakcje pary w tej samej sekundzie
    assert hhmmss(0.42) == "0,4 s"
    assert hhmmss(8) == "8,0 s"
    assert hhmmss(59.9) == "59,9 s"


def test_pusty_arkusz():
    assert obrot_wg_miar([], GRUPA)["sesje"] == []
    assert obrot_wg_miar([], GRUPA)["okres"]["udzial_wolumenu"] is None
