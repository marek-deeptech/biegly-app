#!/usr/bin/env python3
"""Klient LLM z pomiarem zużycia — bliźniaczy do lib/llm/klient.ts.

CO TO ROZWIĄZUJE: rachunek za API rósł szybciej niż intuicja podpowiadała, a żadne
miejsce w kodzie nie zapisywało, ile kosztowało wywołanie. Pytanie „który skrypt pali
budżet" nie miało jak dostać odpowiedzi. Ten moduł zapisuje każde wywołanie:
etykietę, sprawę, model, tokeny i kwotę.

DRUGA FUNKCJA — CACHE. Skrypty offline puszcza się po kilka razy: raz na sucho, raz
po poprawce promptu, raz po dosypaniu plików. Bez cache'u każde uruchomienie płaci od
nowa za dokumenty już przeczytane. Rozbicie skanów SKOK-u puszczaliśmy trzy razy —
to były trzy pełne rachunki za tę samą pracę. Klucz to odcisk CAŁEGO zapytania
(model, limit, system, wiadomości), więc zmiana promptu unieważnia wpis sama z siebie.

W skryptach cache jest DOMYŚLNIE WŁĄCZONY (odwrotnie niż w TS, gdzie trasy aplikacji
mają zawsze generować na nowo). Wyłączenie na jedno uruchomienie: BIEGLY_LLM_BEZ_CACHE=1.

⚠️ LOGOWANIE JEST FAIL-SOFT: awaria zapisu nie może przerwać przetwarzania akt.

UŻYCIE — zamiast `anthropic.Anthropic()`:
    import llm
    msg = llm.klient("rozbij_skany").messages.create(model=..., max_tokens=..., ...)
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import os
import pathlib
import time
import urllib.request

import llm_cennik

# ⚠️ NIE W TMPDIR. Pierwsza wersja trzymała cache w katalogu tymczasowym i system
# go wyczyścił — razem z jedenastoma opłaconymi odczytami ocen kwartalnych, za które
# trzeba było zapłacić drugi raz. Cache ma przeżyć restart maszyny, bo po to jest.
KATALOG_CACHE = pathlib.Path(
    os.environ.get("BIEGLY_LLM_CACHE") or (pathlib.Path.home() / ".biegly-llm" / "cache")
)
PLIK_LOGU = pathlib.Path(
    os.environ.get("BIEGLY_LLM_LOG") or (pathlib.Path.home() / ".biegly-llm" / "uzycie.jsonl")
)

# Po pierwszej nieudanej próbie zapisu do bazy przestajemy dokładać opóźnienie
# do każdego wywołania. Najczęstsza przyczyna: migracja 0018 jeszcze niewgrana.
_baza_wylaczona = False


def _kanoniczny(v) -> str:
    """JSON z posortowanymi kluczami — ten sam prompt ma dawać ten sam odcisk."""
    return json.dumps(v, sort_keys=True, ensure_ascii=False, default=str)


def _klucz(kw: dict) -> str:
    return hashlib.sha256(_kanoniczny(kw).encode("utf8")).hexdigest()


def _do_bazy(w: dict) -> None:
    global _baza_wylaczona
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if _baza_wylaczona or not url or not key:
        return
    try:
        req = urllib.request.Request(
            url.rstrip("/") + "/rest/v1/llm_uzycie",
            data=json.dumps(w).encode("utf8"),
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
            method="POST",
        )
        urllib.request.urlopen(req, timeout=3).read()
    except Exception:
        _baza_wylaczona = True


def _zapisz(w: dict) -> None:
    kwota = "?" if w["usd"] is None else f"${w['usd']:.4f}"
    znacznik = " [z cache]" if w["zrodlo"] == "cache" else ""
    print(
        f"[llm] {w['etykieta']} {w['model']} we={w['wejscie']} wy={w['wyjscie']} "
        f"{kwota} {w['ms'] / 1000:.1f}s{znacznik}",
        flush=True,
    )
    try:
        PLIK_LOGU.parent.mkdir(parents=True, exist_ok=True)
        with PLIK_LOGU.open("a", encoding="utf8") as f:
            f.write(json.dumps(w, ensure_ascii=False) + "\n")
    except Exception:
        pass  # log jest pomiarem, nie warunkiem pracy — patrz nagłówek
    _do_bazy(w)


class _Wiadomosci:
    def __init__(self, rodzic: "_Klient") -> None:
        self._r = rodzic

    def create(self, **kw):
        import anthropic

        model = str(kw.get("model", "?"))
        klucz = _klucz(kw) if self._r.cache else None

        if klucz:
            plik = KATALOG_CACHE / f"{klucz}.json"
            if plik.exists():
                try:
                    surowe = json.loads(plik.read_text(encoding="utf8"))
                    msg = anthropic.types.Message.model_validate(surowe)
                    _zapisz(self._r._wpis(model, {}, 0, "cache", msg.stop_reason, usd=0.0))
                    return msg
                except Exception:
                    # Uszkodzony wpis nie ma blokować pracy — idziemy do API.
                    pass

        start = time.time()
        msg = anthropic.Anthropic().messages.create(**kw)

        try:
            u = msg.usage
            _zapisz(
                self._r._wpis(
                    model,
                    {
                        "input_tokens": getattr(u, "input_tokens", 0),
                        "output_tokens": getattr(u, "output_tokens", 0),
                        "cache_creation_input_tokens": getattr(u, "cache_creation_input_tokens", 0),
                        "cache_read_input_tokens": getattr(u, "cache_read_input_tokens", 0),
                    },
                    int((time.time() - start) * 1000),
                    "api",
                    msg.stop_reason,
                )
            )
        except Exception:
            pass  # pomiar nie może zepsuć odpowiedzi, którą już zapłaciliśmy

        # Urwanej odpowiedzi NIE zapamiętujemy: ponowienie po podniesieniu max_tokens
        # dostałoby z dysku ten sam ucięty tekst i limit nic by nie dał.
        if klucz and msg.stop_reason != "max_tokens":
            try:
                KATALOG_CACHE.mkdir(parents=True, exist_ok=True)
                (KATALOG_CACHE / f"{klucz}.json").write_text(
                    msg.model_dump_json(), encoding="utf8"
                )
            except Exception:
                pass  # brak zapisu = zapłacimy jeszcze raz; to koszt, nie błąd
        return msg


class _Klient:
    def __init__(self, etykieta: str, sprawa: str | None, cache: bool) -> None:
        self.etykieta = etykieta
        self.sprawa = sprawa
        self.cache = cache and not os.environ.get("BIEGLY_LLM_BEZ_CACHE")
        self.messages = _Wiadomosci(self)

    def _wpis(self, model, zuzycie, ms, zrodlo, stop_reason, usd=None) -> dict:
        return {
            "czas": _dt.datetime.now(_dt.timezone.utc).isoformat(),
            "etykieta": self.etykieta,
            "sprawa": self.sprawa,
            "model": model,
            "wejscie": int(zuzycie.get("input_tokens") or 0),
            "wyjscie": int(zuzycie.get("output_tokens") or 0),
            "cache_zapis": int(zuzycie.get("cache_creation_input_tokens") or 0),
            "cache_odczyt": int(zuzycie.get("cache_read_input_tokens") or 0),
            "usd": usd if usd is not None else llm_cennik.koszt(model, zuzycie),
            "ms": ms,
            "zrodlo": zrodlo,
            "stop_reason": stop_reason,
        }


def klient(etykieta: str, sprawa: str | None = None, cache: bool = True) -> _Klient:
    """Klient Anthropic zapisujący każde wywołanie.

    `etykieta` musi być STABILNA między uruchomieniami — po niej grupuje raport
    kosztów. „rozbij_skany" jest użyteczne, „krok 2" po miesiącu już nie.
    """
    return _Klient(etykieta, sprawa, cache)
