"""Raport walidacyjny: liczy wskaźniki i zestawia je z liczbami z opinii.

Uruchomienie:  python -m engine.report
"""
from __future__ import annotations

from . import metrics, settings
from .identity import build_account_owner_map
from .loader import load_rows


def run() -> list[dict]:
    transactions = load_rows(settings.HUBTECH_UTP_FILE, settings.SHEET_TRANSACTIONS)
    orders = load_rows(settings.HUBTECH_UTP_FILE, settings.SHEET_ORDERS)
    owner_map = build_account_owner_map(transactions)

    totals = metrics.session_totals(transactions)
    wash = metrics.wash_trade_share(transactions, "2020-10-13")
    turnover = metrics.group_turnover_share(transactions)
    joyfix = metrics.entity_sell(transactions, "joyfix")
    cancel = metrics.cancelled_buy_share(orders, owner_map, "2020-10-08")

    return [
        ("Transakcje (szt.)", f"{totals.transactions:,}", "41,548"),
        ("Wartość obrotu (zł)", f"{totals.value:,.0f}", "228,285,987"),
        ("Wolumen (szt.)", f"{totals.volume:,.0f}", "180,273,029"),
        ("Wash-trades 13.10.2020", f"{wash['share']*100:.2f}%", "38,45%"),
        ("Obrót z udziałem Grupy", f"{turnover['share']*100:.2f}%", "47,36%"),
        ("Joyfix sprzedaż (szt.)", f"{joyfix['sell_volume']:,.0f}", "47,419,738"),
        ("Anulacje kupna 8.10.2020", f"{cancel['share']*100:.2f}%", "88%"),
    ]


if __name__ == "__main__":
    print(f"{'Wskaźnik':32s} {'Silnik':>18s} {'Cel (opinia)':>16s}")
    print("-" * 70)
    for name, got, target in run():
        print(f"{name:32s} {got:>18s} {target:>16s}")
