#!/usr/bin/env python3
"""Odczyt tabel ZE SKANU STRONY, gdy OCR spłaszcza układ kolumn.

DLACZEGO TO ISTNIEJE
OCR zwraca ciąg słów, gubiąc przynależność liczby do kolumny. W harmonogramie działań
UKNF (akta SK Banku) tabele są wplecione w narrację i po OCR wychodzą jako jeden potok:
„Fundusze własne 141.006 154.148 Współczynnik wypłacalności 10,60% 9,61%". Model
czytający TEN TEKST musi zgadywać, która liczba należy do którego okresu — i w jednym
z wierszy pomylił się, biorąc wartość z sąsiedniej tabeli.

Ten sam model czytający OBRAZ strony widzi linie tabeli i nagłówki kolumn. Skan jest
źródłem; zawodzi OCR, nie dane.

DLACZEGO LOKALNIE, NIE W FUNKCJI BEZSERWEROWEJ
Renderowanie stron wymaga `pdftoppm` (poppler) — binarium systemowego, którego nie ma
w środowisku funkcji Vercela. Ta sama przyczyna, dla której OCR jest krokiem lokalnym.

UŻYCIE:
    python3 scripts/tabele_z_obrazu.py <plik.pdf> --strony 7,9,14,20,41 [--dpi 200]
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import llm

SYSTEM = (
    "Jesteś asystentem biegłego sądowego. Otrzymujesz OBRAZ strony dokumentu nadzorczego. "
    "Strona bywa obrócona o 90 stopni — odczytaj ją mimo to. "
    "Odczytaj WYŁĄCZNIE tabele wskaźników finansowych banku. "
    "ZASADY BEZWZGLĘDNE: "
    "(1) Przepisuj liczby DOKŁADNIE tak, jak widnieją, wraz z separatorami; nie przeliczaj "
    "i nie zaokrąglaj. (2) Każdą wartość przypisz do kolumny, nad którą stoi — nagłówki kolumn "
    "to daty. (3) Jeżeli nagłówka kolumny nie widać, POMIŃ tabelę zamiast zgadywać. "
    "(4) Zapisz jednostkę, jeśli jest podana w przypisie (np. „Dane w tys. zł”). "
    "(5) Nie interpretuj i nie komentuj — sam odczyt. "
    '(6) Zwróć WYŁĄCZNIE JSON: {"tabele":[{"jednostka":"","kolumny":["31.12.2012","31.03.2013"],'
    '"wiersze":[{"etykieta":"Suma bilansowa","wartosci":["1.578.168","2.429.334"]}]}]}'
)

# Tryb „bilans” — strony SPRAWOZDANIA FINANSOWEGO (bilans, rachunek zysków i strat,
# zestawienie zmian w kapitale), nie tabele wskaźników w narracji nadzorczej.
# Osobny prompt, bo tam nagłówkiem kolumny bywa sam rok („2013 r.”) albo data pod
# wspólnym nagłówkiem „stan na”, a etykiety wierszy mają numerację rzymską, którą
# trzeba zachować w tle, ale nie w etykiecie.
SYSTEM_BILANS = (
    "Jesteś asystentem biegłego sądowego. Otrzymujesz OBRAZ strony sprawozdania "
    "finansowego banku (bilans, rachunek zysków i strat, zestawienie zmian w kapitale "
    "własnym). Odczytaj tabele z tej strony. "
    "ZASADY BEZWZGLĘDNE: "
    "(1) Przepisuj liczby DOKŁADNIE tak, jak widnieją, wraz z separatorami; nie przeliczaj "
    "i nie zaokrąglaj. (2) Każdą wartość przypisz do kolumny, nad którą stoi. Nagłówki "
    "kolumn to daty („31.12.2013 r.”) albo okresy roczne („2013 r.”) — przepisz nagłówek "
    "dosłownie. (3) Jeżeli nagłówka kolumn nie widać, a data stanu jest podana w zdaniu "
    "nad tabelą (np. „według stanu na 31.12.2014”), użyj tej daty jako nagłówka jedynej "
    "kolumny wartości; gdy i tego nie ma — POMIŃ tabelę zamiast zgadywać. "
    "(4) Etykieta wiersza BEZ numeracji rzymskiej/arabskiej z brzegu tabeli, ale z pełną "
    "treścią (np. „Zysk (strata) netto”, „Należności od sektora niefinansowego”). "
    "Wiersze podrzędne (1., a), b)) przepisuj jako osobne wiersze z ich etykietami. "
    "(5) Zapisz jednostkę z nagłówka strony (np. „w złotych”), jeśli podana. "
    "(6) Nie interpretuj i nie komentuj — sam odczyt. "
    '(7) Zwróć WYŁĄCZNIE JSON: {"tabele":[{"jednostka":"w złotych",'
    '"kolumny":["31.12.2013","31.12.2014"],'
    '"wiersze":[{"etykieta":"Aktywa razem","wartosci":["3 105 176 764,07","3 828 641 287,62"]}]}]}'
)


def renderuj(pdf: Path, strona: int, dpi: int, katalog: Path) -> Path:
    wzor = katalog / f"s{strona:04d}"
    subprocess.run(
        ["pdftoppm", "-png", "-r", str(dpi), "-f", str(strona), "-l", str(strona), str(pdf), str(wzor)],
        check=True, capture_output=True, timeout=300,
    )
    pliki = sorted(katalog.glob(f"s{strona:04d}*.png"))
    if not pliki:
        raise RuntimeError(f"nie udało się wyrenderować strony {strona}")
    return pliki[0]


def czytaj_strone(obraz: Path, tryb: str = "wskazniki") -> dict:
    dane = base64.standard_b64encode(obraz.read_bytes()).decode()
    msg = llm.klient("tabele_z_obrazu").messages.create(
        model="claude-opus-4-8",
        # Strona bilansu ma kilkadziesiąt wierszy z długimi etykietami — 4000 tokenów
        # urywało odpowiedź w połowie pasywów.
        max_tokens=8000 if tryb == "bilans" else 4000,
        system=SYSTEM_BILANS if tryb == "bilans" else SYSTEM,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": dane}},
                {"type": "text", "text": "Odczytaj tabele wskaźników z tej strony."},
            ],
        }],
    )
    if msg.stop_reason == "max_tokens":
        return {"blad": "odpowiedź urwana"}
    tekst = "".join(b.text for b in msg.content if b.type == "text")
    i, j = tekst.find("{"), tekst.rfind("}")
    if i < 0 or j < 0:
        return {"blad": "nie rozpoznano odpowiedzi jako danych"}
    try:
        return json.loads(tekst[i : j + 1])
    except json.JSONDecodeError as e:
        return {"blad": f"niepoprawny JSON: {e}"}


def _liczba(s: str) -> float | None:
    t = str(s).replace("%", "").replace(" ", "").replace(" ", "").strip()
    # Zapis polski: kropka jako separator tysięcy, przecinek dziesiętny.
    t = t.replace(".", "") if t.count(".") >= 1 and "," in t else t.replace(".", "")
    t = t.replace(",", ".")
    try:
        return float(t)
    except ValueError:
        return None


def sprawdz(tabela: dict) -> list[str]:
    """Kontrola wewnętrzna tabeli: udział musi zgadzać się z ilorazem.

    ⚠️ TA KONTROLA WYKRYWA BŁĄD W SAMYM DOKUMENCIE, nie tylko w odczycie. W harmonogramie
    UKNF kolumna 31.03.2013 podaje portfel 1.222.476, portfel z utratą 115.338 i udział
    6,39% — a iloraz daje 9,43%. Kolumna obok (31.12.2012) domyka się co do setnej.
    Rozbieżność jest więc cechą materiału dowodowego i musi trafić do opinii jako uwaga,
    a nie zostać po cichu wygładzona.
    """
    wg = {w["etykieta"].lower(): w["wartosci"] for w in tabela.get("wiersze", [])}
    kol = tabela.get("kolumny", [])
    uwagi: list[str] = []

    def znajdz(*frazy: str) -> list[str] | None:
        for k, v in wg.items():
            if all(f in k for f in frazy):
                return v
        return None

    portfel = znajdz("portfel", "kredytowy")
    utrata = znajdz("portfel", "utrat")
    udzial = znajdz("utrat", "/")
    if portfel and utrata and udzial:
        for i, nazwa in enumerate(kol):
            p, u, d = (_liczba(x[i]) if i < len(x) else None for x in (portfel, utrata, udzial))
            if p and u is not None and d is not None:
                policzony = 100.0 * u / p
                if abs(policzony - d) > 0.15:
                    uwagi.append(
                        f"kolumna {nazwa}: {u:,.0f} / {p:,.0f} = {policzony:.2f}%, a tabela podaje "
                        f"{d:.2f}% — rozbieżność w SAMYM DOKUMENCIE, nie w odczycie."
                        .replace(",", " ")
                    )
    return uwagi


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--strony", required=True, help="numery stron po przecinku")
    ap.add_argument("--dpi", type=int, default=200)
    ap.add_argument("--json", help="zapisz wynik do pliku")
    ap.add_argument("--tryb", choices=("wskazniki", "bilans"), default="wskazniki",
                    help="wskazniki = tabele w narracji nadzorczej (domyślnie); "
                         "bilans = strony sprawozdania finansowego")
    a = ap.parse_args()

    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("brak ANTHROPIC_API_KEY", file=sys.stderr)
        return 2
    pdf = Path(a.pdf)
    strony = [int(x) for x in a.strony.split(",") if x.strip()]
    wynik = []
    with tempfile.TemporaryDirectory() as tmp:
        for s in strony:
            obraz = renderuj(pdf, s, a.dpi, Path(tmp))
            odczyt = czytaj_strone(obraz, a.tryb)
            if "blad" in odczyt:
                print(f"str.{s}: ✗ {odczyt['blad']}")
                continue
            for t in odczyt.get("tabele", []):
                uwagi = sprawdz(t)
                t["strona"] = s
                t["uwagi"] = uwagi
                wynik.append(t)
                print(f"\nstr.{s}  kolumny: {t.get('kolumny')}  jednostka: {t.get('jednostka') or '—'}")
                for w in t.get("wiersze", []):
                    print(f"    {w['etykieta'][:46]:<48} {'  '.join(str(x).rjust(12) for x in w['wartosci'])}")
                for u in uwagi:
                    print(f"    ⚠ {u}")
    if a.json:
        Path(a.json).write_text(json.dumps(wynik, ensure_ascii=False, indent=1), encoding="utf8")
        print(f"\n✓ zapisano {a.json} — {len(wynik)} tabel")
    return 0


if __name__ == "__main__":
    sys.exit(main())
