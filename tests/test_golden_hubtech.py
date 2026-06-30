"""Testy regresyjne 'złotych liczb' — silnik musi odtwarzać liczby z opinii
biegłego w sprawie HubTech (RP I Ds 4.2019) co do sztuki / grosza / 0,01 p.p.

Źródło liczb docelowych: rozdział WNIOSKI opinii Krzysztofa Michrowskiego.
Każdy test, który tu pęknie, oznacza regresję w silniku faktów.
"""
from engine import metrics


def test_session_totals(transactions):
    t = metrics.session_totals(transactions)
    assert t.transactions == 41_548
    assert round(t.value) == 228_285_987
    assert round(t.volume) == 180_273_029


def test_wash_trades_13_10(transactions):
    r = metrics.wash_trade_share(transactions, "2020-10-13")
    assert round(r["share"] * 100, 2) == 38.45


def test_group_turnover(transactions):
    r = metrics.group_turnover_share(transactions)
    assert round(r["group_value"]) == 108_114_686
    assert round(r["share"] * 100, 2) == 47.36


def test_joyfix_sell(transactions):
    r = metrics.entity_sell(transactions, "joyfix")
    assert round(r["sell_volume"]) == 47_419_738
    assert round(r["sell_value_share"] * 100, 2) == 28.72


def test_cancelled_buy_08_10(orders, owner_map):
    r = metrics.cancelled_buy_share(orders, owner_map, "2020-10-08")
    assert round(r["cancelled_volume"]) == 46_371_305
    assert round(r["share"] * 100) == 88


def test_per_entity_joyfix(transactions):
    # „Tabela per podmiot" musi odtwarzać liczby Joyfix z entity_sell (golden).
    rows = metrics.per_entity_breakdown(transactions)
    joyfix = next(r for r in rows if r["entity"] == "joyfix")
    assert round(joyfix["sell_volume"]) == 47_419_738
    assert round(joyfix["sell_value_share"] * 100, 2) == 28.72


def test_per_session_layering_sums_to_cancelled_08_10(orders, owner_map):
    # Suma anulacji per podmiot dla 08.10 = łączna anulacja tego dnia (golden).
    rows = metrics.per_session_layering(orders, owner_map)
    day_total = sum(r["cancelled_volume"] for r in rows if r["day"] == "2020-10-08")
    assert round(day_total) == 46_371_305
