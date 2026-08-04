"""Ekstraktor kotwicowy zdarzeń uzupełniających — funkcje czyste.

Skrypt dopisuje do chronologii fakty, których ekstrakcja modelowa nie wyjęła
z pism (ocena NIK, wniosek do KNA, opinie rewidentów). Zdarzenie powstaje TYLKO
przy potwierdzonej kotwicy tekstowej, a scalenie jest idempotentne — te testy
pilnują obu własności na czystych funkcjach, bez sieci i bez akt.
"""
import importlib.util
import os

_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _mod(nazwa, sciezka):
    s = importlib.util.spec_from_file_location(nazwa, os.path.join(_HERE, sciezka))
    m = importlib.util.module_from_spec(s)
    s.loader.exec_module(m)
    return m


zp = _mod("zdarzenia_pism", "scripts/zdarzenia_pism.py")


def test_data_z_naglowka_slownie_i_liczbowo():
    assert zp.iso_z_naglowka("Warszawa, dnia 12 stycznia 2016 r.\nRZECZPOSPOLITA") == "2016-01-12"
    assert zp.iso_z_naglowka("Pismem z dnia 30.03.2015 r. bank przekazał…") == "2015-03-30"
    # miesiąc w odmianie („czerwca") — liczy się rdzeń
    assert zp.iso_z_naglowka("dnia 9 czerwca 2015 roku") == "2015-06-09"


def test_brak_daty_daje_None_a_nie_zgadywanie():
    # Rok bez dnia to nie jest data zdarzenia — zdarzenie ma zostać pominięte.
    assert zp.iso_z_naglowka("W 2015 roku bank utracił płynność.") is None
    assert zp.iso_z_naglowka("") is None


def test_scal_jest_idempotentne_po_kotwicy():
    a = {"kotwica": "x", "data": "2015-01-01", "organ": "KNF", "opis": "A", "plik": "p"}
    wynik, dodane = zp.scal([a], [a, dict(a)])
    assert len(wynik) == 1 and dodane == []
    wynik2, dodane2 = zp.scal([], [a, {**a, "kotwica": "y"}])
    assert len(wynik2) == 2 and dodane2 == ["x", "y"]


def test_wzorce_toleruja_skroty_z_kropka():
    """Regresja: [^.] w separatorze ucinał dopasowanie na „2015 r." — kotwica
    „nie znajdowała" frazy, która w skanie BYŁA, i zdarzenie nie powstawało."""
    import re

    proby = {
        "rwef-3q2015-niesporzadzona": (
            "analiza kwartalna w oparciu o system KOBRA według stanu na dzień "
            "30 września 2015 r. nie była sporządzona, ponieważ RWEF za III kwartał 2015 r."
        ),
        "rewidenci-bez-zastrzezen-2013-2014": (
            "opinie biegłych rewidentów badających sprawozdania finansowe SBRzR "
            "za 2013 r. i 2014 r. nie zawierały zastrzeżeń co do prawidłowości"
        ),
        "knf-kna-dyscyplinarne-rewidenci": (
            "Komisja Nadzoru Finansowego zwróciła się do Komisji Nadzoru Audytowego "
            "z prośbą o wszczęcie postępowania dyscyplinarnego wobec biegłych rewidentów"
        ),
    }
    wg = {k["kotwica"]: k for k in zp.KOTWICE}
    for kid, tekst in proby.items():
        assert re.search(wg[kid]["wzor"], tekst, re.I), f"wzorzec {kid} nie łapie cytatu z akt"


def test_zadna_kotwica_nie_bierze_daty_z_naglowka_wieloskanowego():
    """Regresja: „pierwsza data w pliku" na skanie z 19 dokumentami dała 23.12.1994
    jako datę pisma KNF z 2017 r. Kotwice mają daty STAŁE, zweryfikowane w treści."""
    for k in zp.KOTWICE:
        assert k["data"] is not None, (
            f"kotwica {k['kotwica']}: data z nagłówka jest zawodna na skanach "
            "wielodokumentowych — podaj datę stałą z uzasadnieniem w opisie"
        )


def test_kotwice_maja_unikalne_id_i_komplet_pol():
    idki = [k["kotwica"] for k in zp.KOTWICE]
    assert len(idki) == len(set(idki)), "kotwice muszą być unikalne — dedup scalania na nich stoi"
    for k in zp.KOTWICE:
        for pole in ("rdzen", "wzor", "organ", "opis", "plik"):
            assert k.get(pole), f"kotwica {k['kotwica']}: brak pola {pole}"
        # data stała albo świadome None (data z nagłówka pisma) — ale klucz musi istnieć,
        # żeby literówka w nazwie pola nie przeszła jako „brak daty".
        assert "data" in k
