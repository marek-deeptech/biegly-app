#!/usr/bin/env python3
"""Zdarzenia uzupełniające chronologii nadzorczej — kotwicowy ekstraktor z pism.

UŻYCIE:
    python3 scripts/zdarzenia_pism.py <case_id>

CO ROBI I DLACZEGO:
Ekstrakcja modelowa chronologii (lib/opinion/chronologia-run.ts) czyta pisma
procesowe i nadzorcze, ale z 119 zdarzeń sprawy SK Banku ŻADNE nie niosło trzech
faktów rozstrzygających dla pytań organu: oceny NIK o sygnale ostrzegawczym,
wniosku KNF do Komisji Nadzoru Audytowego o dyscyplinarkę rewidentów i tego, że
opinie rewidentów za 2013–2014 nie zawierały zastrzeżeń. Ten skrypt dopisuje je
DETERMINISTYCZNIE: każde zdarzenie ma kotwicę — wzorzec tekstowy, którego obecność
w skanie akt jest warunkiem dopisania. Kotwica nieznaleziona = zdarzenie NIE
wchodzi i jest o tym głośny komunikat; nic nie jest zgadywane.

Zdarzenia trafiają do `subanalyses.data.zdarzenia_uzupelniajace`. Scalenie ich
z tabelą działań i promocję do `findings` robi WYŁĄCZNIE kod TS
(scalUzupelniajace + zbudujChronologie w lib/opinion/chronologia-nadzoru.ts),
uruchamiany przez `npx tsx scripts/chronologia_scal.ts` — składanie rozdziału ma
jedno źródło; bliźniacza kopia w Pythonie rozjechałaby się przy pierwszej poprawce
(dokładnie ta awaria, którą opisuje komentarz w redact-bank-run.ts).

Tekst czytamy z KOPII LOKALNEJ (~/biegly-backup, scripts/backup.py) przez
pdftotext — te same pliki .ocr.pdf, które są w Storage; brak kopii = głośny błąd
z instrukcją, nie ciche pominięcie.
"""
from __future__ import annotations

import json
import os
import pathlib
import re
import subprocess
import sys
import urllib.request

REPO = pathlib.Path(__file__).resolve().parent.parent
BACKUP = pathlib.Path.home() / "biegly-backup" / "files"

MIESIACE = {
    "sty": 1, "lut": 2, "mar": 3, "kwi": 4, "maj": 5, "cze": 6,
    "lip": 7, "sie": 8, "wrz": 9, "paź": 10, "paz": 10, "lis": 11, "gru": 12,
}


def iso_z_naglowka(tekst: str, maks_zn: int = 2500) -> str | None:
    """Data dokumentu z jego nagłówka („Warszawa, dnia 12 stycznia 2016 r." / „30.03.2015").

    None, gdy w nagłówku daty nie ma — zdarzenie bez daty NIE wchodzi do chronologii
    (reguła budowniczego), więc lepiej głośno pominąć niż wstawić datę zgadniętą.
    """
    glowa = tekst[:maks_zn]
    m = re.search(r"dnia\s+(\d{1,2})\s+([a-ząęóźżćńłś]{3,})[a-ząęóźżćńłś]*\s+(\d{4})", glowa, re.I)
    if m:
        mies = MIESIACE.get(m.group(2)[:3].lower())
        if mies:
            return f"{m.group(3)}-{mies:02d}-{int(m.group(1)):02d}"
    m = re.search(r"\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b", glowa)
    if m:
        return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
    return None


def scal(istniejace: list[dict], nowe: list[dict]) -> tuple[list[dict], list[str]]:
    """Scala po `kotwica` — idempotentnie. Zwraca (wynik, kotwice_dodane)."""
    znane = {x.get("kotwica") for x in istniejace}
    out = list(istniejace)
    dodane: list[str] = []
    for n in nowe:
        if n["kotwica"] in znane:
            continue
        znane.add(n["kotwica"])
        out.append(n)
        dodane.append(n["kotwica"])
    return out, dodane


# ── KOTWICE ──────────────────────────────────────────────────────────────────
# `rdzen` wskazuje skan akt; `wzor` musi się w nim znaleźć, inaczej zdarzenie
# nie powstaje. `data` stała jest datą ZDARZENIA wynikającą z treści kotwicy
# (zweryfikowaną na aktach); None = weź datę pisma z nagłówka dokumentu.
KOTWICE: list[dict] = [
    {
        "kotwica": "rwef-3q2015-niesporzadzona",
        "rdzen": "SKM_C451i26080211120",
        # ⚠️ separatorem NIE MOŻE być [^.] — w tekście prawniczym co kilka słów stoi
        # skrót „r." albo „ust." i kropka ucina dopasowanie w połowie frazy. Pierwsza
        # wersja wzorca przez to „nie znajdowała" kotwicy, która w skanie BYŁA.
        "wzor": r"KOBRA[^§]{0,220}30 września 2015[^§]{0,220}nie (?:była|została) sporządzona",
        "wymaga": r"27 listopada 2015",
        "data": "2015-11-27",
        "organ": "Urząd Komisji Nadzoru Finansowego",
        "opis": (
            "Analiza kwartalna (system KOBRA) według stanu na 30.09.2015 r. nie została "
            "sporządzona — RWEF za III kwartał 2015 r. wygenerowano na podstawie "
            "sprawozdawczości pozyskanej z NBP dopiero 27.11.2015 r., tydzień po decyzji "
            "KNF o zawieszeniu działalności banku."
        ),
        "plik": "pozew (skan SKM_…11120)",
    },
    {
        "kotwica": "nik-rwef-sygnal-ostrzegawczy",
        "rdzen": "SKM_C451i26080211510",
        "wzor": r"powinny stanowić dla nadzorcy sygnał ostrzegawczy|W opinii NIK[^.]{0,300}sygnał\w* ostrzegawcz",
        # Data wystąpienia pokontrolnego NIK (KBF.410.…, 9.11.2016) — data oceny, nie pisma UKNF.
        "data": "2016-11-09",
        "organ": "Najwyższa Izba Kontroli",
        "opis": (
            "W wystąpieniu pokontrolnym NIK oceniła, że niepokojące tendencje prezentowane "
            "w RWEF na 30.09.2013 r. — dotyczące istotnych wielkości charakteryzujących "
            "aktywa oraz nieracjonalnie szybkiego wzrostu sumy bilansowej — powinny stanowić "
            "dla nadzorcy sygnał ostrzegawczy o rosnącym ryzyku, a raport RWEF powinien być "
            "wykorzystywany jako narzędzie wczesnego ostrzegania."
        ),
        "plik": "wystąpienie pokontrolne NIK, cyt. w odpowiedzi UKNF na pozew (skan SKM_…11510)",
    },
    {
        "kotwica": "knf-kna-dyscyplinarne-rewidenci",
        "rdzen": "SKM_C451i26080211560",
        "wzor": r"zwróciła się do Komisji Nadzoru Audytowego[^§]{0,300}",
        # ⚠️ NIE braać daty z nagłówka: skan 11560 to 19 dokumentów i „pierwsza data
        # w pliku" (23.12.1994) należała do zupełnie innego pisma. Datujemy na dzień
        # ogłoszenia wystąpienia NIK wraz z zastrzeżeniami KNF (18.01.2017, nik.gov.pl),
        # co opis wypowiada wprost.
        "data": "2017-01-18",
        "organ": "Komisja Nadzoru Finansowego",
        "opis": (
            "KNF zwróciła się do Komisji Nadzoru Audytowego z prośbą o wszczęcie postępowania "
            "dyscyplinarnego wobec biegłych rewidentów występujących przy badaniu sprawozdań "
            "finansowych SBRzR w Wołominie za 2013 r. i 2014 r. (data pisma nieustalona ze "
            "skanu; datowano na dzień ogłoszenia wystąpienia NIK wraz z zastrzeżeniami)."
        ),
        "plik": "zastrzeżenia Przewodniczącego KNF do wystąpienia NIK (skan SKM_…11560)",
    },
    {
        "kotwica": "rewidenci-bez-zastrzezen-2013-2014",
        "rdzen": "SKM_C451i26080211191",
        "wzor": r"opinie biegłych rewidentów[^§]{0,240}nie zawierały zastrzeżeń",
        # Data publikacji opinii za 2014 r. w raporcie rocznym emitenta (EBI, 9.06.2015);
        # załącznik pozyskany przez biegłego jest w aktach sprawy.
        "data": "2015-06-09",
        "organ": "biegły rewident (ZRBS) / SBRzR jako emitent",
        "opis": (
            "Opinie biegłych rewidentów z badania sprawozdań finansowych SBRzR za 2013 r. "
            "i 2014 r. nie zawierały zastrzeżeń; opinię za 2014 r. opublikowano 9.06.2015 r. "
            "wraz z raportem rocznym emitenta (EBI), pięć tygodni przed ustanowieniem zarządu "
            "komisarycznego."
        ),
        "plik": "pismo syndyka (skan SKM_…11191); raport roczny EBI z 9.06.2015 (pozyskany)",
    },
]


def env() -> tuple[str, str]:
    out: dict[str, str] = {}
    for line in (REPO / ".env.local").read_text(encoding="utf8").splitlines():
        m = re.match(r"^([A-Z_]+)=(.*)$", line.strip())
        if m:
            out[m.group(1)] = m.group(2).strip().strip("\"'")
    url, key = out.get("NEXT_PUBLIC_SUPABASE_URL"), out.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("✗ brak kluczy Supabase w .env.local")
    return url, key


def zapytanie(url: str, key: str, sciezka: str, metoda: str = "GET", cialo: dict | None = None):
    req = urllib.request.Request(
        url + sciezka,
        method=metoda,
        headers={
            "apikey": key, "Authorization": f"Bearer {key}",
            "Content-Type": "application/json", "Prefer": "return=representation",
        },
        data=json.dumps(cialo).encode() if cialo is not None else None,
    )
    with urllib.request.urlopen(req) as r:
        surowe = r.read()
    return json.loads(surowe) if surowe else None


def tekst_skanu(case_id: str, rdzen: str) -> str | None:
    """Tekst skanu z kopii lokalnej — preferuje wariant .ocr.pdf."""
    katalog = BACKUP / case_id
    if not katalog.is_dir():
        sys.exit(
            f"✗ brak kopii lokalnej akt: {katalog}\n"
            "  Wykonaj: python3 scripts/backup.py  (kopia jest wznawialna)"
        )
    kandydaci = sorted(katalog.glob(f"{rdzen}*.pdf"), key=lambda p: (".ocr." not in p.name, p.name))
    for p in kandydaci:
        try:
            out = subprocess.run(
                ["pdftotext", "-q", str(p), "-"], capture_output=True, check=True, timeout=120,
            ).stdout.decode("utf8", errors="replace")
        except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired) as e:
            print(f"  ⚠ {p.name}: pdftotext nie odczytał ({e})")
            continue
        if len(out.strip()) > 500:
            return out
    return None


def main() -> int:
    if len(sys.argv) < 2:
        sys.exit("użycie: python3 scripts/zdarzenia_pism.py <case_id>")
    case_id = sys.argv[1]
    url, key = env()

    wiersze = zapytanie(
        url, key,
        f"/rest/v1/subanalyses?case_id=eq.{case_id}&kind=eq.chronologia_nadzoru&select=id,data",
    )
    if not wiersze:
        sys.exit("✗ w sprawie nie ma subanalizy chronologia_nadzoru — wykonaj najpierw jej krok")
    sub = wiersze[0]
    dane = sub.get("data") or {}
    istniejace = dane.get("zdarzenia_uzupelniajace") or []

    nowe: list[dict] = []
    for k in KOTWICE:
        tekst = tekst_skanu(case_id, k["rdzen"])
        if tekst is None:
            print(f"✗ {k['kotwica']}: brak czytelnego skanu {k['rdzen']}* w kopii lokalnej")
            continue
        gladki = re.sub(r"\s+", " ", tekst)
        m = re.search(k["wzor"], gladki, re.I)
        if not m:
            print(f"✗ {k['kotwica']}: KOTWICY NIE ZNALEZIONO w {k['rdzen']} — zdarzenia nie dopisano")
            continue
        if k.get("wymaga") and not re.search(k["wymaga"], gladki, re.I):
            print(f"✗ {k['kotwica']}: brak frazy potwierdzającej „{k['wymaga']}” — zdarzenia nie dopisano")
            continue
        data = k["data"] or iso_z_naglowka(tekst)
        if not data:
            print(f"✗ {k['kotwica']}: kotwica jest, ale dokument nie ma daty w nagłówku — pominięto")
            continue
        nowe.append({"kotwica": k["kotwica"], "data": data, "organ": k["organ"], "opis": k["opis"], "plik": k["plik"]})
        print(f"✓ {k['kotwica']}: kotwica potwierdzona, data {data}")

    scalone, dodane = scal(istniejace, nowe)
    if not dodane:
        print(f"\nbez zmian — uzupełnień w bazie: {len(scalone)}")
        return 0

    dane["zdarzenia_uzupelniajace"] = scalone
    zapytanie(
        url, key,
        f"/rest/v1/subanalyses?id=eq.{sub['id']}", "PATCH", {"data": dane},
    )
    print(f"\n✓ dopisano {len(dodane)}: {', '.join(dodane)}; razem uzupełnień: {len(scalone)}")
    print("  Scal do tabeli i findings: npx tsx scripts/chronologia_scal.ts <sprawa>")
    return 0


if __name__ == "__main__":
    sys.exit(main())
