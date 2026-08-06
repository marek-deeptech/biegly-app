"""Most TS↔PY katalogu wskaźników — blokada rozjazdu progów i rubryki.

Krok „Lista wskaźników" pokazuje katalog z lib/domain/wskazniki-bank.ts, a liczy
silnik z engine/bank.py (progi) i engine/analiza_ekonomiczna.py (rubryka 16).
Rozjazd tych dwóch miejsc = biegły czyta w panelu inne minimum niż to, którym
silnik oznacza naruszenia. Ta sama zasada co bliźniak wyboru pliku UTP
(tests/test_utp_pick.py): logika istnieje w dwóch językach, test trzyma je razem.

Parser jest LINIOWY z rozmysłem — wpisy katalogu TS są sformatowane po jednym
na linię (komentarz w pliku TS o tym mówi), więc regex na linii wystarcza
i nie potrzebujemy interpretera TS.
"""
import pathlib
import re

from engine.analiza_ekonomiczna import WSKAZNIKI_EF
from engine.bank import PROGI

TS = (pathlib.Path(__file__).resolve().parent.parent / "lib/domain/wskazniki-bank.ts").read_text(
    encoding="utf8"
)


def _wpisy(wzor: str) -> list[dict]:
    return [m.groupdict() for m in re.finditer(wzor, TS)]


def test_progi_ts_odpowiadaja_silnikowi_co_do_wartosci_i_dat():
    ts = _wpisy(
        r'\{ kod: "(?P<kod>\w+)", nazwa: "[^"]+", formula: "[^"]+", '
        r'minimum: (?P<minimum>[\d.]+), podstawa: "(?P<podstawa>[^"]+)", '
        r'od: "(?P<od>[\d-]+)"(?:, do: "(?P<do>[\d-]+)")? \}'
    )
    ts_zbior = {(w["kod"], float(w["minimum"]), w["od"], w["do"]) for w in ts}
    py_zbior = {(p.wskaznik, p.minimum, p.od, p.do) for p in PROGI}
    assert ts_zbior == py_zbior, (
        f"TS-PY: {ts_zbior - py_zbior} | PY-TS: {py_zbior - ts_zbior}"
    )
    # Podstawa prawna też musi się zgadzać — to ona idzie do kolumny tabeli w opinii.
    py_podstawy = {(p.wskaznik, p.od): p.podstawa for p in PROGI}
    for w in ts:
        assert w["podstawa"] == py_podstawy[(w["kod"], w["od"])], w["kod"]


def test_rubryka_ts_odpowiada_silnikowi_kod_obszar_waga():
    ts = _wpisy(r'\{ kod: "(?P<kod>\w+)", obszar: "(?P<obszar>\w+)", nazwa: "[^"]+", waga: (?P<waga>[\d.]+) \}')
    assert len(ts) == 16, "parser nie widzi 16 wierszy rubryki — wpis rozbity na wiele linii?"
    ts_zbior = {(w["kod"], w["obszar"], float(w["waga"])) for w in ts}
    py_zbior = {(w.kod, w.obszar, w.waga) for w in WSKAZNIKI_EF}
    assert ts_zbior == py_zbior, (
        f"TS-PY: {ts_zbior - py_zbior} | PY-TS: {py_zbior - ts_zbior}"
    )


def test_nazwy_rubryki_zgodne_z_odczytem_uchwaly():
    # Nazwa wskaźnika w panelu musi brzmieć tak, jak odczyt ze skanu uchwały —
    # to jest tekst, który biegły przepisze do opinii.
    ts = _wpisy(r'\{ kod: "(?P<kod>\w+)", obszar: "\w+", nazwa: "(?P<nazwa>[^"]+)", waga: [\d.]+ \}')
    py = {w.kod: w.nazwa for w in WSKAZNIKI_EF}
    for w in ts:
        assert w["nazwa"] == py[w["kod"]], f"{w['kod']}: nazwa TS ≠ nazwa silnika"
