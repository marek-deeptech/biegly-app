#!/usr/bin/env python3
"""Odczyt NUMERÓW KART AKT z odręcznej paginacji w prawym górnym rogu skanu.

PO CO
Akta sądowe są paginowane ręcznie: na każdej karcie widnieje dopisany długopisem
numer. To on jest adresem dokumentu w postępowaniu — biegły powołuje się na „k. 236",
a nie na nazwę pliku ze skanera. Bez tego numeru dokument w aplikacji jest nie do
zacytowania w opinii i nie do odnalezienia w aktach papierowych.

DLACZEGO NIE Z OCR
Numer jest PISMEM ODRĘCZNYM na kolorowym tle, często przy samej krawędzi. OCR
tekstowy go nie widzi — w warstwie tekstowej skanów tej sprawy nie ma ani jednego
z tych numerów. Model czytający WYCINEK OBRAZU widzi go bez trudu.

DLACZEGO WYCINEK, A NIE CAŁA STRONA
Prawy górny róg to jedyne miejsce, gdzie ten numer występuje. Podanie modelowi całej
strony wpuszcza do gry wszystkie inne liczby dokumentu (numery paragrafów, kwoty,
daty) i zamienia odczyt jednej liczby w zadanie interpretacyjne.

UŻYCIE:
    python3 scripts/karty_ze_skanu.py SKOK            # raport, bez zapisu
    python3 scripts/karty_ze_skanu.py SKOK --zapisz
"""
from __future__ import annotations

import base64
import io
import json
import os
import pathlib
import subprocess
import sys
import tempfile
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

DPI = 200
# Prawe 30% szerokości, górne 14% wysokości — sprawdzone na paginacji akt SK Banku.
WYCINEK = (0.70, 0.00, 1.00, 0.14)
# Ile wycinków w jednym wywołaniu. Paczkowanie jest tańsze, ale NIE JEST NEUTRALNE:
# przy sześciu obrazach naraz model potrafi skleić numer z sąsiedniego wycinka — akt
# oskarżenia dostał tak „k. 72485", choć trzy odczyty POJEDYNCZE tej samej strony dały
# zgodnie brak numeru (róg jest tam pusty). Dlatego każdy odczyt przechodzi jeszcze
# kontrolę `sprawdz`, a wynik podejrzany nie jest zapisywany.
W_PACZCE = 6

SYSTEM = (
    "Odczytujesz NUMER KARTY AKT SĄDOWYCH z wycinka prawego górnego rogu skanu. "
    "Numer jest zapisany ODRĘCZNIE, długopisem, zwykle jedną liczbą od 1 do 4 cyfr. "
    "ZASADY BEZWZGLĘDNE: "
    "(1) Zwróć WYŁĄCZNIE tę jedną liczbę. Nie czytaj numerów drukowanych (paginacja "
    "wydawnicza, numery stron dokumentu, numery paragrafów) — interesuje wyłącznie "
    "dopisek odręczny. "
    "(2) Gdy wycinek nie zawiera odręcznej liczby albo jest nieczytelna, zwróć null. "
    "Zgadnięty numer karty jest gorszy niż jego brak: biegły powołuje się na niego "
    "w opinii i sąd sprawdza go w aktach papierowych. "
    "(3) Nie interpretuj i nie komentuj. "
    '(4) Odpowiadasz WYŁĄCZNIE obiektem JSON: {"wyniki":[{"id":"","karta":123}]} '
    "— `karta` jako liczba albo null."
)


def _req(url: str) -> bytes:
    return urllib.request.urlopen(urllib.request.Request(BASE + url, headers=H)).read()


def _patch(url: str, body: dict) -> None:
    r = urllib.request.Request(
        BASE + url, data=json.dumps(body).encode(), method="PATCH",
        headers={**H, "Content-Type": "application/json", "Prefer": "return=representation"},
    )
    with urllib.request.urlopen(r) as resp:
        if not json.loads(resp.read() or b"[]"):
            raise RuntimeError("PATCH nie zmienił żadnego wiersza")


def wycinek(pdf: pathlib.Path, strona: int, katalog: pathlib.Path) -> pathlib.Path | None:
    """Renderuje stronę i zwraca wycinek prawego górnego rogu."""
    from PIL import Image

    wzor = katalog / f"s{strona:04d}"
    subprocess.run(
        ["pdftoppm", "-png", "-r", str(DPI), "-f", str(strona), "-l", str(strona), str(pdf), str(wzor)],
        check=False, capture_output=True, timeout=300,
    )
    pliki = sorted(katalog.glob(f"s{strona:04d}*.png"))
    if not pliki:
        return None
    im = Image.open(pliki[0])
    w, h = im.size
    x0, y0, x1, y1 = WYCINEK
    out = katalog / f"rog{strona:04d}.png"
    im.crop((int(w * x0), int(h * y0), int(w * x1), int(h * y1))).save(out)
    return out


def czytaj(paczka: list[tuple[str, pathlib.Path]]) -> dict[str, int | None]:
    """Odczyt numerów z paczki wycinków — jedno wywołanie modelu na kilka obrazów."""
    import anthropic

    tresc: list[dict] = []
    for ident, sciezka in paczka:
        tresc.append({"type": "text", "text": f"id={ident}"})
        tresc.append({
            "type": "image",
            "source": {"type": "base64", "media_type": "image/png",
                       "data": base64.standard_b64encode(sciezka.read_bytes()).decode()},
        })
    msg = anthropic.Anthropic().messages.create(
        model="claude-opus-4-8", max_tokens=1000, system=SYSTEM,
        messages=[{"role": "user", "content": tresc}],
    )
    if msg.stop_reason == "max_tokens":
        return {}
    txt = "".join(b.text for b in msg.content if b.type == "text")
    i, j = txt.find("{"), txt.rfind("}")
    if i < 0:
        return {}
    try:
        return {w["id"]: w.get("karta") for w in json.loads(txt[i : j + 1]).get("wyniki", [])}
    except (json.JSONDecodeError, KeyError, TypeError):
        return {}


def sprawdz(start: int | None, koniec: int | None, stron: int) -> str | None:
    """Kontrola wiarygodności odczytu — zwraca opis problemu albo None.

    Karta akt to ARKUSZ, więc dokument o N stronach obejmuje od N/2 do N kart.
    Odczyt spoza tego zakresu znaczy, że jedna z liczb pochodzi skądinąd.
    """
    # ⚠️ GRANICA WIELKOŚCI. Odczyt „k. 72485" przeszedł wszystkie pozostałe kontrole
    # (spójny sam ze sobą, jedna liczba), a jest bezsensowny: akta liczą tysiące kart,
    # nie dziesiątki tysięcy. Model skleił numer karty z sąsiednim nadrukiem.
    for v, ktora in ((start, "początek"), (koniec, "koniec")):
        if v is not None and not (1 <= v <= 9999):
            return f"{ktora} ({v}) poza zakresem numeracji akt (1–9999)"
    if start is None or koniec is None:
        return None
    if koniec < start:
        return f"koniec ({koniec}) przed początkiem ({start})"
    rozpietosc = koniec - start + 1
    if rozpietosc > stron:
        return f"rozpiętość {rozpietosc} kart przy {stron} stronach — karta to arkusz, nie strona"
    return None


def main() -> int:
    sprawa = sys.argv[1] if len(sys.argv) > 1 else ""
    zapisz = "--zapisz" in sys.argv
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("brak ANTHROPIC_API_KEY", file=sys.stderr)
        return 2

    cs = json.loads(_req(f"/rest/v1/cases?name=eq.{urllib.parse.quote(sprawa)}&select=id,name"))
    if not cs:
        print(f"nie znaleziono sprawy: {sprawa}", file=sys.stderr)
        return 2
    cid = cs[0]["id"]
    docs = json.loads(_req(
        f"/rest/v1/documents?case_id=eq.{cid}&select=id,rel_path,storage_path,karta_start,karta_end"
        f"&order=rel_path"
    ))
    # Oryginały skanów. Każdy wariant po OCR (`.ocr.pdf`, `.ocr.cz1.pdf`) niesie TEN SAM
    # obraz, więc czytamy raz — inaczej ten sam dokument dostawał dwa odczyty, a części
    # `czN` dawały numer początku całości przypisany do fragmentu.
    docs = [d for d in docs if d["storage_path"] and ".ocr." not in d["rel_path"]]
    print(f"{cs[0]['name']}: {len(docs)} skanów do odczytu")

    # ⚠️ IDENTYFIKATOR BEZ ZNAKÓW SPECJALNYCH. Pierwsza wersja używała „{uuid}|start"
    # i model odsyłał sam „{uuid}" — ucinał wszystko po pionowej kresce, więc ANI JEDEN
    # odczyt nie trafiał w mapę, a skrypt kończył się bez błędu i bez wyniku.
    # Krótki, nieznaczący klucz („w1", „w2") nie daje modelowi czego normalizować.
    zadania: list[tuple[str, pathlib.Path]] = []
    meta: dict[str, tuple[dict, str, int]] = {}
    licznik = 0
    tmp = tempfile.mkdtemp()
    kat = pathlib.Path(tmp)
    for d in docs:
        nazwa = d["rel_path"].split("/")[-1]
        plik = kat / nazwa
        try:
            plik.write_bytes(_req(f"/storage/v1/object/case-files/{urllib.parse.quote(d['storage_path'])}"))
        except Exception as e:  # noqa: BLE001
            print(f"   ⚠ {nazwa}: nie pobrano ({e})")
            continue
        info = subprocess.run(["pdfinfo", str(plik)], capture_output=True, text=True).stdout
        stron = int(info.split("Pages:")[1].split()[0]) if "Pages:" in info else 1
        podkat = kat / nazwa.replace(".", "_")
        podkat.mkdir(exist_ok=True)
        for etyk, nr in (("start", 1), ("koniec", stron)):
            if etyk == "koniec" and stron == 1:
                continue
            w = wycinek(plik, nr, podkat)
            if w:
                licznik += 1
                ident = f"w{licznik}"
                zadania.append((ident, w))
                meta[ident] = (d, etyk, stron)

    print(f"   wycinków do odczytu: {len(zadania)}")
    odczyty: dict[str, int | None] = {}
    for i in range(0, len(zadania), W_PACZCE):
        odczyty.update(czytaj(zadania[i : i + W_PACZCE]))
        print(f"   … {min(i + W_PACZCE, len(zadania))}/{len(zadania)}")

    # ⚠️ PUSTY ODCZYT TO BŁĄD, NIE WYNIK. Bez tego skrypt kończył się komunikatem
    # „tryb raportu" mimo zera rozpoznań i wyglądał na udany.
    if zadania and not any(v is not None for v in odczyty.values()):
        print(f"\n✗ Z {len(zadania)} wycinków nie odczytano ANI JEDNEGO numeru — "
              f"sprawdź dopasowanie identyfikatorów albo obszar wycinka.", file=sys.stderr)
        return 1

    wg_dok: dict[str, dict] = {}
    for ident, karta in odczyty.items():
        if ident not in meta:
            continue
        d, etyk, stron = meta[ident]
        wg_dok.setdefault(d["id"], {"dok": d, "stron": stron})[etyk] = karta

    # ⚠️ KONTROLA MIĘDZY DOKUMENTAMI: dwa dokumenty nie mogą zajmować tej samej karty.
    # Zakresy nachodzące na siebie znaczą, że któryś odczyt jest błędny — a numer karty
    # trafia do opinii jako adres dowodu i sąd go sprawdza.
    zajete: dict[int, str] = {}
    kolizje: dict[str, str] = {}
    for did, w in sorted(wg_dok.items(), key=lambda x: (x[1].get("start") or 10**9)):
        st = w.get("start")
        if st is None:
            continue
        nazwa_d = w["dok"]["rel_path"].split("/")[-1]
        kon = w.get("koniec") or st
        for k in range(st, min(kon, st + 400) + 1):
            if k in zajete and zajete[k] != nazwa_d:
                kolizje[nazwa_d] = f"karta {k} zajęta przez {zajete[k]}"
                break
            zajete[k] = nazwa_d

    print("\n═══ ODCZYT ═══")
    zapisane, pominiete = 0, 0
    for did, w in sorted(wg_dok.items(), key=lambda x: x[1]["dok"]["rel_path"]):
        d, stron = w["dok"], w["stron"]
        start, koniec = w.get("start"), w.get("koniec", w.get("start"))
        nazwa = d["rel_path"].split("/")[-1]
        problem = sprawdz(start, koniec, stron) or kolizje.get(nazwa)
        opis = f"k. {start}" + (f"–{koniec}" if koniec and koniec != start else "") if start else "—"
        print(f"  {nazwa:<34} {opis:<14} ({stron} str.){'  ⚠ ' + problem if problem else ''}")
        if not zapisz or start is None or problem:
            pominiete += 0 if start else 1
            continue
        # Zapisujemy TAKŻE bliźniakowi po OCR — to ten sam dokument w aktach.
        for cel in json.loads(_req(
            f"/rest/v1/documents?case_id=eq.{d['case_id'] if 'case_id' in d else cid}"
            f"&rel_path=like.*{urllib.parse.quote(nazwa.replace('.pdf', ''))}*&select=id"
        )):
            _patch(f"/rest/v1/documents?id=eq.{cel['id']}",
                   {"karta_start": start, "karta_end": koniec if koniec != start else None})
        zapisane += 1

    print(f"\n{'✓ zapisano ' + str(zapisane) + ' dokumentów' if zapisz else 'tryb raportu — uruchom z --zapisz'}")
    if pominiete:
        print(f"⚠ bez numeru karty: {pominiete} — wycinek nie zawierał czytelnej paginacji odręcznej")
    return 0


if __name__ == "__main__":
    sys.exit(main())
