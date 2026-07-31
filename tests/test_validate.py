"""Regresja walidatora wejścia (QA #1).

Dwie warstwy, celowo rozdzielone:

1. Na realnym pliku dowodowym HubTech — akta prokuratury są kompletne i spójne,
   więc walidator nie może zgłaszać błędów (ERROR). Ostrzeżenia (WARN, np. 2 ISIN-y)
   są dozwolone. Ta warstwa pomija się, gdy lokalnej kopii pliku brak.

2. Na plikach syntetycznych — sprawdza, że walidator faktycznie WYKRYWA uszkodzenia.
   Sam warunek „na dobrych danych brak błędów" spełniałby też walidator, który nie
   wykrywa niczego; ta warstwa domyka drugi kierunek i nie zależy od żadnych danych
   zewnętrznych, więc działa nawet bez akt na dysku.
"""
import openpyxl

from validate.checks import ERROR, WARN, check_files, check_utp


def test_files_no_errors(_utp_file):
    errors = [f for f in check_files(_utp_file.parent) if f.severity == ERROR]
    assert errors == []


def test_utp_no_errors(_utp_file):
    errors = [f for f in check_utp(_utp_file) if f.severity == ERROR]
    assert errors == []


def test_files_wykrywa_uszkodzenia(tmp_path):
    """Pusty plik, uszkodzony xlsx i ucięty PDF muszą zostać zgłoszone."""
    (tmp_path / "pusty.xlsx").write_bytes(b"")
    (tmp_path / "uszkodzony.xlsx").write_bytes(b"to nie jest archiwum zip")
    (tmp_path / "uciety.pdf").write_bytes(b"%PDF-1.7\n1 0 obj\n")  # bez %%EOF

    # plik zdrowy — żeby sprawdzić, że walidator nie alarmuje hurtem.
    # Musi być PRAWDZIWYM skoroszytem: ręcznie sklejony zip z samym
    # [Content_Types].xml nie przechodzi kontroli integralności (i słusznie).
    dobry = tmp_path / "dobry.xlsx"
    openpyxl.Workbook().save(dobry)

    ustalenia = check_files(tmp_path)
    kody = {f.check: f for f in ustalenia}

    assert kody["plik-pusty"].severity == ERROR
    assert "pusty.xlsx" in kody["plik-pusty"].message
    assert kody["xlsx-uszkodzony"].severity == ERROR
    assert "uszkodzony.xlsx" in kody["xlsx-uszkodzony"].message
    assert kody["pdf-uciety"].severity == WARN

    # zdrowy plik nie może trafić do żadnego z błędów
    assert all("dobry.xlsx" not in f.message for f in ustalenia if f.severity == ERROR)


def test_utp_zglasza_blad_gdy_plik_nieczytelny(tmp_path):
    """Nieczytelny arkusz to ERROR z kodem `utp-odczyt`, nie wyjątek."""
    zly = tmp_path / "nie-xlsx.xlsx"
    zly.write_bytes(b"losowe bajty")
    ustalenia = check_utp(zly)
    assert [f.check for f in ustalenia if f.severity == ERROR] == ["utp-odczyt"]
