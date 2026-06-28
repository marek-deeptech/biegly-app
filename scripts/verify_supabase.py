"""Weryfikacja schematu Supabase — czyta klucze z lokalnego .env.local
(NIE z czatu) i sprawdza, czy tabele i bucket istnieją.

Uruchomienie:  python scripts/verify_supabase.py
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TABLES = ["cases", "documents", "metrics", "findings"]


def load_env(path: Path) -> dict:
    env = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def _get(url: str, key: str):
    req = urllib.request.Request(url, headers={"apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.status, r.read()


def main() -> int:
    env_path = ROOT / ".env.local"
    if not env_path.exists():
        print("BRAK .env.local — utwórz go (patrz instrukcja).")
        return 2
    env = load_env(env_path)
    try:
        base = env["SUPABASE_URL"].rstrip("/")
        key = env["SUPABASE_SERVICE_ROLE_KEY"]
    except KeyError as e:
        print(f"Brak zmiennej {e} w .env.local")
        return 2

    print(f"Łączę z {base}\n")
    ok = True
    for t in TABLES:
        try:
            status, _ = _get(f"{base}/rest/v1/{t}?select=id&limit=1", key)
            print(f"  tabela {t:10s}: HTTP {status} {'OK' if status == 200 else ''}")
            ok = ok and status == 200
        except urllib.error.HTTPError as e:
            print(f"  tabela {t:10s}: BŁĄD HTTP {e.code} — {e.read()[:160].decode('utf-8','ignore')}")
            ok = False
        except Exception as e:  # noqa: BLE001
            print(f"  tabela {t:10s}: BŁĄD {e}")
            ok = False

    try:
        status, body = _get(f"{base}/storage/v1/bucket", key)
        names = [b.get("name") for b in json.loads(body)] if status == 200 else []
        has = "case-files" in names
        print(f"  bucket case-files: {'OK' if has else 'BRAK'} (buckety: {names})")
        ok = ok and has
    except Exception as e:  # noqa: BLE001
        print(f"  storage          : BŁĄD {e}")
        ok = False

    print("\nWYNIK:", "schemat kompletny ✓" if ok else "są braki ✗")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
