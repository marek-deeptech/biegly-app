"""Korelacja adresów IP z logowań — deterministyczny dowód „zbieżności IP" (Krok 4).

Źródło: pliki logowań `Logins_users_*.xlsx` (arkusz z kolumnami Username, IpAddress,
Date, Time). Wartości są w formacie FIX, np. `2(Username)=fortune`,
`5(IpAddress)=89.250.20.10` — wyłuskujemy część po znaku `=`.

Wynik: pary użytkowników, którzy logowali się z tych samych adresów IP. To surowa
zbieżność (dowód), nie przesądzenie o koordynacji — interpretuje biegły.
"""
from __future__ import annotations

from collections import defaultdict

import openpyxl


def _val(cell) -> str:
    """Wyłuskuje wartość z komórki FIX `tag(Nazwa)=wartość` albo zwraca surowy string."""
    if cell is None:
        return ""
    s = str(cell).strip()
    return s.split("=", 1)[1].strip() if "=" in s else s


def load_logins(file) -> list[dict]:
    """Czyta pierwszy arkusz pliku logowań jako listę dictów (nagłówek = 1. wiersz z >=3 komórkami)."""
    wb = openpyxl.load_workbook(file, read_only=True, data_only=True)
    try:
        ws = wb[wb.sheetnames[0]]
        it = ws.iter_rows(min_row=1, values_only=True)
        header = None
        for r in it:
            cells = [str(h).strip() if h is not None else "" for h in r]
            if sum(1 for c in cells if c) >= 3:
                header = cells
                break
        if not header:
            return []
        return [dict(zip(header, r)) for r in it]
    finally:
        wb.close()


def ip_correlation(rows: list[dict], max_users_per_ip: int = 8) -> dict:
    """Pary użytkowników dzielących adresy IP.

    Bierzemy tylko adresy współdzielone przez 2..`max_users_per_ip` użytkowników —
    IP użyty przez wielu (proxy/publiczny) nie jest znamienny. Zwraca pary z liczbą
    wspólnych adresów oraz statystyki zbiorcze.
    """
    ip_users: dict[str, set] = defaultdict(set)
    for r in rows:
        u = _val(r.get("Username"))
        ip = _val(r.get("IpAddress"))
        if u and ip:
            ip_users[ip].add(u)

    pairs: dict[tuple, set] = defaultdict(set)
    shared = 0
    for ip, users in ip_users.items():
        if not (2 <= len(users) <= max_users_per_ip):
            continue
        shared += 1
        us = sorted(users)
        for i in range(len(us)):
            for j in range(i + 1, len(us)):
                pairs[(us[i], us[j])].add(ip)

    out = [
        {"user_a": a, "user_b": b, "n_shared": len(ips), "shared_ips": sorted(ips)}
        for (a, b), ips in pairs.items()
    ]
    out.sort(key=lambda x: (-x["n_shared"], x["user_a"], x["user_b"]))
    return {
        "pairs": out,
        "shared_ip_count": shared,
        "ip_count": len(ip_users),
        "user_count": len({u for us in ip_users.values() for u in us}),
    }
