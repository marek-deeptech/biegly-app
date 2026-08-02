"""Rubryka analizy ekonomiczno-finansowej — odczyt ze skanu uchwały BPS."""
import pytest

from engine.analiza_ekonomiczna import (
    OBSZARY,
    WSKAZNIKI_EF,
    brakujace_pozycje,
    ocena_czastkowa,
    ocena_globalna,
    przedzial_dla,
    punktacja,
    wartosc,
    wskaznik_czastkowy,
    wskaznik_syntetyczny,
)
from engine.bank import Pozycje


def test_szesnascie_wskaznikow_w_czterech_obszarach():
    # OCR dał 15 — zgubił „fundusz udziałowy/fundusze podstawowe". Odczyt z obrazu
    # pokazał 16. Liczba jest kontrolą tego, czy rubryka jest kompletna.
    assert len(WSKAZNIKI_EF) == 16
    assert len(OBSZARY) == 4
    for o in OBSZARY:
        assert len([w for w in WSKAZNIKI_EF if w.obszar == o]) == 4


@pytest.mark.parametrize("obszar", list(OBSZARY))
def test_wagi_w_obszarze_sumuja_sie_do_jednosci(obszar):
    """Kontrola poprawności ODCZYTU, nie tylko danych.

    Wagi w każdym obszarze muszą dawać 1,00. Gdy pierwszy odczyt (z OCR) dał
    w obszarze adekwatności 0,90, to właśnie ta suma pokazała, że brakuje wiersza.
    """
    assert round(sum(w.waga for w in WSKAZNIKI_EF if w.obszar == obszar), 4) == 1.0


def test_drugi_wskaznik_jakosci_liczy_sie_do_aktywow_nie_do_naleznosci():
    # OCR przekręcił go na „aktywa zagrożone/aktywa ogółem". Dokument mówi
    # „należności zagrożone/aktywa ogółem" — inny licznik, inny wskaźnik.
    w = next(x for x in WSKAZNIKI_EF if x.kod == "zagrozone_do_aktywow")
    assert (w.licznik, w.mianownik) == ("kredyty_zagrozone", "aktywa_ogolem")


def test_wartosc_liczy_sie_z_pozycji_sprawozdawczych():
    p = Pozycje(dzien="2014-12-31", kredyty_zagrozone=560_663_000, kredyty_brutto=2_500_215_000)
    w = next(x for x in WSKAZNIKI_EF if x.kod == "naleznosci_zagrozone")
    assert wartosc(w, p) == 22.42


def test_brak_pozycji_daje_None_i_NAZWANY_brak():
    """Brak danych ma być brakiem danych, a nie zerem ani „wskaźnikiem nieobsługiwanym"."""
    p = Pozycje(dzien="2014-12-31", aktywa_ogolem=3_828_641_000)
    w = next(x for x in WSKAZNIKI_EF if x.kod == "aktywa_pracujace")
    assert wartosc(w, p) is None
    assert brakujace_pozycje(w, p) == ["aktywa_pracujace"]


def test_wspolczynnik_wyplacalnosci_wymaga_RWA():
    # W aktach SK Banku aktywa ważone ryzykiem nie występują ani razu — dostępna
    # jest tylko wartość WYKAZANA przez bank, o innym statusie dowodowym.
    p = Pozycje(dzien="2014-12-31", fundusze_wlasne=389_566_000)
    w = next(x for x in WSKAZNIKI_EF if x.kod == "wsp_wyplacalnosci")
    assert wartosc(w, p) is None
    assert brakujace_pozycje(w, p) == ["aktywa_wazone_ryzykiem"]


def test_przedzialy_z_przykladu_uchwaly():
    # Uchwała podaje jeden przykład: 7,42% → trzeci przedział.
    assert przedzial_dla("naleznosci_zagrozone", 7.42) == 3
    assert przedzial_dla("naleznosci_zagrozone", 1.20) == 1
    assert przedzial_dla("naleznosci_zagrozone", 46.20) == 5


def test_skala_jest_odwrocona_gorszy_wskaznik_to_wyzsza_liczba():
    assert przedzial_dla("naleznosci_zagrozone", 0.9) < przedzial_dla("naleznosci_zagrozone", 30.0)


def test_przedzialow_pozostalych_wskaznikow_dokument_nie_podaje():
    """Nie udajemy punktacji tam, gdzie nie znamy przedziałów."""
    assert przedzial_dla("roa", 0.2) is None
    w = next(x for x in WSKAZNIKI_EF if x.kod == "roa")
    assert punktacja(w, 0.2) is None


def test_punktacja_to_iloczyn_przedzialu_i_wagi():
    w = next(x for x in WSKAZNIKI_EF if x.kod == "naleznosci_zagrozone")
    assert punktacja(w, 7.42) == round(3 * 0.30, 4)


def test_obszar_bez_kompletu_wskaznikow_nie_dostaje_oceny():
    # Suma po części składników udawałaby ocenę obszaru, a jest oceną jego fragmentu.
    assert wskaznik_czastkowy("jakosc_aktywow", {"naleznosci_zagrozone": 0.9}) is None
    pelne = {w.kod: 1.0 for w in WSKAZNIKI_EF if w.obszar == "jakosc_aktywow"}
    assert wskaznik_czastkowy("jakosc_aktywow", pelne) == 4.0


def test_ocena_globalna_ma_odwrocona_skale():
    """1 = bardzo dobra, 5 = zagrożenie funkcjonowania banku."""
    dobre = {o: 1.0 for o in OBSZARY}
    zle = {o: 5.0 for o in OBSZARY}
    assert ocena_globalna(wskaznik_syntetyczny(dobre)) == 1
    assert ocena_globalna(wskaznik_syntetyczny(zle)) == 5


def test_ocena_czastkowa_zaokragla_do_najblizszej_calkowitej():
    assert ocena_czastkowa(2.4) == 2
    assert ocena_czastkowa(2.6) == 3
    assert ocena_czastkowa(None) is None


def test_brak_jednego_obszaru_wyklucza_ocene_globalna():
    assert wskaznik_syntetyczny({"adekwatnosc": 1.0}) is None
    assert ocena_globalna(None) is None


def test_rejestr_brakow_odroznia_brak_zupelny_od_niekompletnosci():
    """Dwie różne rzeczy, dwa różne wnioski do sądu.

    Pozycja nieobecna w aktach w ogóle (aktywa pracujące) wymaga dokumentu.
    Pozycja obecna prawie wszędzie (suma bilansowa brakuje wyłącznie na 30.09.2014)
    wymaga uzupełnienia jednego okresu. Wrzucone do jednego worka, sugerowały,
    że akta nie zawierają sumy bilansowej — a zawierają ją w siedmiu z ośmiu okresów.
    """
    from engine.uslugi.bank import analiza_ekonomiczna

    okresy = ["2014-06-30", "2014-09-30"]
    poz = [
        Pozycje(dzien="2014-06-30", aktywa_ogolem=3_505_639_000, kredyty_zagrozone=124_032_000,
                kredyty_brutto=2_037_916_000),
        Pozycje(dzien="2014-09-30", kredyty_zagrozone=421_588_000, kredyty_brutto=2_265_833_000),
    ]
    w = analiza_ekonomiczna("x", poz, okresy)
    wg = {b["pozycja"]: b for b in w["braki"]}
    assert wg["aktywa_pracujace"]["brak_zupelny"] is True
    assert wg["aktywa_ogolem"]["brak_zupelny"] is False
    assert wg["aktywa_ogolem"]["okresow_bez"] == 1
    # Wskaźnik policzalny w choćby jednym okresie liczy się jako policzony.
    assert w["policzonych"] >= 1


def test_ocena_globalna_nie_powstaje_bez_kompletu_obszarow():
    from engine.uslugi.bank import analiza_ekonomiczna

    poz = [Pozycje(dzien="2014-12-31", kredyty_zagrozone=560_663_000, kredyty_brutto=2_500_215_000)]
    w = analiza_ekonomiczna("x", poz, ["2014-12-31"])
    assert w["ocena_globalna"] is None
    assert all(o["ocena"] is None for o in w["obszary"])


# ── Odtworzenie aktywów ważonych ryzykiem ────────────────────────────────────

def test_rwa_odtwarza_sie_z_funduszy_i_wykazanego_wspolczynnika():
    from engine.analiza_ekonomiczna import rwa_implikowane

    # SK Bank na 31.12.2014: fundusze własne 389 566 000 zł, wykazany wsp. 13,84%.
    rwa = rwa_implikowane(389_566_000, 13.84)
    assert rwa is not None
    # Kontrola odwrotna: z odtworzonego RWA współczynnik musi wyjść ten sam.
    assert round(100.0 * 389_566_000 / rwa, 2) == 13.84


def test_bez_ktoregokolwiek_skladnika_nie_zgadujemy():
    from engine.analiza_ekonomiczna import bufor_do_progu, rwa_implikowane, wspolczynnik_po_korekcie

    assert rwa_implikowane(None, 13.84) is None
    assert rwa_implikowane(389_566_000, None) is None
    assert wspolczynnik_po_korekcie(None, 13.84, 1) is None
    assert bufor_do_progu(389_566_000, None, 8.0) is None


def test_wspolczynnik_po_dotworzeniu_rezerw():
    """Sedno sprawy: ile wyniósłby współczynnik, gdyby bank utworzył wymagane rezerwy.

    ⚠️ TEN TEST OBALIŁ ZAŁOŻENIE, Z KTÓRYM GO PISANO. Przyjęto, że korekta rzędu
    123 mln zł sprowadziłaby SK Bank poniżej normy 8% na 31.12.2014 — nie sprowadza.
    Przy funduszach własnych 389 566 tys. zł i wykazanym współczynniku 13,84%
    odtworzone RWA wynosi ok. 2 814 783 tys. zł, więc po takiej korekcie współczynnik
    daje 9,47%, a do progu brakuje jeszcze ok. 164 383 tys. zł. Wniosek „utworzenie
    rezerw naruszyłoby normę" nie broni się na tej dacie i wymaga albo innej daty,
    albo innej kwoty korekty — to jest ustalenie dla opinii, nie usterka.
    """
    from engine.analiza_ekonomiczna import wspolczynnik_po_korekcie

    assert wspolczynnik_po_korekcie(389_566_000, 13.84, 123_000_000) == 9.47


def test_bufor_do_progu_mowi_ile_brakowalo_do_naruszenia_normy():
    from engine.analiza_ekonomiczna import bufor_do_progu, wspolczynnik_po_korekcie

    b = bufor_do_progu(389_566_000, 13.84, 8.0)
    assert b is not None and b > 0
    # Korekta dokładnie o bufor sprowadza współczynnik do progu.
    assert wspolczynnik_po_korekcie(389_566_000, 13.84, b) == 8.0


def test_ujemny_bufor_znaczy_norme_niespelniona_juz_przy_wartosciach_wykazanych():
    from engine.analiza_ekonomiczna import bufor_do_progu

    assert bufor_do_progu(301_011_000, 7.5, 8.0) < 0
