"""Wspólne fixture: dane UTP HubTech ładowane raz na sesję testową."""
import pytest

from engine import settings
from engine.identity import build_account_owner_map
from engine.loader import load_rows


@pytest.fixture(scope="session")
def _utp_file():
    """Ścieżka do pliku dowodowego — z czytelnym POMINIĘCIEM, gdy kopii lokalnej brak.

    Bez tego brak jednego pliku daje 8 błędów fixture i wygląda jak regresja kodu
    (tak było 31.07.2026, gdy plik zniknął przy sprzątaniu ~/Downloads).
    Pominięcie z instrukcją odróżnia „nie ma czym testować" od „test nie przechodzi".
    """
    p = settings.HUBTECH_UTP_FILE
    if not p.exists():
        pytest.skip(
            f"Brak pliku dowodowego HubTech: {p}\n"
            f"Odtwórz z Supabase Storage:  python3 scripts/fetch_fixture.py\n"
            f"albo wskaż własną kopię:     HUBTECH_UTP_FILE=/ścieżka/plik.xlsx python3 -m pytest"
        )
    return p


@pytest.fixture(scope="session")
def transactions(_utp_file):
    return load_rows(_utp_file, settings.SHEET_TRANSACTIONS)


@pytest.fixture(scope="session")
def orders(_utp_file):
    return load_rows(_utp_file, settings.SHEET_ORDERS)


@pytest.fixture(scope="session")
def owner_map(transactions):
    return build_account_owner_map(transactions)
