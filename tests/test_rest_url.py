"""Adresy PostgREST z wartości, których nie kontrolujemy.

⚠️ REGRESJA. Zakresowe kasowanie metryk wymienia w filtrze KLUCZE, a te niosą nazwy
podmiotów z rostera Grupy: „ede_bval::profit estate". Spacja w adresie wywracała cały
bieg TREM komunikatem biblioteki („URL can't contain control characters"), zamiast
policzyć wskaźniki.
"""
import urllib.parse
import urllib.request

import pytest

from engine.rest_url import filtr_in, url_rest

BASE = "https://przyklad.supabase.co"
CID = "2c2825d0-3bd0-4176-994e-a1351e254074"


def test_klucz_ze_spacja_daje_adres_wysylalny():
    url = url_rest(BASE, "metrics", case_id=f"eq.{CID}", key=filtr_in(["day_close", "ede_bval::profit estate"]))
    assert " " not in url, "spacja w adresie = wyjątek w urllib jeszcze przed wysłaniem"
    # Sprawdzenie właściwe: obiekt żądania w ogóle daje się utworzyć.
    urllib.request.Request(url, method="DELETE")


def test_wartosci_wracaja_po_zdekodowaniu_bez_zmian():
    klucze = ["day_close", "ede_bval::profit estate", "ent_buy_share::sroka"]
    url = url_rest(BASE, "metrics", case_id=f"eq.{CID}", key=filtr_in(klucze))
    q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    assert q["case_id"] == [f"eq.{CID}"]
    assert q["key"] == ['in.("day_close","ede_bval::profit estate","ent_buy_share::sroka")']


def test_przecinek_i_cudzyslow_nie_rozwalaja_filtru():
    """Przecinek rozdziela wartości, cudzysłów je zamyka — obie muszą przetrwać."""
    f = filtr_in(['a,b', 'c"d', "e\\f"])
    assert f == 'in.("a,b","c\\"d","e\\\\f")'
    url = url_rest(BASE, "metrics", key=f)
    assert "," in urllib.parse.parse_qs(urllib.parse.urlparse(url).query)["key"][0]


def test_ampersand_w_wartosci_nie_dokleja_kolejnego_filtru():
    url = url_rest(BASE, "metrics", case_id=f"eq.{CID}", key=filtr_in(["x&limit=1"]))
    q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    assert set(q) == {"case_id", "key"}, "wartość nie może wprowadzać nowych parametrów"


@pytest.mark.parametrize("sciezka", ["metrics", "/metrics"])
def test_sciezka_z_ukosnikiem_i_bez(sciezka):
    assert url_rest(BASE + "/", sciezka, case_id="eq.1").startswith(f"{BASE}/rest/v1/metrics?")
