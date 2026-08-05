#!/usr/bin/env python3
"""Ingest materiałów POZYSKANYCH PRZEZ BIEGŁEGO do akt sprawy.

UŻYCIE:
    python3 scripts/ingest_pozyskane.py <case_id> <manifest.json>

MANIFEST — lista pozycji:
    [{"plik": "/ścieżka/raport.pdf", "doc_type": "RAPORT_BANK_CENTRALNY",
      "opis": "NBP, Raport o stabilności…", "zrodlo_url": "https://…"}]

DLACZEGO OSOBNA ŚCIEŻKA, A NIE wgraj_akta.ts:
Tamten pipeline obsługuje SKANY AKT SĄDOWYCH: OCR, rozbijanie na dokumenty,
klasyfikację modelem i numery kart. Materiał pozyskany (wzorzec: załączniki 1–6
opinii MBR — raporty banku centralnego, prasa) przychodzi z known-good metadanymi
Z RĘKI BIEGŁEGO: typ i opis są decyzją człowieka, nie klasyfikatora, a URL źródła
jest częścią wartości dowodowej. Przepuszczenie przez klasyfikator mogłoby je
NADPISAĆ błędnym typem — a `pozyskanie: "biegly"` w taksonomii rozróżnia te
dokumenty od luk, o które trzeba wystąpić do organu.

Trafiają do tego samego kubełka i tabeli co akta (`pozyskane/<nazwa>` w sprawie),
więc moduły warsztatu widzą je bez żadnych zmian. Idempotentne po rel_path.
"""
from __future__ import annotations

import json
import mimetypes
import pathlib
import re
import subprocess
import sys
import urllib.parse
import urllib.request

REPO = pathlib.Path(__file__).resolve().parent.parent
BUCKET = "case-files"
DOZWOLONE_TYPY = {
    "PRASA", "RAPORT_BANK_CENTRALNY", "DANE_RYNKOWE_SZEREG", "RATING_AGENCJA",
    # typy „aktowe" dopuszczone świadomie: pozyskany bywa też dokument tej samej
    # natury co aktowy (raport roczny emitenta, raport sektorowy nadzoru, pismo urzędowe)
    "SPRAWOZDANIE_BANK", "NADZOR_KNF", "KORESPONDENCJA",
    # dziedzina GPW — krok 4 (ekonomia emitenta): notowania referencyjne ze stooq
    "NOTOWANIA_REF",
}


def env() -> tuple[str, str]:
    out: dict[str, str] = {}
    for line in (REPO / ".env.local").read_text(encoding="utf8").splitlines():
        m = re.match(r"^([A-Z_]+)=(.*)$", line.strip())
        if m:
            out[m.group(1)] = m.group(2).strip().strip("\"'")
    url, key = out.get("NEXT_PUBLIC_SUPABASE_URL"), out.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("✗ brak kluczy Supabase w .env.local")
    return url, key


def ma_warstwe_tekstu(p: pathlib.Path) -> bool:
    if p.suffix.lower() != ".pdf":
        return True  # docx/xlsx czyta lib/intake/office.ts
    try:
        out = subprocess.run(
            ["pdftotext", "-q", "-l", "3", str(p), "-"],
            capture_output=True, check=True, timeout=60,
        ).stdout.decode("utf8", errors="replace")
        return len(out.strip()) > 200
    except Exception:
        return False


def main() -> int:
    if len(sys.argv) < 3:
        sys.exit("użycie: python3 scripts/ingest_pozyskane.py <case_id> <manifest.json>")
    case_id, manifest_p = sys.argv[1], pathlib.Path(sys.argv[2])
    url, key = env()
    pozycje = json.loads(manifest_p.read_text(encoding="utf8"))

    def req(sciezka: str, metoda: str = "GET", cialo: bytes | None = None, naglowki: dict | None = None):
        h = {"apikey": key, "Authorization": f"Bearer {key}"}
        h.update(naglowki or {})
        r = urllib.request.Request(url + sciezka, method=metoda, headers=h, data=cialo)
        with urllib.request.urlopen(r) as odp:
            surowe = odp.read()
        return json.loads(surowe) if surowe else None

    istniejace = {
        d["rel_path"]
        for d in req(f"/rest/v1/documents?case_id=eq.{case_id}&select=rel_path&limit=3000")
    }

    dodane = pominiete = bledy = 0
    for poz in pozycje:
        p = pathlib.Path(poz["plik"])
        typ, opis, zrodlo = poz["doc_type"], poz["opis"], poz.get("zrodlo_url", "")
        if typ not in DOZWOLONE_TYPY:
            print(f"✗ {p.name}: typ {typ} spoza listy dozwolonych — pominięto")
            bledy += 1
            continue
        if not p.is_file():
            print(f"✗ {p.name}: pliku nie ma — pominięto")
            bledy += 1
            continue
        rel = f"pozyskane/{p.name}"
        if rel in istniejace:
            print(f"· {p.name}: już w aktach — pominięto")
            pominiete += 1
            continue
        storage_path = f"{case_id}/{rel}"
        try:
            req(
                f"/storage/v1/object/{BUCKET}/{urllib.parse.quote(storage_path)}",
                "POST",
                p.read_bytes(),
                {
                    "Content-Type": mimetypes.guess_type(p.name)[0] or "application/octet-stream",
                    "x-upsert": "true",
                },
            )
            warstwa = "tekst" if ma_warstwe_tekstu(p) else "brak"
            req(
                "/rest/v1/documents",
                "POST",
                json.dumps({
                    "case_id": case_id,
                    "rel_path": rel,
                    "storage_path": storage_path,
                    "doc_type": typ,
                    "opis": f"{opis}" + (f" [pozyskane przez biegłego: {zrodlo}]" if zrodlo else ""),
                    "source": "biegły sądowy (pozyskane)",
                    "provenance": "wejście",
                    "warstwa_tekstu": warstwa,
                    "size_bytes": p.stat().st_size,
                }).encode(),
                {"Content-Type": "application/json", "Prefer": "return=minimal"},
            )
            znak = "✓" if warstwa == "tekst" else "◐"
            print(f"{znak} {p.name} → {typ}" + ("" if warstwa == "tekst" else "  (skan bez warstwy tekstu — wymaga OCR)"))
            dodane += 1
        except Exception as e:  # noqa: BLE001 — jedna pozycja nie przerywa całości
            print(f"✗ {p.name}: {e}")
            bledy += 1

    print(f"\ndodane {dodane}, pominięte {pominiete}, błędy {bledy}")
    return 1 if bledy else 0


if __name__ == "__main__":
    sys.exit(main())
