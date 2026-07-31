#!/usr/bin/env python3
"""Odtworzenie lokalnego pliku dowodowego HubTech (golden fixture) z Supabase Storage.

Golden testy silnika liczą wskaźniki na realnym arkuszu UTP HubTech. Plik jest za duży
na repo (31 MB), więc leży poza gitem — a to znaczy, że da się go stracić przy
porządkach na dysku. Ten skrypt czyni tę stratę odwracalną jednym poleceniem:

    python3 scripts/fetch_fixture.py

Źródłem prawdy jest Storage (bucket `case-files`), a nie kopia w ~/Downloads.
"""
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CEL = REPO / ".fixtures" / "hubtech_utp_prok.xlsx"
BUCKET = "case-files"
# Sprawa HUBTECH + nazwa pliku, na którym stoją golden testy.
CASE_ID = "405f8449-98ee-4d8a-8ed5-70bfb90c8776"
PLIK = "Transakcje_i_Zlecenia_HUBTech 2020 prok.xlsx"


def env_z_pliku() -> dict:
    """Odczyt NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY z .env.local."""
    out = {}
    p = REPO / ".env.local"
    if p.exists():
        for line in p.read_text(encoding="utf8").splitlines():
            m = re.match(r"^([A-Z_]+)=(.*)$", line.strip())
            if m:
                out[m.group(1)] = m.group(2).strip().strip("\"'")
    out.update({k: v for k, v in os.environ.items() if k in out or k.startswith("SUPABASE") or k.startswith("NEXT_PUBLIC")})
    return out


def get(url: str, key: str) -> bytes:
    req = urllib.request.Request(url, headers={"apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()


def main() -> int:
    env = env_z_pliku()
    url, key = env.get("NEXT_PUBLIC_SUPABASE_URL"), env.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("✗ brak NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (.env.local)")
        return 1

    import json

    q = f"{url}/rest/v1/documents?case_id=eq.{CASE_ID}&select=storage_path,rel_path"
    docs = json.loads(get(q, key))
    sp = next((d["storage_path"] for d in docs if d["rel_path"].endswith(PLIK)), None)
    if not sp:
        print(f"✗ nie znaleziono w bazie dokumentu kończącego się na: {PLIK}")
        return 1

    print(f"pobieram: {sp}")
    dane = get(f"{url}/storage/v1/object/{BUCKET}/{urllib.parse.quote(sp)}", key)
    if dane[:2] != b"PK":  # .xlsx to zip — krótka odpowiedź to komunikat błędu Storage
        print(f"✗ Storage zwrócił nie-xlsx ({len(dane)} B): {dane[:200]!r}")
        return 1

    CEL.parent.mkdir(parents=True, exist_ok=True)
    CEL.write_bytes(dane)
    print(f"✓ zapisano {CEL} ({len(dane) / 1e6:.1f} MB)")
    print("  uruchom: python3 -m pytest tests/ -q")
    return 0


if __name__ == "__main__":
    sys.exit(main())
