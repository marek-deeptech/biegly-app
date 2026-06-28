"""Konfiguracja ścieżek i stałych domenowych silnika.

Na tym etapie wskazujemy lokalny plik dowodowy HubTech jako fixture walidacyjny.
Docelowo dane wejściowe będą wgrywane przez aplikację i trzymane w chmurze UE.
"""
from pathlib import Path

# --- Dane wejściowe (lokalny fixture walidacyjny) ---------------------------
HUBTECH_UTP_FILE = Path(
    "/Users/marekmielnicki/Downloads/HUBTECH/"
    "2024.12.19_Załączniki_Uzupełnienie zawiadomienia HubTech RP I Ds.4.2019/"
    "Transakcje_i_Zlecenia_HUBTech 2020 prok.xlsx"
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
