"""Chronologia nadzorcza — wskaźniki banku w czasie wraz z działaniami nadzoru.

CZYM RÓŻNI SIĘ OD `sprawozdania.py`
Tamten czyta SPRAWOZDANIE: kolumny są datami, wiersze pozycjami. Tutaj źródłem jest
narracja — harmonogram działań nadzorczych, wystąpienie pokontrolne, korespondencja —
w której daty siedzą w zdaniach („wg stanu na koniec IV kwartału 2013"), a tabele są
wplecione między akapity i po OCR mają pomieszane kolumny. Odczyt musi więc zrobić
model; kod robi to, czego modelowi robić nie wolno: liczy i sprawdza.

PO CO TO ISTNIEJE
W sprawie SK Banku (II C 595/23) teza dowodowa brzmi: „w jakim czasie pozwani mogli
rozsądnie uznać, że bank nie posiada stabilnej sytuacji finansowej". To pytanie o OŚ
CZASU, nie o stan na jeden dzień — a odpowiedź musi wskazywać, jakimi danymi nadzorca
dysponował W DANYM MOMENCIE, nie jakie są znane dziś.

⚠️ WARTOŚĆ WYKAZYWANA TO NIE TO SAMO CO RZECZYWISTA. Bank wykazywał współczynnik
wypłacalności 13,84% przy jednoczesnym nietworzeniu wymaganych rezerw; po ich
utworzeniu wynik spadł o 123 mln zł. Moduł operuje wartościami WYKAZANYMI i tak je
nazywa — ustalenie, ile wynosiły naprawdę, należy do biegłego, nie do arytmetyki.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class OkresNadzorczy:
    """Stan banku na jeden dzień sprawozdawczy, tak jak przedstawiał go nadzorca.

    Wszystkie pola opcjonalne: dokument narracyjny podaje różne wskaźniki w różnych
    okresach, a wskaźnik nieobecny ma zostać nieobecny, nie wyzerowany.
    """

    dzien: str  # ISO
    # Fragment narracji, z którego wynika data — bez niego nie da się sprawdzić,
    # czy okres przypisano właściwie.
    kontekst: str = ""
    suma_bilansowa: float | None = None
    portfel_kredytowy: float | None = None
    portfel_utrata: float | None = None
    udzial_utrata_pct: float | None = None  # jak podał dokument
    depozyty: float | None = None
    fundusze_wlasne: float | None = None
    wsp_wyplacalnosci_pct: float | None = None
    wynik_finansowy: float | None = None
    zrodlo: str = ""


@dataclass
class Zdarzenie:
    """Działanie nadzorcze albo ustalenie z jego przebiegu."""

    data: str  # ISO
    organ: str
    opis: str
    zrodlo: str = ""


@dataclass
class Chronologia:
    okresy: list[OkresNadzorczy] = field(default_factory=list)
    zdarzenia: list[Zdarzenie] = field(default_factory=list)


# Rozbieżność między udziałem podanym a policzonym większa niż ten próg oznacza,
# że wiersz pochodzi z dwóch różnych tabel. W punktach procentowych.
TOLERANCJA_PP = 0.15


def sprawdz_okresy(okresy: list[OkresNadzorczy]) -> list[str]:
    """Kontrola spójności wewnętrznej każdego okresu.

    NA CZYM TO ZŁAPANO: w harmonogramie UKNF wiersz za I kwartał 2013 dostał wartość
    „portfel z utratą wartości" z sąsiedniej tabeli za IV kwartał 2013 — OCR przeplata
    kolumny dwóch tabel leżących obok siebie na stronie. Iloraz nie zgadzał się wtedy
    z udziałem podanym w dokumencie (9,43% wobec 6,30%), co jest jedynym sygnałem,
    jaki w ogóle występuje: obie liczby z osobna wyglądają wiarygodnie.
    """
    uwagi: list[str] = []
    for o in okresy:
        if o.portfel_kredytowy and o.portfel_utrata is not None and o.udzial_utrata_pct is not None:
            policzony = 100.0 * o.portfel_utrata / o.portfel_kredytowy
            if abs(policzony - o.udzial_utrata_pct) > TOLERANCJA_PP:
                uwagi.append(
                    f"{o.dzien}: udział kredytów z utratą wartości nie zgadza się z ilorazem — "
                    f"{o.portfel_utrata:,.0f} / {o.portfel_kredytowy:,.0f} = {policzony:.2f}%, "
                    f"a dokument podaje {o.udzial_utrata_pct:.2f}%. Wartość pochodzi prawdopodobnie "
                    f"z tabeli sąsiedniego okresu — zweryfikuj w oryginale."
                    .replace(",", " ")
                )
        if o.portfel_utrata is not None and o.portfel_kredytowy and o.portfel_utrata > o.portfel_kredytowy:
            uwagi.append(f"{o.dzien}: portfel z utratą wartości przewyższa cały portfel kredytowy.")
        if o.depozyty and o.suma_bilansowa and o.depozyty > o.suma_bilansowa:
            uwagi.append(f"{o.dzien}: depozyty przewyższają sumę bilansową.")
        if not o.kontekst.strip():
            uwagi.append(
                f"{o.dzien}: brak fragmentu narracji, z którego wynika data — nie da się sprawdzić, "
                f"czy okres przypisano właściwie."
            )
    return uwagi


def udzial(o: OkresNadzorczy) -> float | None:
    """Udział kredytów z utratą wartości — POLICZONY, nie przepisany z dokumentu."""
    if o.portfel_kredytowy and o.portfel_utrata is not None:
        return round(100.0 * o.portfel_utrata / o.portfel_kredytowy, 2)
    return o.udzial_utrata_pct


@dataclass
class StanWiedzy:
    """Co było wiadome na dany dzień — i jak nieświeże były wtedy dane."""

    dzien_oceny: str
    okres: OkresNadzorczy
    dni_zwloki: int
    nastepny: OkresNadzorczy | None = None


def _dni(a: str, b: str) -> int:
    from datetime import date

    ra, rb = (date(*map(int, x.split("-"))) for x in (a, b))
    return (rb - ra).days


def stan_wiedzy_na_dzien(okresy: list[OkresNadzorczy], dzien: str) -> StanWiedzy | None:
    """Najświeższy okres NIE PÓŹNIEJSZY niż wskazany dzień.

    ⚠️ TO JEST SEDNO TEGO MODUŁU. Pytanie „co pozwani mogli rozsądnie uznać w dniu X"
    wymaga danych dostępnych W DNIU X, a nie najbliższych chronologicznie: sprawozdanie
    za III kwartał 2015 opisuje stan, o którym w marcu 2015 nikt wiedzieć nie mógł.
    Wzięcie najbliższego okresu w OBIE strony byłoby wnioskowaniem wstecznym wpisanym
    w arytmetykę — błędem tym trudniejszym do wychwycenia, że popełnionym przez kod.

    `dni_zwloki` mówi, jak stare były te dane — sprawozdawczość kwartalna trafia do
    nadzoru z opóźnieniem, więc sam fakt istnienia okresu nie znaczy, że był znany.
    """
    wczesniejsze = sorted([o for o in okresy if o.dzien <= dzien], key=lambda o: o.dzien)
    if not wczesniejsze:
        return None
    pozniejsze = sorted([o for o in okresy if o.dzien > dzien], key=lambda o: o.dzien)
    return StanWiedzy(
        dzien_oceny=dzien,
        okres=wczesniejsze[-1],
        dni_zwloki=_dni(wczesniejsze[-1].dzien, dzien),
        nastepny=pozniejsze[0] if pozniejsze else None,
    )


def przekroczenia(okresy: list[OkresNadzorczy], prog_udzialu_pct: float) -> list[tuple[str, float]]:
    """Okresy, w których udział kredytów z utratą wartości przekroczył próg.

    Zwraca (dzień, wartość) — moment przekroczenia jest odpowiedzią na pytanie „kiedy",
    a nie ilustracją; dlatego liczy się z wartości POLICZONEJ, nie z podanej.
    """
    out: list[tuple[str, float]] = []
    for o in sorted(okresy, key=lambda x: x.dzien):
        u = udzial(o)
        if u is not None and u > prog_udzialu_pct:
            out.append((o.dzien, u))
    return out


def dynamika(okresy: list[OkresNadzorczy], pole: str) -> list[tuple[str, float]]:
    """Zmiana procentowa pola między kolejnymi okresami, w których jest obecne."""
    punkty = [(o.dzien, getattr(o, pole)) for o in sorted(okresy, key=lambda x: x.dzien)]
    punkty = [(d, v) for d, v in punkty if v is not None]
    out: list[tuple[str, float]] = []
    for (_, a), (d2, b) in zip(punkty, punkty[1:]):
        if a:
            out.append((d2, round(100.0 * (b - a) / abs(a), 2)))
    return out
