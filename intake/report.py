"""Inwentarz dokumentów + analiza braków (checklista kanonu).

Uruchomienie:
    python -m intake.report "/ścieżka/do/katalogu/sprawy" "Nazwa sprawy"
"""
from __future__ import annotations

import sys
from collections import Counter

from .classifier import classify_directory
from .taxonomy import DOC_TYPES, RECOMMENDED, REQUIRED


def build(root: str) -> dict:
    records = classify_directory(root)
    by_type = Counter(r.doc_type for r in records)
    by_prov = Counter(r.provenance for r in records)
    present = set(by_type)
    return {
        "records": records,
        "by_type": by_type,
        "by_prov": by_prov,
        "missing_required": [c for c in REQUIRED if c not in present],
        "missing_recommended": [c for c in RECOMMENDED if c not in present],
        "unknown": [r for r in records if r.doc_type == "UNKNOWN"],
    }


def print_report(root: str, case_name: str) -> None:
    res = build(root)
    n = len(res["records"])
    known = n - len(res["unknown"])
    print(f"\n=== SPRAWA: {case_name} ===")
    print(f"plików: {n} | sklasyfikowanych: {known} ({known/n*100:.0f}%) | "
          f"WEJŚCIE: {res['by_prov'].get('wejście',0)} · WYJŚCIE: {res['by_prov'].get('wyjście',0)}")

    print("\nInwentarz wg typu:")
    for code, cnt in res["by_type"].most_common():
        label, source, prov = DOC_TYPES[code]
        print(f"  {cnt:4d}  {label}  [{prov}, {source}]")

    print("\nChecklista kanonu (dokumenty obowiązkowe):")
    for code in REQUIRED:
        ok = "OBECNY " if code not in res["missing_required"] else "BRAK ⚠ "
        print(f"  [{ok}] {DOC_TYPES[code][0]}")
    if res["missing_recommended"]:
        print("\nZalecane, a brakujące:")
        for code in res["missing_recommended"]:
            print(f"  [BRAK] {DOC_TYPES[code][0]}")

    if res["unknown"]:
        print(f"\nDo ręcznej/AI klasyfikacji ({len(res['unknown'])}):")
        for r in res["unknown"][:25]:
            print(f"  ? {r.path}")


if __name__ == "__main__":
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    name = sys.argv[2] if len(sys.argv) > 2 else root
    print_report(root, name)
