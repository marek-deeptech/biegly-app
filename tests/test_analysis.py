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


def test_imo_zero_jest_zapisywane_jawnie(transactions, orders):
    """Regresja: „cisza przy zerze" IMO.

    Gdy w Grupie nie ma żadnych dopasowań ≤ progu, silnik wcześniej nie zapisywał
    NIC — rozdział IV.5 nie umiał odróżnić „techniki nie badano" od „zbadano,
    dopasowań brak". W sprawie weryfikacyjnej (ZASTAL) to drugie jest ustaleniem
    negatywnym o wartości dowodowej. Grupa z nieistniejącym fragmentem wymusza
    zero dopasowań na realnych danych.
    """
    rows = compute_all(transactions, orders, group_fragments=["__nie_ma_takiego_podmiotu__"])
    imo = [r for r in rows if r["key"] == "imo_count"]
    assert len(imo) == 1, "imo_count musi istnieć także przy zerze"
    assert imo[0]["value"] == 0
    assert "≤" in imo[0]["label"], "etykieta ma nieść próg, którym badano"
