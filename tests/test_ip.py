"""Testy korelacji IP (dane syntetyczne — bez pliku)."""
from engine import ip


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
