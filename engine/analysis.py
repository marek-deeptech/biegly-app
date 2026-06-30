"""Zbiorcze obliczenie wskaźników z danych UTP — jedno źródło prawdy.

Używane lokalnie (testy) i przez funkcję Vercel (api/analyze.py). Reużywa
zwalidowanych funkcji z metrics.py; zwraca listę rekordów gotowych do zapisu
w tabeli `metrics`.
"""
from __future__ import annotations

from . import metrics
from .identity import build_account_owner_map
from .loader import session_date


def _m(key, label, value, unit, day=None):
    return {"key": key, "label": label, "value": value, "unit": unit, "session_day": day}


def compute_all(
    transactions: list[dict],
    orders: list[dict],
    group_fragments: list[str] | None = None,
) -> list[dict]:
    """Liczy komplet wskaźników. `group_fragments` = definicja Grupy danej sprawy
    (gdy None — domyślnie HubTech z settings, zachowanie wsteczne)."""
    out: list[dict] = []

    t = metrics.session_totals(transactions)
    out.append(_m("totals_transactions", "Liczba transakcji", t.transactions, "szt"))
    out.append(_m("totals_value", "Wartość obrotu", round(t.value, 2), "zł"))
    out.append(_m("totals_volume", "Wolumen obrotu", round(t.volume), "szt"))

    gt = metrics.group_turnover_share(transactions, group_fragments)
    out.append(_m("group_turnover_value", "Obrót z udziałem Grupy", round(gt["group_value"], 2), "zł"))
    out.append(_m("group_turnover_share", "Udział Grupy w wartości obrotu", round(gt["share"] * 100, 2), "%"))

    owner_map = build_account_owner_map(transactions)
    days = sorted({session_date(r.get("DATA_SESJI")) for r in transactions if r.get("DATA_SESJI")})
    for d in days:
        w = metrics.wash_trade_share(transactions, d, group_fragments)
        out.append(_m(f"wash_{d}", "Wash-trades (udział w wolumenie sesji)",
                      round(w["share"] * 100, 2), "%", d))
        c = metrics.cancelled_buy_share(orders, owner_map, d, group_fragments)
        out.append(_m(f"cancel_{d}", "Anulacje kupna Grupy (layering/spoofing)",
                      round(c["share"] * 100, 2), "%", d))

    # Tabela per podmiot (Grupa) — udział i wolumen sprzedaży każdego podmiotu.
    for e in metrics.per_entity_breakdown(transactions, group_fragments):
        out.append(_m(f"ent_sell_share::{e['entity']}", f"Udział sprzedaży — {e['entity']}",
                      round(e["sell_value_share"] * 100, 2), "%"))
        out.append(_m(f"ent_sell_vol::{e['entity']}", f"Wolumen sprzedaży — {e['entity']}",
                      round(e["sell_volume"]), "szt"))

    # Layering per sesja i podmiot — tylko podmioty z faktycznymi anulacjami.
    for r in metrics.per_session_layering(orders, owner_map, group_fragments):
        if r["cancelled_volume"] <= 0:
            continue
        out.append(_m(f"lay_share::{r['entity']}", f"Anulacje — {r['entity']}",
                      round(r["cancel_share"] * 100, 2), "%", r["day"]))
        out.append(_m(f"lay_cancelled::{r['entity']}", f"Anulowano — {r['entity']}",
                      round(r["cancelled_volume"]), "szt", r["day"]))

    return out
