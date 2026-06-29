"""Wczytywanie danych UTP z pliku xlsx do struktur w pamięci.

Czytamy arkusze przez nagłówki kolumn (po nazwie), nie po stałych indeksach —
dzięki temu wariacje układu kolumn nie psują silnika. Każdy wiersz zwracamy
jako dict {nazwa_kolumny: wartość}.
"""
from __future__ import annotations

from pathlib import Path

import openpyxl


def _match_sheet(wb, name: str):
    """Dopasowanie arkusza po nazwie z tolerancją.

    1) dokładna nazwa (po strip/lower),
    2) prefiks pierwszego członu nazwy docelowej — żeby obsłużyć warianty układu:
       'Transakcje' → 'Transakcje all', 'Zlecenia BO' → 'Zlecenia'.
    """
    target = name.strip().lower()
    for sheet_name in wb.sheetnames:
        if sheet_name.strip().lower() == target:
            return wb[sheet_name]
    key = target.split()[0]  # 'transakcje' / 'zlecenia'
    cands = [sn for sn in wb.sheetnames if sn.strip().lower().startswith(key)]
    if cands:
        cands.sort(key=len)  # najkrótsza nazwa = zwykle arkusz główny
        return wb[cands[0]]
    raise KeyError(f"Brak arkusza pasującego do {name!r}; dostępne: {wb.sheetnames}")


def load_rows(path: Path, sheet_name: str) -> list[dict]:
    """Zwraca listę wierszy arkusza jako dicty kluczowane nazwą kolumny.

    Nagłówek = pierwszy wiersz z co najmniej 3 niepustymi komórkami (część
    eksportów GPW ma wiodące puste wiersze nad nagłówkiem, np. arkusz 'Zlecenia').
    """
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        ws = _match_sheet(wb, sheet_name)
        rows = ws.iter_rows(min_row=1, values_only=True)
        header = None
        for r in rows:
            cells = [str(h).strip() if h is not None else "" for h in r]
            if sum(1 for c in cells if c) >= 3:
                header = cells
                break
        if header is None:
            return []
        return [dict(zip(header, r)) for r in rows]
    finally:
        wb.close()


def session_date(value) -> str:
    """Normalizuje wartość daty sesji do formatu ISO 'YYYY-MM-DD'."""
    if value is None:
        return ""
    if hasattr(value, "date"):
        return value.date().isoformat()
    return str(value)[:10]
