#!/usr/bin/env python3
"""Kopia zapasowa akt: pliki ze Storage + zawartość bazy → katalog lokalny.

DLACZEGO: akta trzech spraw (1000 dokumentów, ~1,8 GB) istnieją dziś w JEDNYM
miejscu — w Supabase. Kopie robocze w ~/Downloads zniknęły 31.07.2026 przy
odzyskiwaniu miejsca na dysku. Awaria projektu, pomyłkowe `delete` albo utrata
dostępu do konta oznaczałaby utratę materiału dowodowego z postępowań sądowych.

UŻYCIE:
    python3 scripts/backup.py                      # → ~/biegly-backup
    python3 scripts/backup.py --cel /Volumes/DYSK  # → dysk zewnętrzny (zalecane)
    python3 scripts/backup.py --sprawdz            # tylko weryfikacja istniejącej kopii

Kopia jest WZNAWIALNA: pliki o zgodnym rozmiarze są pomijane, więc przerwane
pobieranie wystarczy uruchomić ponownie. Każdy plik dostaje sumę SHA-256
w `manifest.json` — to pozwala później udowodnić, że kopia jest wierna.

To realizuje zasadę 3-2-1 tylko częściowo (2. kopia). Trzecia kopia — poza
lokalem — pozostaje po stronie użytkownika: dysk zewnętrzny lub szyfrowany
nośnik trzymany osobno.
"""
import argparse
import hashlib
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BUCKET = "case-files"
TABELE = ["cases", "documents", "metrics", "findings", "subanalyses", "korekty", "audyty_opinii", "wzorce"]


def env() -> tuple[str, str]:
    out = {}
    p = REPO / ".env.local"
    if p.exists():
        for line in p.read_text(encoding="utf8").splitlines():
            m = re.match(r"^([A-Z_]+)=(.*)$", line.strip())
            if m:
                out[m.group(1)] = m.group(2).strip().strip("\"'")
    url, key = out.get("NEXT_PUBLIC_SUPABASE_URL"), out.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("✗ brak NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY w .env.local")
    return url, key


def pobierz(url: str, key: str, timeout: int = 300) -> bytes:
    req = urllib.request.Request(url, headers={"apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def wiersze(url: str, key: str, tabela: str) -> list[dict]:
    """Pełna zawartość tabeli, stronicowana — PostgREST domyślnie tnie do 1000."""
    out, offset = [], 0
    while True:
        q = f"{url}/rest/v1/{tabela}?select=*&order=id&limit=1000&offset={offset}"
        try:
            partia = json.loads(pobierz(q, key))
        except urllib.error.HTTPError as e:
            print(f"  ⚠ {tabela}: {e.code} — pomijam")
            return out
        out.extend(partia)
        if len(partia) < 1000:
            return out
        offset += 1000


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for blok in iter(lambda: f.read(1 << 20), b""):
            h.update(blok)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cel", default=str(Path.home() / "biegly-backup"))
    ap.add_argument("--sprawdz", action="store_true", help="tylko weryfikacja SHA-256 istniejącej kopii")
    a = ap.parse_args()
    cel = Path(a.cel)
    url, key = env()

    if a.sprawdz:
        man = cel / "manifest.json"
        if not man.exists():
            sys.exit(f"✗ brak {man} — najpierw wykonaj kopię")
        m = json.loads(man.read_text(encoding="utf8"))
        zle, brak = [], []
        for wpis in m["pliki"]:
            p = cel / "files" / wpis["sciezka"]
            if not p.exists():
                brak.append(wpis["sciezka"])
            elif sha256(p) != wpis["sha256"]:
                zle.append(wpis["sciezka"])
        print(f"sprawdzono {len(m['pliki'])} plików: brakuje {len(brak)}, uszkodzonych {len(zle)}")
        for x in (brak + zle)[:10]:
            print(f"  ✗ {x}")
        return 1 if (brak or zle) else 0

    (cel / "files").mkdir(parents=True, exist_ok=True)
    (cel / "db").mkdir(parents=True, exist_ok=True)

    print("── baza ──")
    for t in TABELE:
        rows = wiersze(url, key, t)
        (cel / "db" / f"{t}.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf8")
        print(f"  {t:16s} {len(rows):5d} wierszy")

    docs = json.loads((cel / "db" / "documents.json").read_text(encoding="utf8"))
    doStorage = [d for d in docs if d.get("storage_path")]
    print(f"\n── pliki ({len(doStorage)}) ──")

    manifest, nowe, pominiete, bledy = [], 0, 0, 0
    for i, d in enumerate(doStorage, 1):
        sp = d["storage_path"]
        docelowy = cel / "files" / sp
        oczekiwany = d.get("size_bytes") or 0
        # wznawialność: plik o zgodnym rozmiarze uznajemy za pobrany
        if docelowy.exists() and (oczekiwany == 0 or docelowy.stat().st_size == oczekiwany):
            pominiete += 1
        else:
            try:
                dane = pobierz(f"{url}/storage/v1/object/{BUCKET}/{urllib.parse.quote(sp)}", key)
                docelowy.parent.mkdir(parents=True, exist_ok=True)
                docelowy.write_bytes(dane)
                nowe += 1
            except Exception as e:  # noqa: BLE001 — pojedynczy plik nie może przerwać całej kopii
                print(f"  ✗ {sp}: {e}")
                bledy += 1
                continue
        manifest.append({"sciezka": sp, "bajty": docelowy.stat().st_size, "sha256": sha256(docelowy)})
        if i % 100 == 0:
            print(f"  … {i}/{len(doStorage)}")

    (cel / "manifest.json").write_text(
        json.dumps({"bucket": BUCKET, "pliki": manifest}, ensure_ascii=False, indent=1), encoding="utf8"
    )
    razem = sum(m["bajty"] for m in manifest)
    print(f"\n✓ {cel}")
    print(f"  pobrane {nowe}, pominięte (już były) {pominiete}, błędy {bledy}")
    print(f"  razem {len(manifest)} plików, {razem / 1e9:.2f} GB + zrzut {len(TABELE)} tabel")
    if bledy:
        print("  ⚠ część plików się nie pobrała — uruchom ponownie, kopia jest wznawialna")
    print(f"\n  weryfikacja: python3 scripts/backup.py --cel {cel} --sprawdz")
    print("  ⚠ to DRUGA kopia. Trzecia (poza lokalem — dysk zewnętrzny) nadal po Twojej stronie.")
    return 1 if bledy else 0


if __name__ == "__main__":
    sys.exit(main())
