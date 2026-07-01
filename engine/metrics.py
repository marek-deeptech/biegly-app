"""Deterministyczne wskaźniki manipulacji liczone wprost z danych UTP.

ZASADA: tu liczy kod, nie LLM. Każda funkcja jest czysta i odtwarzalna —
te same dane wejściowe dają te same liczby co do sztuki/grosza.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from .identity import canonical_group, is_group, norm_acct
from .loader import session_date


@dataclass
class SessionTotals:
    transactions: int
    value: float
    volume: float


def session_totals(transactions: list[dict]) -> SessionTotals:
    """Sumy całości próby: liczba transakcji, wartość [zł], wolumen [szt]."""
    value = sum(r.get("WARTOSC_TR") or 0 for r in transactions)
    volume = sum(r.get("WOLUMEN") or 0 for r in transactions)
    return SessionTotals(len(transactions), value, volume)


def wash_trade_share(transactions: list[dict], day: str, group_fragments: list[str] | None = None) -> dict:
    """Udział wolumenu wewnątrzgrupowego (wash-trades) w wolumenie sesji danego dnia.

    Transakcja jest wewnątrzgrupowa, gdy obie strony należą do Grupy
    (po normalizacji do beneficjenta rzeczywistego).
    """
    session_vol = 0.0
    intra_vol = 0.0
    for r in transactions:
        if session_date(r.get("DATA_SESJI")) != day:
            continue
        vol = r.get("WOLUMEN") or 0
        session_vol += vol
        if is_group(r.get("ACCTOWNR_POPRAWIONY_B"), group_fragments) and is_group(r.get("ACCTOWNR_POPRAWIONY_S"), group_fragments):
            intra_vol += vol
    share = intra_vol / session_vol if session_vol else 0.0
    return {"session_volume": session_vol, "intra_group_volume": intra_vol, "share": share}


def group_turnover_share(transactions: list[dict], group_fragments: list[str] | None = None) -> dict:
    """Wartość obrotu, w którym co najmniej jedną stroną jest podmiot z Grupy."""
    total_value = 0.0
    group_value = 0.0
    for r in transactions:
        val = r.get("WARTOSC_TR") or 0
        total_value += val
        if is_group(r.get("ACCTOWNR_POPRAWIONY_B"), group_fragments) or is_group(r.get("ACCTOWNR_POPRAWIONY_S"), group_fragments):
            group_value += val
    share = group_value / total_value if total_value else 0.0
    return {"total_value": total_value, "group_value": group_value, "share": share}


def entity_sell(transactions: list[dict], fragment: str, group_fragments: list[str] | None = None) -> dict:
    """Wolumen i udział wartościowy sprzedaży jednego podmiotu z Grupy."""
    sell_volume = 0.0
    sell_value = 0.0
    total_sell_value = 0.0
    for r in transactions:
        val = r.get("WARTOSC_TR") or 0
        total_sell_value += val
        if canonical_group(r.get("ACCTOWNR_POPRAWIONY_S"), group_fragments) == fragment:
            sell_volume += r.get("WOLUMEN") or 0
            sell_value += val
    share = sell_value / total_sell_value if total_sell_value else 0.0
    return {"sell_volume": sell_volume, "sell_value_share": share}


def cancelled_buy_share(orders: list[dict], owner_map: dict, day: str, group_fragments: list[str] | None = None) -> dict:
    """Udział anulowanego wolumenu w zadeklarowanym wolumenie kupna Grupy danego dnia.

    "Anulowany" = część zadeklarowana, która nie weszła do realizacji,
    czyli (Wolumen - Wolumen zrealizowany), zsumowana po zleceniach kupna Grupy.
    Sygnał techniki layering & spoofing.
    """
    declared = 0.0
    cancelled = 0.0
    for r in orders:
        if session_date(r.get("Data")) != day:
            continue
        if r.get("K/S") != "K":
            continue
        owner = owner_map.get((norm_acct(r.get("Biuro")), norm_acct(r.get("Konto"))))
        if not is_group(owner, group_fragments):
            continue
        vol = r.get("Wolumen") or 0
        realised = r.get("Wolumen zreal.") or 0
        declared += vol
        cancelled += vol - realised
    share = cancelled / declared if declared else 0.0
    return {"declared_buy_volume": declared, "cancelled_volume": cancelled, "share": share}


def per_entity_breakdown(transactions: list[dict], group_fragments: list[str] | None = None) -> list[dict]:
    """Tabela per podmiot z Grupy: wolumen/wartość kupna i sprzedaży oraz udziały.

    Uogólnienie `entity_sell` na wszystkie podmioty Grupy naraz — odtwarza
    „Tabele per podmiot" z opinii. Udziały liczone względem całkowitej wartości
    obrotu (każda transakcja ma jedną stronę kupna i jedną sprzedaży, więc suma
    wartości po stronie kupna = suma po stronie sprzedaży = obrót ogółem).
    """
    total_value = 0.0
    agg: dict[str, dict] = defaultdict(
        lambda: {"sell_volume": 0.0, "sell_value": 0.0, "buy_volume": 0.0, "buy_value": 0.0}
    )
    for r in transactions:
        val = r.get("WARTOSC_TR") or 0
        vol = r.get("WOLUMEN") or 0
        total_value += val
        s = canonical_group(r.get("ACCTOWNR_POPRAWIONY_S"), group_fragments)
        if s:
            agg[s]["sell_volume"] += vol
            agg[s]["sell_value"] += val
        b = canonical_group(r.get("ACCTOWNR_POPRAWIONY_B"), group_fragments)
        if b:
            agg[b]["buy_volume"] += vol
            agg[b]["buy_value"] += val
    out: list[dict] = []
    for ent, a in agg.items():
        out.append(
            {
                "entity": ent,
                "sell_volume": a["sell_volume"],
                "sell_value": a["sell_value"],
                "sell_value_share": a["sell_value"] / total_value if total_value else 0.0,
                "buy_volume": a["buy_volume"],
                "buy_value": a["buy_value"],
                "buy_value_share": a["buy_value"] / total_value if total_value else 0.0,
            }
        )
    out.sort(key=lambda x: -x["sell_value"])
    return out


def per_day_breakdown(transactions: list[dict], group_fragments: list[str] | None = None) -> list[dict]:
    """Rozbicie per sesja: wolumen/wartość sesji, obrót z udziałem Grupy oraz
    obrót wewnątrzgrupowy (obie strony w Grupie). Źródło tabel dziennych (Tab 24–28)."""
    agg: dict[str, dict] = defaultdict(
        lambda: {"sv": 0.0, "sval": 0.0, "gv": 0.0, "gval": 0.0, "iv": 0.0, "ival": 0.0, "cnt": 0, "icnt": 0}
    )
    for r in transactions:
        d = session_date(r.get("DATA_SESJI"))
        vol = r.get("WOLUMEN") or 0
        val = r.get("WARTOSC_TR") or 0
        a = agg[d]
        a["sv"] += vol
        a["sval"] += val
        a["cnt"] += 1
        gb = is_group(r.get("ACCTOWNR_POPRAWIONY_B"), group_fragments)
        gs = is_group(r.get("ACCTOWNR_POPRAWIONY_S"), group_fragments)
        if gb or gs:
            a["gv"] += vol
            a["gval"] += val
        if gb and gs:
            a["iv"] += vol
            a["ival"] += val
            a["icnt"] += 1
    return [{"day": d, **a} for d, a in sorted(agg.items())]


def per_session_layering(
    orders: list[dict], owner_map: dict, group_fragments: list[str] | None = None
) -> list[dict]:
    """Layering & spoofing per (sesja, podmiot z Grupy): zadeklarowany wolumen kupna,
    anulowany wolumen i udział anulacji — źródło tabel per sesja (Zał. aktywności).

    Suma `cancelled` po podmiotach dla danego dnia = `cancelled_buy_share` tego dnia.
    """
    agg: dict[tuple, dict] = defaultdict(lambda: {"declared": 0.0, "cancelled": 0.0, "orders": 0})
    for r in orders:
        if r.get("K/S") != "K":
            continue
        owner = owner_map.get((norm_acct(r.get("Biuro")), norm_acct(r.get("Konto"))))
        ent = canonical_group(owner, group_fragments)
        if not ent:
            continue
        day = session_date(r.get("Data"))
        vol = r.get("Wolumen") or 0
        realised = r.get("Wolumen zreal.") or 0
        a = agg[(day, ent)]
        a["declared"] += vol
        a["cancelled"] += vol - realised
        a["orders"] += 1
    out: list[dict] = []
    for (day, ent), a in agg.items():
        out.append(
            {
                "day": day,
                "entity": ent,
                "declared_buy_volume": a["declared"],
                "cancelled_volume": a["cancelled"],
                "cancel_share": a["cancelled"] / a["declared"] if a["declared"] else 0.0,
                "orders": a["orders"],
            }
        )
    out.sort(key=lambda x: (x["day"], -x["cancelled_volume"]))
    return out
