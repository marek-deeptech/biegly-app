"""Testy formatów TREM sparowanych obsługiwanych przez load_trem_paired:

  • IAD_C_TREM — HubTech/MLM (kupujący w kolumnie ACCTOWNR_POPRAWIONY_B),
  • 2_stronnie — ZASTAL, plik per instrument (UTP TREM CSY/RSY.xlsx; kupujący _K → _B).

Surowy MiFIR per osoba (arkusz TREM_Uproszczony) nie jest sparowany i musi zostać
odrzucony — to on wywoływał błąd „Ten plik nie zawiera arkusza 'IAD_C_TREM'".
"""
import io

import openpyxl
import pytest

from engine.analysis import compute_trem
from engine.loader import load_trem_paired

HDR_2S = ["DATA_SESJI", "WOLUMEN", "WARTOSC_TR", "ACCTOWNR_POPRAWIONY_K", "ACCTOWNR_POPRAWIONY_S"]
HDR_IAD = ["DATA_SESJI", "WOLUMEN", "WARTOSC_TR", "ACCTOWNR_POPRAWIONY_B", "ACCTOWNR_POPRAWIONY_S"]


def _xlsx(sheet_name, header, rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = sheet_name
    ws.append(header)
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_2_stronnie_aliasuje_kupujacego_K_na_B():
    data = _xlsx("2_stronnie", HDR_2S, [
        ["2019-01-02", 100, 250.0, "ZALEWSKI KONRAD", "inny podmiot"],
        ["2019-01-02", 50, 130.0, "inny podmiot", "WIECZOREK KONRAD"],
    ])
    rows = load_trem_paired(data)
    assert len(rows) == 2
    # Strona kupna (_K) zmapowana na _B, której oczekuje silnik; sprzedaż bez zmian.
    assert rows[0]["ACCTOWNR_POPRAWIONY_B"] == "ZALEWSKI KONRAD"
    assert rows[0]["ACCTOWNR_POPRAWIONY_S"] == "inny podmiot"


def test_2_stronnie_przyjmuje_bytesio():
    data = _xlsx("2_stronnie", HDR_2S, [["2019-01-02", 10, 5.0, "SROKA TOMASZ", "inny podmiot"]])
    rows = load_trem_paired(io.BytesIO(data))  # obiekt plikopodobny również działa
    assert rows[0]["ACCTOWNR_POPRAWIONY_B"] == "SROKA TOMASZ"


def test_iad_c_trem_kupujacy_B_bez_zmian():
    data = _xlsx("IAD_C_TREM", HDR_IAD, [["2020-10-13", 100, 500.0, "joyfix ltd", "inny"]])
    rows = load_trem_paired(data)
    assert rows[0]["ACCTOWNR_POPRAWIONY_B"] == "joyfix ltd"  # nie nadpisane (brak _K)


def test_surowy_mifir_odrzucony():
    data = _xlsx("TREM_Uproszczony", ["TRADDT", "STRONA", "QTYUNIT", "NETAMT", "ACCTOWNR_NM_FRSTNM"],
                 [["2018-01-04", "B", 112, 179.2, "ZALEWSKI KONRAD"]])
    with pytest.raises(KeyError):
        load_trem_paired(data)


def test_compute_trem_atrybucja_grupy_na_2_stronnie():
    data = _xlsx("2_stronnie", HDR_2S, [
        ["2019-01-02", 100, 300.0, "ZALEWSKI KONRAD", "WIECZOREK KONRAD"],  # obie strony w Grupie
        ["2019-01-02", 40, 80.0, "inny podmiot", "inny podmiot"],           # spoza Grupy
    ])
    rows = load_trem_paired(data)
    out = {m["key"]: m for m in compute_trem(rows, ["zalewski", "wieczorek"])}
    assert out["totals_transactions"]["value"] == 2
    assert out["group_turnover_value"]["value"] == 300.0
    assert out["group_turnover_share"]["value"] == round(300.0 / 380.0 * 100, 2)
