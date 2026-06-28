"""Walidacja materiału wejściowego (QA #1).

Dwie warstwy:
1. Integralność plików — czy się otwierają, czy nie są ucięte/zerowe.
2. Spójność danych UTP — kompletność sesji, "dziury", błędy liczbowe/logiczne.

Wszystko deterministyczne. Każdy problem to Finding o severity ERROR/WARN,
a potwierdzenia poprawności raportujemy jako OK — żeby raport czytał się jak
arkusz kontroli, a nie tylko lista usterek.
"""
from __future__ import annotations

import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path

from engine.identity import build_account_owner_map, norm_acct
from engine.loader import load_rows, session_date
from engine.settings import SESSION_DAYS, SHEET_ORDERS, SHEET_TRANSACTIONS

ERROR, WARN, OK = "ERROR", "WARN", "OK"


@dataclass
class Finding:
    severity: str
    check: str
    message: str


# --------------------------------------------------------------------------
# 1. Integralność plików
# --------------------------------------------------------------------------
def _pdf_intact(path: Path) -> bool:
    """Heurystyka ucięcia PDF: nagłówek %PDF i znacznik %%EOF w ogonie."""
    with open(path, "rb") as f:
        head = f.read(8)
        f.seek(max(0, path.stat().st_size - 2048))
        tail = f.read()
    return head.startswith(b"%PDF") and b"%%EOF" in tail


def _xlsx_intact(path: Path) -> bool:
    """xlsx/xlsm to ZIP — musi być poprawnym archiwum z workbookiem."""
    if not zipfile.is_zipfile(path):
        return False
    try:
        with zipfile.ZipFile(path) as z:
            return "xl/workbook.xml" in z.namelist()
    except zipfile.BadZipFile:
        return False


def check_files(root: str | Path) -> list[Finding]:
    root = Path(root)
    out: list[Finding] = []
    n_ok = 0
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.name.startswith("~$") or path.name == ".DS_Store":
            continue
        rel = str(path.relative_to(root))
        # Pomijamy artefakty zapisanych stron WWW (foldery "*_files/") — to nie dowody.
        if "_files/" in rel.replace("\\", "/"):
            continue
        try:
            size = path.stat().st_size
            if size == 0:
                out.append(Finding(ERROR, "plik-pusty", f"{rel}: plik 0 bajtów"))
                continue
            ext = path.suffix.lower()
            if ext == ".pdf" and not _pdf_intact(path):
                out.append(Finding(WARN, "pdf-uciety", f"{rel}: PDF bez %%EOF (możliwe ucięcie)"))
            elif ext in (".xlsx", ".xlsm") and not _xlsx_intact(path):
                out.append(Finding(ERROR, "xlsx-uszkodzony", f"{rel}: niepoprawne archiwum xlsx"))
            else:
                n_ok += 1
        except OSError as e:
            out.append(Finding(ERROR, "plik-nieczytelny", f"{rel}: {e}"))
    out.insert(0, Finding(OK, "integralność-plików",
                          f"{n_ok} plików przeszło kontrolę integralności"))
    return out


# --------------------------------------------------------------------------
# 2. Spójność danych UTP
# --------------------------------------------------------------------------
def check_utp(path: str | Path) -> list[Finding]:
    out: list[Finding] = []
    try:
        tr = load_rows(path, SHEET_TRANSACTIONS)
        zo = load_rows(path, SHEET_ORDERS)
    except (KeyError, OSError, zipfile.BadZipFile) as e:
        return [Finding(ERROR, "utp-odczyt", f"Nie można wczytać danych UTP: {e}")]

    # --- ISIN / symbole ---
    syms = {r.get("SYMBOL") for r in tr if r.get("SYMBOL")}
    if len(syms) > 1:
        out.append(Finding(WARN, "utp-wiele-isin",
                           f"W danych występuje {len(syms)} symboli: {sorted(syms)} "
                           f"— analiza wymaga filtrowania po ISIN"))

    # --- kompletność sesji wg postanowienia ---
    present_days = {session_date(r.get("DATA_SESJI")) for r in tr}
    missing = [d for d in SESSION_DAYS if d not in present_days]
    extra = sorted(present_days - set(SESSION_DAYS))
    if missing:
        out.append(Finding(ERROR, "utp-brak-sesji",
                           f"Brak {len(missing)} dni sesyjnych z postanowienia: {missing}"))
    else:
        out.append(Finding(OK, "utp-komplet-sesji",
                           f"Wszystkie {len(SESSION_DAYS)} dni sesyjne obecne w danych"))
    if extra:
        out.append(Finding(WARN, "utp-dni-dodatkowe",
                           f"Dni spoza postanowienia w danych: {extra}"))

    # --- dziury w polach krytycznych (transakcje) ---
    tr_nulls = sum(1 for r in tr if not r.get("DATA_SESJI") or r.get("WOLUMEN") in (None, "")
                   or r.get("KURS") in (None, "") or not r.get("ACCTOWNR_POPRAWIONY_B")
                   or not r.get("ACCTOWNR_POPRAWIONY_S"))
    sev = ERROR if tr_nulls else OK
    out.append(Finding(sev, "utp-pola-krytyczne",
                       f"Transakcje z brakami w polach krytycznych: {tr_nulls} / {len(tr)}"))

    # --- spójność liczbowa: WARTOSC_TR == KURS * WOLUMEN ---
    bad_val = []
    for r in tr:
        k, v, w = r.get("KURS"), r.get("WARTOSC_TR"), r.get("WOLUMEN")
        if None in (k, v, w):
            continue
        expected = round(k * w, 2)
        if abs(v - expected) > max(0.02, abs(v) * 0.0005):
            bad_val.append((r.get("DATA_SESJI"), k, w, v, expected))
    if bad_val:
        ex = bad_val[0]
        out.append(Finding(WARN, "utp-wartosc-niespojna",
                           f"{len(bad_val)} transakcji: WARTOSC_TR ≠ KURS×WOLUMEN "
                           f"(np. {ex[1]}×{ex[2]}={ex[4]}, a w danych {ex[3]})"))
    else:
        out.append(Finding(OK, "utp-wartosc-spojna",
                           "WARTOSC_TR = KURS × WOLUMEN we wszystkich transakcjach"))

    # --- wartości niedozwolone ---
    nonpos = sum(1 for r in tr if (r.get("WOLUMEN") or 0) <= 0 or (r.get("KURS") or 0) <= 0)
    if nonpos:
        out.append(Finding(WARN, "utp-wartosci-niedozwolone",
                           f"Transakcje z wolumenem/kursem ≤ 0: {nonpos}"))

    # --- zlecenia: realizacja > deklaracja (niemożliwe) ---
    over = sum(1 for r in zo if (r.get("Wolumen zreal.") or 0) > (r.get("Wolumen") or 0))
    sev = ERROR if over else OK
    out.append(Finding(sev, "utp-realizacja",
                       f"Zlecenia z wolumenem zrealizowanym > zadeklarowanym: {over}"))

    # --- pokrycie mapowania konto→beneficjent (dziury w identyfikacji) ---
    owner_map = build_account_owner_map(tr)
    unmapped = defaultdict(int)
    for r in zo:
        key = (norm_acct(r.get("Biuro")), norm_acct(r.get("Konto")))
        if key not in owner_map:
            unmapped[session_date(r.get("Data"))] += 1
    total_unmapped = sum(unmapped.values())
    if total_unmapped:
        worst = sorted(unmapped.items(), key=lambda x: -x[1])[:3]
        out.append(Finding(WARN, "utp-mapowanie-luki",
                           f"Zleceń bez powiązania z beneficjentem: {total_unmapped} "
                           f"(najwięcej: {worst})"))
    else:
        out.append(Finding(OK, "utp-mapowanie-pelne",
                           f"100% zleceń ({len(zo)}) zmapowanych do beneficjenta"))

    return out
