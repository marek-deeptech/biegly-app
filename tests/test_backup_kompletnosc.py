"""Kopia zapasowa musi obejmować KAŻDĄ tabelę utworzoną migracją.

DLACZEGO TEN TEST ISTNIEJE
`wiedza` i `wiedza_zrodla` powstały migracją 0009 i przez trzy tygodnie były poza
kopią zapasową — 2479 fragmentów literatury i aktów prawnych, których odtworzenie
wymaga oryginalnych plików i kilku godzin pracy. Nikt tego nie zauważył, bo backup
kończył się komunikatem „✓" i podawał liczbę tabel, a nie to, których brakuje.
Lista w skrypcie jest ręczna, więc rozjeżdża się przy każdej nowej migracji —
ten test jest jedynym miejscem, które to wychwyci.
"""
import pathlib
import re

REPO = pathlib.Path(__file__).resolve().parent.parent


def _tabele_z_migracji() -> set[str]:
    out: set[str] = set()
    for plik in sorted((REPO / "supabase" / "migrations").glob("*.sql")):
        for m in re.finditer(r"create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_]+)",
                             plik.read_text(encoding="utf8"), re.I):
            out.add(m.group(1))
    return out


def _tabele_w_backupie() -> set[str]:
    tekst = (REPO / "scripts" / "backup.py").read_text(encoding="utf8")
    blok = re.search(r"TABELE\s*=\s*\[(.*?)\]", tekst, re.S)
    assert blok, "nie znaleziono listy TABELE w scripts/backup.py"
    return set(re.findall(r'"([a-z_]+)"', blok.group(1)))


def test_backup_obejmuje_wszystkie_tabele_z_migracji():
    z_migracji = _tabele_z_migracji()
    assert z_migracji, "nie wykryto żadnej tabeli w migracjach — sprawdź wzorzec"
    poza = sorted(z_migracji - _tabele_w_backupie())
    assert not poza, (
        f"Tabele poza kopią zapasową: {', '.join(poza)}. "
        f"Dopisz je do TABELE w scripts/backup.py — inaczej ich zawartość istnieje "
        f"wyłącznie w Supabase."
    )


def test_pliki_spoza_documents_maja_swoje_zrodlo():
    # Kopia chodzi po wierszach `documents`; tabele trzymające własne `storage_path`
    # muszą być wymienione osobno, inaczej mają zrzut bazy bez plików.
    tekst = (REPO / "scripts" / "backup.py").read_text(encoding="utf8")
    blok = re.search(r"TABELE_Z_PLIKAMI\s*=\s*\[(.*?)\]", tekst, re.S)
    assert blok, "brak listy TABELE_Z_PLIKAMI"
    assert "wiedza_zrodla" in blok.group(1)
