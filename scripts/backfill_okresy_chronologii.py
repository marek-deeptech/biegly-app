#!/usr/bin/env python3
"""Odtwarza SUROWE okresy chronologii z tabeli już zapisanej w subanalizie.

DLACZEGO NIE PRZEZ PONOWNY ODCZYT
Chronologię czyta model z narracji nadzorczej — przebieg kosztuje kilkanaście minut
i może dać inny wynik niż ten, który biegły już zweryfikował (w sprawie SK Banku
sprawdzono wizualnie m.in. rozbieżność w kolumnie 31.03.2013). Odtworzenie liczb
z wyrenderowanej tabeli zachowuje TEN odczyt.

CZEGO NIE ODTWARZA
Kolumna „Udział (policzony)" zawiera wartość WYLICZONĄ przez aplikację, a pole
`udzial_utrata_pct` w modelu oznacza wartość PODANĄ przez dokument. Przepisanie
jednej w drugą zatarłoby różnicę, na której opiera się kontrola arytmetyczna —
zostaje puste.

UŻYCIE: python3 scripts/backfill_okresy_chronologii.py <nazwa sprawy> [--zapisz]
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
sys.path.insert(0, str(ROOT))

BASE = os.environ["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}

# Nagłówek tabeli → pole modelu. „Udział (policzony)" świadomie pominięty.
KOLUMNY = {
    "suma bilansowa": "suma_bilansowa",
    "portfel kredytowy": "portfel_kredytowy",
    "z utratą wartości": "portfel_utrata",
    "depozyty": "depozyty",
    "fundusze własne": "fundusze_wlasne",
    "wsp. wypłacalności": "wsp_wyplacalnosci_pct",
    "wynik finansowy": "wynik_finansowy",
    "źródło": "zrodlo",
}


def _req(method, url, data=None):
    r = urllib.request.Request(BASE + url, data=data, method=method,
                               headers={**H, "Content-Type": "application/json"})
    with urllib.request.urlopen(r) as resp:
        return resp.read()


def _liczba(s: str) -> float | None:
    t = str(s).replace(" ", "").replace(" ", "").replace("%", "").replace(",", ".").strip()
    if not t or t in ("—", "-"):
        return None
    try:
        return float(t)
    except ValueError:
        return None


def main() -> int:
    sprawa = sys.argv[1] if len(sys.argv) > 1 else ""
    zapisz = "--zapisz" in sys.argv
    cs = json.loads(_req("GET", f"/rest/v1/cases?name=eq.{urllib.parse.quote(sprawa)}&select=id,name"))
    if not cs:
        print(f"nie znaleziono sprawy: {sprawa}", file=sys.stderr)
        return 2
    cid = cs[0]["id"]
    subs = json.loads(_req("GET", f"/rest/v1/subanalyses?case_id=eq.{cid}"
                                  f"&kind=eq.chronologia_nadzoru&select=data"))
    if not subs:
        print("sprawa nie ma chronologii nadzorczej", file=sys.stderr)
        return 2
    dane = subs[0]["data"] or {}
    if dane.get("okresy"):
        print(f"okresy surowe już są ({len(dane['okresy'])}) — nic do zrobienia")
        return 0

    okresy: list[dict] = []
    for t in dane.get("tables") or []:
        head = [str(h).strip().lower() for h in (t.get("head") or [])]
        if not head or head[0] != "dzień" or "suma bilansowa" not in head:
            continue  # tabela zdarzeń, nie okresów
        for wiersz in t.get("rows") or []:
            o: dict = {"dzien": str(wiersz[0]).strip()}
            for i, nagl in enumerate(head[1:], start=1):
                pole = KOLUMNY.get(nagl)
                if not pole or i >= len(wiersz):
                    continue
                o[pole] = str(wiersz[i]).strip() if pole == "zrodlo" else _liczba(wiersz[i])
            okresy.append({k: v for k, v in o.items() if v not in (None, "", "—")})

    # KONTROLA NIEZALEŻNA: udział policzony z odtworzonych kwot musi zgadzać się
    # z udziałem, który aplikacja wypisała we `findings` przy poprzednim przebiegu.
    z_findings: dict[str, float] = {}
    for f in dane.get("findings") or []:
        if "Udział kredytów z utratą wartości w kolejnych okresach" in f:
            for kawalek in f.split(";"):
                cz = kawalek.split("—")
                if len(cz) == 2 and _liczba(cz[1]) is not None:
                    z_findings[cz[0].strip().split()[-1]] = _liczba(cz[1])
    bledy = []
    for o in okresy:
        p, u = o.get("portfel_kredytowy"), o.get("portfel_utrata")
        oczek = z_findings.get(o["dzien"])
        if p and u is not None and oczek is not None and abs(100.0 * u / p - oczek) > 0.01:
            bledy.append(f"{o['dzien']}: odtworzono {100.0 * u / p:.2f}%, findings mówi {oczek:.2f}%")

    print(f"{cs[0]['name']}: odtworzono {len(okresy)} okresów, sprawdzono {len(z_findings)} udziałów")
    for o in okresy:
        print(f"   {o['dzien']}  " + "  ".join(f"{k}={v}" for k, v in o.items() if k != "dzien"))
    if bledy:
        print("\n✗ KONTROLA NIE PRZESZŁA:", file=sys.stderr)
        for b in bledy:
            print("   " + b, file=sys.stderr)
        return 1
    print("✓ kontrola: udziały policzone z odtworzonych kwot zgadzają się z zapisanymi")

    if not zapisz:
        print("\ntryb raportu — uruchom z --zapisz")
        return 0
    _req("PATCH", f"/rest/v1/subanalyses?case_id=eq.{cid}&kind=eq.chronologia_nadzoru",
         json.dumps({"data": {**dane, "okresy": okresy}}).encode())
    kontrola = json.loads(_req("GET", f"/rest/v1/subanalyses?case_id=eq.{cid}"
                                      f"&kind=eq.chronologia_nadzoru&select=data"))
    ile = len((kontrola[0]["data"] or {}).get("okresy") or [])
    if ile != len(okresy):
        print(f"✗ zapis nie doszedł: w bazie {ile} okresów", file=sys.stderr)
        return 1
    print(f"✓ zapisano {ile} okresów")
    return 0


if __name__ == "__main__":
    sys.exit(main())
