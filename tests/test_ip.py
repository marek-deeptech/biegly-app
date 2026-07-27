"""Testy korelacji IP (dane syntetyczne — bez pliku)."""
import io

import openpyxl

from engine import ip


def _xlsx(rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _row(user, addr):
    return {"Username": f"2(Username)={user}", "IpAddress": f"5(IpAddress)={addr}"}


def test_val_fix_and_plain():
    assert ip._val("5(IpAddress)=89.250.20.10") == "89.250.20.10"
    assert ip._val("fortune") == "fortune"
    assert ip._val(None) == ""


def test_ip_correlation_pairs():
    rows = [
        _row("alfa", "1.1.1.1"),
        _row("beta", "1.1.1.1"),
        _row("beta", "2.2.2.2"),
        _row("gamma", "2.2.2.2"),
        _row("alfa", "1.1.1.1"),  # duplikat — bez wpływu (zbiory)
    ]
    r = ip.ip_correlation(rows)
    pairs = {(p["user_a"], p["user_b"]): p["n_shared"] for p in r["pairs"]}
    assert pairs[("alfa", "beta")] == 1
    assert pairs[("beta", "gamma")] == 1
    assert r["ip_count"] == 2
    assert r["user_count"] == 3


def test_ip_correlation_skips_public_ip():
    # IP współdzielony przez > max_users_per_ip nie tworzy par.
    rows = [_row(f"u{i}", "9.9.9.9") for i in range(10)]
    r = ip.ip_correlation(rows, max_users_per_ip=8)
    assert r["pairs"] == []
    assert r["shared_ip_count"] == 0


# --- Wieloformatowy loader logowań (ZASTAL) + tożsamość z nazwy pliku ---

def test_entity_from_filename():
    assert ip.entity_from_filename("AMIDA CAPITAL_19002399_0914_logowania.xls") == "AMIDA CAPITAL"
    assert ip.entity_from_filename("0902_K.Wieczorek_84217301-logowania IP.xlsx") == "K.Wieczorek"
    assert ip.entity_from_filename("Konrad_Wieczorek_83541951_SantanderBM_logowania.txt") == "Konrad Wieczorek"
    assert ip.entity_from_filename("Montag 079952 DM BO¦ logowania.xlsx") == "Montag"
    assert ip.entity_from_filename("Starosta W³odzimierz 066256 DM BO¦ logowania.xlsx") == "Starosta Włodzimierz"


def test_load_events_epromak_columns():
    data = _xlsx([
        [None, None, "Zestawienie logowań", None, None, None, None, "19002399"],
        [None, "id_rachunku", None, "id_uzytkownika", None, "start", None, None, "stop", None, None, "ip_adr"],
        [None, "19002399", None, "563243", None, "2017-12-11 15:17:39", None, None, "", None, None, "94.254.245.15 "],
        [None, "19002399", None, "563243", None, "2018-01-03 14:44:59", None, None, "", None, None, "94.254.242.33"],
    ])
    ev = ip.load_login_events(data, "AMIDA CAPITAL_19002399_0914_logowania.xls")
    assert len(ev) == 2
    assert ev[0]["username"] == "AMIDA CAPITAL"  # tożsamość z nazwy pliku
    assert ev[0]["ipaddress"] == "94.254.245.15"  # obcięte spacje
    assert ev[0]["date"] == "2017-12-11"


def test_load_events_dmbos_report():
    data = _xlsx([
        [None, "Raport z sesji internetowych klientów"],
        [None, "Nr. rachunku", "067757"],
        ["Id. użytkownika", "Rodzaj dostępu", "Dostęp", "Data rozpoczęcia", "Data zakończenia", "Adres Ip"],
        ["340747760", "Właściciel", "N", "2018-03-26 12:30:05", "2018-03-26 12:33:33", "77.65.96.188"],
    ])
    ev = ip.load_login_events(data, "Grochocka Kalina 067757 logowania.xlsx")
    assert ev[0]["username"] == "Grochocka Kalina"
    assert ev[0]["ipaddress"] == "77.65.96.188"
    assert ev[0]["date"] == "2018-03-26"


def test_load_events_ip_od_do():
    data = _xlsx([["ip", "od", "do"], ["83.20.146.113", "2017-12-01 09:07:12", "2017-12-01 11:25:05"]])
    ev = ip.load_login_events(data, "0902_K.Wieczorek_84217301-logowania IP.xlsx")
    assert ev[0]["username"] == "K.Wieczorek"
    assert ev[0]["ipaddress"] == "83.20.146.113"
    assert ev[0]["date"] == "2017-12-01"


def test_load_events_txt_pipe():
    data = b"0000000083541951|83.20.146.113|2017-12-01 08:57:16|2017-12-01 17:00:55|WWW|\n"
    ev = ip.load_login_events(data, "Konrad_Wieczorek_83541951_SantanderBM_logowania.txt")
    assert ev[0]["username"] == "Konrad Wieczorek"
    assert ev[0]["ipaddress"] == "83.20.146.113"
    assert ev[0]["date"] == "2017-12-01"


def test_load_events_fix_username_inside():
    # Format FIX (HubTech/MLM): tożsamość jest W PLIKU, nie z nazwy.
    data = _xlsx([
        ["Username", "IpAddress", "Date"],
        ["2(Username)=fortune", "5(IpAddress)=1.2.3.4", "2020-01-01"],
        ["2(Username)=beta", "5(IpAddress)=1.2.3.4", "2020-01-02"],
    ])
    ev = ip.load_login_events(data, "Logins_users_hub.xlsx")
    assert {e["username"] for e in ev} == {"fortune", "beta"}


def test_correlation_over_mixed_files():
    a = ip.load_login_events(_xlsx([["ip", "od"], ["1.1.1.1", "2020-01-01"]]), "Zalewski logowania.xlsx")
    b = ip.load_login_events(_xlsx([["ip", "od"], ["1.1.1.1", "2020-01-02"]]), "Starosta logowania.xlsx")
    res = ip.ip_correlation(a + b)
    assert res["user_count"] == 2
    pairs = {frozenset((p["user_a"], p["user_b"])) for p in res["pairs"]}
    assert frozenset(("Zalewski", "Starosta")) in pairs
