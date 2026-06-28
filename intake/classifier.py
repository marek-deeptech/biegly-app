"""Klasyfikator dokumentów sprawy: typ, źródło/autor, proweniencja.

Wersja deterministyczna oparta na ścieżce/nazwie pliku. To, czego reguły nie
rozpoznają, dostaje typ UNKNOWN i trafia na listę do ręcznej/AI klasyfikacji —
nie zgadujemy. Taki rozkład pracy jest zgodny z zasadą całego projektu:
deterministycznie tam, gdzie się da; osąd (LLM/człowiek) tam, gdzie trzeba.
"""
from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from pathlib import Path

from .taxonomy import DOC_TYPES, RULES

# pliki techniczne/śmieciowe pomijane w inwentarzu
SKIP_NAMES = {".ds_store"}
SKIP_PREFIXES = ("~$",)


@dataclass
class DocRecord:
    path: str          # ścieżka względna w katalogu sprawy
    size: int
    doc_type: str
    label: str
    source: str
    provenance: str


def classify_path(relpath: str) -> str:
    """Zwraca kod typu dokumentu dla ścieżki względnej (lub UNKNOWN).

    Normalizujemy do NFC, bo macOS przechowuje nazwy plików w NFD (rozłożone
    znaki diakrytyczne), przez co dosłowne dopasowanie 'ł'/'ą' by zawodziło.
    """
    low = unicodedata.normalize("NFC", relpath).lower()
    for phrases, code in RULES:
        if any(p in low for p in phrases):
            return code
    return "UNKNOWN"


def classify_directory(root: str | Path) -> list[DocRecord]:
    """Klasyfikuje wszystkie pliki w katalogu sprawy."""
    root = Path(root)
    records: list[DocRecord] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        name = path.name.lower()
        if name in SKIP_NAMES or name.startswith(SKIP_PREFIXES):
            continue
        rel = str(path.relative_to(root))
        code = classify_path(rel)
        label, source, prov = DOC_TYPES[code]
        records.append(DocRecord(rel, path.stat().st_size, code, label, source, prov))
    return records
