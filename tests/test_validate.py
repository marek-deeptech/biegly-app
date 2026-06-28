"""Regresja walidatora wejścia (QA #1) na danych HubTech.

Akta prokuratury w HubTech są kompletne i spójne — walidator nie powinien
zgłaszać żadnych błędów (ERROR). Ostrzeżenia (WARN, np. 2 ISIN-y) są dozwolone.
"""
from engine.settings import HUBTECH_UTP_FILE
from validate.checks import ERROR, check_files, check_utp


def test_files_no_errors():
    errors = [f for f in check_files(HUBTECH_UTP_FILE.parent) if f.severity == ERROR]
    assert errors == []


def test_utp_no_errors():
    errors = [f for f in check_utp(HUBTECH_UTP_FILE) if f.severity == ERROR]
    assert errors == []
