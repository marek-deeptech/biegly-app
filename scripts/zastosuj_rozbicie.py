#!/usr/bin/env python3
"""Zapis inwentarza z `rozbij_skany.py` jako osobnych pozycji akt.

⚠️ ROZDZIELONY OD DETEKCJI ŚWIADOMIE. Rozbicie zmienia liczbę pozycji w aktach —
z 33 skanów robi ponad sto dokumentów, z których każdy biegły może zacytować
w opinii. Taka zmiana ma najpierw zostać obejrzana, a dopiero potem zapisana.

CO ROBI
Dla każdego dokumentu z inwentarza zakłada wiersz w `documents`, wskazujący TEN SAM
plik w magazynie co skan, ale z własnym zakresem stron, numerem karty i opisem.
Wiersz skanu zostaje jako rodzic (`plik_zrodlowy`) — plik jest jeden, mnożą się
pozycje akt, a nie kopie w magazynie.

Uruchomienie powtórne NIE DUBLUJE: pozycje rozpoznaje po (plik_zrodlowy, strona_od).

UŻYCIE:
    python3 scripts/zastosuj_rozbicie.py SKOK inwentarz.json            # podgląd
    python3 scripts/zastosuj_rozbicie.py SKOK inwentarz.json --zapisz
"""
from __future__ import annotations

import json
import os
import pathlib
import sys
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
for _l in (ROOT / ".env.local").read_text(encoding="utf8").splitlines():
    if "=" in _l and not _l.startswith("#"):
        _k, _v = _l.split("=", 1)
        os.environ.setdefault(_k.strip(), _v.strip().strip("\"'"))
BASE = os.environ["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}


def _req(method, url, body=None):
    r = urllib.request.Request(
        BASE + url, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers={**H, "Content-Type": "application/json", "Prefer": "return=representation"},
    )
    with urllib.request.urlopen(r) as resp:
        return json.loads(resp.read() or b"[]")


def main() -> int:
    sprawa, plik = sys.argv[1], sys.argv[2]
    zapisz = "--zapisz" in sys.argv
    inwentarz = json.loads(pathlib.Path(plik).read_text(encoding="utf8"))

    cid = _req("GET", f"/rest/v1/cases?name=eq.{urllib.parse.quote(sprawa)}&select=id")[0]["id"]
    docs = _req("GET", f"/rest/v1/documents?case_id=eq.{cid}"
                       f"&select=id,rel_path,storage_path,doc_type,provenance,strona_od,plik_zrodlowy")
    # Rodzic = wiersz ORYGINAŁU skanu (bez `.ocr.`): to on reprezentuje pozycję akt,
    # a warianty po OCR są jego formami przechowywania.
    rodzice = {d["rel_path"].split("/")[-1].split(".ocr.")[0].replace(".pdf", ""): d
               for d in docs if ".ocr." not in d["rel_path"] and d["plik_zrodlowy"] is None}
    istnieje = {(d["plik_zrodlowy"], d["strona_od"]) for d in docs if d["plik_zrodlowy"]}

    nowe, pominiete = [], 0
    for x in inwentarz:
        rodzic = rodzice.get(x["skan"].replace(".pdf", ""))
        if not rodzic:
            print(f"  ✗ brak rodzica dla {x['skan']}", file=sys.stderr)
            continue
        # Dokument obejmujący CAŁY plik nie jest osobną pozycją — to sam skan.
        if len(inwentarz) and x["strona_od"] == 1 and sum(1 for y in inwentarz if y["skan"] == x["skan"]) == 1:
            pominiete += 1
            continue
        if (rodzic["id"], x["strona_od"]) in istnieje:
            pominiete += 1
            continue
        nowe.append({
            "case_id": cid,
            "rel_path": f"{rodzic['rel_path']}#str{x['strona_od']}-{x['strona_do']}",
            "storage_path": rodzic["storage_path"],
            "doc_type": rodzic["doc_type"],
            "provenance": rodzic.get("provenance") or "wejście",
            "plik_zrodlowy": rodzic["id"],
            "strona_od": x["strona_od"],
            "strona_do": x["strona_do"],
            "karta_start": x.get("karta"),
            "opis": x.get("tytul"),
            "warstwa_tekstu": "ocr",
        })

    print(f"do założenia: {len(nowe)} pozycji · już istnieje albo cały plik: {pominiete}")
    for n in nowe[:12]:
        print(f"   k. {n['karta_start'] or '—'}  str.{n['strona_od']}–{n['strona_do']}  {(n['opis'] or '')[:76]}")
    if len(nowe) > 12:
        print(f"   … i {len(nowe) - 12} dalszych")
    if not zapisz:
        print("\ntryb podglądu — uruchom z --zapisz")
        return 0
    for i in range(0, len(nowe), 50):
        wynik = _req("POST", "/rest/v1/documents", nowe[i : i + 50])
        if len(wynik) != len(nowe[i : i + 50]):
            print(f"✗ zapisano {len(wynik)} z {len(nowe[i:i+50])} w paczce", file=sys.stderr)
            return 1
    print(f"✓ założono {len(nowe)} pozycji akt")
    return 0


if __name__ == "__main__":
    sys.exit(main())
