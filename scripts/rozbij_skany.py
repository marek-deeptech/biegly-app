#!/usr/bin/env python3
"""Rozbicie SKANÓW na DOKUMENTY, które w nich siedzą.

CO TO ROZWIĄZUJE
Skaner produkuje pliki, a nie dokumenty. Jeden `SKM_C451i26080211470.pdf` liczy
54 strony i zawiera uchwałę Zarządu BPS ORAZ kilkanaście kwartalnych analiz sytuacji
SK Banku z lat 2012–2014 — czyli kilkanaście osobnych dokumentów akt, każdy z własną
datą, autorem i numerem karty. Aplikacja liczyła je jako jeden.

To nie jest kosmetyka liczników. Biegły cytuje w opinii KONKRETNY dokument („analiza
kwartalna BPS za III kw. 2014, k. 448"), a nie plik ze skanera. Dopóki dokument nie
istnieje jako osobna pozycja, nie da się go ani zacytować, ani policzyć, ani sprawdzić
jego obecności w wymogach kompletności.

JAK ROZPOZNAJEMY GRANICE
Po POCZĄTKACH dokumentów, nie po końcach: nagłówek instytucji, formuła otwierająca
(„POSTANOWIENIE”, „UCHWAŁA Nr”, „Załącznik nr”), data z miejscowością, nowy adresat.
Model dostaje POCZĄTEK KAŻDEJ STRONY (kilkaset znaków) — tyle wystarcza, żeby odróżnić
pierwszą stronę dokumentu od kolejnej, a nie wystarcza, żeby zacząć streszczać treść.

⚠️ NIE ZAPISUJE NICZEGO DO BAZY. Rozbicie zmienia liczbę pozycji w aktach, więc
wynik ma najpierw obejrzeć biegły. Skrypt drukuje inwentarz i zapisuje JSON.

UŻYCIE:
    python3 scripts/rozbij_skany.py SKOK [--json plik.json] [--tylko 11470]
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request

import llm

ROOT = pathlib.Path(__file__).resolve().parent.parent
for _l in (ROOT / ".env.local").read_text(encoding="utf8").splitlines():
    if "=" in _l and not _l.startswith("#"):
        _k, _v = _l.split("=", 1)
        os.environ.setdefault(_k.strip(), _v.strip().strip("\"'"))

BASE = os.environ["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}

ZNAKOW_ZE_STRONY = 320
STRON_W_PACZCE = 120

SYSTEM = (
    "Jesteś asystentem biegłego sądowego. Otrzymujesz POCZĄTKI KOLEJNYCH STRON jednego "
    "pliku ze skanera akt sądowych. Plik zawiera zwykle KILKA ODRĘBNYCH DOKUMENTÓW "
    "zeskanowanych jeden po drugim. Twoim zadaniem jest wskazać, na której stronie "
    "ZACZYNA SIĘ każdy dokument. "
    "PO CZYM POZNAĆ POCZĄTEK: nagłówek instytucji albo pieczęć, formuła otwierająca "
    "(„POSTANOWIENIE”, „UCHWAŁA Nr”, „WYSTĄPIENIE POKONTROLNE”, „Załącznik nr”, „Umowa”), "
    "data z miejscowością, nowy adresat, sygnatura sprawy, strona rozdzielająca. "
    "Kolejne strony TEGO SAMEGO dokumentu kontynuują numerację, wątek i formatowanie. "
    "ZASADY BEZWZGLĘDNE: "
    "(1) Pierwsza strona pliku ZAWSZE zaczyna dokument. "
    "(2) Nie dziel dokumentu na rozdziały, punkty ani załączniki liczbowe — interesują "
    "wyłącznie granice między ODRĘBNYMI pismami/orzeczeniami/umowami. "
    "(3) `tytul` to jedno zdanie mówiące, czym dokument JEST (rodzaj, wystawca, data, "
    "sygnatura, jeśli widoczne) — nie streszczenie. "
    "(4) W razie wątpliwości NIE dziel: fałszywa granica rozbija jeden dokument na dwa "
    "byty, których w aktach nie ma. "
    '(5) Odpowiadasz WYŁĄCZNIE obiektem JSON: {"dokumenty":[{"strona":1,"tytul":"","data":"",'
    '"wytworca":""}]} — `data` w formacie YYYY-MM-DD albo pominięta.'
)


def _req(url: str) -> bytes:
    return urllib.request.urlopen(urllib.request.Request(BASE + url, headers=H)).read()


def strony_tekstem(pdf: pathlib.Path, stron: int) -> list[str]:
    """Początek każdej strony — tyle, by rozpoznać nagłówek, nie tyle, by streszczać."""
    out = []
    for s in range(1, stron + 1):
        t = subprocess.run(
            ["pdftotext", "-f", str(s), "-l", str(s), str(pdf), "-"],
            capture_output=True, text=True,
        ).stdout
        out.append(re.sub(r"\s+", " ", t).strip()[:ZNAKOW_ZE_STRONY])
    return out


def granice(nazwa: str, strony: list[str], sprawa: str | None = None) -> list[dict]:
    """Strony, na których zaczynają się dokumenty — łącznie z tytułem."""
    wynik: list[dict] = []
    for od in range(0, len(strony), STRON_W_PACZCE):
        kawalek = strony[od : od + STRON_W_PACZCE]
        opis = "\n".join(f"[str. {od + i + 1}] {t or '(strona bez tekstu)'}" for i, t in enumerate(kawalek))
        msg = llm.klient("rozbij_skany", sprawa=sprawa).messages.create(
            model="claude-opus-4-8", max_tokens=4000, system=SYSTEM,
            messages=[{"role": "user", "content":
                       f"Plik: {nazwa}. Strony {od + 1}–{od + len(kawalek)} z {len(strony)}.\n\n{opis}"}],
        )
        if msg.stop_reason == "max_tokens":
            print(f"   ⚠ {nazwa} str. {od + 1}+: odpowiedź urwana — paczka pominięta", file=sys.stderr)
            continue
        txt = "".join(b.text for b in msg.content if b.type == "text")
        i, j = txt.find("{"), txt.rfind("}")
        if i < 0:
            continue
        try:
            wynik += json.loads(txt[i : j + 1]).get("dokumenty", [])
        except json.JSONDecodeError:
            print(f"   ⚠ {nazwa} str. {od + 1}+: niepoprawny JSON", file=sys.stderr)
    # Porządkujemy i usuwamy duplikaty granic ze styku paczek.
    widziane, czyste = set(), []
    for d in sorted(wynik, key=lambda x: x.get("strona", 0)):
        s = d.get("strona")
        if not isinstance(s, int) or s in widziane or not (1 <= s <= len(strony)):
            continue
        widziane.add(s)
        czyste.append(d)
    return czyste


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("sprawa")
    ap.add_argument("--json", help="zapisz inwentarz do pliku")
    ap.add_argument("--tylko", help="fragment nazwy pliku — ogranicz do jednego skanu")
    a = ap.parse_args()
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("brak ANTHROPIC_API_KEY", file=sys.stderr)
        return 2

    cs = json.loads(_req(f"/rest/v1/cases?name=eq.{urllib.parse.quote(a.sprawa)}&select=id,name"))
    if not cs:
        print(f"nie znaleziono sprawy: {a.sprawa}", file=sys.stderr)
        return 2
    docs = json.loads(_req(
        f"/rest/v1/documents?case_id=eq.{cs[0]['id']}&select=rel_path,storage_path,karta_start,opis"
        f"&order=rel_path"
    ))
    # Czytamy WARIANT PO OCR — oryginał skanu nie ma warstwy tekstowej. Części `czN`
    # łączymy pod wspólnym rdzeniem, żeby dokument przecięty granicą części nie wypadł.
    wg_rdzenia: dict[str, list[dict]] = {}
    for d in docs:
        if not d["storage_path"] or ".ocr." not in d["rel_path"]:
            continue
        rdzen = d["rel_path"].split("/")[-1].split(".ocr.")[0]
        wg_rdzenia.setdefault(rdzen, []).append(d)
    if a.tylko:
        wg_rdzenia = {k: v for k, v in wg_rdzenia.items() if a.tylko in k}

    print(f"{cs[0]['name']}: {len(wg_rdzenia)} skanów do rozbicia")
    kat = pathlib.Path(tempfile.mkdtemp())
    inwentarz: list[dict] = []
    for rdzen, czesci in sorted(wg_rdzenia.items()):
        strony_all: list[str] = []
        for cz in sorted(czesci, key=lambda x: x["rel_path"]):
            plik = kat / cz["rel_path"].split("/")[-1]
            plik.write_bytes(_req(f"/storage/v1/object/case-files/{urllib.parse.quote(cz['storage_path'])}"))
            info = subprocess.run(["pdfinfo", str(plik)], capture_output=True, text=True).stdout
            n = int(info.split("Pages:")[1].split()[0]) if "Pages:" in info else 0
            strony_all += strony_tekstem(plik, n)
        if not strony_all:
            continue
        znalezione = granice(rdzen, strony_all, cs[0]["id"])
        karta0 = czesci[0].get("karta_start")
        for i, g in enumerate(znalezione):
            nast = znalezione[i + 1]["strona"] if i + 1 < len(znalezione) else len(strony_all) + 1
            inwentarz.append({
                "skan": rdzen,
                "strona_od": g["strona"],
                "strona_do": nast - 1,
                "stron": nast - g["strona"],
                # Numeracja kart tej sprawy jest PER STRONA (sprawdzone na trzech
                # dokumentach), więc karta dokumentu = karta skanu + przesunięcie.
                "karta": (karta0 + g["strona"] - 1) if karta0 else None,
                "tytul": g.get("tytul", ""),
                "data": g.get("data"),
                "wytworca": g.get("wytworca"),
            })
        print(f"  {rdzen:<32} {len(strony_all):>4} str. → {len(znalezione)} dokumentów")

    print(f"\n═══ INWENTARZ: {len(inwentarz)} dokumentów w {len(wg_rdzenia)} skanach ═══")
    for d in inwentarz:
        k = f"k. {d['karta']}" if d["karta"] else "—"
        print(f"  {k:<9} [{d['skan'][-5:]} str.{d['strona_od']}–{d['strona_do']}]  {d['tytul'][:88]}")
    if a.json:
        pathlib.Path(a.json).write_text(json.dumps(inwentarz, ensure_ascii=False, indent=1), encoding="utf8")
        print(f"\n✓ zapisano {a.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
