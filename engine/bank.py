"""Deterministyczne wskaźniki sytuacji finansowej banku, liczone w szeregu czasowym.

ZASADA — ta sama co w silniku manipulacji: tu liczy kod, nie LLM. Każda funkcja
jest czysta i odtwarzalna; te same pozycje sprawozdania dają te same wskaźniki
co do drugiego miejsca po przecinku.

CO TO ROZSTRZYGA
W sprawach karnych o zarządzanie ryzykiem (np. PO III Ds 84.2020 — lokata 50 mln zł
w Glitnir Bank Hf na trzy tygodnie przed upadkiem islandzkiego sektora) pytanie brzmi:
co dało się odczytać ze sprawozdań kontrahenta W DNIU DECYZJI. Odpowiedź musi być
liczbą z podanym progiem regulacyjnym, a nie oceną — dlatego progi są tu datowane.

⚠️ GRANICA WEJŚCIA — ŚWIADOMA
Silnik przyjmuje POZYCJE JUŻ ODCZYTANE ze sprawozdania, nie plik PDF. Sprawozdania
banków różnią się układem, standardem (PSR/MSSF) i językiem; automatyczne parsowanie
myliłoby pozycje, a w opinii dowodowej błędna liczba jest gorsza niż jej brak.
Odczyt pozycji to osobny krok, zatwierdzany przez biegłego — tak jak w dziedzinie GPW
dane UTP mają ustaloną strukturę, zanim trafią do metrics.py.
"""
from __future__ import annotations

from dataclasses import dataclass, field

# ── Progi regulacyjne w czasie ───────────────────────────────────────────────
# Bliźniacze wobec `przepisyNaDzien` z lib/domain/prawo-bankowe.ts. Powód istnienia
# dat jest ten sam: zachowanie banku ocenia się według stanu prawnego z DNIA
# ZDARZENIA. CRR (575/2013) obowiązuje od 2014 r., więc ocenianie nim decyzji
# z 2008 r. byłoby błędem — wtedy obowiązywała Uchwała nr 1/2007 KNB
# ze współczynnikiem wypłacalności 8% i bez wyodrębnionego progu CET1.


@dataclass(frozen=True)
class Prog:
    wskaznik: str
    minimum: float
    podstawa: str
    od: str
    do: str | None = None


PROGI: list[Prog] = [
    # Stan przed CRD IV/CRR — jeden współczynnik wypłacalności, brak progu CET1.
    Prog("tcr", 8.0, "Uchwała nr 1/2007 KNB", "2007-04-01", "2013-12-31"),
    # CRR art. 92 ust. 1 — trzy progi równolegle.
    Prog("cet1", 4.5, "art. 92 ust. 1 lit. a CRR", "2014-01-01"),
    Prog("tier1", 6.0, "art. 92 ust. 1 lit. b CRR", "2014-01-01"),
    Prog("tcr", 8.0, "art. 92 ust. 1 lit. c CRR", "2014-01-01"),
    # Dźwignia — wiążąca dopiero od 2021 (rozp. 2019/876 „CRR II").
    Prog("dzwignia", 3.0, "art. 92 ust. 1 lit. d CRR w brzmieniu rozp. 2019/876", "2021-06-28"),
    # LCR — dochodzenie do 100% rozłożone w czasie.
    Prog("lcr", 60.0, "rozp. del. (UE) 2015/61", "2015-10-01", "2016-12-31"),
    Prog("lcr", 70.0, "rozp. del. (UE) 2015/61", "2017-01-01", "2017-12-31"),
    Prog("lcr", 80.0, "rozp. del. (UE) 2015/61", "2018-01-01", "2018-12-31"),
    Prog("lcr", 100.0, "rozp. del. (UE) 2015/61", "2019-01-01"),
]


def prog_na_dzien(wskaznik: str, dzien: str) -> Prog | None:
    """Próg obowiązujący dla wskaźnika w danym dniu; None, gdy wówczas nie istniał.

    Brak progu to informacja, nie błąd: przed 2014 r. CET1 nie był odrębnie
    normowany i opinia nie może twierdzić, że bank go „nie spełniał".
    """
    for p in PROGI:
        if p.wskaznik == wskaznik and p.od <= dzien and (p.do is None or p.do >= dzien):
            return p
    return None


# ── Pozycje wejściowe ────────────────────────────────────────────────────────


@dataclass
class Pozycje:
    """Pozycje sprawozdania na jeden dzień bilansowy, w jednej walucie.

    Wszystkie pola opcjonalne — sprawozdania różnią się szczegółowością, a wskaźnik,
    dla którego brakuje danych, ma się NIE POJAWIĆ, zamiast zostać policzony z zera.
    """

    dzien: str  # ISO, dzień bilansowy
    waluta: str = "PLN"

    # Kapitał i ekspozycja na ryzyko
    kapital_cet1: float | None = None
    kapital_at1: float | None = None
    kapital_tier2: float | None = None
    aktywa_wazone_ryzykiem: float | None = None  # RWA
    ekspozycja_calkowita: float | None = None  # miara ekspozycji dźwigni
    fundusze_wlasne: float | None = None  # gdy sprawozdanie podaje łącznie

    # Bilans
    aktywa_ogolem: float | None = None
    depozyty_klientow: float | None = None
    zobowiazania_ogolem: float | None = None
    finansowanie_hurtowe: float | None = None  # emisje dłużne + rynek międzybankowy
    kapital_wlasny: float | None = None

    # Rachunek wyników
    wynik_odsetkowy: float | None = None
    przychody_odsetkowe: float | None = None
    zysk_netto: float | None = None

    # Jakość portfela i płynność
    kredyty_brutto: float | None = None
    kredyty_zagrozone: float | None = None
    # Należności ogółem WG WARTOŚCI NOMINALNEJ (brutto, przed rezerwami celowymi
    # i prowizjami) — mianownik wskaźnika jakości z rubryki banku zrzeszającego.
    # Osobne pole, bo `kredyty_brutto` czyta się z bilansu, a bilans PSR wykazuje
    # należności NETTO: iloraz zagrożonych (nominalnych) przez wartość bilansową
    # mieszałby zakresy i zawyżał wskaźnik (w SK Banku 22,10% zamiast 21,84%,
    # które sam dokument podaje).
    naleznosci_nominalne: float | None = None
    odpisy: float | None = None
    aktywa_plynne: float | None = None
    wyplywy_netto_30d: float | None = None

    # ── Pozycje wymagane przez rubrykę analizy ekonomiczno-finansowej ──────────
    # Dopisane po odczytaniu ze skanu uchwały nr 12/14/AB/BS/2002 Zarządu Banku BPS
    # (akta SK Banku, k. 162–163) rubryki 16 wskaźników w 4 obszarach, którą bank
    # zrzeszający był zobowiązany stosować do banków spółdzielczych.
    #
    # ⚠️ ISTNIEJĄ, ŻEBY BRAK BYŁ NAZWANY. Żadnej z tych pozycji nie ma w aktach SK
    # Banku — i to jest ustalenie, nie usterka: bez nich dziesięciu z szesnastu
    # wskaźników nie da się policzyć, a lista brakujących pozycji jest gotową treścią
    # wniosku dowodowego. Pole nieobecne w modelu dawałoby komunikat „wskaźnik
    # nieobsługiwany" zamiast „brak danych", czyli zrzucałoby winę na aplikację.
    fundusz_udzialowy: float | None = None
    fundusze_podstawowe: float | None = None
    odpis_zobowiazan_podporzadkowanych: float | None = None
    aktywa_pracujace: float | None = None
    rezerwy_utworzone: float | None = None
    rezerwy_wymagane: float | None = None
    koszty_dzialania: float | None = None
    wynik_dzialalnosci_bankowej: float | None = None
    wynik_z_rezerw: float | None = None
    pasywa_niestabilne: float | None = None
    depozyty_stabilne: float | None = None


@dataclass
class Wskaznik:
    """Jeden wskaźnik na jeden dzień — wraz z progiem, jeśli wówczas obowiązywał."""

    dzien: str
    kod: str
    nazwa: str
    wartosc: float
    jednostka: str  # "%" | "x" | waluta
    prog: float | None = None
    podstawa_progu: str | None = None
    spelniony: bool | None = None
    skladniki: dict[str, float] = field(default_factory=dict)
    # Sygnał, że wartość jest arytmetycznie poprawna, ale merytorycznie niemożliwa —
    # np. udział przekraczający 100%. Oznacza, że licznik i mianownik pochodzą
    # z różnych zakresów (skonsolidowany vs jednostkowy, grupa vs bank).
    ostrzezenie: str | None = None


def _pct(licznik: float | None, mianownik: float | None) -> float | None:
    """Udział w procentach; None, gdy brak danych lub mianownik zerowy."""
    if licznik is None or not mianownik:
        return None
    return 100.0 * licznik / mianownik


def _fundusze(p: Pozycje) -> tuple[float | None, float | None]:
    """(Tier 1, fundusze własne łącznie) — złożone ze składników lub wzięte wprost."""
    t1 = None
    if p.kapital_cet1 is not None:
        t1 = p.kapital_cet1 + (p.kapital_at1 or 0.0)
    laczne = p.fundusze_wlasne
    if laczne is None and t1 is not None:
        laczne = t1 + (p.kapital_tier2 or 0.0)
    return t1, laczne


def wskazniki(p: Pozycje) -> list[Wskaznik]:
    """Komplet wskaźników możliwych do policzenia z podanych pozycji.

    Wskaźnik, którego składników brakuje, jest POMIJANY — nie zerowany. Pusta
    pozycja w tabeli opinii mówi „brak danych", a zero mówiłoby „policzono zero".
    """
    out: list[Wskaznik] = []
    t1, laczne = _fundusze(p)
    rwa = p.aktywa_wazone_ryzykiem

    # Wskaźniki będące UDZIAŁEM w całości nie mogą przekroczyć 100%. Przekroczenie
    # znaczy, że licznik i mianownik pochodzą z różnych zakresów sprawozdania —
    # wartość jest wtedy bezużyteczna i nie wolno jej wpuścić do opinii bez uwagi.
    UDZIALY = {"udzial_depozytow", "udzial_hurtu", "npl", "cet1", "tier1", "tcr"}

    def dodaj(kod: str, nazwa: str, wartosc: float | None, jednostka: str, skladniki: dict[str, float]) -> None:
        if wartosc is None:
            return
        ostrz = None
        if kod in UDZIALY and wartosc > 100.0:
            ostrz = (f"Wartość {wartosc:.1f}% przekracza 100% — licznik i mianownik pochodzą "
                     f"prawdopodobnie z różnych zakresów sprawozdania. Zweryfikuj w oryginale.")
        prog = prog_na_dzien(kod, p.dzien)
        out.append(
            Wskaznik(
                dzien=p.dzien,
                kod=kod,
                nazwa=nazwa,
                wartosc=round(wartosc, 2),
                jednostka=jednostka,
                prog=prog.minimum if prog else None,
                podstawa_progu=prog.podstawa if prog else None,
                spelniony=(wartosc >= prog.minimum) if prog else None,
                skladniki={k: v for k, v in skladniki.items() if v is not None},
                ostrzezenie=ostrz,
            )
        )

    # ── Adekwatność kapitałowa ──
    dodaj("cet1", "Współczynnik kapitału podstawowego Tier 1 (CET1)",
          _pct(p.kapital_cet1, rwa), "%", {"CET1": p.kapital_cet1, "RWA": rwa})
    dodaj("tier1", "Współczynnik kapitału Tier 1", _pct(t1, rwa), "%", {"Tier 1": t1, "RWA": rwa})
    dodaj("tcr", "Łączny współczynnik kapitałowy", _pct(laczne, rwa), "%",
          {"fundusze własne": laczne, "RWA": rwa})
    dodaj("dzwignia", "Wskaźnik dźwigni finansowej", _pct(t1, p.ekspozycja_calkowita), "%",
          {"Tier 1": t1, "ekspozycja całkowita": p.ekspozycja_calkowita})
    dodaj("lcr", "Wskaźnik pokrycia wypływów netto (LCR)",
          _pct(p.aktywa_plynne, p.wyplywy_netto_30d), "%",
          {"aktywa płynne": p.aktywa_plynne, "wypływy netto 30 dni": p.wyplywy_netto_30d})

    # ── Struktura finansowania ──
    # To była oś ustaleń w sprawie MBR: Glitnir finansował się głównie hurtowo,
    # więc koszt pieniądza zależał od nastrojów rynku, a nie od bazy depozytowej.
    dodaj("udzial_depozytow", "Udział depozytów klientów w zobowiązaniach",
          _pct(p.depozyty_klientow, p.zobowiazania_ogolem), "%",
          {"depozyty klientów": p.depozyty_klientow, "zobowiązania ogółem": p.zobowiazania_ogolem})
    dodaj("udzial_hurtu", "Udział finansowania hurtowego w zobowiązaniach",
          _pct(p.finansowanie_hurtowe, p.zobowiazania_ogolem), "%",
          {"finansowanie hurtowe": p.finansowanie_hurtowe, "zobowiązania ogółem": p.zobowiazania_ogolem})
    dodaj("kredyty_do_depozytow", "Relacja kredytów do depozytów",
          _pct(p.kredyty_brutto, p.depozyty_klientow), "%",
          {"kredyty brutto": p.kredyty_brutto, "depozyty klientów": p.depozyty_klientow})

    # ── Rentowność ──
    dodaj("roa", "Rentowność aktywów (ROA)", _pct(p.zysk_netto, p.aktywa_ogolem), "%",
          {"zysk netto": p.zysk_netto, "aktywa ogółem": p.aktywa_ogolem})
    dodaj("roe", "Rentowność kapitału własnego (ROE)", _pct(p.zysk_netto, p.kapital_wlasny), "%",
          {"zysk netto": p.zysk_netto, "kapitał własny": p.kapital_wlasny})
    dodaj("marza_odsetkowa", "Marża odsetkowa netto", _pct(p.wynik_odsetkowy, p.aktywa_ogolem), "%",
          {"wynik odsetkowy": p.wynik_odsetkowy, "aktywa ogółem": p.aktywa_ogolem})

    # ── Jakość portfela ──
    # Mianownik NOMINALNY, gdy sprawozdanie go podaje: klasyfikacja należności
    # (zagrożone) jest wg wartości nominalnej, a `kredyty_brutto` z bilansu PSR
    # to wartość NETTO rezerw — iloraz przez nią miesza zakresy (SK Bank: 22,10%
    # zamiast 21,84% z noty). Bilansowy mianownik zostaje jako gałąź zapasowa
    # dla sprawozdań bez noty klasyfikacyjnej — z ostrzeżeniem, nie po cichu.
    mian_npl = p.naleznosci_nominalne if p.naleznosci_nominalne is not None else p.kredyty_brutto
    dodaj("npl", "Udział kredytów zagrożonych", _pct(p.kredyty_zagrozone, mian_npl), "%",
          {"kredyty zagrożone": p.kredyty_zagrozone,
           ("należności ogółem (nominalne)" if p.naleznosci_nominalne is not None
            else "kredyty brutto"): mian_npl})
    if (p.naleznosci_nominalne is None and out and out[-1].kod == "npl"
            and out[-1].ostrzezenie is None):
        out[-1].ostrzezenie = (
            "Mianownik z wartości bilansowej kredytów (sprawozdanie nie podaje należności "
            "wg wartości nominalnej) — klasyfikacja zagrożonych jest nominalna, więc wskaźnik "
            "może być zawyżony o rezerwy celowe."
        )
    dodaj("pokrycie_odpisami", "Pokrycie kredytów zagrożonych odpisami",
          _pct(p.odpisy, p.kredyty_zagrozone), "%",
          {"odpisy": p.odpisy, "kredyty zagrożone": p.kredyty_zagrozone})

    return out


def szereg(okresy: list[Pozycje]) -> dict[str, list[Wskaznik]]:
    """Wskaźniki w układzie kod → lista po dniach, rosnąco.

    To jest postać, w której rozdział „Współczynniki kapitałowe w czasie" dostaje
    dane do tabeli i wykresu: jeden wiersz na wskaźnik, jedna kolumna na okres.
    """
    out: dict[str, list[Wskaznik]] = {}
    for p in sorted(okresy, key=lambda x: x.dzien):
        for w in wskazniki(p):
            out.setdefault(w.kod, []).append(w)
    return out


def zmiany(seria: list[Wskaznik]) -> list[tuple[str, float]]:
    """Zmiany wskaźnika między kolejnymi okresami, w punktach procentowych.

    Trend bywa istotniejszy niż poziom: spadek z 12% do 9% przy progu 8% oznacza
    utratę dwóch trzecich bufora, choć próg wciąż jest formalnie spełniony.
    """
    out: list[tuple[str, float]] = []
    for wczesniej, pozniej in zip(seria, seria[1:]):
        out.append((pozniej.dzien, round(pozniej.wartosc - wczesniej.wartosc, 2)))
    return out


def naruszenia(okresy: list[Pozycje]) -> list[Wskaznik]:
    """Wskaźniki poniżej progu obowiązującego w danym dniu — posortowane po dacie.

    Świadomie NIE nazywa tego „naruszeniem prawa": silnik stwierdza wyłącznie, że
    wartość jest niższa od progu. Kwalifikacja prawna należy do opinii, a ocena
    czynu do organu.
    """
    out = [w for p in okresy for w in wskazniki(p) if w.spelniony is False]
    return sorted(out, key=lambda w: (w.dzien, w.kod))
