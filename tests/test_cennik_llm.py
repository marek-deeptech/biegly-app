"""Blokada rozjazdu cennika LLM między Pythonem a TypeScriptem.

Skrypty (Python) i aplikacja (TS) liczą koszt wywołań tym samym wzorem, ale z
osobnych tablic — języki nie dzielą modułu. Rozjazd nie wywala niczego: raport ze
skryptów po prostu podaje inną kwotę niż raport z aplikacji za to samo wywołanie,
i nie wiadomo, któremu wierzyć. Dlatego test jest blokujący.

Pilnuje dwóch rzeczy naraz:
  (1) DANE — tablice cen, mnożniki cache'u, rabat batcha i progi cache'u są identyczne,
  (2) ARYTMETYKA — koszt() zwraca dokładnie te same kwoty co bliźniaczy test vitest
      (tests-ts/cennik-llm.test.ts) na tych samych wejściach.

Wartości oczekiwane są WPISANE RĘCZNIE, nie wyliczone z tablic — inaczej test
potwierdzałby wyłącznie sam siebie.
"""
import datetime as dt
import importlib.util
import json
import os
import re

import pytest

_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("llm_cennik", os.path.join(_HERE, "scripts", "llm_cennik.py"))
llm_cennik = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(llm_cennik)

_TS = os.path.join(_HERE, "lib", "llm", "cennik.ts")


def _blok(nazwa: str) -> dict:
    """Wyciąga literał obiektu `export const <nazwa> ... = { ... };` z pliku TS.

    Świadomie kruche: przebudowa cennika.ts na inny kształt ma ten test WYWALIĆ,
    a nie po cichu przepuścić. Milczenie znaczyłoby, że przestaliśmy porównywać.
    """
    src = open(_TS, encoding="utf8").read()
    m = re.search(rf"export const {nazwa}[^=]*= (\{{.*?\n\}})", src, re.S)
    assert m, f"nie znaleziono literału {nazwa} w {_TS} — cennik.ts zmienił kształt"
    txt = m.group(1)
    txt = re.sub(r"//.*", "", txt)                    # komentarze końca linii
    txt = re.sub(r"(\w+):", r'"\1":', txt)            # gołe klucze → JSON
    txt = re.sub(r",(\s*[}\]])", r"\1", txt)          # przecinki wiszące
    return json.loads(txt)


def test_tablice_cen_identyczne():
    ts = _blok("CENNIK")
    assert set(ts) == set(llm_cennik.CENNIK), "inny zestaw modeli w TS i w Pythonie"
    for model, w_ts in ts.items():
        w_py = llm_cennik.CENNIK[model]
        assert float(w_ts["wejscie"]) == float(w_py["wejscie"]), f"{model}: cena wejścia"
        assert float(w_ts["wyjscie"]) == float(w_py["wyjscie"]), f"{model}: cena wyjścia"
        assert ("promocja" in w_ts) == ("promocja" in w_py), f"{model}: promocja tylko po jednej stronie"
        if "promocja" in w_ts:
            p_ts, p_py = w_ts["promocja"], w_py["promocja"]
            assert float(p_ts["wejscie"]) == float(p_py["wejscie"]), f"{model}: promocja, wejście"
            assert float(p_ts["wyjscie"]) == float(p_py["wyjscie"]), f"{model}: promocja, wyjście"
            assert p_ts["do"] == p_py["do"], f"{model}: data końca promocji"


def test_mnozniki_i_rabat_identyczne():
    # Klucze różni konwencja nazw (camelCase vs snake_case) — wartości nie mogą się różnić.
    ts = _blok("MNOZNIK")
    py = llm_cennik.MNOZNIK
    assert float(ts["odczytCache"]) == py["odczyt_cache"]
    assert float(ts["zapisCache5m"]) == py["zapis_cache_5m"]
    assert float(ts["zapisCache1h"]) == py["zapis_cache_1h"]

    src = open(_TS, encoding="utf8").read()
    m = re.search(r"export const RABAT_BATCH = ([\d.]+);", src)
    assert m, "nie znaleziono RABAT_BATCH w cennik.ts"
    assert float(m.group(1)) == llm_cennik.RABAT_BATCH


def test_progi_cache_identyczne():
    ts = {k: int(v) for k, v in _blok("MIN_PREFIKS_CACHE").items()}
    assert ts == llm_cennik.MIN_PREFIKS_CACHE


def test_prog_cache_opusa_jest_wyzszy_niz_nasze_systemy():
    """Systemy promptów w tym repo mają 400–700 tokenów — poniżej progu Opusa.

    Ten test nie sprawdza kodu, tylko utrwala ustalenie, przez które NIE cache'ujemy
    systemów: przy 4096 tokenach minimum `cache_control` na naszych promptach nie
    zakłada cache'u i nie zgłasza tego błędem. Gdyby próg kiedyś spadł, test wywali
    i będzie to sygnał, że decyzję warto przemyśleć od nowa.
    """
    assert llm_cennik.MIN_PREFIKS_CACHE["claude-opus-4-8"] == 4096


# ── Arytmetyka. Te same wejścia i te same kwoty co w tests-ts/cennik-llm.test.ts ──
# Kwoty policzone ręcznie z cennika, nie wygenerowane z tablic.

def test_koszt_opus_bez_cache():
    # 150 000 wejścia × $5/MTok + 48 000 wyjścia × $25/MTok = 0,75 + 1,20
    z = {"input_tokens": 150_000, "output_tokens": 48_000}
    assert llm_cennik.koszt("claude-opus-4-8", z, dt.date(2026, 8, 3)) == pytest.approx(1.95)


def test_koszt_opus_z_cache():
    # 1 000×$5 + 20 000×$5×1,25 (zapis) + 100 000×$5×0,1 (odczyt) + 500×$25
    z = {
        "input_tokens": 1_000,
        "cache_creation_input_tokens": 20_000,
        "cache_read_input_tokens": 100_000,
        "output_tokens": 500,
    }
    assert llm_cennik.koszt("claude-opus-4-8", z, dt.date(2026, 8, 3)) == pytest.approx(0.1925)


def test_koszt_batch_to_polowa():
    z = {"input_tokens": 150_000, "output_tokens": 48_000}
    assert llm_cennik.koszt("claude-opus-4-8", z, dt.date(2026, 8, 3), batch=True) == pytest.approx(0.975)


def test_promocja_sonneta_wygasa():
    """Sonnet 5 ma cenę wprowadzającą do 2026-08-31 — po tej dacie rachunek rośnie o połowę."""
    z = {"input_tokens": 1_000_000, "output_tokens": 100_000}
    w_promocji = llm_cennik.koszt("claude-sonnet-5", z, dt.date(2026, 8, 3))
    po_promocji = llm_cennik.koszt("claude-sonnet-5", z, dt.date(2026, 9, 1))
    assert w_promocji == pytest.approx(3.0)      # 1M×$2 + 100k×$10
    assert po_promocji == pytest.approx(4.5)     # 1M×$3 + 100k×$15
    # Ostatni dzień promocji liczy się jeszcze po cenie promocyjnej.
    assert llm_cennik.koszt("claude-sonnet-5", z, dt.date(2026, 8, 31)) == pytest.approx(3.0)


def test_id_z_data_wydania_ma_cene():
    """lib/intake/classify-content.ts woła Haiku pełnym ID: claude-haiku-4-5-20251001.

    Bez normalizacji datowanego sufiksu jedyny już zoptymalizowany krok w repo
    byłby też jedynym, którego kosztu raport nie zna.
    """
    z = {"input_tokens": 1_000_000, "output_tokens": 100_000}  # 1M×$1 + 100k×$5
    assert llm_cennik.koszt("claude-haiku-4-5-20251001", z, dt.date(2026, 8, 3)) == pytest.approx(1.5)
    assert llm_cennik.koszt("claude-haiku-4-5", z, dt.date(2026, 8, 3)) == pytest.approx(1.5)


def test_normalizacja_nie_zjada_nazwy_modelu():
    """Sufiks obcinamy TYLKO wtedy, gdy wygląda jak data — nie z każdej nazwy."""
    assert llm_cennik.alias_modelu("claude-opus-4-8") == "claude-opus-4-8"
    assert llm_cennik.alias_modelu("claude-haiku-4-5-20251001") == "claude-haiku-4-5"
    assert llm_cennik.alias_modelu("model-bez-daty-123") == "model-bez-daty-123"


def test_model_spoza_cennika_daje_luke_a_nie_zero():
    """None znaczy „nie wiem" i jest widoczne w raporcie. Zero udawałoby darmowe wywołanie."""
    assert llm_cennik.koszt("claude-nieistniejacy-9", {"input_tokens": 1_000}) is None
