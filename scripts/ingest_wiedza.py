#!/usr/bin/env python3
"""Ingest materiałów naukowych do repozytorium wiedzy (tabele `wiedza_zrodla` i `wiedza`).

Wiedza o tym, czym JEST wash trade albo jakie okoliczności wskazują na layering,
nie pochodzi z akt jednej sprawy — pochodzi z doktryny i przepisów. Ten skrypt
wprowadza ją raz i na stałe, dla wszystkich spraw, także przyszłych.

UŻYCIE:
    python3 scripts/ingest_wiedza.py                 # raport, bez zapisu
    python3 scripts/ingest_wiedza.py --zapisz        # zapis do bazy + Storage
    python3 scripts/ingest_wiedza.py --dir ŚCIEŻKA   # inny katalog źródeł

ZASADY:
* Fragment ZAWSZE nosi numer strony — opinia sądowa cytuje doktrynę ze stroną,
  a fragment bez strony jest w niej bezużyteczny.
* Tagi technik nadawane są deterministycznie (słowa kluczowe), nie przez model:
  dobór materiału, na którym oparto opinię, musi dać się odtworzyć i uzasadnić.
* Kopia źródła trafia do Storage (prefiks `wiedza/`), więc repozytorium przetrwa
  utratę plików lokalnych i jest objęte `scripts/backup.py`.
"""
from __future__ import annotations  # systemowy python to 3.9 — bez tego `bytes | None` nie działa

import argparse
import hashlib
import json
import re
import subprocess
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BUCKET = "case-files"
DOMYSLNY_KATALOG = Path.home() / "Downloads/!!!!Opinie/materialy do nauki o manipulacjach"

# ── Metadane źródeł ──────────────────────────────────────────────────────────
# Ranga 1–5 rozstrzyga pierwszeństwo w prompcie: przy rozbieżności doktryny
# z przepisem lub stanowiskiem organu nadzoru wygrywa akt prawny i organ.
ZRODLA = {
    "Prezentacja CEDUR 16-10-2024 MANIPULACJA.pdf": dict(
        tytul="Manipulacja instrumentami finansowymi oraz ujawnianie i wykorzystywanie informacji poufnych (CEDUR)",
        autor="Urząd Komisji Nadzoru Finansowego", rok=2024, wydawca="UKNF",
        rodzaj="prezentacja_organu", ranga=4,
        uwagi="Seminarium CEDUR z 16.10.2024 — stanowisko organu nadzoru, w tym omówienie TREM i przykłady praktyczne",
    ),
    "Manipulacje i Insider Trading Czesław Martysz.pdf": dict(
        tytul="Manipulacje instrumentami finansowymi i insider trading",
        autor="Czesław Martysz", rok=2015, wydawca="Wolters Kluwer",
        rodzaj="monografia", ranga=3,
        uwagi="Monografia — materiał referencyjny biegłego; w opinii parafraza z przypisem, nie przedruk",
    ),
    "Manipulacje giełdowe od fałszywych informacji do nadużyć i przestępstw.pdf": dict(
        tytul="Manipulacje giełdowe: od fałszywych informacji do nadużyć i przestępstw",
        autor="Paweł Doliniak", rok=None, wydawca=None,
        rodzaj="artykul", ranga=2, uwagi=None,
    ),
    "255060681_235240252005065_5358491077102242122_n.jpg": dict(
        tytul="Pojęcie manipulacji instrumentem finansowym — część I",
        autor="Kamil Korn", rok=2012, wydawca="Transformacje Prawa Prywatnego 3/2012",
        rodzaj="artykul", ranga=2, sygnatura="ISSN 1641-1609",
        uwagi="Dwie strony zachowane jako zrzuty ekranu (OCR) — s. 29 i s. 47; pełny tekst nie został pozyskany",
    ),
}
# Zrzuty tej samej publikacji łączone w jedno źródło; wartość = numer strony z oryginału.
ZRZUTY_KORN = {
    "255060681_235240252005065_5358491077102242122_n.jpg": 29,
    "255054059_1312117465890780_4605534927742851143_n.jpg": 47,
}

# ── Tagowanie technik ────────────────────────────────────────────────────────
# Identyfikatory MUSZĄ pokrywać się z `TechniqueId` z lib/opinion/legal.ts — inaczej
# repozytorium nie połączy się z resztą aplikacji (dobór wiedzy do rozdziału o danej
# technice odbywa się po tym właśnie kluczu).
#
# Frazy pochodzą z DWÓCH źródeł, nie ze zgadywania:
#  1) pomiaru częstości na samym korpusie (1,02 mln zn.) — stąd cornering, squeeze,
#     churning, painting the tape, momentum ignition, których pierwsza wersja nie miała;
#  2) terminologii z legal.ts, czyli języka, którym operuje sama opinia.
# Frazy są wąskie celowo: „informacja" oznaczyłaby pół monografii i zamieniła dobór
# materiału w losowanie. Fragment bez trafienia dostaje `ogolne` i pozostaje osiągalny
# wyszukiwaniem pełnotekstowym.
TECHNIKI = {
    "wash": ["wash trade", "wash trading", "wash sale", "transakcje pozorne", "transakcja pozorna",
             "transakcje wzajemne", "pranie transakcji", "bez zmiany właściciela",
             "ten sam beneficjent", "brak zmiany własności", "painting the tape"],
    "layering": ["layering", "spoofing", "nawarstwianie", "warstwowanie", "zlecenia bez zamiaru",
                 "bez zamiaru ich wykonania", "anulowanie zleceń", "zlecenia anulowane",
                 "fikcyjny popyt", "fikcyjna podaż", "mylne wrażenie popytu", "quote stuffing",
                 "momentum ignition", "advancing the bid"],
    "imo": ["matched order", "matched orders", "improper matched", "zlecenia uzgodnione",
            "transakcje uzgodnione", "zlecenia skrzyżowane", "cross trade", "wash sales and matched"],
    "pumpdump": ["pump and dump", "pump & dump", "pump&dump", "trash and cash", "napompowanie kursu",
                 "wywindowanie kursu", "stop loss", "stop buy", "pozycji długiej", "sztucznie wysokim"],
    "fixing": ["fixing", "kurs zamknięcia", "kurs otwarcia", "marking the close", "zamknięcie sesji",
               "dogrywka", "faza równoważenia", "kurs odniesienia", "kursu odniesienia"],
    "reversal": ["odwrócenie pozycji", "odwrócenie kursu", "reversal", "odwrócenie tendencji",
                 "w krótkim okresie"],
    "concentration": ["koncentracja obrotu", "koncentracji obrotu", "udział w obrocie",
                      "dominująca pozycja", "pozycja dominująca", "pozycji dominującej",
                      "znaczący udział", "cornering", "squeeze", "abusive squeeze", "churning"],
    "infomanip": ["rozpowszechnianie informacji", "rozpowszechnianiu informacji", "fałszywe informacje",
                  "nieprawdziwe informacje", "wprowadzające w błąd", "wprowadzających w błąd",
                  "rekomendacje inwestycyjne", "media społecznościowe", "forum internetowe",
                  "raport bieżący", "manipulacja informacją", "scalping"],
    # Insider trading nie jest techniką manipulacji w rozumieniu legal.ts, ale połowa
    # monografii go dotyczy i biegły bywa o niego pytany — trzymamy jako osobny tag,
    # dzięki czemu NIE zaśmieca doboru materiału do rozdziałów o technikach.
    "insider": ["insider trading", "informacja poufna", "informacji poufnych", "informacje poufne",
                "wykorzystywanie informacji poufnej", "okres zamknięty"],
}

# Odwołania prawne — wychwytywane osobno, bo w opinii stanowią podstawę prawną tezy.
WZORCE_PRAWNE = [
    (r"\bart\.\s*(\d+[a-z]?)\s*(?:ust\.\s*(\d+))?", lambda m: f"art. {m.group(1)}" + (f" ust. {m.group(2)}" if m.group(2) else "")),
    (r"\bMAR\b", lambda m: "MAR"),
    (r"\b596/2014\b", lambda m: "rozp. 596/2014 (MAR)"),
    (r"\b2016/522\b", lambda m: "rozp. del. 2016/522"),
    (r"\b2003/6/WE\b", lambda m: "dyrektywa 2003/6/WE"),
    (r"\bzał[ąa]cznik(?:u|a)?\s+I\b", lambda m: "załącznik I MAR"),
    (r"\bu\.o\.i\.f\.", lambda m: "ustawa o obrocie instr. fin."),
]

MIN_ZN, CEL_ZN, MAX_ZN = 400, 2500, 4200


def env() -> tuple[str, str]:
    out = {}
    p = REPO / ".env.local"
    for line in p.read_text(encoding="utf8").splitlines():
        m = re.match(r"^([A-Z_]+)=(.*)$", line.strip())
        if m:
            out[m.group(1)] = m.group(2).strip().strip("\"'")
    url, key = out.get("NEXT_PUBLIC_SUPABASE_URL"), out.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("✗ brak NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY w .env.local")
    return url, key


def req(url: str, key: str, metoda="GET", dane: bytes | None = None, naglowki: dict | None = None) -> bytes:
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    h.update(naglowki or {})
    r = urllib.request.Request(url, data=dane, headers=h, method=metoda)
    with urllib.request.urlopen(r, timeout=300) as resp:
        return resp.read()


def strony_pdf(p: Path) -> list[tuple[int, str]]:
    from pypdf import PdfReader

    r = PdfReader(str(p))
    return [(i + 1, (pg.extract_text() or "").strip()) for i, pg in enumerate(r.pages)]


def ocr_jpg(p: Path) -> str:
    """OCR zrzutu ekranu. Bez tesseracta zwraca pusty tekst — brak wiedzy jest lepszy niż zmyślona."""
    try:
        out = subprocess.run(["tesseract", str(p), "stdout", "-l", "pol"],
                             capture_output=True, timeout=180)
        return out.stdout.decode("utf8", "replace").strip()
    except Exception as e:  # noqa: BLE001
        print(f"  ⚠ OCR nieudany ({e}) — pomijam {p.name}")
        return ""


def sprzataj(t: str) -> str:
    """Zdejmuje śmieci ekstrakcji: numery stron w osobnej linii, dzielenie wyrazów, wielokrotne spacje."""
    t = re.sub(r"-\n(?=[a-ząćęłńóśźż])", "", t)       # przeniesienie wyrazu
    t = re.sub(r"\n(?=\S)", " ", t)                     # łamanie wiersza wewnątrz zdania
    t = re.sub(r"^\s*\d{1,3}\s*$", "", t, flags=re.M)   # samotny numer strony
    t = re.sub(r"[ \t]{2,}", " ", t)
    return re.sub(r"\n{3,}", "\n\n", t).strip()


def tagi(t: str) -> list[str]:
    low = t.lower()
    out = [k for k, frazy in TECHNIKI.items() if any(f in low for f in frazy)]
    return out or ["ogolne"]


def prawne(t: str) -> list[str]:
    out = []
    for wz, fmt in WZORCE_PRAWNE:
        for m in re.finditer(wz, t, flags=re.I):
            out.append(fmt(m))
    # zachowujemy kolejność pierwszego wystąpienia, bez duplikatów
    return list(dict.fromkeys(out))[:12]


def fragmenty(strony: list[tuple[int, str]]) -> list[dict]:
    """Łączy kolejne strony do ~2500 znaków, zachowując zakres stron do cytowania."""
    out, buf, od, do = [], "", None, None
    for nr, surowy in strony:
        t = sprzataj(surowy)
        if not t:
            continue
        if od is None:
            od = nr
        do = nr
        buf = f"{buf}\n\n{t}".strip() if buf else t
        if len(buf) >= CEL_ZN:
            for kawalek in podziel(buf):
                out.append({"strona_od": od, "strona_do": do, "tresc": kawalek})
            buf, od, do = "", None, None
    if buf and len(buf) >= MIN_ZN:
        out.append({"strona_od": od, "strona_do": do, "tresc": buf})
    return out


def podziel(t: str) -> list[str]:
    """Dzieli nadmiarowy blok po granicy zdania, żeby fragment pozostał cytowalny."""
    if len(t) <= MAX_ZN:
        return [t]
    out, reszta = [], t
    while len(reszta) > MAX_ZN:
        ciecie = reszta.rfind(". ", MIN_ZN, MAX_ZN)
        if ciecie < 0:
            ciecie = MAX_ZN
        out.append(reszta[: ciecie + 1].strip())
        reszta = reszta[ciecie + 1 :].strip()
    if reszta:
        out.append(reszta)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=str(DOMYSLNY_KATALOG))
    ap.add_argument("--zapisz", action="store_true")
    a = ap.parse_args()
    katalog = Path(a.dir)
    if not katalog.exists():
        sys.exit(f"✗ brak katalogu: {katalog}")
    url, key = env()

    # Zrzuty Korna scalamy w jedno źródło o dwóch stronach.
    korn_strony: list[tuple[int, str]] = []
    plan: list[tuple[Path, dict, list[tuple[int, str]]]] = []
    widziane_sha: set[str] = set()

    for p in sorted(katalog.iterdir()):
        if p.name.startswith(".") or not p.is_file():
            continue
        sha = hashlib.sha256(p.read_bytes()).hexdigest()
        if sha in widziane_sha:
            print(f"  ⊘ {p.name}: duplikat (identyczna suma SHA-256) — pomijam")
            continue
        widziane_sha.add(sha)

        # macOS zapisuje nazwy plików w NFD, literały w tym pliku są w NFC —
        # bez normalizacji „nadużyć" z dysku nie równa się „nadużyć" z kodu.
        nazwa = unicodedata.normalize("NFC", p.name)
        if nazwa in ZRZUTY_KORN:
            tekst = ocr_jpg(p)
            if tekst:
                korn_strony.append((ZRZUTY_KORN[nazwa], tekst))
            continue
        meta = ZRODLA.get(nazwa)
        if not meta:
            print(f"  ? {nazwa}: brak metadanych w ZRODLA — pomijam (dopisz pozycję do skryptu)")
            continue
        plan.append((p, {**meta, "sha256": sha}, strony_pdf(p)))

    if korn_strony:
        klucz = "255060681_235240252005065_5358491077102242122_n.jpg"
        korn_strony.sort()
        plan.append((katalog / klucz, {**ZRODLA[klucz], "sha256": None}, korn_strony))

    lacznie_frag = 0
    for p, meta, strony in plan:
        frs = fragmenty(strony)
        for f in frs:
            f["techniki"] = tagi(f["tresc"])
            f["pojecia"] = prawne(f["tresc"])
        rozklad: dict[str, int] = {}
        for f in frs:
            for t in f["techniki"]:
                rozklad[t] = rozklad.get(t, 0) + 1
        znak = sum(len(f["tresc"]) for f in frs)
        print(f"\n✓ {meta['tytul'][:64]}")
        print(f"    {meta.get('autor') or '—'} | {meta['rodzaj']} | ranga {meta['ranga']} | {len(strony)} s.")
        print(f"    fragmentów: {len(frs)}, znaków: {znak}")
        print(f"    tagi: {', '.join(f'{k}:{v}' for k, v in sorted(rozklad.items(), key=lambda x: -x[1]))}")
        lacznie_frag += len(frs)

        if not a.zapisz:
            continue

        # 1. kopia źródła do Storage — repozytorium ma przetrwać utratę plików lokalnych
        sp = f"wiedza/{p.name}"
        try:
            req(f"{url}/storage/v1/object/{BUCKET}/{urllib.parse.quote(sp)}", key, "POST",
                p.read_bytes(), {"Content-Type": "application/octet-stream", "x-upsert": "true"})
        except urllib.error.HTTPError as e:
            print(f"    ⚠ Storage: {e.code} {e.read()[:120]!r}")

        # 2. źródło
        wiersz = {k: v for k, v in meta.items() if k != "sha256"}
        wiersz.update(storage_path=sp, sha256=meta.get("sha256"), stron=len(strony))
        try:
            odp = req(f"{url}/rest/v1/wiedza_zrodla?on_conflict=tytul,autor", key, "POST",
                      json.dumps(wiersz, ensure_ascii=False).encode(),
                      {"Content-Type": "application/json",
                       "Prefer": "resolution=merge-duplicates,return=representation"})
            zid = json.loads(odp)[0]["id"]
        except urllib.error.HTTPError as e:
            print(f"    ✗ zapis źródła: {e.code} {e.read()[:300]!r}")
            continue

        # 3. fragmenty partiami
        wiersze = [{"zrodlo_id": zid, "strona_od": f["strona_od"], "strona_do": f["strona_do"],
                    "tresc": f["tresc"], "techniki": f["techniki"], "pojecia": f["pojecia"],
                    "znakow": len(f["tresc"])} for f in frs]
        zapisane = 0
        for i in range(0, len(wiersze), 100):
            partia = wiersze[i : i + 100]
            try:
                req(f"{url}/rest/v1/wiedza?on_conflict=zrodlo_id,strona_od,tresc", key, "POST",
                    json.dumps(partia, ensure_ascii=False).encode(),
                    {"Content-Type": "application/json", "Prefer": "resolution=merge-duplicates"})
                zapisane += len(partia)
            except urllib.error.HTTPError as e:
                print(f"    ✗ fragmenty {i}: {e.code} {e.read()[:300]!r}")
        print(f"    → zapisano {zapisane} fragmentów")

    print(f"\n═══ RAZEM: {len(plan)} źródeł, {lacznie_frag} fragmentów ═══")
    if not a.zapisz:
        print("  tryb próbny — uruchom z --zapisz, gdy raport wygląda dobrze")
    return 0


if __name__ == "__main__":
    sys.exit(main())
