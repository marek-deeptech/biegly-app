#!/usr/bin/env python3
"""Odczyt OCEN, które bank zrzeszający wystawił bankowi spółdzielczemu.

DLACZEGO TO JEST NAJMOCNIEJSZY MATERIAŁ W TEJ SPRAWIE
Uchwała nr 12/14/AB/BS/2002 zobowiązywała Bank BPS do oceniania zrzeszonych banków
w rubryce 16 wskaźników. W aktach SK Banku leży OSIEM kwartalnych ocen wykonanych
przez BPS w latach 2013–2014 — czyli zapis tego, co bank zrzeszający sam ustalił
o sytuacji SK Banku, kwartał po kwartale, WŁASNĄ metodyką. Nie trzeba niczego
rekonstruować: wystarczy odczytać, co tam napisano, i zestawić z rubryką.

CO ROBI MODEL, A CO KOD
Model wyłącznie ODCZYTUJE: oceny cząstkowe obszarów, ocenę globalną i wartości
wskaźników przytoczone w tekście. Nie liczy, nie uśrednia, nie interpretuje trendu.
Zestawienie z rubryką, wykrycie zmian ocen i kontrola zgodności skali robi kod.

⚠️ SKALA JEST ODWRÓCONA. 1 to sytuacja bardzo dobra, 5 — zagrożenie funkcjonowania
banku. Ocena rosnąca w czasie oznacza POGORSZENIE. Odczytanie jej w drugą stronę
zamieniłoby w opinii wniosek na przeciwny, więc kod sprawdza zakres i kierunek.

UŻYCIE:
    python3 scripts/oceny_zrzeszajacego.py SKOK [--zapisz]
"""
from __future__ import annotations

import json
import os
import pathlib
import re
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
sys.path.insert(0, str(ROOT))

BASE = os.environ["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}

WZORZEC_OCENY = re.compile(r"ocen[ay]\s+(sytuacji\s+ekonomiczno|Spółdzielczego)", re.I)

SYSTEM = (
    "Jesteś asystentem biegłego sądowego. Otrzymujesz treść JEDNEJ oceny sytuacji "
    "ekonomiczno-finansowej banku spółdzielczego, sporządzonej przez bank zrzeszający. "
    "ODCZYTUJESZ, NIE OCENIASZ. "
    "ZASADY BEZWZGLĘDNE: "
    "(1) Wszystkie liczby przepisuj DOKŁADNIE tak, jak widnieją — nie przeliczaj, "
    "nie zaokrąglaj, nie uzupełniaj. "
    "(2) Oceny są w skali 1–5, gdzie 1 oznacza sytuację NAJLEPSZĄ, a 5 najgorszą. "
    "Przepisz liczbę z dokumentu; nie odwracaj jej ani nie interpretuj. "
    "(3) Czego w dokumencie nie ma, pomijasz. NIE ZGADUJ — brak oceny obszaru jest "
    "ustaleniem (bank zrzeszający jej nie wystawił), a zgadnięta ocena byłaby "
    "przypisaniem mu twierdzenia, którego nie sformułował. "
    "(4) `wskazniki` to wartości PRZYTOCZONE w tekście oceny (np. marża odsetkowa, "
    "współczynnik wypłacalności, udział należności zagrożonych) wraz z jednostką. "
    "(5) `cytat_globalnej` to dosłowne zdanie, z którego wynika ocena globalna — "
    "służy weryfikacji odczytu. "
    "(6) Odpowiadasz WYŁĄCZNIE obiektem JSON: "
    '{"dzien":"YYYY-MM-DD","oceny":{"adekwatnosc":null,"jakosc_aktywow":null,'
    '"efektywnosc":null,"plynnosc":null},"globalna":null,"cytat_globalnej":"",'
    '"wskazniki":[{"nazwa":"","wartosc":"","jednostka":""}],"grupa_rowiesnicza":null,'
    '"zmiany_ocen":""}'
)


def _req(url: str) -> bytes:
    return urllib.request.urlopen(urllib.request.Request(BASE + url, headers=H)).read()


def _zapisz_sub(case_id: str, dane: dict) -> None:
    body = {
        "case_id": case_id,
        "kind": "oceny_zrzeszajacego",
        "chapter_no": "V",
        "title": "Oceny banku zrzeszającego wystawione bankowi spółdzielczemu",
        "status": "szkic",
        "body_md": "",
        "data": dane,
    }
    r = urllib.request.Request(
        f"{BASE}/rest/v1/subanalyses?on_conflict=case_id,kind",
        data=json.dumps(body, ensure_ascii=False).encode(), method="POST",
        headers={**H, "Content-Type": "application/json",
                 "Prefer": "resolution=merge-duplicates,return=representation"},
    )
    with urllib.request.urlopen(r) as resp:
        if not json.loads(resp.read() or b"[]"):
            raise RuntimeError("zapis subanalizy nie zmienił żadnego wiersza")


def tekst_zakresu(pdf: pathlib.Path, od: int, do: int) -> str:
    t = subprocess.run(
        ["pdftotext", "-f", str(od), "-l", str(do), str(pdf), "-"],
        capture_output=True, text=True,
    ).stdout
    return re.sub(r"[ \t]+", " ", t).strip()


# Pamięć podręczna odczytów. ⚠️ POWÓD: przebieg na jedenastu ocenach przerwał się
# w połowie (wyczerpane środki API) i cała praca modelu przepadła — mimo że dziewięć
# dokumentów było już odczytanych. Odczyt jest funkcją treści, więc wynik da się
# trzymać pod skrótem tej treści i nie płacić za niego drugi raz.
CACHE = pathlib.Path(os.environ.get("TMPDIR", "/tmp")) / "biegly_oceny_cache"


def odczytaj(tytul: str, tresc: str) -> dict | None:
    import hashlib

    CACHE.mkdir(exist_ok=True)
    klucz = CACHE / (hashlib.sha256((tytul + tresc).encode()).hexdigest()[:32] + ".json")
    if klucz.exists():
        return json.loads(klucz.read_text(encoding="utf8"))

    import anthropic

    msg = anthropic.Anthropic().messages.create(
        model="claude-opus-4-8", max_tokens=3000, system=SYSTEM,
        messages=[{"role": "user", "content": f"Dokument: {tytul}\n\n{tresc[:60000]}"}],
    )
    if msg.stop_reason == "max_tokens":
        return None
    txt = "".join(b.text for b in msg.content if b.type == "text")
    i, j = txt.find("{"), txt.rfind("}")
    if i < 0:
        return None
    try:
        wynik = json.loads(txt[i : j + 1])
    except json.JSONDecodeError:
        return None
    klucz.write_text(json.dumps(wynik, ensure_ascii=False), encoding="utf8")
    return wynik


OBSZARY = ["adekwatnosc", "jakosc_aktywow", "efektywnosc", "plynnosc"]
ETYKIETY = {
    "adekwatnosc": "Adekwatność kapitałów",
    "jakosc_aktywow": "Jakość aktywów",
    "efektywnosc": "Efektywność działania",
    "plynnosc": "Płynność finansowa",
}


def sprawdz(o: dict) -> list[str]:
    """Kontrole odczytu — zakres skali i zgodność oceny globalnej z cząstkowymi."""
    uwagi = []
    for pole in [*OBSZARY, "globalna"]:
        v = (o.get("oceny") or {}).get(pole) if pole != "globalna" else o.get("globalna")
        if v is not None and not (isinstance(v, int) and 1 <= v <= 5):
            uwagi.append(f"{o.get('dzien')}: ocena „{pole}” = {v!r} poza skalą 1–5")
    czastkowe = [v for k, v in (o.get("oceny") or {}).items() if isinstance(v, int)]
    g = o.get("globalna")
    # Uchwała: ocena globalna wynika z cząstkowych i nie może być od nich lepsza
    # o więcej niż jeden stopień — inaczej albo odczyt się nie zgadza, albo bank
    # zrzeszający skorygował ocenę i musi to być w opinii odnotowane.
    if isinstance(g, int) and czastkowe and g < max(czastkowe) - 1:
        uwagi.append(
            f"{o.get('dzien')}: ocena globalna {g} jest lepsza od najgorszej cząstkowej "
            f"({max(czastkowe)}) o więcej niż stopień — sprawdź w dokumencie, czy analityk ją korygował"
        )
    return uwagi


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
        f"/rest/v1/documents?case_id=eq.{cid}"
        f"&select=id,rel_path,opis,strona_od,strona_do,karta_start,storage_path,plik_zrodlowy&limit=500"
    ))
    oceny_dok = [d for d in docs if WZORZEC_OCENY.search(d.get("opis") or "")]
    if not oceny_dok:
        print("nie znaleziono ocen banku zrzeszającego — czy rozbicie skanów zostało zastosowane?",
              file=sys.stderr)
        return 1
    # Treść czytamy z WARIANTU PO OCR rodzica — oryginał skanu nie ma warstwy tekstowej.
    wg_id = {d["id"]: d for d in docs}
    kat = pathlib.Path(tempfile.mkdtemp())
    pobrane: dict[str, pathlib.Path] = {}

    def plik_dla(d: dict) -> pathlib.Path | None:
        rodzic = wg_id.get(d.get("plik_zrodlowy")) or d
        rdzen = rodzic["rel_path"].split("/")[-1].replace(".pdf", "")
        kandydat = next(
            (x for x in docs if x["rel_path"].split("/")[-1].startswith(rdzen) and ".ocr." in x["rel_path"]),
            None,
        )
        if not kandydat or not kandydat["storage_path"]:
            return None
        if kandydat["id"] not in pobrane:
            p = kat / kandydat["rel_path"].split("/")[-1]
            p.write_bytes(_req(f"/storage/v1/object/case-files/{urllib.parse.quote(kandydat['storage_path'])}"))
            pobrane[kandydat["id"]] = p
        return pobrane[kandydat["id"]]

    print(f"{cs[0]['name']}: {len(oceny_dok)} ocen do odczytu")
    wyniki: list[dict] = []
    for d in sorted(oceny_dok, key=lambda x: x.get("karta_start") or 0):
        pdf = plik_dla(d)
        if not pdf:
            print(f"   ⚠ {d['opis'][:60]}: brak wariantu po OCR", file=sys.stderr)
            continue
        tresc = tekst_zakresu(pdf, d["strona_od"] or 1, d["strona_do"] or 1)
        try:
            o = odczytaj(d["opis"], tresc)
        except Exception as e:  # noqa: BLE001
            # Przerwanie w połowie NIE MOŻE kasować tego, co już odczytano — wyniki
            # wcześniejszych dokumentów są w pamięci podręcznej i w `wyniki`.
            print(f"\n⚠ przerwano na „{d['opis'][:50]}”: {e}", file=sys.stderr)
            print(f"   odczytano {len(wyniki)} z {len(oceny_dok)}; ponowny przebieg "
                  f"dokończy resztę bez powtarzania odczytów.", file=sys.stderr)
            break
        if not o:
            print(f"   ⚠ {d['opis'][:60]}: nie odczytano", file=sys.stderr)
            continue
        o["karta"] = d.get("karta_start")
        o["zrodlo"] = d["opis"]
        wyniki.append(o)
        print(f"   … {d.get('karta_start')} {o.get('dzien')}")

    wyniki.sort(key=lambda x: x.get("dzien") or "")
    uwagi = [u for o in wyniki for u in sprawdz(o)]

    print(f"\n═══ OCENY BANKU ZRZESZAJĄCEGO ({len(wyniki)}) ═══")
    print(f"{'dzień':<12} {'k.':<6} " + " ".join(f"{ETYKIETY[o][:12]:<13}" for o in OBSZARY) + " GLOBALNA")
    for o in wyniki:
        oc = o.get("oceny") or {}
        wiersz = " ".join(f"{(str(oc.get(k)) if oc.get(k) is not None else '—'):<13}" for k in OBSZARY)
        print(f"{o.get('dzien') or '—':<12} {str(o.get('karta') or '—'):<6} {wiersz} {o.get('globalna') or '—'}")
    if uwagi:
        print("\n⚠ UWAGI KONTROLI ODCZYTU")
        for u in uwagi:
            print("   " + u)

    dane = {
        "oceny": wyniki,
        "uwagi": uwagi,
        "skala": "1 = sytuacja bardzo dobra, 5 = zagrożenie funkcjonowania banku (skala odwrócona)",
        "podstawa": "Uchwała nr 12/14/AB/BS/2002 Zarządu Banku BPS S.A. — zasady monitorowania "
                    "sytuacji ekonomiczno-finansowej zrzeszonych banków spółdzielczych",
    }
    if zapisz:
        _zapisz_sub(cid, dane)
        print(f"\n✓ zapisano subanalizę `oceny_zrzeszajacego` ({len(wyniki)} ocen)")
    else:
        print("\ntryb raportu — uruchom z --zapisz")
    return 0


if __name__ == "__main__":
    sys.exit(main())
