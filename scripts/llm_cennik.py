#!/usr/bin/env python3
"""Cennik modeli — bliźniaczy do lib/llm/cennik.ts.

POWÓD ISTNIENIA: wpis w logu zużycia ma nieść kwotę, a nie same tokeny. Liczba
tokenów nie odpowiada na pytanie „który krok pali budżet": 100 tys. tokenów wyjścia
Opusa kosztuje 25× tyle, co 100 tys. tokenów wejścia Haiku.

ŹRÓDŁO: platform.claude.com/docs/en/about-claude/models/overview + /pricing.
Migawka z 2026-06-24.

⚠️ ZGODNOŚĆ Z TS: tests/test_cennik_llm.py porównuje tę tablicę z lib/llm/cennik.ts
co do grosza. Rozjazd znaczyłby, że raport ze skryptów i raport z aplikacji podają
różne kwoty za to samo wywołanie — czyli że jednemu z nich nie można wierzyć.
"""
from __future__ import annotations

import datetime as _dt
import re as _re

# Cena za MILION tokenów, w dolarach. `promocja` obowiązuje DO podanej daty włącznie.
CENNIK: dict[str, dict] = {
    "claude-fable-5": {"wejscie": 10.0, "wyjscie": 50.0},
    "claude-mythos-5": {"wejscie": 10.0, "wyjscie": 50.0},
    "claude-opus-4-8": {"wejscie": 5.0, "wyjscie": 25.0},
    "claude-opus-4-7": {"wejscie": 5.0, "wyjscie": 25.0},
    "claude-opus-4-6": {"wejscie": 5.0, "wyjscie": 25.0},
    "claude-sonnet-5": {
        "wejscie": 3.0,
        "wyjscie": 15.0,
        "promocja": {"wejscie": 2.0, "wyjscie": 10.0, "do": "2026-08-31"},
    },
    "claude-sonnet-4-6": {"wejscie": 3.0, "wyjscie": 15.0},
    "claude-haiku-4-5": {"wejscie": 1.0, "wyjscie": 5.0},
}

# Mnożniki od ceny WEJŚCIA. Odczyt z cache'u to dziesiąta część, zapis 1,25× (TTL 5 min)
# albo 2× (TTL 1 h) — dlatego cache prompta zwraca się dopiero od drugiego zapytania.
MNOZNIK = {"odczyt_cache": 0.1, "zapis_cache_5m": 1.25, "zapis_cache_1h": 2.0}

# Batch API: 50% od CAŁEGO rachunku (wejście i wyjście), nie mnożnik wejścia.
RABAT_BATCH = 0.5

# Minimalny prefiks, od którego cache prompta w ogóle się zakłada — w tokenach.
# Poniżej progu `cache_control` NIE zgłasza błędu, tylko po cichu nic nie robi.
MIN_PREFIKS_CACHE = {
    "claude-opus-4-8": 4096,
    "claude-opus-4-7": 4096,
    "claude-opus-4-6": 4096,
    "claude-haiku-4-5": 4096,
    "claude-fable-5": 2048,
    "claude-mythos-5": 2048,
    "claude-sonnet-5": 2048,
    "claude-sonnet-4-6": 2048,
}


def alias_modelu(model: str) -> str:
    """Sprowadza ID modelu do klucza cennika.

    Część wywołań podaje pełne ID z datą wydania (`claude-haiku-4-5-20251001`),
    a cennik trzyma aliasy. Bez tego kroku takie wywołanie trafiałoby do raportu
    z kwotą None — czyli najtańszy model w repo byłby jedynym, którego kosztu nie znamy.
    """
    return model if model in CENNIK else _re.sub(r"-\d{8}$", "", model)


def cena(model: str, kiedy: _dt.date | None = None) -> dict | None:
    """Cena obowiązująca danego dnia — z promocją wprowadzającą, jeśli trwa."""
    w = CENNIK.get(alias_modelu(model))
    if not w:
        return None
    p = w.get("promocja")
    if p and (kiedy or _dt.date.today()).isoformat() <= p["do"]:
        return {"wejscie": p["wejscie"], "wyjscie": p["wyjscie"]}
    return {"wejscie": w["wejscie"], "wyjscie": w["wyjscie"]}


def koszt(model: str, zuzycie, kiedy: _dt.date | None = None, batch: bool = False) -> float | None:
    """Koszt jednego wywołania w dolarach.

    `input_tokens` to już RESZTA nieobsłużona przez cache — tokeny z cache'u API
    raportuje osobno, więc sumowanie nie podwaja. Zwraca None dla modelu spoza
    cennika: lepiej luka w raporcie niż zmyślona kwota.
    """
    c = cena(model, kiedy)
    if not c:
        return None

    def pole(nazwa: str) -> int:
        v = zuzycie.get(nazwa) if isinstance(zuzycie, dict) else getattr(zuzycie, nazwa, None)
        return int(v or 0)

    usd = (
        pole("input_tokens") * c["wejscie"]
        + pole("cache_creation_input_tokens") * c["wejscie"] * MNOZNIK["zapis_cache_5m"]
        + pole("cache_read_input_tokens") * c["wejscie"] * MNOZNIK["odczyt_cache"]
        + pole("output_tokens") * c["wyjscie"]
    ) / 1_000_000
    return usd * RABAT_BATCH if batch else usd
