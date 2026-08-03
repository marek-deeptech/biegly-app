"""Analiza ekonomiczno-finansowa banku — katalog wskaźników, wagi i punktacja.

SKĄD TO POCHODZI
Rubryka odczytana ZE SKANU uchwały nr 12/14/AB/BS/2002 Zarządu Banku Polskiej
Spółdzielczości S.A. w sprawie zasad monitorowania sytuacji ekonomiczno-finansowej
zrzeszonych banków spółdzielczych (akta SK Banku, plik SKM_C451i26080211470, k. 162
i nast.). Nie jest to zestaw wymyślony ani przepisany z podręcznika: to metodyka,
którą bank zrzeszający BYŁ ZOBOWIĄZANY stosować do SK Banku — i której zastosowanie
albo niezastosowanie jest przedmiotem sporu w sprawie II C 595/23.

⚠️ ODCZYTANE Z OBRAZU, NIE Z OCR. Warstwa tekstowa tej strony gubi wiersze tabeli
i myli etykiety: OCR dał 15 wskaźników zamiast 16 (zniknął „fundusz udziałowy/
fundusze podstawowe") i przekręcił drugi wskaźnik jakości aktywów na „aktywa
zagrożone/aktywa ogółem", podczas gdy dokument mówi „należności zagrożone/aktywa
ogółem". Wagi w każdym obszarze sumują się do 1,00 — to jest kontrola poprawności
odczytu i jest sprawdzana testem.

ALGORYTM PUNKTACJI (str. 4–5 uchwały)
1. Dla każdego wskaźnika, W OBRĘBIE GRUPY RÓWIEŚNICZEJ, ustala się 5 przedziałów
   wartości, uwzględniając skalę bezpieczeństwa, rozproszenie w grupie, rozkład
   gęstości i średnie w grupie.
2. Przedziałowi przypisuje się liczbę całkowitą 1–5. IM GORSZY WSKAŹNIK, TYM WYŻSZA
   LICZBA — skala jest odwrócona względem intuicji.
3. Punktacja wskaźnika = liczba przedziału × waga istotności.
4. Suma punktów w obszarze = wskaźnik cząstkowy; po zaokrągleniu → ocena cząstkowa (1–5).
5. Suma NIEZAOKRĄGLONYCH wskaźników cząstkowych = wskaźnik syntetyczny.
6. Rating = wskaźnik syntetyczny ÷ liczba obszarów; po zaokrągleniu → ocena globalna.
   1 = bardzo dobra sytuacja, 5 = zagrożenie funkcjonowania banku.

CZEGO DOKUMENT NIE PODAJE
Przedziałów dla piętnastu z szesnastu wskaźników ani wartości granicznych dla
poszczególnych grup rówieśniczych. Podaje jeden przykład — dla udziału należności
zagrożonych — i on jest tu zapisany. Punktacji pozostałych wskaźników NIE DA SIĘ
odtworzyć bez tych przedziałów i moduł tego nie udaje.
"""
from __future__ import annotations

from dataclasses import dataclass

from .bank import Pozycje

# ── Obszary ──────────────────────────────────────────────────────────────────
OBSZARY: dict[str, str] = {
    "adekwatnosc": "Adekwatność kapitałów",
    "jakosc_aktywow": "Jakość aktywów",
    "efektywnosc": "Efektywność działania",
    "plynnosc": "Płynność finansowa",
}


@dataclass(frozen=True)
class WskaznikEF:
    """Jeden wskaźnik rubryki: co dzielimy przez co i z jaką wagą."""

    kod: str
    obszar: str
    nazwa: str
    waga: float
    # Nazwy pól `Pozycje`. None w liczniku albo mianowniku = wskaźnika NIE DA SIĘ
    # policzyć z modelu sprawozdawczego, choć rubryka go wymaga.
    licznik: str | None
    mianownik: str | None
    jednostka: str = "%"


WSKAZNIKI_EF: list[WskaznikEF] = [
    # 1. Adekwatność kapitałów — wagi 0,50 + 0,30 + 0,10 + 0,10 = 1,00
    # ⚠️ Współczynnik wypłacalności liczy się z funduszy własnych i AKTYWÓW WAŻONYCH
    # RYZYKIEM. W aktach SK Banku RWA nie występuje ani razu — dostępna jest wyłącznie
    # wartość WYKAZANA przez bank, a wartość wykazana i policzona mają w tej sprawie
    # różny status dowodowy (bank wykazywał 13,84% przy nietworzeniu wymaganych rezerw).
    WskaznikEF("wsp_wyplacalnosci", "adekwatnosc", "Współczynnik wypłacalności", 0.50,
               "fundusze_wlasne", "aktywa_wazone_ryzykiem"),
    WskaznikEF("roe", "adekwatnosc", "Wskaźnik zwrotu z kapitału (ROE netto)", 0.30,
               "zysk_netto", "kapital_wlasny"),
    WskaznikEF("odpis_podporzadkowane", "adekwatnosc",
               "Roczny odpis zobowiązań podporządkowanych / zannualizowany wynik finansowy netto", 0.10,
               "odpis_zobowiazan_podporzadkowanych", "zysk_netto"),
    WskaznikEF("fundusz_udzialowy", "adekwatnosc", "Fundusz udziałowy / fundusze podstawowe", 0.10,
               "fundusz_udzialowy", "fundusze_podstawowe"),

    # 2. Jakość aktywów — 0,30 + 0,25 + 0,35 + 0,10 = 1,00
    WskaznikEF("naleznosci_zagrozone", "jakosc_aktywow",
               "Należności zagrożone / należności ogółem (wg wartości nominalnej)", 0.30,
               "kredyty_zagrozone", "kredyty_brutto"),
    WskaznikEF("zagrozone_do_aktywow", "jakosc_aktywow",
               "Należności zagrożone / aktywa ogółem (wg wartości nominalnej)", 0.25,
               "kredyty_zagrozone", "aktywa_ogolem"),
    WskaznikEF("aktywa_pracujace", "jakosc_aktywow", "Aktywa pracujące / aktywa bilansowe", 0.35,
               "aktywa_pracujace", "aktywa_ogolem"),
    # „Bez pomniejszeń podstawy ich tworzenia" — to jest wskaźnik pokrycia REZERWAMI
    # WYMAGANYMI, a nie relacja odpisów do portfela zagrożonego. Inny mianownik
    # znaczy inny wskaźnik; podstawienie `odpisy/kredyty_zagrozone` byłoby cichą
    # podmianą definicji narzuconej dokumentem.
    WskaznikEF("pokrycie_rezerwami", "jakosc_aktywow",
               "Pokrycie należności zagrożonych rezerwami celowymi (utworzone / wymagane)", 0.10,
               "rezerwy_utworzone", "rezerwy_wymagane"),

    # 3. Efektywność działania — 0,30 + 0,30 + 0,30 + 0,10 = 1,00
    WskaznikEF("roa", "efektywnosc", "Stopa zwrotu z aktywów (ROA netto)", 0.30,
               "zysk_netto", "aktywa_ogolem"),
    WskaznikEF("marza_odsetkowa", "efektywnosc", "Marża odsetkowa", 0.30,
               "wynik_odsetkowy", "aktywa_ogolem"),
    WskaznikEF("koszty_do_wyniku", "efektywnosc", "Koszty działania / wynik działalności bankowej", 0.30,
               "koszty_dzialania", "wynik_dzialalnosci_bankowej"),
    WskaznikEF("rezerwy_do_wyniku", "efektywnosc",
               "Wynik z rezerw celowych / wynik działalności bankowej", 0.10,
               "wynik_z_rezerw", "wynik_dzialalnosci_bankowej"),

    # 4. Płynność finansowa — 0,30 + 0,30 + 0,20 + 0,20 = 1,00
    WskaznikEF("plynnosc_aktywow", "plynnosc", "Wskaźnik płynności aktywów (aktywa płynne / aktywa ogółem)",
               0.30, "aktywa_plynne", "aktywa_ogolem"),
    WskaznikEF("plynne_do_niestabilnych", "plynnosc", "Aktywa płynne / pasywa niestabilne", 0.30,
               "aktywa_plynne", "pasywa_niestabilne"),
    WskaznikEF("kredyty_do_depozytow", "plynnosc", "Kredyty wg wartości bilansowej / depozyty", 0.20,
               "kredyty_brutto", "depozyty_klientow"),
    WskaznikEF("stabilnosc_depozytow", "plynnosc",
               "Wskaźnik stabilności depozytów (depozyty stabilne / depozyty ogółem)", 0.20,
               "depozyty_stabilne", "depozyty_klientow"),
]


@dataclass
class Przedzial:
    """Przedział wartości wskaźnika i przypisana mu liczba całkowita 1–5."""

    od: float | None  # None = bez dolnej granicy
    do: float | None  # None = bez górnej granicy
    wartosc: int


# JEDYNE przedziały podane w uchwale — dla udziału należności zagrożonych
# w należnościach ogółem (str. 4, wraz z przykładem: 7,42% → przedział 3).
#
# ⚠️ ROZBIEŻNOŚĆ W SAMYM DOKUMENCIE: przykład liczy punktację jako 3 × 0,55 = 1,65 pkt,
# podczas gdy tabela wag przypisuje temu wskaźnikowi 0,30. Przykład pochodzi
# najpewniej z wcześniejszej wersji wag. Zapisujemy wagę Z TABELI i odnotowujemy
# rozbieżność — wygładzenie jej po cichu byłoby ukryciem cechy materiału dowodowego.
PRZEDZIALY_NALEZNOSCI_ZAGROZONE: list[Przedzial] = [
    Przedzial(None, 1.50, 1),
    Przedzial(1.51, 4.00, 2),
    Przedzial(4.01, 8.00, 3),
    Przedzial(8.01, 12.00, 4),
    Przedzial(12.01, 100.00, 5),
]

ROZBIEZNOSC_WAGI = (
    "Uchwała podaje w przykładzie punktację wskaźnika udziału należności zagrożonych "
    "jako 3 × 0,55 = 1,65 pkt, a w tabeli wag przypisuje mu 0,30. Przyjęto wagę z tabeli."
)

PRZEDZIALY: dict[str, list[Przedzial]] = {
    "naleznosci_zagrozone": PRZEDZIALY_NALEZNOSCI_ZAGROZONE,
}


# ── Obliczenia ───────────────────────────────────────────────────────────────
def wartosc(w: WskaznikEF, p: Pozycje) -> float | None:
    """Wartość wskaźnika w procentach; None, gdy brak którejkolwiek pozycji."""
    if not w.licznik or not w.mianownik:
        return None
    licz = getattr(p, w.licznik, None)
    mian = getattr(p, w.mianownik, None)
    if licz is None or not mian:
        return None
    return round(100.0 * licz / mian, 2)


def brakujace_pozycje(w: WskaznikEF, p: Pozycje) -> list[str]:
    """Pozycje sprawozdawcze, których zabrakło do policzenia tego wskaźnika."""
    braki = []
    for pole in (w.licznik, w.mianownik):
        if pole and getattr(p, pole, None) is None:
            braki.append(pole)
    return braki


def przedzial_dla(kod: str, v: float) -> int | None:
    """Liczba całkowita 1–5 przypisana wartości; None, gdy przedziałów nie znamy."""
    lista = PRZEDZIALY.get(kod)
    if not lista:
        return None
    for pr in lista:
        if (pr.od is None or v >= pr.od) and (pr.do is None or v <= pr.do):
            return pr.wartosc
    return None


def punktacja(w: WskaznikEF, v: float) -> float | None:
    """Punkty wskaźnika = liczba przedziału × waga istotności."""
    n = przedzial_dla(w.kod, v)
    return None if n is None else round(n * w.waga, 4)


def wskaznik_czastkowy(obszar: str, punkty: dict[str, float]) -> float | None:
    """Suma punktów wskaźników obszaru.

    None, gdy któregokolwiek wskaźnika obszaru nie udało się wycenić — suma po
    części składników udawałaby ocenę obszaru, a jest oceną jego fragmentu.
    """
    kody = [w.kod for w in WSKAZNIKI_EF if w.obszar == obszar]
    if any(k not in punkty for k in kody):
        return None
    return round(sum(punkty[k] for k in kody), 4)


def ocena_czastkowa(wsk: float | None) -> int | None:
    """Wskaźnik cząstkowy po zaokrągleniu do najbliższej liczby całkowitej (1–5)."""
    if wsk is None:
        return None
    return max(1, min(5, round(wsk)))


def wskaznik_syntetyczny(czastkowe: dict[str, float]) -> float | None:
    """Suma NIEZAOKRĄGLONYCH wskaźników cząstkowych wszystkich czterech obszarów."""
    if any(o not in czastkowe for o in OBSZARY):
        return None
    return round(sum(czastkowe[o] for o in OBSZARY), 4)


def ocena_globalna(syntetyczny: float | None) -> int | None:
    """Rating = wskaźnik syntetyczny ÷ liczba obszarów, zaokrąglony.

    ⚠️ SKALA JEST ODWRÓCONA: 1 oznacza bardzo dobrą sytuację ekonomiczno-finansową,
    5 — zagrożenie funkcjonowania banku. Odczytanie jej „w drugą stronę" zamieniłoby
    w opinii ocenę najlepszą na najgorszą.
    """
    if syntetyczny is None:
        return None
    return max(1, min(5, round(syntetyczny / len(OBSZARY))))


OPIS_OCENY: dict[int, str] = {
    1: "bardzo dobra sytuacja ekonomiczno-finansowa; oceny cząstkowe nie niższe niż 1–2",
    2: "dobra sytuacja ekonomiczno-finansowa; oceny cząstkowe nie gorsze niż 3",
    3: "sytuacja częściowo niestabilna — niepokojące zjawiska w jednym lub kilku obszarach",
    4: "sytuacja zła; badane obszary nie mogą uzyskać oceny cząstkowej niższej niż 4",
    5: "zagrożenie funkcjonowania banku",
}


# ── Odtworzenie aktywów ważonych ryzykiem ────────────────────────────────────
# Współczynnik wypłacalności = fundusze własne / aktywa ważone ryzykiem × 100.
# W aktach SK Banku RWA nie występuje ani razu, ale WYSTĘPUJĄ oba pozostałe
# składniki: fundusze własne i sam współczynnik, oba wykazane przez bank. Z nich
# mianownik daje się odtworzyć — i dopiero wtedy da się odpowiedzieć na pytanie,
# które w tej sprawie jest sednem: ILE WYNIÓSŁBY WSPÓŁCZYNNIK, gdyby bank utworzył
# wymagane rezerwy.
#
# ⚠️ ODTWORZENIE DZIEDZICZY WIARYGODNOŚĆ ŹRÓDŁA. RWA policzone z dwóch wartości
# wykazanych przez bank jest tak wiarygodne, jak te wartości — jeżeli bank zawyżył
# współczynnik, odtworzone RWA jest zaniżone o ten sam czynnik. To NIE JEST pomiar
# niezależny i nie wolno go tak przedstawiać w opinii.


def rwa_implikowane(fundusze_wlasne: float | None, wsp_pct: float | None) -> float | None:
    """Aktywa ważone ryzykiem odtworzone z funduszy własnych i wykazanego współczynnika."""
    if not fundusze_wlasne or not wsp_pct:
        return None
    return round(fundusze_wlasne / (wsp_pct / 100.0), 2)


def wspolczynnik_po_korekcie(
    fundusze_wlasne: float | None, wsp_pct: float | None, korekta: float
) -> float | None:
    """Współczynnik po pomniejszeniu funduszy własnych o `korekta` (np. o dotworzone rezerwy).

    Mianownik zostaje bez zmian: utworzenie rezerwy celowej obciąża wynik, a przez
    niego fundusze własne — nie zmienia natomiast wagi ryzyka aktywów. To jest
    uproszczenie i jako uproszczenie musi być w opinii nazwane; dokładny rachunek
    wymagałby ekspozycji w podziale na wagi ryzyka, których akta nie zawierają.
    """
    rwa = rwa_implikowane(fundusze_wlasne, wsp_pct)
    if rwa is None:
        return None
    return round(100.0 * (fundusze_wlasne - korekta) / rwa, 2)


def bufor_do_progu(
    fundusze_wlasne: float | None, wsp_pct: float | None, prog_pct: float
) -> float | None:
    """O ile mogłyby spaść fundusze własne, zanim współczynnik zejdzie poniżej progu.

    Odpowiada na pytanie zadawane wprost w sprawach o nadzór: jak duża korekta
    wyniku wystarczyłaby, żeby bank przestał spełniać normę. Wartość ujemna
    znaczy, że norma nie była spełniona już przy wartościach wykazanych.
    """
    rwa = rwa_implikowane(fundusze_wlasne, wsp_pct)
    if rwa is None or fundusze_wlasne is None:
        return None
    return round(fundusze_wlasne - (prog_pct / 100.0) * rwa, 2)


# ── Zestawienie ocen zrzeszającego z wskaźnikami policzonymi ─────────────────
# W aktach SK Banku leży osiem kwartalnych ocen wykonanych przez Bank BPS własną
# rubryką. Zestawienie ich z wartościami policzonymi z danych nadzorczych odpowiada
# na pytanie, którego żadne z tych źródeł nie rozstrzyga samodzielnie: CZY OCENA
# NADĄŻAŁA ZA LICZBAMI.
#
# ⚠️ KOD NIE OCENIA, CZY BPS DOPEŁNIŁ OBOWIĄZKU. Zestawia dwa szeregi i wskazuje
# kwartały, w których wskaźnik pogorszył się skokowo — wniosek o dopełnieniu albo
# niedopełnieniu obowiązku należy do biegłego i do sądu.

PROG_SKOKU_PP = 5.0  # skok udziału w punktach procentowych uznawany za istotny


def zestaw_oceny(
    oceny: list[dict],
    wartosci: dict[str, dict[str, float]],
) -> dict:
    """Łączy oceny obszarów z wartościami wskaźników na te same dni.

    `oceny`     — rekordy z `oceny_zrzeszajacego` (dzien, oceny{obszar: 1–5}, globalna)
    `wartosci`  — {dzien: {kod_wskaznika: wartość}} z odczytu akt

    Zwraca wiersze zestawienia oraz `sygnaly`: kwartały, w których udział należności
    zagrożonych skoczył o próg, wraz z informacją, czy ocena obszaru wtedy się zmieniła.
    """
    dni = sorted({o["dzien"] for o in oceny if o.get("dzien")} | set(wartosci))
    wg_dnia = {o["dzien"]: o for o in oceny if o.get("dzien")}
    wiersze, sygnaly = [], []
    poprzedni_npl = None
    poprzednia_ocena = None

    for d in dni:
        o = wg_dnia.get(d) or {}
        w = wartosci.get(d) or {}
        npl = w.get("naleznosci_zagrozone")
        jakosc = (o.get("oceny") or {}).get("jakosc_aktywow")
        wiersze.append({
            "dzien": d,
            "oceny": o.get("oceny") or {},
            "globalna": o.get("globalna"),
            "karta": o.get("karta"),
            "wskazniki": w,
        })
        if npl is not None and poprzedni_npl is not None and npl - poprzedni_npl >= PROG_SKOKU_PP:
            sygnaly.append({
                "dzien": d,
                "skok_pp": round(npl - poprzedni_npl, 2),
                "z": poprzedni_npl,
                "na": npl,
                "ocena_jakosci": jakosc,
                "ocena_zmieniona": jakosc is not None and poprzednia_ocena is not None
                                   and jakosc != poprzednia_ocena,
            })
        if npl is not None:
            poprzedni_npl = npl
        if jakosc is not None:
            poprzednia_ocena = jakosc
    return {"wiersze": wiersze, "sygnaly": sygnaly, "prog_skoku_pp": PROG_SKOKU_PP}
