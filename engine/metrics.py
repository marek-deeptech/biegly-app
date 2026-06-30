"""Deterministyczne wskaźniki manipulacji liczone wprost z danych UTP.

ZASADA: tu liczy kod, nie LLM. Każda funkcja jest czysta i odtwarzalna —
te same dane wejściowe dają te same liczby co do sztuki/grosza.
"""
from __future__ import annotations

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
