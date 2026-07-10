"""Detektor techniki Spoofing & Layering na danych arkusza zleceń (UTP).

Definicja (Gideon Mark, „Spoofing and Layering"; CFTC/CEA §4c(a)(5); MAR art. 12 +
Zał. I lit. a): layering to odmiana spoofingu — składanie WIELU zleceń limitowanych po
jednej stronie arkusza na RÓŻNYCH poziomach cen (warstwy), BEZ ZAMIARU REALIZACJI, w celu
wywołania złudzenia podaży/popytu; realizacja następuje po stronie przeciwnej po sztucznie
utworzonej cenie, a zlecenia-warstwy są następnie anulowane.

Dane: arkusz „Zlecenia" (jeden wiersz na zlecenie): Data (sesja), K/S, Biuro+Konto,
Wolumen (zadeklarowany), Wolumen zreal. (zrealizowany), Limit (cena), OrderEntry Time,
CancelReplaceTime. „Anulowany" wolumen = Wolumen − Wolumen zreal. (część niewprowadzona
do obrotu). Detekcja jest deterministyczna; ocena prawna należy do biegłego i sądu.

Sygnatura per (sesja, podmiot z Grupy):
  • duże zlecenia KUPNA Grupy, w większości NIEZREALIZOWANE i ANULOWANE (wysoki udział
    anulacji), rozłożone na wielu poziomach cen (warstwy);
  • jednoczesna SPRZEDAŻ Grupy realizowana po stronie przeciwnej (zysk ze sztucznej ceny).
"""
from __future__ import annotations

from collections import defaultdict

from .identity import build_account_owner_map, canonical_group, norm_acct
from .loader import session_date


def _f(v) -> float:
    """Liczba odporna na format GPW: spacje jako separator tysięcy, przecinek dziesiętny."""
    if v is None or v == "":
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace("\xa0", "").replace(" ", "").replace(",", "."))
    except (TypeError, ValueError):
        return 0.0


def _time(v) -> str:
    """'HH:MM:SS' z 'YYYY-MM-DD HH:MM:SS,ms' albo z datetime; inaczej ''."""
    if v is None:
        return ""
    s = str(v)
    if len(s) >= 19 and s[10] == " ":
        return s[11:19]
    if len(s) >= 8 and s[2] == ":":
        return s[:8]
    return ""


def _date(v) -> str:
    """'YYYY-MM-DD' z 'YYYY-MM-DD HH:MM:SS,ms' albo z datetime; inaczej ''."""
    if v is None:
        return ""
    s = str(v)
    return s[:10] if len(s) >= 10 and s[4] == "-" else ""


def _sec(hms: str) -> int | None:
    """'HH:MM:SS' → sekundy od północy; inaczej None."""
    if not hms or len(hms) < 8 or hms[2] != ":":
        return None
    try:
        return int(hms[:2]) * 3600 + int(hms[3:5]) * 60 + int(hms[6:8])
    except ValueError:
        return None


OPEN_S, CLOSE_S, N_POINTS = 9 * 3600, 17 * 3600 + 300, 96  # sesja GPW ~09:00–17:05, 96 próbek


def _tx_time_col(r: dict) -> str:
    v = r.get("TRANSACTTIME_TXT") or r.get("CZAS_TR") or ""
    return _time(v)


CONT_OPEN, CONT_CLOSE = 9 * 3600, 16 * 3600 + 50 * 60  # faza ciągła GPW (poza aukcjami 08:30–09:00 i 16:50–17:05)


def reconstruct_book(day_orders: list[dict], day: str) -> tuple[list, list]:
    """Odtwarza rzeczywisty BestBid/BestAsk z arkusza zleceń (WSZYSTKIE zlecenia rynku)
    silnikiem dopasowań (matching engine) — jak liczy giełda. Zdarzenia (wejście/anulacja)
    przetwarzane chronologicznie; gdy nowe zlecenie krzyżuje przeciwną stronę → realizacja
    zjada wolumen. Dzięki temu w fazie ciągłej kwotowania NIE krzyżują się (bid < ask).

    Best bid/ask liczone tylko w fazie ciągłej (09:00–16:50); poza nią None (aukcje mają
    kwotowania krzyżujące się z natury). Pomijamy zlecenia PKC/PCR (limit 0).
    """
    byid: dict[int, dict] = {}
    ev: list[tuple[int, int, int]] = []  # (sec, typ: 0=ADD/1=CANCEL, id)
    for idx, r in enumerate(day_orders):
        lim = _f(r.get("Limit"))
        if lim <= 0:
            continue
        es = _sec(_time(r.get("OrderEntry Time"))) if _date(r.get("OrderEntry Time")) == day else OPEN_S
        cs = _sec(_time(r.get("CancelReplaceTime"))) if _date(r.get("CancelReplaceTime")) == day else CLOSE_S
        es = OPEN_S if es is None else es
        cs = CLOSE_S if cs is None else cs
        if cs <= es:
            cs = es + 1
        byid[idx] = {"side": r.get("K/S"), "lim": lim, "rem": _f(r.get("Wolumen"))}
        ev.append((es, 0, idx))
        ev.append((cs, 1, idx))
    ev.sort()

    book: dict[str, set] = {"K": set(), "S": set()}

    def best(side: str):
        vals = [byid[i]["lim"] for i in book[side] if byid[i]["rem"] > 0]
        if not vals:
            return None
        return max(vals) if side == "K" else min(vals)

    def match(o: dict):
        opp = "S" if o["side"] == "K" else "K"
        while o["rem"] > 0 and book[opp]:
            act = [byid[i] for i in book[opp] if byid[i]["rem"] > 0]
            if not act:
                break
            b = max(act, key=lambda x: x["lim"]) if opp == "K" else min(act, key=lambda x: x["lim"])
            cross = o["lim"] >= b["lim"] if o["side"] == "K" else o["lim"] <= b["lim"]
            if not cross:
                break
            q = min(o["rem"], b["rem"])
            o["rem"] -= q
            b["rem"] -= q
            if b["rem"] <= 0:
                book[opp].discard(next(i for i in book[opp] if byid[i] is b))

    step = (CLOSE_S - OPEN_S) / (N_POINTS - 1)
    grid = [OPEN_S + int(step * i) for i in range(N_POINTS)]
    bid: list = [None] * N_POINTS
    ask: list = [None] * N_POINTS
    gi = 0

    def sample_upto(t: int):
        nonlocal gi
        while gi < N_POINTS and grid[gi] <= t:
            if CONT_OPEN <= grid[gi] <= CONT_CLOSE:
                bid[gi], ask[gi] = best("K"), best("S")
            gi += 1

    for t, typ, oid in ev:
        o = byid[oid]
        if typ == 0:
            match(o)
            if o["rem"] > 0:
                book[o["side"]].add(oid)
        else:
            book["K"].discard(oid)
            book["S"].discard(oid)
        sample_upto(t)
    sample_upto(CLOSE_S)
    return bid, ask


def session_series(recs: list[dict], tx_prices: list[tuple[int, float]]) -> dict:
    """Śróddzienna rekonstrukcja aktywności arkusza dla sesji (odpowiednik wykresu wzoru).

    Z realnych zleceń GRUPY (zlecenia-warstwy realnie leżą w arkuszu do anulacji, więc
    ich obecność jest wiarygodna) — okno [wejście, koniec] × zadeklarowany wolumen. Na
    siatce czasu: SumaWolK = zgłoszony wolumen kupna Grupy, SumaWolS = sprzedaży,
    Różnica = SumaWolK − SumaWolS, oraz kurs transakcyjny (z transakcji) jako linia.

    Uwaga metodyczna: prawdziwych linii BestBid/BestAsk nie da się wiernie odtworzyć z
    arkusza UTP (jeden wiersz na zlecenie, bez momentów realizacji) — wymagałyby pełnego
    „widoku arkusza zleceń"/silnika dopasowań. Zamiast nich — realny kurs transakcyjny.
    """
    intervals = []  # (side, start_s, end_s, vol)
    for o in recs:
        vol = o["vol"]
        if vol <= 0:
            continue
        es = _sec(o["entry_t"]) if o["entry_d"] == o["day"] else OPEN_S
        cs = _sec(o["cancel_t"]) if o["cancel_d"] == o["day"] else None
        start = es if es is not None else OPEN_S
        end = cs if cs is not None else CLOSE_S
        if end <= start:
            end = min(CLOSE_S, start + 30)
        intervals.append((o["side"], start, end, vol))

    step = (CLOSE_S - OPEN_S) / (N_POINTS - 1)
    grid = [OPEN_S + int(step * i) for i in range(N_POINTS)]
    sumK = [0.0] * N_POINTS
    sumS = [0.0] * N_POINTS
    for side, s, e, vol in intervals:
        for i, t in enumerate(grid):
            if s <= t < e:
                if side == "K":
                    sumK[i] += vol
                elif side == "S":
                    sumS[i] += vol

    txs = sorted(tx_prices)
    price: list[float | None] = []
    j, last = 0, None
    for t in grid:
        while j < len(txs) and txs[j][0] <= t:
            last = txs[j][1]
            j += 1
        price.append(last)

    return {
        "times": [f"{t // 3600:02d}:{(t % 3600) // 60:02d}" for t in grid],
        "sumK": [round(x) for x in sumK],
        "sumS": [round(x) for x in sumS],
        "diff": [round(k - s) for k, s in zip(sumK, sumS)],
        "price": price,
    }


def detect_layering(
    orders: list[dict],
    transactions: list[dict],
    fragments: list[str] | None = None,
    min_cancel_vol: float = 20000.0,
    min_cancel_share: float = 0.5,
    max_orders_per_day: int = 80,
) -> dict:
    """Zwraca strukturę analizy layering/spoofing per sesja + listę dni manipulacyjnych.

    Dzień oznaczany jako manipulacyjny, gdy anulowany wolumen kupna Grupy ≥ min_cancel_vol
    ORAZ udział anulacji ≥ min_cancel_share ORAZ Grupa realizowała tego dnia sprzedaż
    (strona przeciwna). Zwraca też sekwencje zleceń do tabel dowodowych.
    """
    owner_map = build_account_owner_map(transactions)

    buy = defaultdict(lambda: {"declared": 0.0, "cancelled": 0.0, "filled": 0.0, "orders": 0, "levels": set(), "layer_orders": 0})
    sell = defaultdict(lambda: {"declared": 0.0, "exec": 0.0, "orders": 0, "exec_orders": 0})
    seq: dict[str, list[dict]] = defaultdict(list)
    ents_day: dict[str, set] = defaultdict(set)

    for r in orders:
        d = session_date(r.get("Data"))
        if not d:
            continue
        owner = owner_map.get((norm_acct(r.get("Biuro")), norm_acct(r.get("Konto"))))
        ent = canonical_group(owner, fragments)
        if not ent:
            continue  # tylko Grupa
        side = r.get("K/S")
        vol = _f(r.get("Wolumen"))
        realised = _f(r.get("Wolumen zreal."))
        limit = _f(r.get("Limit"))
        cancelled = max(0.0, vol - realised)
        entry = _time(r.get("OrderEntry Time"))
        cancel = _time(r.get("CancelReplaceTime"))
        ents_day[d].add(ent)

        if side == "K":
            b = buy[(d, ent)]
            b["declared"] += vol
            b["cancelled"] += cancelled
            b["filled"] += realised
            b["orders"] += 1
            if limit > 0:
                b["levels"].add(round(limit, 4))
            if cancelled > 0 and vol > 0:  # zlecenie-warstwa (nie weszło w całości do obrotu)
                b["layer_orders"] += 1
                seq[d].append({
                    "entity": ent, "side": "K", "entry": entry, "cancel": cancel,
                    "limit": limit, "vol": vol, "realised": realised, "cancelled": cancelled,
                    "mod": bool(r.get("OrderModificationDate")),
                    "cls": "layer" if realised == 0 else "layer_partial",
                })
        elif side == "S":
            s = sell[(d, ent)]
            s["declared"] += vol
            s["exec"] += realised
            s["orders"] += 1
            if realised > 0:
                s["exec_orders"] += 1
                seq[d].append({
                    "entity": ent, "side": "S", "entry": entry, "cancel": cancel,
                    "limit": limit, "vol": vol, "realised": realised, "cancelled": cancelled,
                    "mod": bool(r.get("OrderModificationDate")),
                    "cls": "sell_exec",
                })

    # agregacja per dzień
    days_map: dict[str, dict] = {}
    all_days = set(k[0] for k in buy) | set(k[0] for k in sell)
    for d in all_days:
        decl = sum(buy[(d, e)]["declared"] for e in ents_day[d] if (d, e) in buy)
        canc = sum(buy[(d, e)]["cancelled"] for e in ents_day[d] if (d, e) in buy)
        norders = sum(buy[(d, e)]["orders"] for e in ents_day[d] if (d, e) in buy)
        nlayer = sum(buy[(d, e)]["layer_orders"] for e in ents_day[d] if (d, e) in buy)
        levels = set()
        for e in ents_day[d]:
            if (d, e) in buy:
                levels |= buy[(d, e)]["levels"]
        sexec = sum(sell[(d, e)]["exec"] for e in ents_day[d] if (d, e) in sell)
        sorders = sum(sell[(d, e)]["exec_orders"] for e in ents_day[d] if (d, e) in sell)
        ratio = canc / decl if decl else 0.0
        ents = sorted({e for e in ents_day[d] if (d, e) in buy and buy[(d, e)]["layer_orders"] > 0})
        lv = sorted(levels)
        manip = canc >= min_cancel_vol and ratio >= min_cancel_share and sexec > 0 and nlayer >= 2
        rows = sorted(seq[d], key=lambda x: (x["entry"] or "99", x["side"]))[:max_orders_per_day]
        days_map[d] = {
            "day": d,
            "declared_buy": round(decl),
            "cancelled_buy": round(canc),
            "cancel_ratio": round(ratio, 4),
            "buy_orders": norders,
            "layer_orders": nlayer,
            "price_levels": len(lv),
            "price_min": lv[0] if lv else None,
            "price_max": lv[-1] if lv else None,
            "sell_exec_vol": round(sexec),
            "sell_exec_orders": sorders,
            "entities": ents,
            "manip": manip,
            "orders": rows,
        }

    days = sorted(days_map.values(), key=lambda x: x["day"])
    manip_days = [d["day"] for d in sorted(days_map.values(), key=lambda x: -x["cancelled_buy"]) if d["manip"]]
    entities = sorted({e for d in days for e in d["entities"]})

    # Szereg czasowy (rekonstrukcja arkusza z WSZYSTKICH zleceń) dla najsilniejszych sesji.
    top_days = [d["day"] for d in sorted((x for x in days_map.values() if x["manip"]), key=lambda x: -x["cancelled_buy"])[:12]]
    if top_days:
        wanted = set(top_days)
        # kurs transakcyjny per dzień (z transakcji, po czasie)
        px: dict[str, list[tuple[int, float]]] = defaultdict(list)
        for t in transactions:
            d = session_date(t.get("DATA_SESJI"))
            if d not in wanted:
                continue
            sec = _sec(_tx_time_col(t))
            pr = t.get("KURS")
            if sec is None or not pr:
                continue
            try:
                px[d].append((sec, float(pr)))
            except (TypeError, ValueError):
                continue
        # zlecenia GRUPY (obszary SumaWolK/S) oraz WSZYSTKIE zlecenia rynku (matching engine → BestBid/BestAsk)
        recs: dict[str, list[dict]] = defaultdict(list)
        all_day: dict[str, list[dict]] = defaultdict(list)
        for r in orders:
            d = session_date(r.get("Data"))
            if d not in wanted:
                continue
            all_day[d].append(r)  # matching engine potrzebuje CAŁEGO rynku
            owner = owner_map.get((norm_acct(r.get("Biuro")), norm_acct(r.get("Konto"))))
            if not canonical_group(owner, fragments):
                continue
            recs[d].append({
                "day": d, "side": r.get("K/S"), "vol": _f(r.get("Wolumen")),
                "entry_d": _date(r.get("OrderEntry Time")), "entry_t": _time(r.get("OrderEntry Time")),
                "cancel_d": _date(r.get("CancelReplaceTime")), "cancel_t": _time(r.get("CancelReplaceTime")),
            })
        for d in top_days:
            s = session_series(recs[d], px.get(d, []))
            bid, ask = reconstruct_book(all_day[d], d)  # prawdziwe BestBid/BestAsk z arkusza
            s["bid"], s["ask"] = bid, ask
            days_map[d]["series"] = s
    return {
        "days": days,
        "manip_days": manip_days,
        "entities": entities,
        "totals": {
            "sessions_flagged": len(manip_days),
            "cancelled_buy_total": round(sum(d["cancelled_buy"] for d in days if d["manip"])),
            "declared_buy_total": round(sum(d["declared_buy"] for d in days if d["manip"])),
            "sell_exec_total": round(sum(d["sell_exec_vol"] for d in days if d["manip"])),
            "layer_orders_total": sum(d["layer_orders"] for d in days if d["manip"]),
        },
        "params": {"min_cancel_vol": min_cancel_vol, "min_cancel_share": min_cancel_share},
    }
