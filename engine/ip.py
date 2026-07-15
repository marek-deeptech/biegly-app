"""Korelacja adresów IP z logowań — deterministyczny dowód „zbieżności IP" (Krok 4).

Źródło: pliki logowań `Logins_users_*.xlsx` (arkusz z kolumnami Username, IpAddress,
Date, Time). Wartości są w formacie FIX, np. `2(Username)=fortune`,
`5(IpAddress)=89.250.20.10` — wyłuskujemy część po znaku `=`.

Wynik: pary użytkowników, którzy logowali się z tych samych adresów IP. To surowa
zbieżność (dowód), nie przesądzenie o koordynacji — interpretuje biegły.
"""
from __future__ import annotations

import re
from collections import defaultdict

import openpyxl

# Wartości w formacie FIX: `tag(Nazwa)=wartość`, np. `2(Username)=fortune`.
_FIX = re.compile(r"^\s*\d+\(([^)]+)\)=(.*)$", re.S)


def _val(cell) -> str:
    """Wyłuskuje wartość z komórki FIX `tag(Nazwa)=wartość` albo zwraca surowy string."""
    if cell is None:
        return ""
    s = str(cell).strip()
    return s.split("=", 1)[1].strip() if "=" in s else s


def _fields(row: dict) -> dict[str, str]:
    """Mapuje wiersz na {nazwa_pola (małe litery): wartość}.

    Preferuje nazwę pola ze znacznika FIX zawartego w treści komórki
    (`(Username)`, `(IpAddress)`) — dzięki temu działa niezależnie od etykiety
    nagłówka kolumny (w części plików „User”, w innych „Username”). Gdy komórka
    nie jest w formacie FIX, kluczem jest nazwa z nagłówka.
    """
    out: dict[str, str] = {}
    for header, cell in row.items():
        if cell is None:
            continue
        s = str(cell).strip()
        m = _FIX.match(s)
        if m:
            out[m.group(1).strip().lower()] = m.group(2).strip()
        elif header:
            out[str(header).strip().lower()] = s
    return out


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


def _iso_date(raw: str) -> str | None:
    """Normalizuje datę logowania do ISO YYYY-MM-DD (tolerancyjnie: ISO, DD.MM.YYYY,
    DD-MM-YYYY, DD/MM/YYYY, 'YYYY-MM-DD hh:mm:ss'). Nieczytelna → None."""
    s = (raw or "").strip().split(" ")[0].split("T")[0]
    if not s:
        return None
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", s)
    if m:
        return s
    m = re.match(r"^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$", s)
    if m:
        return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
    return None


def ip_correlation(rows: list[dict], max_users_per_ip: int = 8) -> dict:
    """Pary użytkowników dzielących adresy IP + zdarzenia logowań ze wspólnych IP.

    Bierzemy tylko adresy współdzielone przez 2..`max_users_per_ip` użytkowników —
    IP użyty przez wielu (proxy/publiczny) nie jest znamienny. Zwraca pary z liczbą
    wspólnych adresów, statystyki zbiorcze oraz `events` — unikalne (data, IP,
    użytkownik) WYŁĄCZNIE dla wspólnych adresów (materiał wykresu „data × IP"
    w formie jak wykres nr 6 analizy specjalisty: nałożenie symboli = wspólne IP).
    """
    ip_users: dict[str, set] = defaultdict(set)
    ip_user_dates: dict[tuple, set] = defaultdict(set)
    for r in rows:
        f = _fields(r)
        u = f.get("username") or f.get("user") or f.get("login")
        ip = f.get("ipaddress") or f.get("ip") or f.get("ipaddr") or f.get("adres ip")
        if not (u and ip):
            continue
        ip_users[ip].add(u)
        d = _iso_date(f.get("date") or f.get("data") or "")
        if d:
            ip_user_dates[(ip, u)].add(d)

    pairs: dict[tuple, set] = defaultdict(set)
    shared_ips: list[str] = []
    for ip, users in ip_users.items():
        if not (2 <= len(users) <= max_users_per_ip):
            continue
        shared_ips.append(ip)
        us = sorted(users)
        for i in range(len(us)):
            for j in range(i + 1, len(us)):
                pairs[(us[i], us[j])].add(ip)

    out = [
        {"user_a": a, "user_b": b, "n_shared": len(ips), "shared_ips": sorted(ips)}
        for (a, b), ips in pairs.items()
    ]
    out.sort(key=lambda x: (-x["n_shared"], x["user_a"], x["user_b"]))

    shared_set = set(shared_ips)
    events = [
        {"date": d, "ip": ip, "user": u}
        for (ip, u), dates in ip_user_dates.items()
        if ip in shared_set
        for d in dates
    ]
    events.sort(key=lambda e: (e["date"], e["ip"], e["user"]))
    return {
        "pairs": out,
        "events": events,
        "shared_ip_count": len(shared_ips),
        "ip_count": len(ip_users),
        "user_count": len({u for us in ip_users.values() for u in us}),
    }
