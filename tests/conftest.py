"""Wspólne fixture: dane UTP HubTech ładowane raz na sesję testową."""
import pytest

from engine import settings
from engine.identity import build_account_owner_map
from engine.loader import load_rows


@pytest.fixture(scope="session")
def transactions():
    return load_rows(settings.HUBTECH_UTP_FILE, settings.SHEET_TRANSACTIONS)


@pytest.fixture(scope="session")
def orders():
    return load_rows(settings.HUBTECH_UTP_FILE, settings.SHEET_ORDERS)


@pytest.fixture(scope="session")
def owner_map(transactions):
    return build_account_owner_map(transactions)
