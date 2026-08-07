"""Adapter zestawienia zleceń KNF → silnik layering/spoofing.

Format KNF (ZASTAL, zał. 5 do zawiadomienia: „5. Zestawienie zleceń giełdowych podmiotów
Grupy") różni się od arkusza UTP „Zlecenia BO": inne nazwy kolumn, właściciel wprost przy
zleceniu, BRAK czasu anulacji. Testy pilnują mapowania i tego, że detektor liczy z niego
te same wielkości co z UTP.
"""
import io

import openpyxl

from engine.loader import load_knf_orders
from engine.spoofing import detect_layering

CSY, RSY = "PLCSYSA00016", "PLRSYSA00014"
HDR = ["Rodzaj zlecenia", "Data złożenia", "ISIN", "Wolumen", "Limit", "Właściciel",
       "Realizacja", "WUJ", "Nr zlecenia", "Nr rachunku", "DM", "Inne", "Mod / Anulata"]


def _xlsx(rows: list[list]) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Arkusz1"
    ws.append(HDR)
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# 3 zlecenia kupna-warstwy (anulowane w całości/części) + sprzedaż zrealizowana tego dnia,
# oraz zlecenie na obcym instrumencie (musi zostać odfiltrowane przez `isins`).
ROWS = [
    ["K", "2019-03-29 09:15:00", CSY, 30000, 7.30, "Zalewski Konrad", 0, None, 1, "19002403", "914", None, None],
    ["K", "2019-03-29 09:20:00", CSY, 20000, 7.20, "Wieczorek Konrad", 5000, None, 2, "84217301", "902", None, None],
    ["S", "2019-03-29 15:30:00", CSY, 9000, 7.50, "Omegia", 9000, None, 3, "19002472", "914", None, None],
    ["K", "2019-03-29 10:00:00", "PLYLWHT00012", 99999, 1.00, "Zalewski Konrad", 0, None, 4, "19002403", "914", None, None],
    # zdarzenia: osobne wiersze powiązane z pierwotnym zleceniem przez „Nr zlecenia"
    ["Anulata K", "2019-03-29 16:50:22", CSY, 30000, 7.30, "Zalewski Konrad", 0, None, 1, "19002403", "914", None, None],
    ["Modyfikacja K", "2019-03-29 09:45:00", CSY, 20000, 7.20, "Wieczorek Konrad", 0, None, 2, "84217301", "902", None, None],
]


def test_adapter_maps_columns_and_filters_isin():
    orders, owner_map = load_knf_orders(_xlsx(ROWS), [CSY, RSY])
    assert len(orders) == 3, "zlecenie spoza CSY/RSY odfiltrowane; wiersze zdarzeń nie tworzą duplikatów"
    o = orders[0]
    assert o["K/S"] == "K"
    assert o["Data"] == "2019-03-29"
    assert o["OrderEntry Time"] == "2019-03-29 09:15:00"
    assert o["Wolumen"] == 30000 and o["Wolumen zreal."] == 0 and o["Limit"] == 7.30
    assert o["Biuro"] == "914" and o["Konto"] == "19002403"
    # owner_map budowana wprost z kolumny Właściciel (klucze znormalizowane jak w silniku)
    assert owner_map[("914", "19002403")] == "Zalewski Konrad"
    assert owner_map[("902", "84217301")] == "Wieczorek Konrad"


def test_cancel_and_modify_events_merged_into_order():
    """Wiersze „Anulata K"/„Modyfikacja K" niosą CZAS zdarzenia i łączą się z pierwotnym
    zleceniem przez „Nr zlecenia" — bez tego rekonstrukcja śróddzienna nie zna momentu
    wycofania zlecenia (kluczowe dla layeringu przy fixingu)."""
    orders, _ = load_knf_orders(_xlsx(ROWS), [CSY, RSY])
    by_nr = {o["Nr zlecenia"]: o for o in orders}
    assert by_nr["1"]["CancelReplaceTime"] == "2019-03-29 16:50:22"
    assert by_nr["2"]["OrderModificationDate"] == "2019-03-29 09:45:00"
    assert by_nr["3"]["CancelReplaceTime"] == "", "zlecenie bez zdarzenia zostaje puste"


def test_detector_flags_session_from_knf_orders():
    orders, owner_map = load_knf_orders(_xlsx(ROWS), [CSY, RSY])
    res = detect_layering(orders, [], ["zalewski", "wieczorek", "omegia"], owner_map=owner_map)
    day = next(d for d in res["days"] if d["day"] == "2019-03-29")
    # anulowane kupno = (30000-0) + (20000-5000) = 45 000 szt z 50 000 zadeklarowanych
    assert day["cancelled_buy"] == 45000
    assert day["declared_buy"] == 50000
    assert round(day["cancel_ratio"], 2) == 0.90
    assert day["layer_orders"] == 2
    assert day["sell_exec_vol"] == 9000
    assert day["manip"] is True, "≥20 tys. szt, ≥50% anulacji, sprzedaż po stronie przeciwnej"
    assert set(day["entities"]) == {"zalewski", "wieczorek"}


def test_owner_map_required_for_group_attribution():
    """Bez owner_map (brak arkusza transakcji) detektor nie przypisze zleceń do Grupy —
    dowód, że adapter MUSI podać mapę właścicieli."""
    orders, _ = load_knf_orders(_xlsx(ROWS), [CSY, RSY])
    res = detect_layering(orders, [], ["zalewski", "wieczorek", "omegia"])
    assert res["totals"]["sessions_flagged"] == 0


def test_examined_base_survives_zero_detection():
    """Zerowa detekcja musi nieść PODSTAWĘ badania.

    ⚠️ `totals` sumuje wyłącznie po sesjach oflagowanych, więc przy braku detekcji cały
    blok to zera. W opinii „0 szt zleceń kupna" czyta się jak „Grupa nie składała zleceń",
    podczas gdy w sprawie ZASTAL dla RSY było 279 zleceń kupna na 124 547 szt — po prostu
    żadna sesja nie spełniła łącznie kryteriów. Rozróżnienie „brak zjawiska" / „brak
    materiału" jest dla opinii rozstrzygające.
    """
    orders, owner_map = load_knf_orders(_xlsx(ROWS), [CSY, RSY])
    # Próg wyżej niż cały zadeklarowany wolumen — detekcja pusta z definicji.
    res = detect_layering(orders, [], ["zalewski", "wieczorek", "omegia"],
                          min_cancel_vol=10_000_000, owner_map=owner_map)
    assert res["totals"]["sessions_flagged"] == 0
    assert res["totals"]["declared_buy_total"] == 0, "sumy liczą się po sesjach oflagowanych"
    e = res["examined"]
    assert e["sessions"] >= 1
    assert e["declared_buy"] == 50000, "podstawa badania widzi zlecenia mimo zerowej detekcji"
    assert e["cancelled_buy"] == 45000
    assert e["layer_orders"] == 2
