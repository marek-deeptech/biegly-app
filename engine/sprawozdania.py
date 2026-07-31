"""Odczyt pozycji ze sprawozdań finansowych banku — z kontrolą spójności.

CO TO ROZWIĄZUJE
`engine/bank.py` przyjmuje pozycje już odczytane, bo automatyczne parsowanie całych
sprawozdań myliłoby wiersze, a w opinii dowodowej błędna liczba jest gorsza niż jej brak.
Ten moduł nie znosi tej zasady — on ją obsługuje: PROPONUJE odczyt wraz ze stroną
źródłową i wskazuje niezgodności, a zatwierdza biegły.

DLACZEGO DZIAŁA MIMO BAŁAGANU W PDF
W sprawozdaniach wiersze składnikowe mają kropkowane wypełnienie („Intangible assets
......  61,564"), przez co ekstrakcja odrywa etykietę od liczby. Ale wiersze SUMARYCZNE
(„Core capital 138,871 124,395", „Total risk weighted assets 2,537,072 2,017,470") są
składane bez wypełniacza i etykieta zostaje przy liczbach. Te wiersze wystarczą do
policzenia współczynników — więc czytamy wyłącznie je i nie udajemy, że rozumiemy resztę.

KONTROLA SPÓJNOŚCI TO NIE OZDOBA
Weryfikacja na aktach PO III Ds 84.2020 wykazała, że w tabeli opinii jeden składnik
aktywów ważonych ryzykiem przepisano jako 4 507 zamiast 45 070. Suma była poprawna,
więc żaden współczynnik nie ucierpiał — ale sam błąd przeszedł niezauważony do sądu.
`sprawdz_spojnosc` wychwytuje właśnie takie rozjazdy składnik-suma.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .bank import Pozycje

# ── Słownik etykiet ──────────────────────────────────────────────────────────
# Dwujęzyczny, bo sprawozdania kontrahentów zagranicznych bywają wyłącznie po
# angielsku (Glitnir Bank Hf), a krajowych po polsku. Dopasowanie jest do POCZĄTKU
# oczyszczonej etykiety, więc „Tier 1 capital" nie łapie się na „Tier 1 capital ratio".
ETYKIETY: dict[str, list[str]] = {
    "kapital_wlasny": ["total shareholders' equity", "total equity", "kapitał własny razem", "kapitał własny ogółem"],
    "kapital_cet1": ["core capital", "common equity tier 1", "cet1 capital", "kapitał podstawowy tier 1", "kapitał bazowy"],
    "kapital_at1": ["hybrid core capital", "additional tier 1", "kapitał dodatkowy tier 1", "hybrydowy kapitał bazowy"],
    "kapital_tier2": ["tier 2 capital", "supplementary capital", "kapitał tier 2", "kapitał uzupełniający"],
    "fundusze_wlasne": ["capital base", "total own funds", "own funds", "fundusze własne"],
    "aktywa_wazone_ryzykiem": ["total risk weighted assets", "total risk-weighted assets", "aktywa ważone ryzykiem razem",
                               "łączna kwota ekspozycji na ryzyko"],
    "aktywa_ogolem": ["total assets", "aktywa razem", "aktywa ogółem", "suma aktywów"],
    "zobowiazania_ogolem": ["total liabilities", "zobowiązania razem", "zobowiązania ogółem"],
    "depozyty_klientow": ["deposits from customers total", "total deposits from customers", "depozyty klientów",
                          "zobowiązania wobec klientów"],
    "kredyty_brutto": ["loans to customers", "total loans", "kredyty i pożyczki", "należności od klientów"],
    "zysk_netto": ["profit for the period", "net profit", "profit after tax", "zysk netto", "wynik finansowy netto"],
    "wynik_odsetkowy": ["net interest income", "wynik z tytułu odsetek", "wynik odsetkowy"],
    "przychody_odsetkowe": ["interest income", "przychody z tytułu odsetek", "przychody odsetkowe"],
}

# Tier 1 podajemy osobno: w sprawozdaniach bywa wierszem sumarycznym, a w modelu
# `Pozycje` jest wyliczany z CET1 + AT1. Czytamy go, by MÓC SPRAWDZIĆ tę sumę.
ETYKIETA_TIER1 = ["tier 1 capital", "total tier 1", "kapitał tier 1"]


@dataclass
class Kandydat:
    """Jeden odczytany wiersz: pole modelu, etykieta źródłowa, wartości, strona."""

    pole: str
    etykieta: str
    wartosci: list[float]
    strona: int


@dataclass
class Odczyt:
    """Wynik odczytu jednego sprawozdania — do zatwierdzenia przez biegłego."""

    kandydaci: list[Kandydat] = field(default_factory=list)
    dni: list[str] = field(default_factory=list)  # ISO, w kolejności kolumn
    strony: list[int] = field(default_factory=list)


# Liczba BEZ spacji wewnatrz — spacja rozdziela KOLUMNY. Zapis polski (2 537 072)
# obsluguje osobna sciezka w `_liczby`, bo spacja nie moze jednoczesnie znaczyc
# separatora tysiecy i konca kolumny.
_LICZBA = re.compile(r"\(?-?\d[\d,.']*\)?")
_LICZBA_PL = re.compile(r"\(?-?\d{1,3}(?:[ \u00a0]\d{3})+(?:[.,]\d{1,2})?\)?")
_ANG_TYSIACE = re.compile(r"\d,\d{3}")
_DATA = re.compile(r"(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})")


def _liczba(s: str) -> float | None:
    """Parsuje liczbę w zapisie angielskim i polskim, w tym ujemną w nawiasach.

    „1,211,752" → 1211752 | „2 537 072" → 2537072 | „(61,564)" → -61564
    Zwraca None dla tego, co liczbą nie jest (np. „2%", odsyłacz „30.").
    """
    s = s.strip()
    if not s:
        return None
    ujemna = s.startswith("(") and ")" in s
    s = s.strip("()").strip()
    s = s.replace(" ", "").replace("'", "").replace(" ", "")
    # Rozstrzygnięcie separatorów: ostatni z „,." o ile po nim są 1-2 cyfry, jest
    # dziesiętny; w przeciwnym razie oba są separatorami tysięcy.
    m = re.search(r"[,.](\d{1,2})$", s)
    if m:
        calosc = re.sub(r"[,.]", "", s[: m.start()])
        s = f"{calosc}.{m.group(1)}"
    else:
        s = re.sub(r"[,.]", "", s)
    if not re.fullmatch(r"-?\d+(\.\d+)?", s):
        return None
    v = float(s)
    return -v if ujemna else v


def _liczby(fragment: str) -> list[float]:
    """Wartości kolumn z fragmentu wiersza — rozstrzyga styl separatorów.

    Zapisy „200,435 169,969" (angielski) i „2 537 072" (polski) są nierozróżnialne
    dla jednego wyrażenia: w pierwszym spacja kończy kolumnę, w drugim jest wewnątrz
    liczby. Rozstrzygamy po obecności wzorca „cyfra,3 cyfry" — jeśli występuje,
    dokument używa przecinka na tysiące, więc spacja NA PEWNO rozdziela kolumny.
    """
    if _ANG_TYSIACE.search(fragment):
        return [v for v in (_liczba(t) for t in _LICZBA.findall(fragment)) if v is not None]
    out: list[float] = []
    reszta = fragment
    for m in _LICZBA_PL.finditer(fragment):
        v = _liczba(m.group(0))
        if v is not None:
            out.append(v)
        reszta = reszta.replace(m.group(0), " ", 1)
    out += [v for v in (_liczba(t) for t in _LICZBA.findall(reszta)) if v is not None]
    return out


def _wartosciowy(token: str) -> bool:
    """Czy token należy do bloku wartości na końcu wiersza.

    Procenty zaliczamy celowo: w tabelach struktury kolumny „kwota | % udziału"
    przeplatają się, a zatrzymanie obierania na pierwszym „100%" ucięłoby kwoty.
    Odfiltrowane zostaną dopiero przy parsowaniu.
    """
    if token.endswith("%") and _liczba(token[:-1]) is not None:
        return True
    return _liczba(token) is not None


def _daty_kolumn(tekst: str) -> list[str]:
    """Daty nagłówka kolumn, jako ISO.

    Bierzemy PIERWSZY wiersz zawierający co najmniej dwie daty — tak wygląda nagłówek
    tabeli porównawczej („30.06.2008 31.12.2007"). Zbieranie wszystkich dat ze strony
    dawało śmieci: odwołania do okresu („1.1.2007") trafiały do kolumn.
    """
    def z_linii(linia: str) -> list[str]:
        out: list[str] = []
        for m in _DATA.finditer(linia):
            d, mies, rok = int(m.group(1)), int(m.group(2)), int(m.group(3))
            if 1 <= d <= 31 and 1 <= mies <= 12 and 1990 <= rok <= 2100:
                iso = f"{rok:04d}-{mies:02d}-{d:02d}"
                if iso not in out:
                    out.append(iso)
        return out

    for linia in tekst.split("\n"):
        d = z_linii(linia)
        if len(d) >= 2:
            return d
    return []


def _dopasuj(etykieta: str) -> str | None:
    """Pole modelu dla etykiety — dopasowanie od najdłuższej frazy, by uniknąć kolizji.

    „interest income" jest podciągiem „net interest income", więc bez sortowania po
    długości przychody odsetkowe zjadałyby wynik odsetkowy.
    """
    e = etykieta.lower().strip(" .:·…")
    pary = [(f, pole) for pole, frazy in ETYKIETY.items() for f in frazy]
    pary += [(f, "_tier1") for f in ETYKIETA_TIER1]
    for fraza, pole in sorted(pary, key=lambda x: -len(x[0])):
        if e.startswith(fraza) or e == fraza:
            return pole
    return None


def czytaj_tekst(tekst: str, strona: int = 1, o: Odczyt | None = None) -> Odczyt:
    """Odczyt jednej strony sprawozdania. Wydzielone z `czytaj_pdf`, by dało się
    testować bez pliku — plik w katalogu roboczym bywa przenoszony i usuwany.

    Czyta WYŁĄCZNIE wiersze, w których etykieta stoi bezpośrednio przy liczbach
    (czyli sumaryczne). Wiersze składnikowe z kropkowanym wypełnieniem są w ekstrakcji
    rozerwane i ich odczyt byłby zgadywaniem — dopełnia je `uzupelnij_z_tozsamosci`.
    """
    o = o or Odczyt()
    if not tekst.strip():
        return o
    for d in _daty_kolumn(tekst):
        if d not in o.dni:
            o.dni.append(d)
    for linia in tekst.split("\n"):
        linia = linia.strip()
        if len(linia) < 8:
            continue
        # Wartości obieramy OD PRAWEJ, nie do pierwszej liczby w wierszu: szukanie
        # pierwszej liczby gubiło etykiety zawierające cyfrę — w „Tier 1 capital
        # 201,695 163,959" pierwszą liczbą jest „1" z nazwy, więc etykieta wychodziła
        # jako „Tier" i nie dopasowywała się do niczego.
        tokeny = linia.split()
        g = len(tokeny)
        while g > 0 and _wartosciowy(tokeny[g - 1]):
            g -= 1
        if g == 0 or g == len(tokeny):
            continue
        etykieta = " ".join(tokeny[:g])
        pole = _dopasuj(etykieta)
        if not pole:
            continue
        # Kolumny procentowe („709,584 100% 725,349 100%") bywają przeplatane
        # z kwotami — odrzucamy same procenty, a nie cały wiersz.
        wartosci = _liczby(" ".join(t for t in tokeny[g:] if "%" not in t))
        if not wartosci:
            continue
        o.kandydaci.append(Kandydat(pole=pole, etykieta=etykieta, wartosci=wartosci, strona=strona))
        if strona not in o.strony:
            o.strony.append(strona)
    return o


def czytaj_pdf(sciezka: str, max_stron: int = 200) -> Odczyt:
    """Przegląda całe sprawozdanie i zwraca kandydatów do zatwierdzenia przez biegłego."""
    from pypdf import PdfReader

    r = PdfReader(sciezka)
    o = Odczyt()
    for nr, strona in enumerate(r.pages[:max_stron], start=1):
        czytaj_tekst(strona.extract_text() or "", strona=nr, o=o)
    return o


def zbuduj_pozycje(o: Odczyt, dni: list[str] | None = None) -> list[Pozycje]:
    """Składa `Pozycje` per dzień z odczytanych kandydatów.

    Kolejność kolumn odpowiada kolejności dat w nagłówku tabeli. Gdy kandydat ma
    mniej wartości niż dat, przypisujemy tylko tyle, ile jest — brak wartości ma
    zostać brakiem, nie zerem (patrz `wskazniki` w bank.py).

    Pierwsze trafienie na pole wygrywa: sprawozdanie powtarza te same etykiety
    w notach segmentowych, a wiersz z tabeli głównej pojawia się wcześniej.
    """
    kolumny = dni or o.dni
    if not kolumny:
        return []
    out = [Pozycje(dzien=d) for d in kolumny]
    for k in o.kandydaci:
        if k.pole.startswith("_"):
            continue  # pola pomocnicze (np. _tier1) służą tylko kontroli i dopełnieniu
        for idx, v in enumerate(k.wartosci[: len(kolumny)]):
            if getattr(out[idx], k.pole, None) is None:
                setattr(out[idx], k.pole, v)
    return out


def uzupelnij_z_tozsamosci(o: Odczyt, poz: list[Pozycje]) -> list[str]:
    """Dolicza składniki kapitału, których etykiety nie dało się odczytać.

    Wiersze składnikowe („Hybrid core capital", „Tier 2") mają w sprawozdaniach
    kropkowane wypełnienie i ekstrakcja odrywa im etykietę. Ale wiersze SUMARYCZNE
    czytają się dobrze, a między nimi zachodzą tożsamości podane w samym sprawozdaniu:

        AT1    = Tier 1        − CET1
        Tier 2 = fundusze wł.  − Tier 1

    To odtworzenie z odczytanych sum, nie oszacowanie — ale i tak jest RAPORTOWANE,
    żeby biegły widział, która liczba pochodzi z wiersza, a która z odejmowania.
    """
    tier1 = next((k.wartosci for k in o.kandydaci if k.pole == "_tier1"), [])
    uwagi: list[str] = []
    for idx, p in enumerate(poz):
        if idx >= len(tier1):
            continue
        t1 = tier1[idx]
        if p.kapital_at1 is None and p.kapital_cet1 is not None:
            p.kapital_at1 = round(t1 - p.kapital_cet1, 2)
            uwagi.append(f"{p.dzien}: kapitał AT1 = {p.kapital_at1:,.0f} (Tier 1 − CET1, nie odczytany wprost)")
        if p.kapital_tier2 is None and p.fundusze_wlasne is not None:
            p.kapital_tier2 = round(p.fundusze_wlasne - t1, 2)
            uwagi.append(f"{p.dzien}: kapitał Tier 2 = {p.kapital_tier2:,.0f} (fundusze własne − Tier 1, nie odczytany wprost)")
    return uwagi


def sprawdz_spojnosc(o: Odczyt, poz: list[Pozycje]) -> list[str]:
    """Rozjazdy między składnikami a sumami — to tu wychodzą błędy przepisania.

    Sprawdza tożsamości, które w sprawozdaniu muszą zachodzić:
      CET1 + AT1 = Tier 1        (gdy sprawozdanie podaje Tier 1 osobno)
      Tier 1 + Tier 2 = fundusze własne
    Tolerancja 1 jednostka — sprawozdania bywają zaokrąglane do pełnych milionów.
    """
    uwagi: list[str] = []
    tier1_z_pliku = {
        i: k.wartosci for k in o.kandydaci if k.pole == "_tier1" for i in [0]
    }
    for idx, p in enumerate(poz):
        if p.kapital_cet1 is not None and p.kapital_at1 is not None:
            suma = p.kapital_cet1 + p.kapital_at1
            zrodlo = tier1_z_pliku.get(0, [])
            if idx < len(zrodlo) and abs(zrodlo[idx] - suma) > 1:
                uwagi.append(
                    f"{p.dzien}: Tier 1 ze sprawozdania ({zrodlo[idx]:,.0f}) ≠ CET1 + AT1 ({suma:,.0f})"
                )
        if p.fundusze_wlasne is not None and p.kapital_cet1 is not None:
            skladniki = p.kapital_cet1 + (p.kapital_at1 or 0) + (p.kapital_tier2 or 0)
            if abs(p.fundusze_wlasne - skladniki) > 1:
                uwagi.append(
                    f"{p.dzien}: fundusze własne ({p.fundusze_wlasne:,.0f}) ≠ suma składników ({skladniki:,.0f})"
                )
    return uwagi
