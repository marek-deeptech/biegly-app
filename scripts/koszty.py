#!/usr/bin/env python3
"""Raport kosztów API — dokąd idą pieniądze i ile dałoby się zaoszczędzić.

CO TO ROZWIĄZUJE: rachunek wyczerpywał się co dwa dni, a decyzja „zejdźmy z modelu"
albo „przytnijmy wejście" była zgadywaniem. Ten raport pokazuje rozkład kosztu po
krokach — dopiero na nim wolno decydować, bo zgadywanie przy optymalizacji zwykle
trafia w krok tani i zostawia drogi.

ŹRÓDŁO: log pisany przez lib/llm/klient.ts i scripts/llm.py — plik JSONL (domyślnie)
albo tabela llm_uzycie (--baza; wymaga migracji 0018). Plik zbiera to, co puszczane
lokalnie; tabela dodatkowo to, co poszło z Vercela, gdzie systemu plików nie ma.

UŻYCIE:
    python3 scripts/koszty.py                    # ostatnie 30 dni z pliku
    python3 scripts/koszty.py --baza --dni 7     # z bazy, ostatni tydzień
    python3 scripts/koszty.py --etykieta redakcja   # jeden krok, szczegółowo
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import os
import pathlib
import sys
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import llm_cennik  # noqa: E402

PLIK_LOGU = pathlib.Path(
    os.environ.get("BIEGLY_LLM_LOG") or (pathlib.Path.home() / ".biegly-llm" / "uzycie.jsonl")
)

# Modele, do których warto porównać obecny koszt. Nie sugerują, że każdy krok
# WOLNO przenieść — to decyzja o jakości, nie o cenie. Pokazują skalę stawki.
POROWNANIA = ["claude-sonnet-5", "claude-haiku-4-5"]


def _wczytaj_plik(od: dt.datetime) -> list[dict]:
    if not PLIK_LOGU.exists():
        return []
    out = []
    for linia in PLIK_LOGU.read_text(encoding="utf8").splitlines():
        if not linia.strip():
            continue
        try:
            w = json.loads(linia)
            if dt.datetime.fromisoformat(w["czas"]) >= od:
                out.append(w)
        except Exception:
            continue  # uszkodzona linia nie ma wywalać raportu z reszty
    return out


def _wczytaj_baze(od: dt.datetime) -> list[dict]:
    korzen = pathlib.Path(__file__).resolve().parent.parent
    for l in (korzen / ".env.local").read_text(encoding="utf8").splitlines():
        if "=" in l and not l.startswith("#"):
            k, v = l.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip("\"'"))
    base = os.environ["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    url = (f"{base}/rest/v1/llm_uzycie?czas=gte.{urllib.parse.quote(od.isoformat())}"
           f"&select=*&order=czas.desc&limit=100000")
    req = urllib.request.Request(url, headers={"apikey": key, "Authorization": f"Bearer {key}"})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=30).read())
    except Exception as e:
        print(f"⚠ nie udało się odczytać tabeli llm_uzycie ({e}).", file=sys.stderr)
        print("  Czy migracja 0018 jest wgrana? Bez niej zostaje log w pliku.", file=sys.stderr)
        return []


def _usd(v) -> str:
    return "     ?    " if v is None else f"${v:>9.2f}"


def _tabela(naglowek: str, wiersze: list[tuple], suma: float) -> None:
    if not wiersze:
        return
    print(f"\n── {naglowek} " + "─" * max(0, 62 - len(naglowek)))
    for nazwa, koszt, ile in wiersze:
        udzial = (koszt / suma * 100) if suma else 0
        srednia = koszt / ile if ile else 0
        print(f"  {nazwa:<30} {_usd(koszt)}  {udzial:>5.1f}%  {ile:>5}× "
              f" śr. ${srednia:.4f}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--baza", action="store_true", help="czytaj z tabeli llm_uzycie zamiast z pliku")
    ap.add_argument("--dni", type=int, default=30)
    ap.add_argument("--etykieta", help="ogranicz do jednego kroku")
    a = ap.parse_args()

    od = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=a.dni)
    wpisy = _wczytaj_baze(od) if a.baza else _wczytaj_plik(od)
    if a.etykieta:
        wpisy = [w for w in wpisy if a.etykieta in (w.get("etykieta") or "")]

    if not wpisy:
        skad = "tabela llm_uzycie" if a.baza else str(PLIK_LOGU)
        print(f"Brak wpisów w oknie {a.dni} dni ({skad}).")
        print("Log powstaje przy pierwszym wywołaniu modelu po wpięciu wrappera.")
        return 0

    oplacone = [w for w in wpisy if w.get("zrodlo") != "cache"]
    z_cache = [w for w in wpisy if w.get("zrodlo") == "cache"]
    suma = sum(w["usd"] or 0 for w in oplacone)
    bez_ceny = [w for w in oplacone if w.get("usd") is None]

    print("═" * 68)
    print(f"KOSZT API — ostatnie {a.dni} dni ({len(wpisy)} wywołań)")
    print("═" * 68)
    print(f"  Zapłacone:        {_usd(suma)}   ({len(oplacone)} wywołań)")
    if z_cache:
        print(f"  Oszczędzone cache'em: {len(z_cache)} wywołań nie poszło do API")
    if bez_ceny:
        modele = sorted({w["model"] for w in bez_ceny})
        print(f"  ⚠ {len(bez_ceny)} wywołań bez ceny (modele spoza cennika: {', '.join(modele)})")

    def zgrupuj(pole):
        k, n = collections.defaultdict(float), collections.Counter()
        for w in oplacone:
            klucz = w.get(pole) or "—"
            k[klucz] += w["usd"] or 0
            n[klucz] += 1
        return sorted(((x, k[x], n[x]) for x in k), key=lambda r: -r[1])

    _tabela("WG KROKU (etykieta)", zgrupuj("etykieta"), suma)
    _tabela("WG MODELU", zgrupuj("model"), suma)

    # Dzień po dniu — pokazuje, czy koszt to stały strumień, czy pojedyncze przebiegi.
    dni = collections.defaultdict(float)
    for w in oplacone:
        dni[w["czas"][:10]] += w["usd"] or 0
    if len(dni) > 1:
        print("\n── WG DNIA " + "─" * 52)
        for d in sorted(dni)[-14:]:
            slupek = "█" * min(40, int(dni[d] / max(dni.values()) * 40)) if max(dni.values()) else ""
            print(f"  {d}  {_usd(dni[d])}  {slupek}")

    # ── Gdzie są pieniądze do odzyskania ─────────────────────────────────────
    print("\n" + "═" * 68)
    print("POTENCJAŁ OSZCZĘDNOŚCI")
    print("═" * 68)

    print(f"\n  Batch API (ten sam model, ten sam prompt, wynik w ciągu godzin):")
    print(f"    −50% na wszystkim puszczanym offline  →  do {_usd(suma * 0.5).strip()} mniej")

    print("\n  Zejście z modelu — te same tokeny wg cennika innego modelu:")
    print("    (przybliżenie: liczba tokenów zmienia się nieco między tokenizerami)")
    wg_etykiet = collections.defaultdict(lambda: collections.defaultdict(int))
    koszt_etykiet = collections.defaultdict(float)
    for w in oplacone:
        koszt_etykiet[w.get("etykieta") or "—"] += w["usd"] or 0
        for pole in ("wejscie", "wyjscie", "cache_zapis", "cache_odczyt"):
            wg_etykiet[w.get("etykieta") or "—"][pole] += w.get(pole) or 0
    naglowek = f"    {'krok':<28}{'teraz':>11}"
    for m in POROWNANIA:
        naglowek += f"{m.replace('claude-', ''):>13}"
    print(naglowek)
    for etyk, teraz in sorted(koszt_etykiet.items(), key=lambda r: -r[1])[:10]:
        t = wg_etykiet[etyk]
        z = {"input_tokens": t["wejscie"], "output_tokens": t["wyjscie"],
             "cache_creation_input_tokens": t["cache_zapis"],
             "cache_read_input_tokens": t["cache_odczyt"]}
        wiersz = f"    {etyk:<28}{teraz:>10.2f}$"
        for m in POROWNANIA:
            k = llm_cennik.koszt(m, z)
            wiersz += f"{k:>12.2f}$" if k is not None else f"{'?':>13}"
        print(wiersz)

    # Urwane odpowiedzi: pełna stawka za tekst nie do użycia.
    urwane = [w for w in oplacone if w.get("stop_reason") == "max_tokens"]
    if urwane:
        strata = sum(w["usd"] or 0 for w in urwane)
        print(f"\n  ⚠ ODPOWIEDZI URWANE LIMITEM: {len(urwane)} × {_usd(strata).strip()}")
        print("    Zapłacone w całości, a tekst jest nie do użycia. Kroki do sprawdzenia:")
        for etyk, ile in collections.Counter(w.get("etykieta") for w in urwane).most_common(5):
            print(f"      {etyk} ({ile}×) — podnieś max_tokens")

    return 0


if __name__ == "__main__":
    sys.exit(main())
