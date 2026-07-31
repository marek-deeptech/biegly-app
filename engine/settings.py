"""Konfiguracja ścieżek i stałych domenowych silnika.

Na tym etapie wskazujemy lokalny plik dowodowy HubTech jako fixture walidacyjny.
Docelowo dane wejściowe będą wgrywane przez aplikację i trzymane w chmurze UE.
"""
import os
from pathlib import Path

# --- Dane wejściowe (lokalny fixture walidacyjny) ---------------------------
# Kolejność szukania jest celowa. Fixture NIE może zależeć od ~/Downloads: to
# katalog roboczy, który bywa sprzątany przy odzyskiwaniu miejsca na dysku —
# i raz już tak zniknął, wywracając cały golden suite (31.07.2026).
# Kanoniczne miejsce to `.fixtures/` w repo (gitignore, odtwarzalne ze Storage
# przez `scripts/fetch_fixture.py`); ścieżka w Downloads została jako fallback
# dla istniejących kopii roboczych.
_REPO = Path(__file__).resolve().parent.parent

HUBTECH_FIXTURE = _REPO / ".fixtures" / "hubtech_utp_prok.xlsx"

_HUBTECH_KANDYDACI = [
    HUBTECH_FIXTURE,
    Path(
        "/Users/marekmielnicki/Downloads/HUBTECH/"
        "2024.12.19_Załączniki_Uzupełnienie zawiadomienia HubTech RP I Ds.4.2019/"
        "Transakcje_i_Zlecenia_HUBTech 2020 prok.xlsx"
    ),
]

# Jawnie podana ścieżka obowiązuje BEZWZGLĘDNIE — także gdy pliku nie ma. Cichy zjazd
# na inną kopię przy literówce w zmiennej dałby wynik policzony z nie tego pliku,
# co użytkownik wskazał; w opinii dowodowej to niedopuszczalne. Fallback dotyczy
# wyłącznie wyboru domyślnego.
_JAWNA = os.environ.get("HUBTECH_UTP_FILE")
HUBTECH_UTP_FILE = (
    Path(_JAWNA)
    if _JAWNA
    else next((p for p in _HUBTECH_KANDYDACI if p.exists()), HUBTECH_FIXTURE)
)

# Nazwy arkuszy w pliku UTP (uwaga: arkusz zleceń ma wiodącą spację w oryginale).
SHEET_TRANSACTIONS = "Transakcje"
SHEET_ORDERS = "Zlecenia BO"

# --- Definicja "Grupy" -------------------------------------------------------
# Fragmenty nazw beneficjentów rzeczywistych z postanowienia RP I Ds 4.2019.
# Dopasowanie jest świadomie po fragmencie nazwy, bo ten sam beneficjent
# występuje też w wariancie powierniczym, np. "Bank Pekao S.A. (PL) | Joyfix Ltd (CY)".
GROUP_FRAGMENTS = [
    "joyfix", "lausewleo", "holderstar", "tonbo", "lauren", "texolla",
    "texla", "latnodo", "centurion", "centiram", "janali", "ragnar",
]

# Dni sesyjne objęte postanowieniem (ISO).
SESSION_DAYS = [
    "2020-09-09", "2020-09-10", "2020-09-11", "2020-09-14", "2020-09-15",
    "2020-09-16", "2020-09-17", "2020-09-18",
    "2020-10-08", "2020-10-09", "2020-10-13", "2020-10-21",
]
