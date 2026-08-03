"""Wrapper klienta LLM w Pythonie — zachowania, które przy fail-soft psują się po cichu.

Bliźniaczy do tests-ts/klient-llm.test.ts. Wrapper ma jedną twardą obietnicę:
NIE ZMIENIA odpowiedzi i NIE PRZERYWA przetwarzania. Awaria logu nie może wywalić
odczytu akt w środku nocnego przebiegu, a cache nie może podmienić treści.

Cache jest tu istotniejszy niż w TS: skrypty puszcza się po kilka razy pod rząd
(na sucho, po poprawce promptu, po dosypaniu plików) i bez cache'u każde
uruchomienie płaci od nowa za dokumenty już przeczytane.
"""
import json
import os
import sys

import pytest

_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(_HERE, "scripts"))

anthropic = pytest.importorskip("anthropic")
import llm  # noqa: E402  (po wstrzyknięciu scripts/ do sys.path)

ZUZYCIE = {"input_tokens": 150_000, "output_tokens": 48_000}


def _msg(stop_reason="end_turn", tekst="treść odpowiedzi", zuzycie=None):
    return anthropic.types.Message.model_validate({
        "id": "msg_1", "type": "message", "role": "assistant", "model": "claude-opus-4-8",
        "content": [{"type": "text", "text": tekst, "citations": None}],
        "stop_reason": stop_reason, "stop_sequence": None,
        "usage": zuzycie or ZUZYCIE,
    })


PARAMS = dict(
    model="claude-opus-4-8", max_tokens=4000, system="systemowy",
    messages=[{"role": "user", "content": "pytanie"}],
)


@pytest.fixture
def srodowisko(tmp_path, monkeypatch):
    """Izolowany cache i log + atrapa SDK licząca realne wyjścia „do API"."""
    monkeypatch.setattr(llm, "KATALOG_CACHE", tmp_path / "cache")
    monkeypatch.setattr(llm, "PLIK_LOGU", tmp_path / "uzycie.jsonl")
    # Bez tych zmiennych wrapper nie próbuje pisać do bazy — testy nie ruszają sieci.
    monkeypatch.delenv("NEXT_PUBLIC_SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    monkeypatch.delenv("BIEGLY_LLM_BEZ_CACHE", raising=False)
    monkeypatch.setattr(llm, "_baza_wylaczona", False)

    stan = {"wywolan": 0, "odpowiedz": _msg()}

    class AtrapaSDK:
        def __init__(self, *a, **k):
            self.messages = self

        def create(self, **kw):
            stan["wywolan"] += 1
            return stan["odpowiedz"]

    monkeypatch.setattr(anthropic, "Anthropic", AtrapaSDK)

    def wpisy():
        p = tmp_path / "uzycie.jsonl"
        return [json.loads(l) for l in p.read_text(encoding="utf8").splitlines() if l] if p.exists() else []

    stan["wpisy"] = wpisy
    return stan


# ── przezroczystość ──────────────────────────────────────────────────────────

def test_zwraca_odpowiedz_nietknieta(srodowisko):
    msg = llm.klient("test", cache=False).messages.create(**PARAMS)
    assert msg.stop_reason == "end_turn"
    assert msg.content[0].text == "treść odpowiedzi"


# ── log zużycia ──────────────────────────────────────────────────────────────

def test_log_ma_tokeny_kwote_i_etykiete(srodowisko):
    llm.klient("rozbij_skany", sprawa="case-123", cache=False).messages.create(**PARAMS)
    w = srodowisko["wpisy"]()[0]
    assert w["etykieta"] == "rozbij_skany"
    assert w["sprawa"] == "case-123"
    assert w["model"] == "claude-opus-4-8"
    assert w["wejscie"] == 150_000
    assert w["wyjscie"] == 48_000
    assert w["zrodlo"] == "api"
    assert w["usd"] == pytest.approx(1.95)  # 150k×$5 + 48k×$25 wg cennika


def test_log_odnotowuje_urwana_odpowiedz(srodowisko):
    # stop_reason w logu pozwala wychwycić odczyty ucięte limitem — płacimy za nie
    # pełną stawkę, a wynik jest nie do użycia.
    srodowisko["odpowiedz"] = _msg(stop_reason="max_tokens")
    llm.klient("test", cache=False).messages.create(**PARAMS)
    assert srodowisko["wpisy"]()[0]["stop_reason"] == "max_tokens"


def test_niezapisywalny_log_nie_przerywa_wywolania(srodowisko, monkeypatch):
    # Gdyby to wywalało, nocny przebieg na 1400 stronach padałby na pierwszym pliku.
    monkeypatch.setattr(llm, "PLIK_LOGU", __import__("pathlib").Path("/proc/nie-ma/uzycie.jsonl"))
    msg = llm.klient("test", cache=False).messages.create(**PARAMS)
    assert msg.stop_reason == "end_turn"
    assert srodowisko["wywolan"] == 1


def test_model_spoza_cennika_daje_luke(srodowisko):
    llm.klient("test", cache=False).messages.create(**{**PARAMS, "model": "claude-nieznany-1"})
    assert srodowisko["wpisy"]()[0]["usd"] is None


# ── cache ────────────────────────────────────────────────────────────────────

def test_cache_domyslnie_wlaczony_w_skryptach(srodowisko):
    k = llm.klient("skrypt")
    a = k.messages.create(**PARAMS)
    b = k.messages.create(**PARAMS)
    assert srodowisko["wywolan"] == 1
    assert b.content[0].text == a.content[0].text
    assert [w["zrodlo"] for w in srodowisko["wpisy"]()] == ["api", "cache"]
    assert srodowisko["wpisy"]()[1]["usd"] == 0


def test_cache_przezywa_nowy_obiekt_klienta(srodowisko):
    # Cache jest na dysku, więc oszczędza między URUCHOMIENIAMI skryptu — po to jest.
    llm.klient("skrypt").messages.create(**PARAMS)
    llm.klient("skrypt").messages.create(**PARAMS)
    assert srodowisko["wywolan"] == 1


def test_rozny_prompt_to_rozny_klucz(srodowisko):
    k = llm.klient("skrypt")
    k.messages.create(**PARAMS)
    k.messages.create(**{**PARAMS, "messages": [{"role": "user", "content": "inne pytanie"}]})
    assert srodowisko["wywolan"] == 2


def test_zmiana_systemu_uniewaznia_cache(srodowisko):
    # Poprawka promptu MUSI unieważnić wpis — inaczej testowalibyśmy stary prompt
    # w przekonaniu, że sprawdzamy nowy.
    k = llm.klient("skrypt")
    k.messages.create(**PARAMS)
    k.messages.create(**{**PARAMS, "system": "systemowy, poprawiony"})
    assert srodowisko["wywolan"] == 2


def test_kolejnosc_argumentow_nie_zmienia_klucza(srodowisko):
    k = llm.klient("skrypt")
    k.messages.create(**PARAMS)
    k.messages.create(
        messages=PARAMS["messages"], system=PARAMS["system"],
        max_tokens=PARAMS["max_tokens"], model=PARAMS["model"],
    )
    assert srodowisko["wywolan"] == 1


def test_urwana_odpowiedz_nie_trafia_do_cache(srodowisko):
    # Inaczej ponowienie po podniesieniu max_tokens dostałoby z dysku ten sam
    # ucięty tekst i limit nic by nie zmienił — usterka nie do zdiagnozowania.
    srodowisko["odpowiedz"] = _msg(stop_reason="max_tokens")
    k = llm.klient("skrypt")
    k.messages.create(**PARAMS)
    k.messages.create(**PARAMS)
    assert srodowisko["wywolan"] == 2


def test_zmienna_srodowiskowa_wylacza_cache(srodowisko, monkeypatch):
    monkeypatch.setenv("BIEGLY_LLM_BEZ_CACHE", "1")
    k = llm.klient("skrypt")
    k.messages.create(**PARAMS)
    k.messages.create(**PARAMS)
    assert srodowisko["wywolan"] == 2
