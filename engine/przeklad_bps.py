"""Przekład nazw wskaźników z ocen banku zrzeszającego na kody rubryki.

CO TO ROZWIĄZUJE
Silnik liczył wskaźniki rubryki z surowych pozycji sprawozdawczych (wynik działalności
bankowej, aktywa płynne, pasywa niestabilne). W aktach SK Banku tych pozycji nie ma
w ŻADNYM z ośmiu okresów, więc dwanaście z szesnastu wskaźników zostawało nieobliczone.

Tymczasem uchwała nr 12/14/AB/BS/2002 zobowiązywała Bank BPS do liczenia dokładnie tych
wskaźników — i BPS je policzył, a WARTOŚCI WPISAŁ DO SWOICH KWARTALNYCH OCEN. Leżą
w aktach od początku, tyle że jako liczby w prozie oceny, nie jako tabela sprawozdania.

⚠️ STATUS DOWODOWY JEST INNY I MUSI BYĆ WIDOCZNY.
Wartość policzona przez biegłego z pozycji sprawozdania to ustalenie własne. Wartość
przepisana z oceny BPS to ustalenie o TREŚCI DOKUMENTU: „zrzeszający wykazał X".
W tej sprawie różnica jest istotą rzeczy — bank wykazywał współczynnik wypłacalności
13,84% przy nietworzeniu wymaganych rezerw, więc wartość wykazana bywa właśnie tym,
co się kwestionuje. Dlatego wartości stąd wchodzą do rubryki ZE ŹRÓDŁEM, a nie jako
liczby biegłego.

⚠️ PRZEKŁAD JEST RĘCZNY, NIE ROZMYTY.
Dopasowanie po zbieżności słów dawało 14/16, ale myliło pozycje: „Pokrycie należności
zagrożonych rezerwami" trafiało na „udział należności zagrożonych", a „Wskaźnik
płynności aktywów" na „aktywa przychodowe pracujące". W dokumencie sądowym taki błąd
wsadza wskaźnik płynności pod adekwatność kapitałową i nikt tego nie zauważy. Każda
para poniżej jest sprawdzona pozycja po pozycji na realnych ocenach z akt SK Banku.

BPS NAZYWA TEN SAM WSKAŹNIK RÓŻNIE W RÓŻNYCH KWARTAŁACH — stąd listy wariantów
(„relacja obliga kredytowego do depozytów" i „…do stanu depozytów" to jedno i to samo).
"""
from __future__ import annotations

import re

# kod rubryki → warianty nazw używane przez BPS (małymi literami, bez interpunkcji)
PRZEKLAD: dict[str, tuple[str, ...]] = {
    # ── Adekwatność kapitałów ────────────────────────────────────────────────
    "wsp_wyplacalnosci": ("wspolczynnik wyplacalnosci",),
    "roe": ("roe netto", "roe"),
    # BPS formułuje ten wskaźnik inaczej w każdym kwartale — cztery zapisy na cztery
    # oceny. ⚠️ NIE MYLIĆ z pozycją „zobowiązanie podporządkowane w funduszach
    # własnych" (17,67% / 16,10% / 15,01%): to udział w funduszach, inny wskaźnik,
    # inna wielkość, i wpisanie go tutaj podmieniłoby treść rubryki.
    "odpis_podporzadkowane": (
        "roczny odpis zobowiazan podporzadkowanych do zannualizowanego wyniku finansowego netto",
        "roczny odpis zobowiazania podporzadkowanego do wyniku finansowego netto",
        "roczny odpis zobowiazania podporzadkowanego zannualizowany wynik finansowy netto",
        "roczny odpis zobowiazania podporzadkowanego do zannualizowanego wyniku netto",
    ),
    "fundusz_udzialowy": ("fundusz udzialowy w funduszach podstawowych",),
    # ── Jakość aktywów ───────────────────────────────────────────────────────
    # ⚠️ DWA RÓŻNE MIANOWNIKI, NIE JEDEN WSKAŹNIK. BPS podaje zagrożone zarówno
    # w obligu kredytowym (= należności ogółem), jak i w aktywach ogółem —
    # zlanie ich dałoby ten sam odczyt w dwóch wierszach rubryki o różnych wagach.
    "naleznosci_zagrozone": (
        "zagrozone ekspozycje kredytowe w obligu kredytowym",
        "udzial naleznosci zagrozonych w naleznosciach ogolem",
    ),
    "zagrozone_do_aktywow": ("zagrozone ekspozycje kredytowe w aktywach ogolem",),
    "aktywa_pracujace": (
        "relacja aktywow przychodowych pracujacych do aktywow ogolem",
        "udzial aktywow pracujacych w sumie aktywow netto",
    ),
    # Pokrycie rezerwami: BPS podaje saldo odpisów, nie relację utworzone/wymagane.
    # ŚWIADOMIE PUSTE — przepisanie salda w to miejsce byłoby podmianą wskaźnika.
    "pokrycie_rezerwami": (),
    # ── Efektywność działania ────────────────────────────────────────────────
    "roa": ("roa netto", "roa"),
    "marza_odsetkowa": ("marza odsetkowa",),
    # ⚠️ WYKLUCZONE WARIANTY GRUPOWE. BPS podaje obok wskaźnika banku ten sam
    # wskaźnik DLA GRUPY („- grupa", „średnia w grupie", „w grupie"). Wciągnięcie
    # ich do rubryki podstawiłoby cudzą wielkość pod ocenę tego banku — a różnica
    # bywa duża (48,87% bank wobec 58,08% grupa na 31.03.2014).
    "koszty_do_wyniku": (
        "koszty dzialania do wyniku dzialalnosci bankowej",
        "koszty dzialania wynik dzialalnosci bankowej",
        "koszty dzialania absorbujace wynik dzialalnosci bankowej",
    ),
    # Rubryka nazywa to „wynikiem z rezerw celowych", BPS — „saldem odpisów
    # aktualizujących". To ta sama wielkość pod dwiema konwencjami nazewniczymi
    # (rezerwy celowe wg PSR, odpisy aktualizujące wg MSR).
    #
    # ⚠️ TYLKO POSTACI RELACYJNE. Samo „saldo odpisów aktualizujących" (6 wystąpień)
    # to KWOTA w tysiącach złotych, nie procent — wpisana do rubryki dałaby wskaźnik
    # rzędu 12 000% zamiast 12%.
    "rezerwy_do_wyniku": (
        "saldo odpisow w wyniku dzialalnosci bankowej",
        "saldo odpisow wynik dzialalnosci bankowej",
        "saldo odpisow do wyniku dzialalnosci bankowej",
        "saldo odpisow aktualizujacych do wyniku dzialalnosci bankowej",
        "udzial salda odpisow w wyniku dzialalnosci bankowej",
    ),
    # ── Płynność finansowa ───────────────────────────────────────────────────
    "plynnosc_aktywow": ("udzial aktywow plynnych w aktywach ogolem",),
    "plynne_do_niestabilnych": (
        "poziom zabezpieczenia pasywow niestabilnych aktywami plynnymi",
        "zabezpieczenie pasywow niestabilnych aktywami plynnymi",
    ),
    "kredyty_do_depozytow": (
        "relacja obliga kredytowego do depozytow",
        "relacja obliga kredytowego do stanu depozytow",
    ),
    "stabilnosc_depozytow": ("relacja depozytow stabilnych do depozytow ogolem",),
}

_OGONKI = str.maketrans("ąćęłńóśźż", "acelnoszz")


def klucz(nazwa: str) -> str:
    """Nazwa sprowadzona do postaci porównywalnej — bez ogonków i interpunkcji.

    BPS zapisuje tę samą pozycję raz z myślnikiem, raz z ukośnikiem, raz wielką
    literą. Porównywanie surowych napisów gubiłoby połowę trafień.
    """
    return re.sub(r"\s+", " ", re.sub(r"[^a-z ]", " ", nazwa.lower().translate(_OGONKI))).strip()


# Odwrotna mapa: znormalizowana nazwa BPS → kod rubryki.
_WG_NAZWY: dict[str, str] = {
    klucz(w): kod for kod, warianty in PRZEKLAD.items() for w in warianty
}


def kod_rubryki(nazwa_bps: str) -> str | None:
    """Kod wskaźnika rubryki dla nazwy użytej przez BPS. None = brak przekładu.

    None znaczy „nie wiem", nie „nie ma" — pozycja nieprzełożona ma zostać
    widoczna jako nieobsłużona, a nie po cichu wpaść do najbliższego wiersza.
    """
    return _WG_NAZWY.get(klucz(nazwa_bps))


def liczba(wartosc: str | float | int | None) -> float | None:
    """Wartość liczbowa z zapisu BPS („12,85%", „3 529 130 tys. zł", „1,38").

    Zwraca None dla zapisów, których nie da się jednoznacznie odczytać — wartość
    zgadnięta z niejasnego napisu trafiłaby do tabeli w opinii jako liczba pewna.
    """
    if wartosc is None:
        return None
    if isinstance(wartosc, (int, float)):
        return float(wartosc)
    t = str(wartosc).strip().replace(" ", " ")
    # Separator tysięcy: spacja. Dziesiętny: przecinek. Kropka bywa i jednym, i drugim,
    # więc przy obecnym przecinku traktujemy kropkę jako separator tysięcy.
    t = re.sub(r"[^\d,.\-]", "", t.replace(" ", ""))
    if "," in t:
        t = t.replace(".", "").replace(",", ".")
    if t.count(".") > 1:
        return None
    try:
        return float(t)
    except ValueError:
        return None


def wartosci_wykazane(oceny: list[dict]) -> dict[str, dict[str, float]]:
    """Wskaźniki rubryki WYKAZANE przez zrzeszającego: kod → {dzień: wartość}.

    Wejście to lista odczytów z scripts/oceny_zrzeszajacego.py. Pozycje bez
    przekładu i bez czytelnej liczby są POMIJANE — mają zostać brakiem w rubryce,
    a nie wartością przybliżoną.
    """
    out: dict[str, dict[str, float]] = {}
    for o in oceny:
        dzien = o.get("dzien")
        if not dzien:
            continue
        for w in o.get("wskazniki") or []:
            kod = kod_rubryki(str(w.get("nazwa", "")))
            v = liczba(w.get("wartosc"))
            if kod and v is not None:
                out.setdefault(kod, {})[dzien] = v
    return out
