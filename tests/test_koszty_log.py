"""Raport kosztów musi czytać log z OBU wrapperów.

⚠️ POWÓD ISTNIENIA: log zużycia piszą dwa wrappery w dwóch językach i każdy
zapisuje znacznik czasu inaczej — TypeScript przez `Date.toISOString()` (sufiks
„Z"), Python przez `datetime.isoformat()` („+00:00"). `datetime.fromisoformat`
do wersji 3.10 nie przyjmuje „Z" i rzuca ValueError, a pętla czytająca log łapała
wyjątek i szła do następnej linii.

Skutek był dokładnie taki, jakiemu ten raport miał zapobiegać: przy pierwszym
pełnym przebiegu opinii SKOK raport pokazał $0,90 z 14 wywołań, podczas gdy
w logu leżało 30 wywołań za $3,77. Zgubił CAŁĄ redakcję i CAŁY warsztat — czyli
trzy czwarte rachunku — i nie powiedział o tym ani słowa.
"""
import datetime as dt
import importlib.util
import json
import os

_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("koszty", os.path.join(_HERE, "scripts", "koszty.py"))
koszty = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(koszty)


def test_czyta_oba_formaty_znacznika_czasu():
    z_ts = koszty._czas("2026-08-03T20:38:00.526Z")          # Date.toISOString()
    z_py = koszty._czas("2026-08-03T20:38:00.526000+00:00")  # datetime.isoformat()
    assert z_ts.tzinfo is not None and z_py.tzinfo is not None
    assert abs((z_ts - z_py).total_seconds()) < 1


def test_zaden_wpis_nie_wypada_z_okna(tmp_path, monkeypatch):
    """Wpisy z obu wrapperów w tym samym oknie czasowym muszą trafić do raportu."""
    teraz = dt.datetime.now(dt.timezone.utc)
    wpisy = [
        {"czas": teraz.isoformat(), "etykieta": "skrypt-py", "model": "claude-opus-4-8",
         "wejscie": 1000, "wyjscie": 100, "cache_zapis": 0, "cache_odczyt": 0,
         "usd": 0.0075, "ms": 100, "zrodlo": "api", "stop_reason": "end_turn", "sprawa": None},
        {"czas": teraz.isoformat().replace("+00:00", "Z"), "etykieta": "trasa-ts",
         "model": "claude-opus-4-8", "wejscie": 2000, "wyjscie": 200, "cache_zapis": 0,
         "cache_odczyt": 0, "usd": 0.015, "ms": 100, "zrodlo": "api",
         "stop_reason": "end_turn", "sprawa": None},
    ]
    p = tmp_path / "uzycie.jsonl"
    p.write_text("\n".join(json.dumps(w) for w in wpisy) + "\n", encoding="utf8")
    monkeypatch.setattr(koszty, "PLIK_LOGU", p)

    odczytane = koszty._wczytaj_plik(teraz - dt.timedelta(days=1))
    assert len(odczytane) == 2, "raport zgubił wpis jednego z wrapperów"
    assert {w["etykieta"] for w in odczytane} == {"skrypt-py", "trasa-ts"}


def test_uszkodzona_linia_nie_kasuje_reszty(tmp_path, monkeypatch):
    """Pojedyncza zepsuta linia ma zostać pominięta, a nie wywalić cały raport."""
    teraz = dt.datetime.now(dt.timezone.utc)
    dobry = json.dumps({"czas": teraz.isoformat(), "etykieta": "ok", "model": "claude-opus-4-8",
                        "wejscie": 1, "wyjscie": 1, "usd": 0.1, "ms": 1, "zrodlo": "api"})
    p = tmp_path / "uzycie.jsonl"
    p.write_text(f"{{niepoprawny json\n{dobry}\n", encoding="utf8")
    monkeypatch.setattr(koszty, "PLIK_LOGU", p)
    assert len(koszty._wczytaj_plik(teraz - dt.timedelta(days=1))) == 1
