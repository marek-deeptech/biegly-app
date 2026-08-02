#!/usr/bin/env python3
"""OCR bardzo dużych skanów — w kawałkach, gdy całość nie mieści się w limicie czasu.

DLACZEGO OSOBNO OD `ocr_akta.py`
Tamten uruchamia `ocrmypdf` na całym pliku z limitem godziny. W sprawie SKOK dwa
załączniki mają po 342 strony i przekraczają go — obydwa zostały bez warstwy
tekstowej, a więc dla analizy puste, mimo że raport kończył się liczbą „domknięto 31".

Dzielimy na paczki stron, OCR-ujemy każdą osobno (równolegle) i sklejamy z powrotem.
Oryginał pozostaje nietknięty; wynik trafia obok jako `<nazwa>.ocr.pdf`.

UŻYCIE:
    python3 scripts/ocr_duzy.py <plik.pdf> [--stron 40] [--rownolegle 4]
"""
import argparse
import concurrent.futures as cf
import subprocess
import sys
import tempfile
from pathlib import Path

import pypdf


def ocr_paczki(zrodlo: Path, cel: Path, na_paczke: int, rownolegle: int, jezyk: str) -> int:
    czytnik = pypdf.PdfReader(str(zrodlo))
    stron = len(czytnik.pages)
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        paczki = []
        for i in range(0, stron, na_paczke):
            w = pypdf.PdfWriter()
            for s in range(i, min(i + na_paczke, stron)):
                w.add_page(czytnik.pages[s])
            p = t / f"cz{i:04d}.pdf"
            with open(p, "wb") as fh:
                w.write(fh)
            paczki.append(p)
        print(f"  {stron} stron → {len(paczki)} paczek po {na_paczke}")

        def jedna(p: Path) -> Path:
            wyj = p.with_suffix(".ocr.pdf")
            subprocess.run(
                ["ocrmypdf", "-l", jezyk, "--force-ocr", "--optimize", "3", "--quiet", str(p), str(wyj)],
                check=True, capture_output=True, timeout=1800,
            )
            print(f"    ✓ {p.name}")
            return wyj

        with cf.ThreadPoolExecutor(max_workers=rownolegle) as ex:
            gotowe = list(ex.map(jedna, paczki))

        scal = pypdf.PdfWriter()
        for g in sorted(gotowe):
            for strona in pypdf.PdfReader(str(g)).pages:
                scal.add_page(strona)
        with open(cel, "wb") as fh:
            scal.write(fh)
    return stron


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("plik")
    ap.add_argument("--stron", type=int, default=40, help="stron na paczkę")
    ap.add_argument("--rownolegle", type=int, default=4)
    ap.add_argument("--jezyk", default="pol")
    a = ap.parse_args()

    zrodlo = Path(a.plik)
    cel = zrodlo.with_name(zrodlo.name.replace(".pdf", ".ocr.pdf"))
    print(f"── {zrodlo.name}")
    stron = ocr_paczki(zrodlo, cel, a.stron, a.rownolegle, a.jezyk)
    # Kontrola skuteczności: plik po OCR bez tekstu to nie sukces, tylko cichy brak.
    from pypdf import PdfReader
    znakow = sum(len(s.extract_text() or "") for s in PdfReader(str(cel)).pages)
    print(f"✓ {cel.name}: {stron} stron, {znakow} znaków, {cel.stat().st_size/1e6:.1f} MB")
    return 0 if znakow else 1


if __name__ == "__main__":
    sys.exit(main())
