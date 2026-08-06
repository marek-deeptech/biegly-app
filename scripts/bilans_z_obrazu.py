#!/usr/bin/env python3
"""Pozycje bilansu i RZiS ZE SKANU stron sprawozdania → tabele akt sprawy.

DLACZEGO TO ISTNIEJE
Rubryka 16 wskaźników SK Banku ma 17 wartości WŁASNYCH (policzonych, nie wykazanych
przez BPS) na dni 31.12.2013 i 31.12.2014 — m.in. udział należności zagrożonych
6,73 % → 21,84 %, ROE 5,87 % → 2,38 %, koszty/WDB 60,70 % → 47,24 %. Powstały
z pozycji odczytanych Z OBRAZU stron sprawozdania, bo warstwa tekstowa OCR łamie
kolumny tabel (dawała „kredyty = 300 zł" przy sumie bilansowej 3,8 mld).

Silnik tej ścieżki jest w repozytorium od commita 7b685a9 (`pozycje_z_tabel`
w engine/sprawozdania.py, wejście `--tabele` w engine/uslugi/bank.py). NIE BYŁO
natomiast ZAPISU, KTÓRE PLIKI I KTÓRE STRONY przeczytano — a bez tego artefakt
`pozyskane/tabele_sprawozdan.json` był nieodtwarzalny: dane w bazie miały źródło,
ale ścieżki nie dało się powtórzyć ani sprawdzić. Ten skrypt jest tym brakującym
ogniwem: rejestr `ODCZYTY` utrwala spis plików, stron i metodyk, a przebieg
odtwarza artefakt od skanu do wskaźnika.

⚠️ KOLEJNOŚĆ STRON JEST ZNACZĄCA. Strony 3, 5 i 8 raportu EBI nie mają nagłówków
kolumn — `pozycje_z_tabel` dziedziczy je ze strony POPRZEDNIEJ (ten sam plik,
strona o jeden mniejsza, zgodna liczba wartości w wierszu). Spis stron podany
malejąco albo z dziurą zrywa dziedziczenie i tabela wypada z odczytu.

⚠️ METODYKA FUNDUSZY WŁASNYCH JEST DEKLAROWANA, NIE ZGADYWANA. Sprawozdanie podaje
fundusze własne w dwóch rachunkach (art. 127 Prawa bankowego: 396,3 mln; CRR:
389,6 mln). Model czytający obraz nie ma jak wiedzieć, którą stronę czyta, więc
przynależność strony do metodyki jest w rejestrze — a `pozycje_z_tabel` bez tego
klucza wiersz POMIJA, zamiast zlać dwie metodyki w jedno pole.

DLACZEGO LOKALNIE, NIE W FUNKCJI BEZSERWEROWEJ
Renderowanie stron wymaga `pdftoppm` (poppler) — binarium systemowego, którego nie
ma w środowisku funkcji Vercela. Ta sama przyczyna, dla której OCR jest krokiem
lokalnym.

UŻYCIE:
    python3 scripts/bilans_z_obrazu.py SKOK                 # odtworzenie + porównanie z bazą
    python3 scripts/bilans_z_obrazu.py SKOK --zapisz        # + wgranie artefaktu do akt
    python3 scripts/bilans_z_obrazu.py SKOK --fixture       # + golden do .fixtures/ (testy)
    python3 scripts/bilans_z_obrazu.py SKOK \\
        --plik ebi14_08.ocr.pdf --strony 1:pb,2:crr,22      # spis doraźny, poza rejestrem
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
import tempfile
import urllib.parse
import urllib.request
from dataclasses import dataclass

import llm  # noqa: F401  — import dla efektu: pomiar kosztów i cache odczytów
import tabele_z_obrazu

ROOT = pathlib.Path(__file__).resolve().parent.parent
for _l in (ROOT / ".env.local").read_text(encoding="utf8").splitlines():
    if "=" in _l and not _l.startswith("#"):
        _k, _v = _l.split("=", 1)
        os.environ.setdefault(_k.strip(), _v.strip().strip("\"'"))
sys.path.insert(0, str(ROOT))

from engine.analiza_ekonomiczna import WSKAZNIKI_EF, wartosc  # noqa: E402
# `_liczba` i `_etykieta_tabeli` są prywatne, ale trzecia kopia parsera liczb
# w zapisie polskim i trzecia lista etykiet PSR rozjechałyby się z silnikiem —
# kontrola ma sprawdzać DOKŁADNIE te wiersze i liczby, które wchodzą do wskaźników.
from engine.sprawozdania import (  # noqa: E402
    ETYKIETY_TABEL,
    _etykieta_tabeli,
    _liczba,
    pozycje_z_tabel,
)
from engine.uslugi.bank import SCIEZKA_TABEL  # noqa: E402

BASE = os.environ["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
BUCKET = "case-files"

# Dziedzina — twarda bramka. Ten krok czyta bilans banku; w sprawie o manipulację
# instrumentem finansowym nie ma czego czytać (patrz PODZIAL-WATKOW.md).
TYP_DZIEDZINY = "ryzyko_bankowe"


@dataclass
class Strona:
    """Strona sprawozdania do odczytu; `metodyka` tylko tam, gdzie są fundusze własne.

    `metodyka` bywa LISTĄ — po jednej pozycji na tabelę w kolejności odczytu — bo
    strona 1 raportu EBI 8/2014 mieści DWA rachunki funduszy: art. 127 Prawa
    bankowego (kończy się wynikiem 396 347 390,10) i początek rachunku wg CRR
    (fundusze podstawowe 313 665 638,25, dokończony na stronie 2). Jedna metodyka
    na całą stronę oznaczyłaby oba tym samym kluczem.
    """

    nr: int
    metodyka: str | list[str | None] | None = None

    def metodyki(self, ile_tabel: int) -> list[str | None]:
        """Metodyka per tabela; przy liczbie innej niż zadeklarowana — przerwanie."""
        if self.metodyka is None:
            return [None] * ile_tabel
        if isinstance(self.metodyka, str):
            return [self.metodyka] * ile_tabel
        if len(self.metodyka) != ile_tabel:
            raise SystemExit(
                f"✗ str.{self.nr}: zadeklarowano metodyki dla {len(self.metodyka)} tabel "
                f"({', '.join(str(m) for m in self.metodyka)}), a odczyt dał {ile_tabel}. "
                "Metodyka trafiłaby na niewłaściwy rachunek funduszy — popraw spis w ODCZYTY "
                "po sprawdzeniu strony w oryginale."
            )
        return list(self.metodyka)


@dataclass
class Odczyt:
    plik: str
    strony: list[Strona]
    opis: str = ""


# ── Rejestr odczytów: SPIS, KTÓREGO ZABRAKŁO ─────────────────────────────────
# Odtworzony z `data.zrodla` subanalizy `analiza_ekonomiczna` (pliki + strony)
# oraz z kluczy `metodyka` w zachowanym artefakcie akt. Zgodność rejestru ze
# źródłami zapisanymi w bazie pilnuje test — spis nie może się rozjechać cicho.
ODCZYTY: dict[str, list[Odczyt]] = {
    "SKOK": [
        # Raport EBI 14/2014 — sprawozdanie finansowe SBRiR za 2014 r. Kolejność
        # stron rosnąca, bo 3, 5 i 8 są kontynuacjami bez nagłówków kolumn.
        Odczyt(
            "ebi14_14.ocr.pdf",
            [Strona(1), Strona(2), Strona(3), Strona(4), Strona(5), Strona(7), Strona(8)],
            "bilans (aktywa/pasywa), RZiS, zestawienie zmian w kapitale własnym",
        ),
        # Raport EBI 8/2014 — informacja o adekwatności kapitałowej. DWIE metodyki
        # funduszy własnych, których nie wolno zlać: art. 127 Prawa bankowego
        # (396,3 mln) i CRR (389,6 mln). ⚠️ Strona 1 mieści OBA rachunki — tabela
        # pierwsza to art. 127, druga to początek CRR dokończony na stronie 2.
        # Strona 22 to nota klasyfikacyjna należności (mianownik NOMINALNY
        # wskaźników jakości: to z niej biorą się 6,73 % → 21,84 %).
        Odczyt(
            "ebi14_08.ocr.pdf",
            [Strona(1, ["pb", "crr"]), Strona(2, "crr"), Strona(22)],
            "fundusze własne wg art. 127 pb i wg CRR, nota klasyfikacyjna należności",
        ),
    ],
}


def _req(sciezka: str, metoda: str = "GET", dane: bytes | None = None,
         naglowki: dict | None = None) -> bytes:
    req = urllib.request.Request(
        f"{BASE}{sciezka}", data=dane, method=metoda,
        headers={"apikey": KEY, "Authorization": f"Bearer {KEY}", **(naglowki or {})},
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()


def sprawa_po_nazwie(nazwa: str) -> dict:
    cs = json.loads(_req(f"/rest/v1/cases?name=eq.{urllib.parse.quote(nazwa)}&select=id,name,typ"))
    if not cs:
        raise SystemExit(f"✗ nie znaleziono sprawy: {nazwa}")
    c = cs[0]
    if c.get("typ") != TYP_DZIEDZINY:
        raise SystemExit(
            f"✗ sprawa {c['name']} ma typ „{c.get('typ')}”, a ten krok czyta bilans banku "
            f"(wymagany typ „{TYP_DZIEDZINY}”)."
        )
    return c


def pobierz_pdf(case_id: str, plik: str, katalog: pathlib.Path) -> pathlib.Path:
    """PDF z akt sprawy; kopia lokalna, żeby kolejne przebiegi nie ciągnęły 11 MB.

    Kopia leży w `.fixtures/` (poza gitem — akta nie trafiają do repozytorium).
    """
    cel = katalog / plik
    if cel.exists() and cel.stat().st_size > 0:
        return cel
    sp = f"{case_id}/pozyskane/{plik}"
    dane = _req(f"/storage/v1/object/{BUCKET}/{urllib.parse.quote(sp)}")
    if dane[:4] != b"%PDF":
        raise SystemExit(f"✗ Storage zwrócił nie-PDF dla {plik} ({len(dane)} B): {dane[:200]!r}")
    cel.parent.mkdir(parents=True, exist_ok=True)
    cel.write_bytes(dane)
    return cel


def czytaj_odczyt(pdf: pathlib.Path, odczyt: Odczyt, dpi: int) -> list[dict]:
    """Renderuje i czyta wskazane strony; zwraca tabele z `plik`/`strona`/`metodyka`.

    Wynik `tabele_z_obrazu.czytaj_strone` NIE zawiera nazwy pliku ani metodyki —
    obie dokłada ten krok, bo obie są wiedzą o dokumencie, nie o obrazie strony.
    """
    out: list[dict] = []
    numery = [s.nr for s in odczyt.strony]
    if numery != sorted(numery):
        raise SystemExit(
            f"✗ {odczyt.plik}: strony podane nierosnąco {numery} — dziedziczenie kolumn "
            "przez strony-kontynuacje wymaga kolejności rosnącej (patrz nagłówek skryptu)."
        )
    with tempfile.TemporaryDirectory() as tmp:
        for s in odczyt.strony:
            obraz = tabele_z_obrazu.renderuj(pdf, s.nr, dpi, pathlib.Path(tmp))
            odp = tabele_z_obrazu.czytaj_strone(obraz, "bilans")
            if "blad" in odp:
                print(f"   str.{s.nr:>3}: ✗ {odp['blad']}")
                continue
            tabele = odp.get("tabele") or []
            metodyki = s.metodyki(len(tabele))
            # Jedna metodyka na stronę i więcej niż jeden rachunek funduszy własnych
            # to przypisanie po omacku — wtedy przerywamy, zamiast oznaczyć oba tak samo.
            if isinstance(s.metodyka, str):
                z_funduszami = sum(1 for t in tabele if any(
                    str(w.get("etykieta", "")).strip().lower().startswith("fundusze własne")
                    for w in (t.get("wiersze") or [])))
                if z_funduszami > 1:
                    raise SystemExit(
                        f"✗ {odczyt.plik} str.{s.nr}: {z_funduszami} tabele z wierszem "
                        f"„Fundusze własne”, a metodyka „{s.metodyka}” jest zadeklarowana dla całej "
                        "strony — przypisanie byłoby domysłem. Podaj metodyki listą, po jednej "
                        "na tabelę."
                    )
            for t, met in zip(tabele, metodyki):
                t["strona"] = s.nr
                t["plik"] = odczyt.plik
                t["uwagi"] = tabele_z_obrazu.sprawdz(t)
                if met:
                    t["metodyka"] = met
                out.append(t)
            opis_met = ", ".join(m or "—" for m in metodyki) if any(metodyki) else ""
            print(f"   str.{s.nr:>3}: {len(tabele)} tab.  "
                  f"kolumny={tabele[0].get('kolumny') if tabele else '—'}"
                  f"{'  metodyka=' + opis_met if opis_met else ''}")
    return out


def _pole_wiersza(etykieta) -> str | None:
    """Pole `Pozycje`, do którego silnik zmapuje etykietę — albo None."""
    e = _etykieta_tabeli(str(etykieta))
    return next((p for wz, p in ETYKIETY_TABEL if wz.match(e)), None)


def kontrola_udzialow(tabele: list[dict]) -> list[str]:
    """Kontrola krzyżowa noty klasyfikacyjnej: kwota / suma == udział z dokumentu.

    ⚠️ TO WALIDUJE WPROST LICZBĘ NAGŁÓWKOWĄ OPINII. Nota klasyfikacyjna podaje pod
    każdą datą kolumnę złotową i procentową. Jeżeli 110 626 541,71 / 1 644 687 085,45
    daje 6,73 % i dokument też pisze 6,73 %, to obie kolumny potwierdzają się
    nawzajem — sam iloraz tego nie dowodzi, bo liczy się z tej samej liczby.

    ⚠️ SPRAWDZAMY WYŁĄCZNIE WIERSZE WCHODZĄCE DO WSKAŹNIKÓW (należności zagrożone
    wobec należności ogółem brutto). Wiersze podrzędne noty liczą udział od SWOJEJ
    kategorii, nie od sumy portfela: „- poniżej standardu 39,28 %” to udział
    w zagrożonych, a nie w należnościach ogółem. Porównywanie ich z sumą portfela
    dawało 19 fałszywych alarmów — kontrola, która krzyczy bez powodu, jest gorsza
    niż jej brak, bo uczy przewijać ostrzeżenia.
    """
    def liczba(x) -> float | None:
        return _liczba(str(x).replace("%", "").strip())

    def w_kolumnie(w: dict, i: int) -> float | None:
        war = w.get("wartosci") or []
        return liczba(war[i]) if i < len(war) else None

    uwagi: list[str] = []
    for t in tabele:
        kolumny = [str(k) for k in (t.get("kolumny") or [])]
        wiersze = t.get("wiersze") or []
        suma_w = next((w for w in wiersze
                       if _pole_wiersza(w.get("etykieta")) == "naleznosci_nominalne"), None)
        zagr_w = next((w for w in wiersze
                       if _pole_wiersza(w.get("etykieta")) == "kredyty_zagrozone"), None)
        if not suma_w or not zagr_w:
            continue
        # Pary „<data> zł” / „<data> %” — kolumna procentowa stoi zaraz za złotową.
        for i_zl, i_pct in [(i, i + 1) for i in range(len(kolumny) - 1)
                            if "%" not in kolumny[i] and "%" in kolumny[i + 1]]:
            suma, kwota = w_kolumnie(suma_w, i_zl), w_kolumnie(zagr_w, i_zl)
            udzial = w_kolumnie(zagr_w, i_pct)
            if not suma or kwota is None or udzial is None:
                continue
            policzony = 100.0 * kwota / suma
            zgodne = abs(policzony - udzial) <= 0.02
            uwagi.append(
                f"{t.get('plik')}, str. {t.get('strona')}, kolumna „{kolumny[i_zl]}”: "
                f"należności zagrożone / należności ogółem = {policzony:.2f} %, dokument podaje "
                f"{udzial:.2f} % — " + ("zgodność ✓" if zgodne else
                "ROZBIEŻNOŚĆ w materiale albo w odczycie; sprawdź w oryginale.")
            )
    return uwagi


def wskazniki_z_pozycji(poz: list) -> dict[str, dict[str, float]]:
    """{dzien: {kod_wskaznika: wartość w %}} — tylko to, co dało się policzyć."""
    out: dict[str, dict[str, float]] = {}
    for p in poz:
        for w in WSKAZNIKI_EF:
            v = wartosc(w, p)
            if v is not None:
                out.setdefault(p.dzien, {})[w.kod] = round(v, 2)
    return out


def wskazniki_z_bazy(case_id: str) -> dict[str, dict[str, float]]:
    """Wartości WŁASNE rubryki zapisane w bazie (bez gwiazdki = policzone, nie wykazane)."""
    dane = json.loads(_req(
        f"/rest/v1/subanalyses?case_id=eq.{case_id}&kind=eq.analiza_ekonomiczna&select=data"))
    if not dane:
        return {}
    tab = (dane[0].get("data") or {}).get("table") or {}
    head, rows = tab.get("head") or [], tab.get("rows") or []
    po_nazwie = {w.nazwa: w.kod for w in WSKAZNIKI_EF}
    out: dict[str, dict[str, float]] = {}
    for row in rows:
        kod = po_nazwie.get(row[1] if len(row) > 1 else "")
        if not kod:
            continue
        for i, sur in enumerate(row[3:], start=3):
            s = str(sur).strip()
            # Gwiazdka = wartość WYKAZANA przez BPS, nie policzona z bilansu.
            if not s or s == "—" or "*" in s:
                continue
            v = _liczba(s.replace("%", "").strip())
            if v is not None and i < len(head):
                out.setdefault(head[i], {})[kod] = round(v, 2)
    return out


def porownaj(nowe: dict, stare: dict, co_nowe: str, co_stare: str) -> list[str]:
    """Różnice dwóch zestawów {dzien: {kod: wartość}} — wypisane, nigdy wygładzone."""
    roznice: list[str] = []
    for dzien in sorted(set(nowe) | set(stare)):
        a, b = nowe.get(dzien) or {}, stare.get(dzien) or {}
        for kod in sorted(set(a) | set(b)):
            x, y = a.get(kod), b.get(kod)
            if x is None:
                roznice.append(f"{dzien} {kod}: brak w {co_nowe}, w {co_stare} {y:.2f} %")
            elif y is None:
                roznice.append(f"{dzien} {kod}: {x:.2f} % w {co_nowe}, brak w {co_stare}")
            elif abs(x - y) > 0.005:
                roznice.append(f"{dzien} {kod}: {co_nowe} {x:.2f} % ≠ {co_stare} {y:.2f} %")
    return roznice


def artefakt_z_akt(case_id: str) -> list[dict] | None:
    try:
        return json.loads(_req(
            f"/storage/v1/object/{BUCKET}/{urllib.parse.quote(f'{case_id}/{SCIEZKA_TABEL}')}"))
    except Exception:  # noqa: BLE001
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("sprawa", help="nazwa sprawy (np. SKOK)")
    ap.add_argument("--plik", action="append", default=[], help="spis doraźny: nazwa pliku w pozyskane/")
    ap.add_argument("--strony", action="append", default=[],
                    help="numery po przecinku, opcjonalnie nr:metodyka (np. 1:pb,2:crr,22)")
    ap.add_argument("--dpi", type=int, default=200)
    ap.add_argument("--zapisz", action="store_true", help="wgraj artefakt do akt sprawy")
    ap.add_argument("--fixture", action="store_true", help="zapisz golden do .fixtures/ (testy)")
    ap.add_argument("--json", help="zapisz odczyt do pliku lokalnego")
    a = ap.parse_args()

    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("✗ brak ANTHROPIC_API_KEY", file=sys.stderr)
        return 2

    c = sprawa_po_nazwie(a.sprawa)
    case_id, nazwa = c["id"], c["name"]

    if a.plik:
        if len(a.plik) != len(a.strony):
            print("✗ --plik i --strony muszą występować parami", file=sys.stderr)
            return 2
        odczyty = []
        for plik, spis in zip(a.plik, a.strony):
            strony = []
            for cz in spis.split(","):
                cz = cz.strip()
                if not cz:
                    continue
                nr, _, met = cz.partition(":")
                strony.append(Strona(int(nr), met.strip().lower() or None))
            odczyty.append(Odczyt(plik, strony, "spis doraźny z wiersza poleceń"))
    else:
        odczyty = ODCZYTY.get(nazwa) or []
        if not odczyty:
            print(f"✗ brak zapisanego odczytu dla sprawy {nazwa}; podaj --plik/--strony "
                  f"albo dopisz do ODCZYTY w {pathlib.Path(__file__).name}", file=sys.stderr)
            return 2

    katalog = ROOT / ".fixtures" / "pozyskane" / nazwa
    tabele: list[dict] = []
    print(f"sprawa {nazwa} ({case_id})\n")
    for o in odczyty:
        print(f"— {o.plik}" + (f"  [{o.opis}]" if o.opis else ""))
        pdf = pobierz_pdf(case_id, o.plik, katalog)
        tabele += czytaj_odczyt(pdf, o, a.dpi)
        print()

    if not tabele:
        print("✗ nie odczytano żadnej tabeli", file=sys.stderr)
        return 1

    # ── Walidacje ────────────────────────────────────────────────────────────
    uwagi: list[str] = []
    poz, wykazane, zastrzezenia, miejsca = pozycje_z_tabel(tabele, uwagi=uwagi)
    krzyzowe = kontrola_udzialow(tabele)

    print(f"═ ODCZYT: {len(tabele)} tabel, okresy {', '.join(p.dzien for p in poz) or '—'}")
    for u in uwagi:
        print(f"   · {u}")
    for u in krzyzowe:
        print(f"   ⚠ {u}")
    if wykazane:
        print("   wykazany współczynnik wypłacalności: "
              + ", ".join(f"{d} = {v:.2f} %" for d, v in wykazane))

    if zastrzezenia:
        print(f"\n⚠ ZASTRZEŻENIA ({len(zastrzezenia)}):")
        for z in zastrzezenia:
            print(f"   ✗ {z}")

    # ── Wskaźniki i porównanie z bazą ────────────────────────────────────────
    nowe = wskazniki_z_pozycji(poz)
    print(f"\n═ WSKAŹNIKI POLICZONE ({sum(len(v) for v in nowe.values())} wartości)")
    for dzien in sorted(nowe):
        print(f"  {dzien}")
        for kod, v in sorted(nowe[dzien].items()):
            nazwa_w = next((w.nazwa for w in WSKAZNIKI_EF if w.kod == kod), kod)
            print(f"     {kod:<24} {v:>8.2f} %   {nazwa_w[:46]}")

    w_bazie = wskazniki_z_bazy(case_id)
    roznice = porownaj(nowe, w_bazie, "odczyt", "baza")
    print(f"\n═ PORÓWNANIE Z BAZĄ ({sum(len(v) for v in w_bazie.values())} wartości własnych w bazie)")
    if roznice:
        print(f"⚠ ROZBIEŻNOŚCI ({len(roznice)}) — NIE nadpisuję niczego po cichu:")
        for r in roznice:
            print(f"   ✗ {r}")
    else:
        print("✓ zgodność co do setnej — odczyt odtwarza wartości zapisane w bazie")

    # Porównanie z zachowanym artefaktem akt: czy ponowny odczyt daje to samo.
    stary = artefakt_z_akt(case_id)
    if stary:
        poz_s, _, _, _ = pozycje_z_tabel(stary, uwagi=[])
        r2 = porownaj(nowe, wskazniki_z_pozycji(poz_s), "odczyt", "artefakt w aktach")
        print(f"\n═ PORÓWNANIE Z ARTEFAKTEM W AKTACH ({len(stary)} tabel)")
        if r2:
            print(f"⚠ ROZBIEŻNOŚCI ({len(r2)}):")
            for r in r2:
                print(f"   ✗ {r}")
        else:
            print("✓ ponowny odczyt daje te same wskaźniki co artefakt zapisany w aktach")

    tresc = json.dumps(tabele, ensure_ascii=False, indent=1)
    if a.json:
        pathlib.Path(a.json).write_text(tresc, encoding="utf8")
        print(f"\n✓ zapisano {a.json}")
    if a.fixture:
        cel = ROOT / ".fixtures" / f"tabele_sprawozdan_{nazwa}.json"
        cel.parent.mkdir(parents=True, exist_ok=True)
        cel.write_text(tresc, encoding="utf8")
        print(f"✓ golden dla testów: {cel}")

    # ── Zapis do akt: tylko na żądanie i tylko bez zastrzeżeń ────────────────
    if not a.zapisz:
        print("\ntryb raportu — uruchom z --zapisz, żeby wgrać artefakt do akt")
        return 1 if (zastrzezenia or roznice) else 0

    if zastrzezenia:
        print("\n✗ NIE ZAPISUJĘ: odczyt ma zastrzeżenia (wyżej). Rozstrzygnij je "
              "w oryginale — artefakt akt ma być odczytem, któremu można zaufać.", file=sys.stderr)
        return 1
    if roznice:
        print("\n✗ NIE ZAPISUJĘ: odczyt różni się od wartości w bazie (wyżej). "
              "Ciche nadpisanie ukryłoby zmianę liczb, na których stoi opinia.", file=sys.stderr)
        return 1

    _req(f"/storage/v1/object/{BUCKET}/{urllib.parse.quote(f'{case_id}/{SCIEZKA_TABEL}')}",
         "POST", tresc.encode("utf8"),
         {"Content-Type": "application/json", "x-upsert": "true"})
    print(f"\n✓ wgrano {SCIEZKA_TABEL} do akt sprawy {nazwa} ({len(tabele)} tabel)")
    print("  przelicz rubrykę: python3 -m engine.uslugi.bank " + case_id)
    return 0


if __name__ == "__main__":
    sys.exit(main())
