"""Zbiorcze obliczenie wskaźników z danych UTP — jedno źródło prawdy.

Używane lokalnie (testy) i przez funkcję Vercel (api/analyze.py). Reużywa
zwalidowanych funkcji z metrics.py; zwraca listę rekordów gotowych do zapisu
w tabeli `metrics`.
"""
from __future__ import annotations

from collections import defaultdict

from . import metrics
from .identity import build_account_owner_map, canonical_group, is_group
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

    # Tabela per podmiot (Grupa) — udział, wartość i wolumen sprzedaży.
    for e in metrics.per_entity_breakdown(transactions, group_fragments):
        out.append(_m(f"ent_sell_share::{e['entity']}", f"Udział sprzedaży — {e['entity']}",
                      round(e["sell_value_share"] * 100, 2), "%"))
        out.append(_m(f"ent_sell_val::{e['entity']}", f"Wartość sprzedaży — {e['entity']}",
                      round(e["sell_value"], 2), "zł"))
        out.append(_m(f"ent_sell_vol::{e['entity']}", f"Wolumen sprzedaży — {e['entity']}",
                      round(e["sell_volume"]), "szt"))

    # Rozbicie per sesja (Tab 24–28): wolumen/wartość sesji, obrót Grupy i wewnątrzgrupowy.
    for r in metrics.per_day_breakdown(transactions, group_fragments):
        d = r["day"]
        out.append(_m("day_sess_vol", "Wolumen sesji", round(r["sv"]), "szt", d))
        out.append(_m("day_sess_val", "Wartość sesji", round(r["sval"], 2), "zł", d))
        out.append(_m("day_grp_vol", "Wolumen z udziałem Grupy", round(r["gv"]), "szt", d))
        out.append(_m("day_grp_val", "Wartość z udziałem Grupy", round(r["gval"], 2), "zł", d))
        out.append(_m("day_intra_vol", "Wolumen wewnątrzgrupowy", round(r["iv"]), "szt", d))

    # Pary podmiotów handlujących wewnątrz Grupy (sygnał do kolejki powiązań OSINT).
    for p in metrics.per_pair_intra(transactions, group_fragments)[:60]:
        out.append(_m(f"pair_intra::{p['a']}|{p['b']}", f"Wash-pary — {p['a']} ↔ {p['b']}",
                      round(p["value"], 2), "zł"))

    # Layering per sesja i podmiot — tylko podmioty z faktycznymi anulacjami.
    for r in metrics.per_session_layering(orders, owner_map, group_fragments):
        if r["cancelled_volume"] <= 0:
            continue
        out.append(_m(f"lay_share::{r['entity']}", f"Anulacje — {r['entity']}",
                      round(r["cancel_share"] * 100, 2), "%", r["day"]))
        out.append(_m(f"lay_cancelled::{r['entity']}", f"Anulowano — {r['entity']}",
                      round(r["cancelled_volume"]), "szt", r["day"]))

    return out


def compute_trem(transactions: list[dict], group_fragments: list[str] | None = None) -> list[dict]:
    """Metryki transakcyjne z pliku TREM (arkusz IAD_C_TREM) — jednoprzebiegowo.

    TREM nie zawiera pełnej książki zleceń, więc bez anulacji/layeringu: liczba
    transakcji, wartość, wolumen, udział Grupy, wash/dzień oraz tabela per podmiot.
    Klucze te same co przy UTP, więc zasilają te same rozdziały. Definicje zgodne
    z metrics.py (wash = wolumen, gdy obie strony należą do Grupy)."""
    out: list[dict] = []
    n = len(transactions)
    total_val = 0.0
    total_vol = 0.0
    group_val = 0.0
    sess_vol: dict[str, float] = defaultdict(float)
    sess_val: dict[str, float] = defaultdict(float)
    grp_vol: dict[str, float] = defaultdict(float)
    grp_val: dict[str, float] = defaultdict(float)
    intra_vol: dict[str, float] = defaultdict(float)
    ent: dict[str, dict] = defaultdict(lambda: {"sv": 0.0, "svol": 0.0})
    for r in transactions:
        val = r.get("WARTOSC_TR") or 0
        vol = r.get("WOLUMEN") or 0
        total_val += val
        total_vol += vol
        d = session_date(r.get("DATA_SESJI"))
        sess_vol[d] += vol
        sess_val[d] += val
        gb = is_group(r.get("ACCTOWNR_POPRAWIONY_B"), group_fragments)
        gs = is_group(r.get("ACCTOWNR_POPRAWIONY_S"), group_fragments)
        if gb or gs:
            group_val += val
            grp_vol[d] += vol
            grp_val[d] += val
        if gb and gs:
            intra_vol[d] += vol
        cs = canonical_group(r.get("ACCTOWNR_POPRAWIONY_S"), group_fragments)
        if cs:
            ent[cs]["sv"] += val
            ent[cs]["svol"] += vol

    out.append(_m("totals_transactions", "Liczba transakcji", n, "szt"))
    out.append(_m("totals_value", "Wartość obrotu", round(total_val, 2), "zł"))
    out.append(_m("totals_volume", "Wolumen obrotu", round(total_vol), "szt"))
    out.append(_m("group_turnover_value", "Obrót z udziałem Grupy", round(group_val, 2), "zł"))
    out.append(_m("group_turnover_share", "Udział Grupy w wartości obrotu",
                  round(group_val / total_val * 100, 2) if total_val else 0.0, "%"))
    for d in sorted(sess_vol):
        share = intra_vol[d] / sess_vol[d] * 100 if sess_vol[d] else 0.0
        out.append(_m(f"wash_{d}", "Wash-trades (udział w wolumenie sesji)", round(share, 2), "%", d))
        out.append(_m("day_sess_vol", "Wolumen sesji", round(sess_vol[d]), "szt", d))
        out.append(_m("day_sess_val", "Wartość sesji", round(sess_val[d], 2), "zł", d))
        out.append(_m("day_grp_vol", "Wolumen z udziałem Grupy", round(grp_vol[d]), "szt", d))
        out.append(_m("day_grp_val", "Wartość z udziałem Grupy", round(grp_val[d], 2), "zł", d))
        out.append(_m("day_intra_vol", "Wolumen wewnątrzgrupowy", round(intra_vol[d]), "szt", d))
    for e, agg in sorted(ent.items(), key=lambda x: -x[1]["sv"]):
        out.append(_m(f"ent_sell_share::{e}", f"Udział sprzedaży — {e}",
                      round(agg["sv"] / total_val * 100, 2) if total_val else 0.0, "%"))
        out.append(_m(f"ent_sell_val::{e}", f"Wartość sprzedaży — {e}", round(agg["sv"], 2), "zł"))
        out.append(_m(f"ent_sell_vol::{e}", f"Wolumen sprzedaży — {e}", round(agg["svol"]), "szt"))
    for p in metrics.per_pair_intra(transactions, group_fragments)[:60]:
        out.append(_m(f"pair_intra::{p['a']}|{p['b']}", f"Wash-pary — {p['a']} ↔ {p['b']}",
                      round(p["value"], 2), "zł"))
    return out
