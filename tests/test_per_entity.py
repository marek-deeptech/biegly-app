"""Testy jednostkowe nowych funkcji silnika (per podmiot, layering per sesja).

Dane syntetyczne — nie wymagają pliku UTP (działają niezależnie od dostępu do
fixture'u), walidują logikę agregacji i spójność z funkcjami bazowymi.
"""
from engine import metrics


def _tx(buyer, seller, vol, val):
    return {
        "ACCTOWNR_POPRAWIONY_B": buyer,
        "ACCTOWNR_POPRAWIONY_S": seller,
        "WOLUMEN": vol,
        "WARTOSC_TR": val,
    }


def _ord(ks, biuro, konto, data, vol, real):
    return {
        "K/S": ks,
        "Biuro": biuro,
        "Konto": konto,
        "Data": data,
        "Wolumen": vol,
        "Wolumen zreal.": real,
    }


FRAGS = ["alfa", "beta"]


def test_per_entity_breakdown_shares():
    tx = [
        _tx("Alfa Ltd", "Beta Ltd", 100, 1000),  # alfa kupuje, beta sprzedaje
        _tx("Outsider", "Alfa Ltd", 50, 500),  # alfa sprzedaje
        _tx("Beta Ltd", "Outsider", 30, 300),  # beta kupuje
    ]
    rows = metrics.per_entity_breakdown(tx, FRAGS)
    by = {r["entity"]: r for r in rows}
    total = 1800.0
    assert round(by["alfa"]["sell_value_share"], 6) == round(500 / total, 6)
    assert by["alfa"]["sell_volume"] == 50
    assert by["alfa"]["buy_volume"] == 100
    assert round(by["beta"]["sell_value_share"], 6) == round(1000 / total, 6)
    assert by["beta"]["sell_volume"] == 100
    # sortowanie malejąco po wartości sprzedaży → beta pierwsza
    assert rows[0]["entity"] == "beta"


def test_per_entity_consistent_with_entity_sell():
    tx = [_tx("Alfa Ltd", "Beta Ltd", 100, 1000), _tx("Outsider", "Alfa Ltd", 50, 500)]
    es = metrics.entity_sell(tx, "alfa", FRAGS)
    pe = {r["entity"]: r for r in metrics.per_entity_breakdown(tx, FRAGS)}["alfa"]
    assert round(pe["sell_value_share"], 10) == round(es["sell_value_share"], 10)
    assert pe["sell_volume"] == es["sell_volume"]


def test_per_session_layering_matches_cancelled():
    owner_map = {("1", "10"): "Alfa Ltd", ("1", "20"): "Beta Ltd"}
    orders = [
        _ord("K", "1", "10", "2020-10-08", 1000, 100),  # alfa: anulowane 900
        _ord("K", "1", "20", "2020-10-08", 500, 500),  # beta: anulowane 0
        _ord("S", "1", "10", "2020-10-08", 200, 200),  # sprzedaż — pomijana
        _ord("K", "1", "10", "2020-10-09", 400, 0),  # alfa dzień 2: anulowane 400
    ]
    rows = metrics.per_session_layering(orders, owner_map, FRAGS)
    by = {(r["day"], r["entity"]): r for r in rows}
    assert by[("2020-10-08", "alfa")]["cancelled_volume"] == 900
    assert round(by[("2020-10-08", "alfa")]["cancel_share"], 6) == round(900 / 1000, 6)
    # suma anulacji per dzień == cancelled_buy_share tego dnia
    day_total = sum(r["cancelled_volume"] for r in rows if r["day"] == "2020-10-08")
    cbs = metrics.cancelled_buy_share(orders, owner_map, "2020-10-08", FRAGS)
    assert round(day_total) == round(cbs["cancelled_volume"])
