"""Szeregi czasowe danych rynkowych — parsowanie i statystyki opisowe.

Moduł „otoczenie makroekonomiczne" opinii bankowej stoi na szeregach: indeksie
giełdowym kraju kontrahenta, kursach walutowych, stopach procentowych, inflacji.
Wszystkie mają tę samą postać (data → wartość) i te same pytania: jaki był poziom
w dniu zdarzenia, jak się zmieniał, kiedy był szczyt i dołek.

ZASADA — jak w całym silniku: liczy kod, nie model. Model dostanie gotową tabelę
i statystyki, a jego zadaniem jest opisać je prozą, nie wyliczać.

⚠️ CZEGO NIE MA, TEGO NIE ZMYŚLAMY
Sprawozdania i biuletyny banków centralnych podają część danych WYŁĄCZNIE jako
wykresy — w sprawie PO III Ds 84.2020 inflacja i kursy są w Biuletynie Monetarnym
w postaci graficznej, a biegły przepisał je ze strony banku centralnego. Parser
zwraca tylko szeregi faktycznie obecne w aktach jako dane; braki są raportowane
jako braki, żeby opinia nie powołała liczby, której w materiale nie ma.
"""
from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field

_DATA = re.compile(r"(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})|(\d{4})-(\d{2})-(\d{2})")


@dataclass
class Punkt:
    dzien: str  # ISO
    wartosc: float


@dataclass
class Szereg:
    """Jeden szereg czasowy wraz z opisem pochodzenia."""

    nazwa: str
    zrodlo: str
    punkty: list[Punkt] = field(default_factory=list)
    jednostka: str = ""

    @property
    def od(self) -> str:
        return self.punkty[0].dzien if self.punkty else ""

    @property
    def do(self) -> str:
        return self.punkty[-1].dzien if self.punkty else ""


def _iso(tekst: str) -> str | None:
    m = _DATA.search(tekst)
    if not m:
        return None
    if m.group(1):
        d, mies, rok = int(m.group(1)), int(m.group(2)), int(m.group(3))
    else:
        rok, mies, d = int(m.group(4)), int(m.group(5)), int(m.group(6))
    if not (1 <= d <= 31 and 1 <= mies <= 12 and 1990 <= rok <= 2100):
        return None
    return f"{rok:04d}-{mies:02d}-{d:02d}"


def _liczba(s: str) -> float | None:
    """Wartość liczbowa w zapisie polskim lub angielskim; None, gdy to nie liczba."""
    s = s.strip().strip('"').replace(" ", "").replace(" ", "")
    if not s:
        return None
    # Przecinek dziesiętny (zapis polski) kontra przecinek tysięczny (angielski):
    # rozstrzyga liczba cyfr po ostatnim separatorze.
    if re.fullmatch(r"-?\d+,\d{1,6}", s):
        s = s.replace(",", ".")
    else:
        s = s.replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None


def czytaj_csv(tresc: bytes, nazwa: str, kolumna: str | None = None) -> Szereg | None:
    """Szereg z pliku CSV: pierwsza kolumna z datą, wskazana (lub ostatnia) z wartością.

    Kodowanie próbujemy w kolejności UTF-8 → CP1250 → Latin-2: pliki eksportowane
    z polskich narzędzi bywają w stronie kodowej Windows, a błąd dekodowania
    zamieniłby nagłówki w krzaki i uniemożliwił rozpoznanie kolumn.
    """
    tekst = None
    for kod in ("utf-8", "cp1250", "iso-8859-2"):
        try:
            tekst = tresc.decode(kod)
            break
        except UnicodeDecodeError:
            continue
    if tekst is None:
        return None

    # Separator: średnik (eksport polski) albo przecinek.
    proba = tekst[:2000]
    sep = ";" if proba.count(";") > proba.count(",") else ","
    wiersze = list(csv.reader(io.StringIO(tekst), delimiter=sep))
    if len(wiersze) < 3:
        return None

    naglowek = [c.strip().strip('"') for c in wiersze[0]]
    idx = None
    if kolumna:
        for i, h in enumerate(naglowek):
            if kolumna.lower() in h.lower():
                idx = i
                break

    punkty: list[Punkt] = []
    for w in wiersze[1:]:
        if not w:
            continue
        dzien = _iso(w[0])
        if not dzien:
            continue
        # Domyślnie ostatnia niepusta kolumna liczbowa — dla notowań to kurs zamknięcia.
        if idx is not None and idx < len(w):
            v = _liczba(w[idx])
        else:
            v = next((x for x in (_liczba(c) for c in reversed(w[1:])) if x is not None), None)
        if v is not None:
            punkty.append(Punkt(dzien, v))

    if len(punkty) < 3:
        return None
    punkty.sort(key=lambda p: p.dzien)
    etykieta = naglowek[idx] if idx is not None and idx < len(naglowek) else "wartość"
    return Szereg(nazwa=nazwa, zrodlo=nazwa, punkty=punkty, jednostka=etykieta)


@dataclass
class Statystyki:
    """Opis szeregu w postaci, w jakiej wchodzi do rozdziału opinii."""

    od: str
    do: str
    obserwacji: int
    poczatek: float
    koniec: float
    zmiana_pct: float
    szczyt: Punkt
    dolek: Punkt
    # Wartość w dniu zdarzenia (lub w najbliższym wcześniejszym notowaniu) —
    # to ona jest przedmiotem oceny, a nie wartość końcowa szeregu.
    w_dniu: Punkt | None = None
    zmiana_do_dnia_pct: float | None = None


def statystyki(s: Szereg, dzien_zdarzenia: str | None = None) -> Statystyki | None:
    if len(s.punkty) < 2:
        return None
    p0, pk = s.punkty[0], s.punkty[-1]
    szczyt = max(s.punkty, key=lambda p: p.wartosc)
    dolek = min(s.punkty, key=lambda p: p.wartosc)

    w_dniu = None
    zmiana_do = None
    if dzien_zdarzenia:
        # Ostatnie notowanie NIE PÓŹNIEJSZE niż dzień zdarzenia. Wzięcie najbliższego
        # w obie strony mogłoby wciągnąć notowanie po zdarzeniu, czyli wiedzę,
        # której oceniany nie mógł mieć.
        wczesniejsze = [p for p in s.punkty if p.dzien <= dzien_zdarzenia]
        if wczesniejsze:
            w_dniu = wczesniejsze[-1]
            if p0.wartosc:
                zmiana_do = round(100.0 * (w_dniu.wartosc - p0.wartosc) / p0.wartosc, 2)

    return Statystyki(
        od=s.od,
        do=s.do,
        obserwacji=len(s.punkty),
        poczatek=p0.wartosc,
        koniec=pk.wartosc,
        zmiana_pct=round(100.0 * (pk.wartosc - p0.wartosc) / p0.wartosc, 2) if p0.wartosc else 0.0,
        szczyt=szczyt,
        dolek=dolek,
        w_dniu=w_dniu,
        zmiana_do_dnia_pct=zmiana_do,
    )


def proba_miesieczna(s: Szereg) -> list[Punkt]:
    """Ostatnie notowanie każdego miesiąca — do tabeli w opinii.

    Szereg dzienny (682 notowania ICEX) jest nieczytelny w tabeli opinii sądowej.
    Bierzemy ostatnie notowanie miesiąca, bo to ono zamyka okres sprawozdawczy.
    """
    wg_msc: dict[str, Punkt] = {}
    for p in s.punkty:
        wg_msc[p.dzien[:7]] = p  # kolejne nadpisują — zostaje ostatnie w miesiącu
    return [wg_msc[k] for k in sorted(wg_msc)]
