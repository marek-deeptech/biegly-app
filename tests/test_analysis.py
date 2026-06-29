"""Regresja zbiorczego modułu analiz — te same złote liczby HubTech,
tym razem przez compute_all (wspólny rdzeń używany przez funkcję Vercel)."""
from engine.analysis import compute_all


def _val(rows, key):
    return next(r["value"] for r in rows if r["key"] == key)


def test_compute_all_golden(transactions, orders):
    rows = compute_all(transactions, orders)
    assert _val(rows, "totals_transactions") == 41_548
    assert round(_val(rows, "totals_value")) == 228_285_987
    assert _val(rows, "group_turnover_share") == 47.36
    assert _val(rows, "wash_2020-10-13") == 38.45
    assert round(_val(rows, "cancel_2020-10-08")) == 88
