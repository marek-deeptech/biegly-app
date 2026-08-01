#!/usr/bin/env python3
"""OCR akt sprawy — KROK ZEROWY, przed jakąkolwiek analizą.

DLACZEGO TO JEST KROK ZEROWY, A NIE OPCJA
Skan bez warstwy tekstowej jest dla aplikacji plikiem pustym. W sprawie MBR
(PO III Ds 84.2020) wgrano 81 dokumentów, z czego DZIEWIĘĆ kluczowych — postanowienie
o powołaniu biegłego, zawiadomienie, protokoły komitetu, metodyka limitów, audyt
wewnętrzny, BION, uchwały — miało ZERO znaków tekstu na 125 stronach. Aplikacja nie
znalazła pytań organu ani podmiotów nie dlatego, że ich nie było, tylko dlatego, że
patrzyła na obrazki. Kompletność akt pokazywała komplet, choć treść była niedostępna.

Wniosek ogólny: **jeśli w sprawie są skany, OCR robi się PRZED klasyfikacją,
kompletnością i analizą** — inaczej wszystkie trzy kłamią.

UŻYCIE
    python3 scripts/ocr_akta.py --dir ~/Downloads/AKTA           # raport, bez zapisu
    python3 scripts/ocr_akta.py --dir ~/Downloads/AKTA --wykonaj # OCR do <plik>.ocr.pdf
    python3 scripts/ocr_akta.py --dir ~/Downloads/AKTA --oznacz MBR  # ustaw warstwa_tekstu w bazie
    python3 scripts/ocr_akta.py --domknij MBR                        # PEŁNA PĘTLA dla sprawy

TRYB --domknij: PEŁNA PĘTLA NA AKTACH W CHMURZE
Znajduje w sprawie dokumenty bez warstwy tekstowej, pobiera je ze Storage, OCR-uje,
wgrywa wersję `.ocr.pdf` z powrotem i oznacza w bazie. Jednym poleceniem doprowadza
sprawę do stanu, w którym ŻADEN wgrany plik nie jest dla analizy pusty.

Dlaczego to nie dzieje się automatycznie przy wgrywaniu: OCR wymaga `ocrmypdf`
i `tesseract` — binariów systemowych, których nie ma w środowisku funkcji
bezserwerowych. Alternatywą byłaby usługa OCR w chmurze, ale akta zawierają dane
osobowe stron postępowań karnych i wysłanie ich do zewnętrznego dostawcy jest
decyzją użytkownika, nie domyślnym zachowaniem narzędzia.

ZASADA NIENARUSZALNOŚCI ORYGINAŁU
Wynik trafia OBOK oryginału jako `<nazwa>.ocr.pdf`, nigdy w jego miejsce. `ocrmypdf`
zachowuje obraz strony i dokłada niewidoczną warstwę tekstową, więc dokument pozostaje
wiernym odwzorowaniem skanu — ale plik dowodowy w aktach ma zostać bitowo nietknięty.
"""
from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

# Poniżej tylu znaków na stronę uznajemy, że warstwy tekstowej faktycznie nie ma.
# Skany bywają „podpisane" stopką generatora (kilkanaście znaków) — to nie treść.
PROG_ZNAKOW_NA_STRONE = 80


def tekst_pdf(p: Path) -> tuple[int, int]:
    """(liczba stron, liczba znaków tekstu) — bez rzucania wyjątkiem na uszkodzonym pliku."""
    try:
        from pypdf import PdfReader

        r = PdfReader(str(p))
        return len(r.pages), sum(len((s.extract_text() or "").strip()) for s in r.pages)
    except Exception:  # noqa: BLE001 — plik nieczytelny to informacja, nie awaria przebiegu
        return 0, 0


def _env() -> tuple[str, str]:
    out = {}
    for line in (Path(__file__).resolve().parent.parent / ".env.local").read_text(encoding="utf8").splitlines():
        m = re.match(r"^([A-Z_]+)=(.*)$", line.strip())
        if m:
            out[m.group(1)] = m.group(2).strip().strip("\"'")
    return out["NEXT_PUBLIC_SUPABASE_URL"], out["SUPABASE_SERVICE_ROLE_KEY"]


def oznacz_w_bazie(katalog: Path, sprawa: str) -> int:
    """Ustawia `documents.warstwa_tekstu` dla dokumentów sprawy (migracja 0011).

    Dopasowanie po NAZWIE PLIKU, nie po pełnej ścieżce: `rel_path` w bazie ma prefiks
    nadany przy wgrywaniu i nie odpowiada układowi katalogu na dysku.

    Formaty tekstowe (docx/xlsx/csv/txt) dostają 'jest' bez sprawdzania — treść jest
    w nich z definicji. Obrazy dostają 'brak': to zwykle wykresy do opinii, więc nie
    zaniża to kompletności akt, ale opisuje stan zgodnie z prawdą.
    """
    import json
    import urllib.parse
    import urllib.request

    url, key = _env()

    def req(sciezka: str, metoda="GET", dane=None):
        h = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json",
             "Prefer": "return=minimal"}
        r = urllib.request.Request(f"{url}/rest/v1/{sciezka}",
                                   data=json.dumps(dane).encode() if dane else None, headers=h, method=metoda)
        with urllib.request.urlopen(r, timeout=120) as resp:
            b = resp.read()
            return json.loads(b) if b else None

    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    with urllib.request.urlopen(urllib.request.Request(
            f"{url}/rest/v1/cases?name=eq.{urllib.parse.quote(sprawa)}&select=id", headers=h)) as r:
        sprawy = json.loads(r.read())
    if not sprawy:
        print(f"✗ nie znaleziono sprawy o nazwie {sprawa}")
        return 1
    cid = sprawy[0]["id"]
    with urllib.request.urlopen(urllib.request.Request(
            f"{url}/rest/v1/documents?case_id=eq.{cid}&select=id,rel_path", headers=h)) as r:
        docs = json.loads(r.read())

    # nazwa pliku → stan warstwy, wyliczony z plików na dysku
    stan: dict[str, str] = {}
    for p in katalog.rglob("*"):
        if not p.is_file():
            continue
        ext = p.suffix.lower()
        if ext == ".pdf":
            stron, znakow = tekst_pdf(p)
            if not stron:
                continue
            ma = znakow / stron >= PROG_ZNAKOW_NA_STRONE
            stan[p.name] = ("ocr" if p.name.endswith(".ocr.pdf") else "jest") if ma else "brak"
        elif ext in (".docx", ".doc", ".xlsx", ".xls", ".csv", ".txt", ".rtf"):
            stan[p.name] = "jest"
        elif ext in (".jpg", ".jpeg", ".png", ".gif", ".tif", ".tiff"):
            stan[p.name] = "brak"

    licz = {"jest": 0, "brak": 0, "ocr": 0}
    nieznane = 0
    for d in docs:
        nazwa = d["rel_path"].split("/")[-1]
        w = stan.get(nazwa)
        if not w:
            nieznane += 1
            continue
        req(f"documents?id=eq.{d['id']}", "PATCH", {"warstwa_tekstu": w})
        licz[w] += 1

    print(f"\nOznaczono w sprawie {sprawa}:")
    print(f"  jest (czytelne): {licz['jest']}")
    print(f"  ocr  (po OCR):   {licz['ocr']}")
    print(f"  brak (do OCR):   {licz['brak']}")
    if nieznane:
        print(f"  bez odpowiednika na dysku (pominięte): {nieznane}")
    return 0


def domknij_sprawe(sprawa: str, jezyk: str, wykonaj: bool) -> int:
    """Doprowadza sprawę do stanu: każdy wgrany plik ma czytelną treść.

    Pomija świadomie dwie grupy: obrazy (wykresy do opinii — nie niosą tekstu do
    analizy) oraz oryginały, których wersja `.ocr.pdf` jest już w aktach.
    """
    import json
    import tempfile
    import unicodedata
    import urllib.parse
    import urllib.request

    url, key = _env()
    h = {"apikey": key, "Authorization": f"Bearer {key}"}

    def get(sciezka: str):
        with urllib.request.urlopen(urllib.request.Request(f"{url}/rest/v1/{sciezka}", headers=h)) as r:
            return json.loads(r.read())

    sprawy = get(f"cases?name=eq.{urllib.parse.quote(sprawa)}&select=id,typ")
    if not sprawy:
        print(f"✗ nie znaleziono sprawy {sprawa}")
        return 1
    cid = sprawy[0]["id"]
    docs = get(f"documents?case_id=eq.{cid}&select=id,rel_path,doc_type,storage_path,warstwa_tekstu")

    nfc = lambda s: unicodedata.normalize("NFC", s)  # noqa: E731
    nazwa = lambda rp: nfc(rp.split("/")[-1])  # noqa: E731
    po_ocr = {nazwa(d["rel_path"]) for d in docs if d.get("warstwa_tekstu") == "ocr"}

    do_zrobienia = []
    for d in docs:
        if d.get("warstwa_tekstu") != "brak" or not d.get("storage_path"):
            continue
        n = nazwa(d["rel_path"])
        if not n.lower().endswith(".pdf"):
            continue  # obrazy i formaty bez tekstu
        if n.replace(".pdf", ".ocr.pdf") in po_ocr:
            continue  # treść już dostępna z bliźniaka
        do_zrobienia.append((d, n))

    obrazy = sum(1 for d in docs if d.get("warstwa_tekstu") == "brak"
                 and not nazwa(d["rel_path"]).lower().endswith(".pdf"))
    print(f"Sprawa {sprawa}: {len(docs)} dokumentów")
    print(f"  bez warstwy, z bliźniakiem po OCR: {sum(1 for d in docs if d.get('warstwa_tekstu')=='brak') - len(do_zrobienia) - obrazy}")
    print(f"  obrazy (bez tekstu z natury):      {obrazy}")
    print(f"  DO OCR:                            {len(do_zrobienia)}\n")
    for _, n in do_zrobienia:
        print(f"    {n}")
    if not do_zrobienia:
        print("\n✓ każdy plik w sprawie ma czytelną treść")
        return 0
    if not wykonaj:
        print("\n  tryb raportu — uruchom z --wykonaj")
        return 0

    zrobione, bledy = 0, 0
    with tempfile.TemporaryDirectory() as tmp:
        for i, (d, n) in enumerate(do_zrobienia, 1):
            print(f"\n  [{i}/{len(do_zrobienia)}] {n}")
            src = Path(tmp) / n
            cel = Path(tmp) / n.replace(".pdf", ".ocr.pdf")
            try:
                obj = f"{url}/storage/v1/object/case-files/{urllib.parse.quote(d['storage_path'])}"
                with urllib.request.urlopen(urllib.request.Request(obj, headers=h), timeout=600) as r:
                    src.write_bytes(r.read())
                subprocess.run(
                    ["ocrmypdf", "-l", jezyk, "--force-ocr", "--optimize", "3", "--quiet", str(src), str(cel)],
                    check=True, capture_output=True, timeout=3600,
                )
                _, zn = tekst_pdf(cel)
                dane = cel.read_bytes()
                # Klucz w magazynie: ta sama transliteracja co w interfejsie (lib/upload.ts).
                klucz = f"{cid}/{cel.name}"
                for a, b in zip("ąćęłńóśźżĄĆĘŁŃÓŚŹŻ", "acelnoszzACELNOSZZ"):
                    klucz = klucz.replace(a, b)
                klucz = re.sub(r"[^\x20-\x7E]", "_", klucz)
                up = urllib.request.Request(
                    f"{url}/storage/v1/object/case-files/{urllib.parse.quote(klucz)}",
                    data=dane, method="POST",
                    headers={**h, "Content-Type": "application/pdf", "x-upsert": "true"},
                )
                urllib.request.urlopen(up, timeout=600)
                wiersz = json.dumps({
                    "case_id": cid, "rel_path": cel.name, "size_bytes": len(dane),
                    "doc_type": d["doc_type"], "source": "biegły sądowy", "provenance": "wejście",
                    "storage_path": klucz, "warstwa_tekstu": "ocr",
                }).encode()
                urllib.request.urlopen(urllib.request.Request(
                    f"{url}/rest/v1/documents", data=wiersz, method="POST",
                    headers={**h, "Content-Type": "application/json", "Prefer": "return=minimal"}), timeout=120)
                print(f"        ✓ {zn} znaków, {len(dane)/1e6:.1f} MB → wgrane jako {cel.name}")
                zrobione += 1
            except subprocess.CalledProcessError as e:
                print(f"        ✗ OCR: {e.stderr.decode('utf8','replace')[:140]}")
                bledy += 1
            except Exception as e:  # noqa: BLE001
                print(f"        ✗ {e}")
                bledy += 1

    print(f"\n✓ domknięto {zrobione}, błędów {bledy}")
    return 1 if bledy else 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", help="katalog akt sprawy (niepotrzebny przy --domknij)")
    ap.add_argument("--wykonaj", action="store_true", help="wykonaj OCR (domyślnie tylko raport)")
    ap.add_argument("--oznacz", metavar="SPRAWA", help="ustaw warstwa_tekstu w bazie dla sprawy o tej nazwie")
    ap.add_argument("--domknij", metavar="SPRAWA", help="pełna pętla: OCR brakujących + wgranie + oznaczenie")
    ap.add_argument("--jezyk", default="pol", help="języki tesseract, np. pol lub pol+eng")
    a = ap.parse_args()

    if a.wykonaj and not shutil.which("ocrmypdf"):
        sys.exit("✗ brak ocrmypdf (brew install ocrmypdf)")

    if a.domknij:
        return domknij_sprawe(a.domknij, a.jezyk, a.wykonaj)

    if not a.dir:
        sys.exit("✗ podaj --dir albo --domknij")
    katalog = Path(a.dir).expanduser()
    if not katalog.exists():
        sys.exit(f"✗ brak katalogu: {katalog}")

    if a.oznacz:
        return oznacz_w_bazie(katalog, a.oznacz)

    doOcr: list[tuple[Path, int]] = []
    maja_tekst = 0
    for p in sorted(katalog.rglob("*.pdf")):
        if p.name.endswith(".ocr.pdf"):
            continue
        stron, znakow = tekst_pdf(p)
        if not stron:
            continue
        if znakow / stron < PROG_ZNAKOW_NA_STRONE:
            doOcr.append((p, stron))
        else:
            maja_tekst += 1

    print(f"PDF-ów z warstwą tekstową: {maja_tekst}")
    print(f"PDF-ów do OCR: {len(doOcr)} ({sum(s for _, s in doOcr)} stron)\n")
    for p, stron in doOcr:
        print(f"  {stron:4d} s.  {p.relative_to(katalog)}")
    if not doOcr:
        print("\n✓ wszystkie PDF-y mają tekst — OCR niepotrzebny")
        return 0
    if not a.wykonaj:
        print("\n  tryb raportu — uruchom z --wykonaj, by wykonać OCR")
        return 0

    print()
    zrobione, bledy = 0, 0
    for i, (p, stron) in enumerate(doOcr, 1):
        cel = p.with_suffix(".ocr.pdf")
        if cel.exists():
            print(f"  [{i}/{len(doOcr)}] ⊘ {p.name[:56]} — plik .ocr.pdf już istnieje")
            continue
        print(f"  [{i}/{len(doOcr)}] {p.name[:56]} ({stron} s.) …", flush=True)
        try:
            # --force-ocr: skany bywają mają szczątkową warstwę (numer strony), przez
            # którą ocrmypdf domyślnie odmawia pracy.
            #
            # --optimize 3, NIE 0. Pierwsza wersja miała 0 („nie ruszamy obrazu") i dała
            # 16-krotny przyrost objętości: 99 MB akt spuchło do 1,57 GB, a podręcznik
            # 46 MB do 1,29 GB. Bezstratne przekodowanie skanu jest gorsze niż brak
            # kompresji w oryginale. Poziom 3 (jbig2 + pngquant) daje pliki ~2× większe
            # od oryginału, co jest kosztem samej warstwy tekstowej i jest do przyjęcia.
            subprocess.run(
                ["ocrmypdf", "-l", a.jezyk, "--force-ocr", "--optimize", "3", "--quiet", str(p), str(cel)],
                check=True,
                capture_output=True,
                timeout=1800,
            )
            _, zn = tekst_pdf(cel)
            print(f"           ✓ {zn} znaków → {cel.name}")
            zrobione += 1
        except subprocess.CalledProcessError as e:
            print(f"           ✗ {e.stderr.decode('utf8', 'replace')[:160]}")
            bledy += 1
        except subprocess.TimeoutExpired:
            print("           ✗ przekroczony czas (30 min)")
            bledy += 1

    print(f"\n✓ zOCR-owano {zrobione}, błędów {bledy}")
    print("  Pliki .ocr.pdf leżą OBOK oryginałów — oryginały nietknięte.")
    print("  Wgraj je do sprawy, żeby aplikacja zobaczyła treść skanów.")
    return 1 if bledy else 0


if __name__ == "__main__":
    sys.exit(main())
