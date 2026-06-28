"""Raport walidacji wejścia (QA #1).

Uruchomienie:
    python -m validate.report "<katalog sprawy>" "<plik UTP>"
Drugi argument opcjonalny — domyślnie plik UTP HubTech z settings.
"""
from __future__ import annotations

import sys
from collections import Counter

from engine.settings import HUBTECH_UTP_FILE
from .checks import ERROR, OK, WARN, check_files, check_utp

ICON = {ERROR: "✗", WARN: "!", OK: "✓"}


def _emit(title: str, findings):
    print(f"\n— {title} —")
    for f in findings:
        print(f"  [{ICON[f.severity]} {f.severity:5s}] {f.message}")
    return Counter(f.severity for f in findings)


def run(case_dir: str, utp_file: str) -> None:
    print(f"WALIDACJA WEJŚCIA (QA #1)\nKatalog: {case_dir}\nUTP: {utp_file}")
    tally = Counter()
    tally += _emit("Integralność plików", check_files(case_dir))
    tally += _emit("Spójność danych UTP", check_utp(utp_file))
    print(f"\nPODSUMOWANIE: {tally[ERROR]} błędów · {tally[WARN]} ostrzeżeń · {tally[OK]} OK")


if __name__ == "__main__":
    case_dir = sys.argv[1] if len(sys.argv) > 1 else "."
    utp_file = sys.argv[2] if len(sys.argv) > 2 else str(HUBTECH_UTP_FILE)
    run(case_dir, utp_file)
