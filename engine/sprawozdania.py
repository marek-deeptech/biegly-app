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

# Pozycje RACHUNKU WYNIKÓW. Odnoszą się do OKRESU, nie do dnia bilansowego — a
# sprawozdanie półroczne zestawia półrocze z półroczem, nie z pełnym rokiem, mimo że
# nagłówek kolumny nosi datę „31.12.2007". Dlatego dla tych pól dopuszczamy wyłącznie
# odczyt z wiersza o liczbie wartości równej liczbie kolumn i z czystą etykietą;
# wnioskowanie z układu strony dawałoby tu wynik półroczny podpisany jako roczny.
POLA_WYNIKOWE = {"zysk_netto", "wynik_odsetkowy", "przychody_odsetkowe"}

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
    dni: list[str] = field(default_factory=list)  # ISO, w kolejności kolumn (pierwsza rozpoznana strona)
    strony: list[int] = field(default_factory=list)
    # Daty kolumn PER STRONA. Kolejność kolumn bywa różna na różnych stronach tego
    # samego sprawozdania: nota o adekwatności podaje [2007, 2006], a zestawienie
    # pięcioletnie [2006, 2007]. Wzięcie dat z pierwszej rozpoznanej strony i wartości
    # z innej przestawiało cały szereg — Tier 1 wychodził zamieniony między latami.
    dni_stron: dict[int, list[str]] = field(default_factory=dict)
    # Liczba znaków wyciągniętych z PDF-a. Odróżnia skan BEZ warstwy tekstowej (0)
    # od dokumentu z tekstem, w którym po prostu nie ma tabeli bilansowej — bez tego
    # rozróżnienia komunikat o błędzie wysyłał biegłego do OCR-u już wykonanego.
    znakow: int = 0


# Liczba BEZ spacji wewnatrz — spacja rozdziela KOLUMNY. Zapis polski (2 537 072)
# obsluguje osobna sciezka w `_liczby`, bo spacja nie moze jednoczesnie znaczyc
# separatora tysiecy i konca kolumny.
_LICZBA = re.compile(r"\(?-?\d[\d,.']*\)?")
_LICZBA_PL = re.compile(r"\(?-?\d{1,3}(?:[ \u00a0]\d{3})+(?:[.,]\d{1,2})?\)?")
_ANG_TYSIACE = re.compile(r"\d,\d{3}")
_DATA = re.compile(r"(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})")


def _dzis():
    """Dzień dzisiejszy — wydzielone, żeby test mógł podmienić bez ruszania zegara."""
    from datetime import date

    return date.today()


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
            # ⚠️ DZIEŃ BILANSOWY NIE MOŻE BYĆ W PRZYSZŁOŚCI. Górna granica 2100 wpuszczała
            # przekręcone cyfry OCR: w informacji dodatkowej SK Banku „31.12.2018" wyszło
            # jako „31.12.2028" i silnik założył okres sprawozdawczy oddalony o dwanaście
            # lat. Sprawozdanie opisuje stan, który już zaistniał — data późniejsza niż
            # dziś jest błędem odczytu, nie danymi.
            if 1 <= d <= 31 and 1 <= mies <= 12 and 1990 <= rok <= _dzis().year:
                iso = f"{rok:04d}-{mies:02d}-{d:02d}"
                if iso not in out:
                    out.append(iso)
        return out

    def koniec_miesiaca(iso: str) -> bool:
        """Dzień bilansowy to KONIEC okresu, nigdy jego początek.

        Sprawozdania obok nagłówka kolumn zawierają frazy „za okres od 1.04.2007
        do 1.07.2007" — dwie daty w jednym wierszu, czyli dokładnie to, czego szuka
        heurystyka nagłówka. Bez tego filtru do szeregu wchodziły kolumny 2007-04-01
        i 2007-12-01, których w bilansie nie ma.
        """
        r, m, d = (int(x) for x in iso.split("-"))
        dni = [31, 29 if (r % 4 == 0 and (r % 100 != 0 or r % 400 == 0)) else 28,
               31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
        return d == dni

    for linia in tekst.split("\n"):
        d = z_linii(linia)
        if len(d) < 2:
            continue
        bilansowe = [x for x in d if koniec_miesiaca(x)]
        # Wiersz z samymi datami początkowymi to opis okresu, nie nagłówek kolumn.
        if bilansowe:
            return bilansowe
    return []


# Co wolno zostać po frazie, żeby etykieta wciąż znaczyła to samo: kropkowane
# wypełnienie, interpunkcja i numer noty. Nie wolno — dalsze SŁOWA.
_OGON = re.compile(r"^[^A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]*$")


def _dopasuj(etykieta: str) -> str | None:
    """Pole modelu dla etykiety — dopasowanie od najdłuższej frazy, by uniknąć kolizji.

    „interest income" jest podciągiem „net interest income", więc bez sortowania po
    długości przychody odsetkowe zjadałyby wynik odsetkowy.

    ⚠️ FRAZA MUSI KOŃCZYĆ ETYKIETĘ, nie tylko ją zaczynać.
    Samo `startswith` łapało zupełnie inne pozycje sprawozdania:
      „Net profit from sale of subsidiaries and assets" → brane jako zysk netto
      „Total equity and liabilities"                    → brane jako kapitał własny
      „Total assets on 30 June"                         → brane jako aktywa ogółem
    Każda z nich ma sensowne liczby w sensownej liczbie kolumn, więc przechodziła
    wszystkie kontrole i trafiała do opinii jako pozycja, którą nie jest.
    Po frazie mogą zostać cyfry i interpunkcja — to numer noty albo wartości wchłonięte
    z wiersza przez kropkowane wypełnienie. Nie mogą zostać LITERY: dalsze słowa znaczą,
    że jest to inna pozycja sprawozdania.
    """
    e = etykieta.lower().strip(" .:·…")
    pary = [(f, pole) for pole, frazy in ETYKIETY.items() for f in frazy]
    pary += [(f, "_tier1") for f in ETYKIETA_TIER1]
    for fraza, pole in sorted(pary, key=lambda x: -len(x[0])):
        if e.startswith(fraza) and _OGON.match(e[len(fraza):]):
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
    daty = _daty_kolumn(tekst)
    if daty:
        o.dni_stron[strona] = daty
    for d in daty:
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
        tekst = strona.extract_text() or ""
        o.znakow += len(tekst.strip())
        czytaj_tekst(tekst, strona=nr, o=o)
    return o


# Pola noty o adekwatności kapitałowej — po ich współwystępowaniu rozpoznajemy,
# która strona jest TĄ tabelą, a nie notą segmentową o podobnych etykietach.
_POLA_KAPITALOWE = {"kapital_cet1", "kapital_at1", "kapital_tier2", "fundusze_wlasne",
                    "aktywa_wazone_ryzykiem", "_tier1"}


def strona_kapitalowa(o: Odczyt) -> int | None:
    """Strona z notą o adekwatności — ta, na której zebrało się najwięcej pól kapitałowych.

    Sprawozdanie roczne (129 stron) zawiera kilka tabel z podobnymi etykietami:
    skonsolidowaną, jednostkową i noty segmentowe. Bez wskazania jednej strony
    kandydaci mieszali się między nimi, a kolumny wypadały w innej kolejności —
    Tier 1 dla 2007 i 2006 wychodził zamieniony miejscami. Kontrola spójności to
    wykrywała, ale lepiej nie wyprodukować rozjazdu, niż go potem zgłaszać.
    """
    licz: dict[int, set[str]] = {}
    for k in o.kandydaci:
        if k.pole in _POLA_KAPITALOWE:
            licz.setdefault(k.strona, set()).add(k.pole)
    if not licz:
        return None
    return max(licz, key=lambda s: len(licz[s]))


def _dlugosc_frazy(etykieta: str) -> int:
    """Długość dopasowanej frazy słownika — do zbadania, co zostało w ogonie etykiety."""
    e = etykieta.lower().strip(" .:·…")
    pary = [(f, p) for p, frazy in ETYKIETY.items() for f in frazy] + [(f, "_tier1") for f in ETYKIETA_TIER1]
    for fraza, _ in sorted(pary, key=lambda x: -len(x[0])):
        if e.startswith(fraza) and _OGON.match(e[len(fraza):]):
            return len(fraza)
    return len(etykieta)


def _uwaga(uwagi: list[str] | None, dzien: str, k: Kandydat, v: float, skad: str,
           zrodla: list[dict] | None = None) -> None:
    """Odnotowuje odczyt WYWNIOSKOWANY z układu strony — biegły ma wiedzieć, że to nie
    jest odczyt kolumny, tylko wniosek z tego, jak tabela była złożona.

    `zrodla` dostaje ten sam komunikat W POSTACI DANYCH (dzień, pole, strona), żeby
    aplikacja mogła podać odnośnik wprost do tej strony sprawozdania. Numer strony
    zaszyty tylko w zdaniu zmuszał biegłego do ręcznego szukania pliku i kartkowania.
    """
    tekst = (
        f"{dzien}: {k.pole} = {v:,.0f} — {skad} (str. {k.strona}); wartość wywnioskowana "
        f"z układu strony, nie odczytana z kolumny.".replace(",", "\u00a0")
    )
    if uwagi is not None:
        uwagi.append(tekst)
    if zrodla is not None:
        zrodla.append({"tekst": tekst, "dzien": dzien, "pole": k.pole, "strona": k.strona})


def zbuduj_pozycje(o: Odczyt, dni: list[str] | None = None, uwagi: list[str] | None = None,
                   zrodla: list[dict] | None = None) -> list[Pozycje]:
    """Składa `Pozycje` per dzień z odczytanych kandydatów.

    ⚠️ MAPOWANIE POZYCYJNE JEST UPRAWNIONE TYLKO PRZY ZGODNEJ LICZBIE WARTOŚCI.
    Wiersz z pięcioma liczbami w sprawozdaniu o dwóch kolumnach dat NIE jest wierszem
    dwukolumnowym — pochodzi z innej tabeli (segmentowej, kwartalnej, terminowej).
    Wzięcie z niego wartości „po indeksie" wstawiało do kolumny rocznej liczbę kwartalną:
    w aktach MBR aktywa Glitnira na 31.12.2007 wyszły 1 043 029 zamiast 2 948 910, przez co
    bilans nie domykał się o 27,5%. Wiersz o niezgodnej liczbie wartości jest więc pomijany.

    Wyjątek — wiersz z JEDNĄ wartością trafia wyłącznie do pierwszej kolumny. To skutek
    kropkowanego wypełnienia: etykieta wchłania wartości segmentów i zostaje sama suma
    („Total assets 869,724 1,961,522 ... 3,862,797" → odczyt [3 862 797]). Takie odczyty
    oznaczamy w `uwagi`, bo są wnioskiem z układu strony, a nie odczytem kolumny.

    Pierwsze trafienie na pole wygrywa: sprawozdanie powtarza te same etykiety
    w notach segmentowych, a wiersz z tabeli głównej pojawia się wcześniej.
    """
    # Daty bierzemy ze STRONY NOTY KAPITAŁOWEJ, nie z pierwszej napotkanej — to
    # z niej pochodzą wartości, więc tylko jej porządek kolumn jest właściwy.
    skap = strona_kapitalowa(o)
    kolumny = dni or (o.dni_stron.get(skap) if skap is not None else None) or o.dni
    if not kolumny:
        return []
    out = [Pozycje(dzien=d) for d in kolumny]

    def przypisz(k: Kandydat, wartosci: list[float], od: int = 0) -> None:
        for idx, v in enumerate(wartosci, start=od):
            if idx < len(out) and getattr(out[idx], k.pole, None) is None:
                setattr(out[idx], k.pole, v)

    # Pola kapitałowe bierzemy WYŁĄCZNIE ze strony noty o adekwatności — patrz
    # `strona_kapitalowa`. Pozostałe (bilans, wynik) mogą pochodzić z innych stron.
    wazne = [
        k for k in o.kandydaci
        if not k.pole.startswith("_")  # pola pomocnicze służą tylko kontroli i dopełnieniu
        and not (k.pole in _POLA_KAPITALOWE and skap is not None and k.strona != skap)
    ]
    def bez_noty(w: list[float]) -> list[float]:
        """Ucina wiodący NUMER NOTY, gdy to on psuje zgodność liczby wartości z kolumnami.

        Sprawozdania podają przy pozycji odsyłacz do noty i ekstrakcja czyta go jako
        pierwszą liczbę: „Total Equity 59 169,969 146,119" → [59, 169 969, 146 119].
        Wiersz wygląda wtedy na trzykolumnowy w sprawozdaniu o dwóch kolumnach i cały
        idzie ścieżką domysłu, choć jest odczytem dokładnym. Warunek jest ciasny:
        dokładnie jedna wartość nadmiarowa, całkowita i mniejsza od 1000.
        """
        if len(w) == len(kolumny) + 1 and w[0] == int(w[0]) and 0 < w[0] < 1000:
            return w[1:]
        return w

    czysta = lambda k: not re.search(r"\d", k.etykieta[_dlugosc_frazy(k.etykieta):])  # noqa: E731

    # Przebieg 1 — wiersz o liczbie wartości równej liczbie kolumn i o CZYSTEJ etykiecie.
    # Tylko tu układ wiersza odpowiada układowi nagłówka, więc tylko tu mapowanie
    # po indeksie jest odczytem, a nie domysłem.
    for k in wazne:
        if len(bez_noty(k.wartosci)) == len(kolumny) and czysta(k):
            przypisz(k, bez_noty(k.wartosci))
    # Przebieg 2 — to samo, ale etykieta wchłonęła liczby (kropkowane wypełnienie).
    # Po przebiegu 1, bo wiersz z czystą etykietą jest wiarygodniejszy: w aktach MBR
    # „Net interest income 13,521 23,198 ( 562) 2,9" dawał [786, 39 082] i podstawiał
    # 786 pod rok 2007, podczas gdy czysty wiersz kilka stron dalej miał [39 082, 37 084].
    for k in wazne:
        if len(bez_noty(k.wartosci)) == len(kolumny) and not czysta(k):
            przypisz(k, bez_noty(k.wartosci))
    # Dalsze przebiegi to WNIOSKOWANIE Z UKŁADU STRONY, nie odczyt kolumny — dla pozycji
    # rachunku wyników niedopuszczalne (patrz POLA_WYNIKOWE).
    reszta = [k for k in wazne if k.pole not in POLA_WYNIKOWE]
    # Przebieg 3 — pojedyncza wartość do pierwszej kolumny.
    for k in reszta:
        if len(k.wartosci) == 1 and getattr(out[0], k.pole, None) is None:
            przypisz(k, k.wartosci)
            _uwaga(uwagi, kolumny[0], k, k.wartosci[0], "wiersz o jednej wartości", zrodla)
    # Przebieg 4 — tabela segmentowa/kwartalna: OSTATNIA liczba wiersza jest sumą okresu,
    # a kolejne takie wiersze opisują kolejne okresy. Sprawdzone na sześciu wierszach
    # z obu sprawozdań Glitnira; bilans policzony z tak odczytanych wartości domyka się
    # co do jednostki, co jest niezależnym potwierdzeniem reguły.
    licznik: dict[str, int] = {}
    for k in reszta:
        if len(bez_noty(k.wartosci)) <= len(kolumny):
            continue
        idx = licznik.get(k.pole, 0)
        licznik[k.pole] = idx + 1
        if idx < len(out) and getattr(out[idx], k.pole, None) is None:
            setattr(out[idx], k.pole, k.wartosci[-1])
            _uwaga(uwagi, kolumny[idx], k, k.wartosci[-1], "suma wiersza tabeli segmentowej", zrodla)

    # ⚠️ OKRES BEZ JEDNEJ LICZBY NIE JEST OKRESEM. Sama obecność daty w nagłówku nie
    # znaczy, że stronę udało się odczytać: w aktach SK Banku informacja dodatkowa
    # o należnościach walutowych dała DWA okresy z samą walutą i zerem wartości, a te
    # puste okresy szły dalej do wskaźników i do wykresów jako pełnoprawny szereg.
    # Brak danych ma być widoczny jako brak, nie jako punkt na osi czasu.
    pelne = [p for p in out if _ma_dane(p)]
    if uwagi is not None:
        for p in out:
            if not _ma_dane(p):
                uwagi.append(
                    f"{p.dzien}: rozpoznano kolumnę daty, ale nie odczytano z niej żadnej "
                    f"pozycji — okres pominięty."
                )
    return pelne


def _ma_dane(p: Pozycje) -> bool:
    """Czy w okresie odczytano cokolwiek poza samą datą i walutą."""
    return any(
        v is not None
        for k, v in vars(p).items()
        if k not in ("dzien", "waluta")
    )


def uzupelnij_z_tozsamosci(o: Odczyt, poz: list[Pozycje], zrodla: list[dict] | None = None) -> list[str]:
    """Dolicza składniki kapitału, których etykiety nie dało się odczytać.

    Wiersze składnikowe („Hybrid core capital", „Tier 2") mają w sprawozdaniach
    kropkowane wypełnienie i ekstrakcja odrywa im etykietę. Ale wiersze SUMARYCZNE
    czytają się dobrze, a między nimi zachodzą tożsamości podane w samym sprawozdaniu:

        AT1    = Tier 1        − CET1
        Tier 2 = fundusze wł.  − Tier 1

    To odtworzenie z odczytanych sum, nie oszacowanie — ale i tak jest RAPORTOWANE,
    żeby biegły widział, która liczba pochodzi z wiersza, a która z odejmowania.
    """
    skap = strona_kapitalowa(o)
    tier1 = next(
        (k.wartosci for k in o.kandydaci if k.pole == "_tier1" and (skap is None or k.strona == skap)),
        [],
    )
    uwagi: list[str] = []
    for idx, p in enumerate(poz):
        if idx >= len(tier1):
            continue
        t1 = tier1[idx]
        def zapisz(pole: str, wartosc: float, opis: str) -> None:
            tekst = f"{p.dzien}: {opis} = {wartosc:,.0f} (nie odczytany wprost)".replace(",", "\u00a0")
            uwagi.append(tekst)
            if zrodla is not None:
                zrodla.append({"tekst": tekst, "dzien": p.dzien, "pole": pole, "strona": skap})

        if p.kapital_at1 is None and p.kapital_cet1 is not None:
            p.kapital_at1 = round(t1 - p.kapital_cet1, 2)
            zapisz("kapital_at1", p.kapital_at1, "kapitał AT1 z tożsamości Tier 1 − CET1")
        if p.kapital_tier2 is None and p.fundusze_wlasne is not None:
            p.kapital_tier2 = round(p.fundusze_wlasne - t1, 2)
            zapisz("kapital_tier2", p.kapital_tier2, "kapitał Tier 2 z tożsamości fundusze własne − Tier 1")
    return uwagi


def sprawdz_spojnosc(o: Odczyt, poz: list[Pozycje]) -> list[str]:
    """Rozjazdy między składnikami a sumami — to tu wychodzą błędy przepisania.

    Sprawdza tożsamości, które w sprawozdaniu muszą zachodzić:
      CET1 + AT1 = Tier 1        (gdy sprawozdanie podaje Tier 1 osobno)
      Tier 1 + Tier 2 = fundusze własne
    Tolerancja 1 jednostka — sprawozdania bywają zaokrąglane do pełnych milionów.
    """
    uwagi: list[str] = []
    # Tier 1 WYŁĄCZNIE ze strony noty kapitałowej. Wcześniej brany był ostatni
    # kandydat w dokumencie, czyli w sprawozdaniu rocznym tabela z zestawienia
    # pięcioletniego — a ta ma kolumny w odwrotnej kolejności lat. Kontrola
    # spójności zgłaszała wtedy rozjazd, którego w dokumencie nie ma.
    skap = strona_kapitalowa(o)
    tier1_seria = next(
        (k.wartosci for k in o.kandydaci if k.pole == "_tier1" and (skap is None or k.strona == skap)),
        [],
    )
    for idx, p in enumerate(poz):
        if p.kapital_cet1 is not None and p.kapital_at1 is not None:
            suma = p.kapital_cet1 + p.kapital_at1
            if idx < len(tier1_seria) and abs(tier1_seria[idx] - suma) > 1:
                uwagi.append(
                    f"{p.dzien}: Tier 1 ze sprawozdania ({tier1_seria[idx]:,.0f}) ≠ CET1 + AT1 ({suma:,.0f})"
                )
        if p.fundusze_wlasne is not None and p.kapital_cet1 is not None:
            skladniki = p.kapital_cet1 + (p.kapital_at1 or 0) + (p.kapital_tier2 or 0)
            if abs(p.fundusze_wlasne - skladniki) > 1:
                uwagi.append(
                    f"{p.dzien}: fundusze własne ({p.fundusze_wlasne:,.0f}) ≠ suma składników ({skladniki:,.0f})"
                )
    return uwagi


# ── Zestawienie pozycji do rozdziału opinii ──────────────────────────────────
# Rozdział „Analiza sprawozdań finansowych" pokazuje KWOTY, nie wskaźniki. Te same
# odczyty zasilają `wskazniki` w bank.py, ale wskaźnik jest ilorazem i ukrywa skalę:
# udział depozytów 22% nie mówi, czy bank urósł dwukrotnie, czy skurczył się o połowę.
# Biegły w opinii MBR omawia obie warstwy i tak samo musi umieć aplikacja.

GRUPY: list[tuple[str, list[tuple[str, str]]]] = [
    ("Suma bilansowa i portfel", [
        ("aktywa_ogolem", "Aktywa ogółem"),
        ("kredyty_brutto", "Kredyty i pożyczki udzielone klientom"),
        ("naleznosci_nominalne", "Należności ogółem wg wartości nominalnej (brutto)"),
        ("kredyty_zagrozone", "w tym kredyty zagrożone"),
        ("rezerwy_utworzone", "Rezerwy celowe utworzone na należności (stan)"),
        ("odpisy", "Odpisy z tytułu utraty wartości"),
    ]),
    ("Struktura finansowania", [
        ("zobowiazania_ogolem", "Zobowiązania ogółem"),
        ("depozyty_klientow", "Depozyty klientów"),
        ("finansowanie_hurtowe", "Finansowanie hurtowe (emisje dłużne, rynek międzybankowy)"),
        ("kapital_wlasny", "Kapitał własny"),
    ]),
    ("Fundusze własne i ekspozycja na ryzyko", [
        ("kapital_cet1", "Kapitał podstawowy Tier 1 (CET1)"),
        ("kapital_at1", "Kapitał dodatkowy Tier 1"),
        ("kapital_tier2", "Kapitał Tier 2"),
        ("fundusze_wlasne", "Fundusze własne razem"),
        ("aktywa_wazone_ryzykiem", "Aktywa ważone ryzykiem (RWA)"),
        # Pojęcia rubryki banku zrzeszającego (art. 127 Prawa bankowego w brzmieniu
        # sprzed CRR) — czytane z tabeli funduszy własnych w informacji dodatkowej.
        ("fundusz_udzialowy", "Fundusz udziałowy"),
        ("fundusze_podstawowe", "Fundusze podstawowe"),
    ]),
    ("Rachunek wyników", [
        ("przychody_odsetkowe", "Przychody odsetkowe"),
        ("wynik_odsetkowy", "Wynik z tytułu odsetek"),
        ("wynik_dzialalnosci_bankowej", "Wynik działalności bankowej"),
        ("koszty_dzialania", "Koszty działania banku"),
        ("wynik_z_rezerw", "Różnica wartości rezerw i aktualizacji (saldo odpisów)"),
        ("zysk_netto", "Zysk netto"),
    ]),
]


def strony_pol(o: Odczyt, plik: str = "") -> dict[str, str]:
    """Pole modelu → miejsce w sprawozdaniu, z którego je odczytano („str. 47").

    Bez wskazania strony biegły nie ma jak zweryfikować liczby w oryginale, a opinia
    dowodowa musi być sprawdzalna. Pierwsze trafienie wygrywa — tak samo jak
    w `zbuduj_pozycje`, żeby wskazana strona odpowiadała wziętej wartości.

    `plik` dopisujemy, gdy okresy pochodzą z KILKU sprawozdań: sam numer strony
    byłby wtedy dwuznaczny, bo „str. 47" jest w każdym z nich.
    """
    out: dict[str, str] = {}
    for k in o.kandydaci:
        out.setdefault(k.pole, f"{plik}, str. {k.strona}" if plik else f"str. {k.strona}")
    return out


def _fmt_kwota(v: float) -> str:
    s = f"{v:,.0f}".replace(",", " ") if abs(v) >= 1000 else f"{v:,.2f}".replace(",", " ")
    return s.replace(".", ",")


def zestawienie(poz: list[Pozycje], strony: dict[str, str] | None = None) -> dict:
    """Tabela kwot ze sprawozdań: wiersz na pozycję, kolumna na dzień bilansowy.

    ⚠️ JEDNOSTKA JEST TAKA, JAK W SPRAWOZDANIU — silnik czyta liczby z tabeli i nie
    wie, czy są w tysiącach czy w milionach ani w jakiej walucie; sprawozdania podają
    to w nagłówku, którego ekstrakcja nie zachowuje. Przeliczanie „na wszelki wypadek"
    dałoby w opinii kwotę fałszywą, więc podajemy odczyt surowy i mówimy to wprost.

    Zmiana liczona jest od PIERWSZEGO do OSTATNIEGO okresu, w którym pozycja
    występuje — pozycje nieobecne w części okresów mają puste komórki i widać,
    czego zmiana dotyczy.
    """
    okresy = sorted({p.dzien for p in poz})
    wg_dnia = {p.dzien: p for p in sorted(poz, key=lambda x: x.dzien)}
    strony = strony or {}

    rows: list[list[str]] = []
    findings: list[str] = []
    for tytul_grupy, pola in GRUPY:
        wiersze_grupy: list[list[str]] = []
        for pole, etykieta in pola:
            wartosci = [getattr(wg_dnia[d], pole, None) if d in wg_dnia else None for d in okresy]
            if all(v is None for v in wartosci):
                continue  # pozycji nie odczytano w żadnym okresie — nie ma czego pokazać
            obecne = [(d, v) for d, v in zip(okresy, wartosci) if v is not None]
            zmiana = "—"
            if len(obecne) >= 2 and obecne[0][1]:
                p_od, p_do = obecne[0], obecne[-1]
                pct = 100.0 * (p_do[1] - p_od[1]) / abs(p_od[1])
                zmiana = f"{pct:+.1f}%"
                if abs(pct) >= 20.0:
                    findings.append(
                        f"{etykieta}: {_fmt_kwota(p_od[1])} ({p_od[0]}) → {_fmt_kwota(p_do[1])} "
                        f"({p_do[0]}), zmiana {pct:+.1f}%."
                    )
            wiersze_grupy.append([
                etykieta,
                *[(_fmt_kwota(v) if v is not None else "—") for v in wartosci],
                zmiana,
                strony.get(pole, "—"),
            ])
        if wiersze_grupy:
            # Nagłówek grupy jako wiersz — tabela w opinii nie ma podtytułów sekcji.
            rows.append([tytul_grupy] + [""] * (len(okresy) + 2))
            rows += wiersze_grupy

    return {
        "caption": "Tabela. Pozycje sprawozdań finansowych kontrahenta w jednostce i walucie sprawozdania "
                   "(odczyt surowy — bez przeliczeń)",
        "head": ["Pozycja"] + okresy + ["Zmiana", "Źródło"],
        "rows": rows,
        "findings": findings,
        "okresy": okresy,
    }


def _kw(v: float) -> str:
    """Kwota w tresci uwagi — ten sam zapis co w tabeli. Osobna funkcja, bo
    `.replace(",", …)` puszczone na cale zdanie zjadalo tez przecinki w tekscie
    uwagi (wychodzilo „to niemozliwe  depozyty sa ich skladnikiem")."""
    return _fmt_kwota(v)


def sprawdz_bilans(poz: list[Pozycje]) -> list[str]:
    """Kontrola wiarygodności odczytu pozycji bilansowych — per okres.

    `sprawdz_spojnosc` pilnuje składników KAPITAŁU, bo współczynniki adekwatności
    liczą się z noty kapitałowej, przypiętej do jednej strony. Pozycje bilansu i
    wyniku takiego przypięcia nie mają — ekstrakcja bierze je z różnych stron i
    z dwóch sprawozdań naraz, więc kolumna potrafi się rozjechać.

    NA CZYM TO ZŁAPANO: w sprawie MBR kolumna 2007 dała aktywa 1 043 029 przy
    zobowiązaniach 586 381 i kapitale 169 969 — bilans nie domykał się o 27,5%,
    podczas gdy 2008 zgadzał się co do jednostki, a 2006 z dokładnością 0,1%.
    Bez tej kontroli błędna kolumna weszłaby do opinii jako spadek sumy bilansowej
    o połowę i wróciła z sądu jako zarzut.

    Nie usuwamy okresu z odczytu — usunięcie danych jest gorsze niż ich oznaczenie.
    Biegły sprawdza wskazaną stronę w oryginale i rozstrzyga.
    """
    uwagi: list[str] = []
    for p in sorted(poz, key=lambda x: x.dzien):
        a, z, kw = p.aktywa_ogolem, p.zobowiazania_ogolem, p.kapital_wlasny
        if a and z is not None and kw is not None:
            roznica = a - (z + kw)
            if abs(roznica) > 0.01 * abs(a):
                uwagi.append(
                    f"{p.dzien}: bilans nie domyka się — aktywa {_kw(a)} wobec sumy zobowiązań "
                    f"({_kw(z)}) i kapitału własnego ({_kw(kw)}) = {_kw(z + kw)}; różnica "
                    f"{_kw(roznica)} ({100 * abs(roznica) / abs(a):.1f}%). Któraś z pozycji pochodzi "
                    "z innego zakresu sprawozdania — zweryfikuj w oryginale przed użyciem w opinii."
                )
        if p.depozyty_klientow and z and p.depozyty_klientow > z:
            uwagi.append(
                f"{p.dzien}: depozyty klientów ({_kw(p.depozyty_klientow)}) przewyższają zobowiązania "
                f"ogółem ({_kw(z)}) — to niemożliwe, depozyty są ich składnikiem."
            )
        if p.kredyty_zagrozone and p.kredyty_brutto and p.kredyty_zagrozone > p.kredyty_brutto:
            uwagi.append(f"{p.dzien}: kredyty zagrożone przewyższają portfel kredytowy brutto.")
        if p.wynik_odsetkowy and p.przychody_odsetkowe and p.wynik_odsetkowy > p.przychody_odsetkowe:
            uwagi.append(f"{p.dzien}: wynik odsetkowy przewyższa przychody odsetkowe.")

    # Ta sama kwota w dwóch kolejnych okresach to prawie zawsze skutek przepisania
    # kolumny, a nie rzeczywistej stagnacji: pozycje sprawozdania idą w tysiącach
    # i trafienie co do jednostki dwa lata z rzędu nie zdarza się.
    okresy = sorted({p.dzien for p in poz})
    wg = {p.dzien: p for p in poz}
    for pole, etykieta in [(f, e) for _, pola in GRUPY for f, e in pola]:
        for d1, d2 in zip(okresy, okresy[1:]):
            v1, v2 = getattr(wg[d1], pole, None), getattr(wg[d2], pole, None)
            if v1 is not None and v1 == v2 and abs(v1) >= 1000:
                uwagi.append(
                    f"{d1} i {d2}: pozycja „{etykieta}” ma identyczną wartość {_kw(v1)} w obu okresach — "
                    "prawdopodobnie ta sama kolumna przypisana dwa razy."
                )
    return uwagi


# ── Pozycje z tabel odczytanych Z OBRAZU stron sprawozdania ──────────────────
# OCR spłaszcza tabelę bilansu do potoku słów i gubi przynależność liczby do
# kolumny — w raporcie EBI SK Banku warstwa tekstowa dała „kredyty = 300 zł”
# przy sumie bilansowej 3,8 mld. Odczyt z obrazu (scripts/tabele_z_obrazu.py
# --tryb bilans) widzi linie tabeli i nagłówki kolumn; ten blok zamienia jego
# wynik na `Pozycje` — z kontrolą, której odczyt tekstowy dać nie może:
# bilans MUSI się domykać, a wartości absurdalne wobec sumy bilansowej są
# odrzucane GŁOŚNO, nie po cichu.

# Etykiety wierszy sprawozdania wg układu PSR (banki krajowe). Dopasowanie do
# POCZĄTKU etykiety po zdjęciu numeracji porządkowej; wzorce z `$` wymagają
# całej etykiety — „Udziałowy” ma NIE łapać „Udziałowy (amortyzowany)” z rachunku
# wg CRR, bo to inna metodyka i inna wartość.
ETYKIETY_TABEL: list[tuple[re.Pattern, str]] = [
    (re.compile(r"^aktywa razem"), "aktywa_ogolem"),
    (re.compile(r"^pasywa razem"), "_pasywa_razem"),
    # Nota klasyfikacyjna: „…brutto” to należności NOMINALNE (przed rezerwami
    # i prowizjami) — wzorzec MUSI stać przed bilansowym, bo tamten dopasowuje
    # się do początku i połknąłby też „…brutto” i „…netto”.
    (re.compile(r"^należności od sektora niefinansowego brutto"), "naleznosci_nominalne"),
    (re.compile(r"^należności od sektora niefinansowego(?!\s+brutto|\s+netto)"), "kredyty_brutto"),
    (re.compile(r"^należności zagrożone"), "kredyty_zagrozone"),
    (re.compile(r"^rezerwy celowe na należności"), "rezerwy_utworzone"),
    (re.compile(r"^zobowiązania wobec sektora niefinansowego"), "depozyty_klientow"),
    (re.compile(r"^kapitał własny na koniec okresu"), "kapital_wlasny"),
    (re.compile(r"^zysk \(strata\) netto$|^wynik netto$|^zysk netto$"), "zysk_netto"),
    (re.compile(r"^przychody z tytułu odsetek"), "przychody_odsetkowe"),
    (re.compile(r"^wynik z tytułu odsetek"), "wynik_odsetkowy"),
    (re.compile(r"^koszty działania banku"), "koszty_dzialania"),
    (re.compile(r"^wynik działalności bankowej"), "wynik_dzialalnosci_bankowej"),
    # Saldo odpisów (odpisy − rozwiązania) DODATNIE = obciążenie wyniku. Konwencję
    # potwierdza zgodność z wartością wykazaną przez BPS: 10 174 447,13 / WDB za
    # 2013 = 15,43% wobec 15,23% w ocenie zrzeszającego na 31.12.2013.
    (re.compile(r"^różnica wartości rezerw i aktualizacji"), "wynik_z_rezerw"),
    (re.compile(r"^udziałowy$"), "fundusz_udzialowy"),
    (re.compile(r"^fundusze podstawowe$"), "fundusze_podstawowe"),
    # Fundusze własne występują w sprawozdaniu SK Banku W DWÓCH METODYKACH
    # (art. 127 pb: 396,3 mln; CRR: 389,6 mln) — wiersz jest rozstrzygany przy
    # tabeli po jej kluczu `metodyka`, nigdy ślepo (patrz pętla niżej).
    (re.compile(r"^fundusze własne$"), "_fundusze_wlasne"),
    # Współczynnik wypłacalności bywa OSTATNIM WIERSZEM bilansu banku spółdzielczego.
    # To wartość WYKAZANA przez bank (silnik nie ma RWA, żeby ją policzyć) — idzie
    # osobnym kanałem, nigdy do pól `Pozycje`.
    (re.compile(r"^współczynnik wypłacalności"), "_wsp_wyplacalnosci"),
]

# Pola objęte kontrolą domknięcia bilansu — czytane z tabel AKTYWA/PASYWA.
# Kapitał własny pochodzi z zestawienia zmian (osobna tabela o własnych kolumnach),
# a pozycje wynikowe z RZiS — niedomknięty bilans ich nie unieważnia.
_POLA_BILANSOWE_TABEL = {"aktywa_ogolem", "kredyty_brutto", "depozyty_klientow"}

# Numeracja porządkowa wiersza: „1.2.”, „a)”, „IV.”, wiodący myślnik wyliczenia.
_NUMERACJA_TABEL = re.compile(r"^\s*(?:[-–—]\s*)?(?:(?:[ivxlc]+|\d+(?:\.\d+)*|[a-z])[.)])?\s*")


def _etykieta_tabeli(s: str) -> str:
    return _NUMERACJA_TABEL.sub("", str(s).strip().lower(), count=1).strip()


def _dzien_kolumny(s: str, uwagi: list[str], strona: int) -> str | None:
    """Nagłówek kolumny → dzień ISO.

    „31.12.2013 r.” → 2013-12-31. Sam rok („2014 r.”) — nagłówek rachunku zysków
    i strat oraz zestawienia zmian — oznacza OKRES roczny; przypisujemy go do dnia
    bilansowego kończącego okres, bo tak te wielkości wchodzą do szeregu (patrz
    POLA_WYNIKOWE). Przypisanie jest odnotowywane: to wniosek z układu sprawozdania
    rocznego, nie odczyt daty.
    """
    t = str(s).strip()
    m = _DATA.search(t)
    if m:
        d, mies, rok = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1 <= d <= 31 and 1 <= mies <= 12 and 1990 <= rok <= _dzis().year:
            return f"{rok:04d}-{mies:02d}-{d:02d}"
        return None
    m = re.fullmatch(r"(\d{4})\s*r?\.?", t)
    if m and 1990 <= int(m.group(1)) <= _dzis().year:
        iso = f"{int(m.group(1)):04d}-12-31"
        u = (f"str. {strona}: kolumna roczna „{t}” przypisana do dnia bilansowego {iso} "
             "(okres roczny kończy się w tym dniu).")
        if u not in uwagi:
            uwagi.append(u)
        return iso
    return None


def pozycje_z_tabel(
    tabele: list[dict],
    uwagi: list[str] | None = None,
) -> tuple[list[Pozycje], list[tuple[str, float]], list[str], dict[str, str]]:
    """Tabele z obrazu stron → (pozycje, wykazane_wspolczynniki, zastrzezenia, miejsca).

    Format wejścia = wyjście scripts/tabele_z_obrazu.py (kolumny, wiersze z etykietą
    i wartościami, strona, opcjonalnie plik) — ten sam, który dla chronologii
    konsumuje `okresyZTabel` w lib/opinion/chronologia-run.ts.

    KONTYNUACJE STRON: tabela bez rozpoznanej kolumny daty dziedziczy kolumny
    z tabeli POPRZEDNIEJ, jeżeli pochodzi z tego samego pliku, z następnej strony
    i każdy jej wiersz ma tyle wartości, ile odziedziczonych kolumn. Tak są łamane
    wielostronicowe tabele sprawozdania (pasywa, RZiS, zestawienie zmian) — model
    czytający obraz słusznie nie zgaduje dat, których na stronie nie ma, ale układ
    dokumentu jest tu regułą, nie domysłem. Dziedziczenie jest odnotowywane.
    """
    uwagi = uwagi if uwagi is not None else []
    zastrzezenia: list[str] = []
    miejsca: dict[str, str] = {}
    wykazane: dict[str, float] = {}
    wartosci: dict[tuple[str, str], float] = {}
    # (plik, strona, pary indeks→dzień, liczba kolumn oryginału) — do dziedziczenia
    # przez strony-kontynuacje. Liczba kolumn osobno, bo pary pomijają kolumny
    # procentowe, a wiersz kontynuacji musi mieć tyle wartości, ile KOLUMN tabeli.
    poprzednia: tuple[str, int, list[tuple[int, str]], int] | None = None

    for t in tabele or []:
        plik = str(t.get("plik") or "")
        strona = int(t.get("strona") or 0)
        kolumny = t.get("kolumny") or []
        # Noty klasyfikacyjne mają pod jedną datą DWIE kolumny: kwotę i udział
        # („Wartość na 31.12.2014r. | zł | %”). Kolumna procentowa niesie strukturę,
        # nie kwotę — wzięta po indeksie podstawiłaby 45,76 pod pozycję w złotych.
        pary = [(i, d) for i, k in enumerate(kolumny)
                if "%" not in str(k) and (d := _dzien_kolumny(k, uwagi, strona))]
        n_kol = len(kolumny)
        wiersze = t.get("wiersze") or []
        if not pary:
            odz = poprzednia
            if (odz and plik == odz[0] and strona == odz[1] + 1
                    and wiersze and all(len(w.get("wartosci") or []) == odz[3] for w in wiersze)):
                pary, n_kol = odz[2], odz[3]
                uwagi.append(
                    f"{plik or 'tabela'}, str. {strona}: kontynuacja tabeli ze str. {odz[1]} — "
                    f"kolumny odziedziczone ({', '.join(d for _, d in pary)})."
                )
            else:
                zastrzezenia.append(
                    f"{plik or 'tabela'}, str. {strona}: nie rozpoznano kolumn dat i nie ma "
                    "poprzedzającej strony o zgodnym układzie — tabelę pominięto."
                )
                continue
        poprzednia = (plik, strona, pary, n_kol)
        gdzie = f"{plik}, str. {strona} (tabela z obrazu)" if plik else f"str. {strona} (tabela z obrazu)"
        metodyka = str(t.get("metodyka") or "").strip().lower()

        for w in wiersze:
            pole = next((p for wz, p in ETYKIETY_TABEL if wz.match(_etykieta_tabeli(w.get("etykieta", "")))), None)
            if pole is None:
                continue
            for i, dzien in pary:
                surowa = str((w.get("wartosci") or [])[i] if i < len(w.get("wartosci") or []) else "").strip()
                v = _liczba(surowa.rstrip("%").strip()) if pole == "_wsp_wyplacalnosci" else _liczba(surowa)
                if v is None:
                    continue
                if pole == "_wsp_wyplacalnosci":
                    wykazane.setdefault(dzien, v)
                    miejsca.setdefault("wsp_wyplacalnosci_wykazany", gdzie)
                    continue
                pole_w = pole
                if pole == "_fundusze_wlasne":
                    # Dwie metodyki funduszy własnych w jednym sprawozdaniu (art. 127 pb
                    # i CRR) NIE MOGĄ trafić do jednego pola. Do `fundusze_wlasne` wchodzi
                    # wyłącznie rachunek wg CRR — bo to z niego bank policzył wykazany
                    # współczynnik wypłacalności i tylko to parowanie jest metodycznie
                    # jednorodne przy odtwarzaniu RWA. Wartość wg art. 127 zostaje
                    # odnotowana; tabela bez oznaczenia metodyki nie wchodzi wcale.
                    if metodyka == "crr":
                        pole_w = "fundusze_wlasne"
                    elif metodyka == "pb":
                        uwagi.append(
                            f"{dzien}: fundusze własne wg art. 127 Prawa bankowego = {_kw(v)} "
                            f"({gdzie}) — NIE weszły do pozycji: do wskaźników idzie rachunek "
                            "wg CRR, z którego bank policzył wykazany współczynnik."
                        )
                        continue
                    else:
                        zastrzezenia.append(
                            f"{dzien}: wiersz „Fundusze własne” w tabeli bez klucza `metodyka` "
                            f"(pb|crr) — pominięty ({gdzie}); oznacz tabelę, żeby rozstrzygnąć, "
                            "która z metodyk sprawozdania to jest."
                        )
                        continue
                stara = wartosci.get((dzien, pole_w))
                if stara is None:
                    wartosci[(dzien, pole_w)] = v
                    if not pole_w.startswith("_"):
                        miejsca.setdefault(pole_w, gdzie)
                elif abs(stara - v) > 1:
                    # Ta sama pozycja czytana z dwóch miejsc sprawozdania (np. zysk netto
                    # w pasywach i w RZiS) MUSI się zgadzać — rozjazd to błąd odczytu
                    # albo dokumentu i nie wolno go wygładzić wyborem jednej z wartości.
                    zastrzezenia.append(
                        f"{dzien}: pozycja „{w.get('etykieta')}” odczytana dwukrotnie z różnymi "
                        f"wartościami ({_kw(stara)} i {_kw(v)}) — przyjęto pierwszą; zweryfikuj "
                        f"w oryginale ({gdzie})."
                    )

    # ── Walidacje per dzień: domknięcie bilansu i wartości absurdalne ────────
    dni_wszystkie = sorted({d for d, _ in wartosci})
    for dzien in dni_wszystkie:
        a = wartosci.get((dzien, "aktywa_ogolem"))
        p = wartosci.get((dzien, "_pasywa_razem"))
        if a is not None and p is not None:
            if abs(a - p) > 0.002 * max(abs(a), abs(p)):
                zastrzezenia.append(
                    f"{dzien}: bilans z tabel NIE DOMYKA SIĘ — aktywa razem {_kw(a)} wobec pasywów "
                    f"razem {_kw(p)}; pozycje bilansowe tego dnia odrzucono. Zweryfikuj odczyt "
                    "stron bilansu w oryginale."
                )
                for pole in _POLA_BILANSOWE_TABEL:
                    wartosci.pop((dzien, pole), None)
        elif a is not None and p is None:
            uwagi.append(f"{dzien}: tabele nie zawierają wiersza „Pasywa razem” — domknięcia bilansu nie sprawdzono.")
        elif p is not None and a is None:
            uwagi.append(f"{dzien}: tabele nie zawierają wiersza „Aktywa razem” — domknięcia bilansu nie sprawdzono.")

        a = wartosci.get((dzien, "aktywa_ogolem"))
        if a is not None and a <= 0:
            zastrzezenia.append(f"{dzien}: aktywa razem ≤ 0 ({_kw(a)}) — wartość odrzucona.")
            wartosci.pop((dzien, "aktywa_ogolem"), None)
            a = None
        for pole in ("kredyty_brutto", "depozyty_klientow", "kapital_wlasny"):
            v = wartosci.get((dzien, pole))
            if v is None:
                continue
            if v < 0:
                zastrzezenia.append(
                    f"{dzien}: {pole} ujemne ({_kw(v)}) — wartość odrzucona.")
                wartosci.pop((dzien, pole), None)
            elif a is not None and v > 1.02 * a:
                zastrzezenia.append(
                    f"{dzien}: {pole} ({_kw(v)}) przewyższa sumę bilansową ({_kw(a)}) — składnik nie "
                    "może być większy od całości; wartość odrzucona.")
                wartosci.pop((dzien, pole), None)
            elif a is not None and v < 0.0005 * a:
                zastrzezenia.append(
                    f"{dzien}: {pole} = {_kw(v)} przy sumie bilansowej {_kw(a)} — wartość absurdalnie "
                    "mała wobec całości — najpewniej obcięty odczyt; odrzucona.")
                wartosci.pop((dzien, pole), None)

        # Nota klasyfikacyjna: zagrożone i rezerwy są PODZBIOREM należności ogółem
        # wg wartości nominalnej — składnik większy od całości to błąd odczytu.
        nom = wartosci.get((dzien, "naleznosci_nominalne"))
        for pole in ("kredyty_zagrozone", "rezerwy_utworzone"):
            v = wartosci.get((dzien, pole))
            if v is None:
                continue
            if v < 0:
                zastrzezenia.append(f"{dzien}: {pole} ujemne ({_kw(v)}) — wartość odrzucona.")
                wartosci.pop((dzien, pole), None)
            elif nom is not None and v > 1.02 * nom:
                zastrzezenia.append(
                    f"{dzien}: {pole} ({_kw(v)}) przewyższa należności ogółem wg wartości "
                    f"nominalnej ({_kw(nom)}) — składnik nie może być większy od całości; "
                    "wartość odrzucona.")
                wartosci.pop((dzien, pole), None)

    out: list[Pozycje] = []
    for dzien in dni_wszystkie:
        pz = Pozycje(dzien=dzien)
        ma = False
        for (d, pole), v in wartosci.items():
            if d == dzien and not pole.startswith("_"):
                setattr(pz, pole, v)
                ma = True
        if ma:
            out.append(pz)
    return out, sorted(wykazane.items()), zastrzezenia, miejsca
