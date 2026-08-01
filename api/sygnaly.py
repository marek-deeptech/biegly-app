"""Funkcja serverless: moduł „sygnały rynkowe — CDS i ratingi" opinii bankowej.

POST /api/sygnaly  body: {"caseId": "...", "dzienZdarzenia": "YYYY-MM-DD"}

Spread CDS jest rynkową ceną zabezpieczenia przed niewypłacalnością kontrahenta,
więc jego skokowy wzrost to sygnał dostępny każdemu uczestnikowi rynku — w sprawie
PO III Ds 84.2020 biegły uznał pominięcie tej miary za istotny brak w analizie banku.

⚠️ TU NAJCZĘŚCIEJ WYCHODZI LUKA DOWODOWA
Notowania CDS i decyzje agencji ratingowych rzadko trafiają do akt jako DANE —
zwykle są w opinii jako wykres albo opis. Moduł rozróżnia trzy stany: szereg
obecny (liczymy), obliczenie pomocnicze obecne (referujemy parametry), brak danych
(mówimy wprost, że teza o sygnałach rynkowych nie ma w aktach oparcia liczbowego).
Zamilczenie tego byłoby gorsze niż pusty rozdział.
"""
import json
import os
import sys
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from engine.szeregi import czytaj_csv, proba_miesieczna, statystyki  # noqa: E402

BASE = (os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL") or "").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
AUTH = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}

CDS = ("cds", "credit default", "spread")
RATING = ("rating", "moody", "fitch", "standard", "s&p", "ecai")


def _req(method, url, data=None, headers=None):
    r = urllib.request.Request(url, data=data, method=method, headers={**AUTH, **(headers or {})})
    with urllib.request.urlopen(r, timeout=55) as resp:
        return resp.status, resp.read()


def _fmt(v):
    s = f"{v:,.2f}".replace(",", " ").replace(".", ",")
    return s[:-3] if s.endswith(",00") else s


def _komorki_xlsx(dane: bytes, maks: int = 60) -> list[tuple[str, str]]:
    """Pary etykieta–wartość z małego arkusza (obliczenie pomocnicze, nie szereg).

    Arkusz z kilkoma komórkami to notatka rachunkowa biegłego albo banku — jej
    parametry warto zreferować w opinii, ale NIE wolno jej podać jako notowań.
    """
    import io
    import zipfile
    import re as _re

    try:
        z = zipfile.ZipFile(io.BytesIO(dane))
    except Exception:  # noqa: BLE001
        return []
    slownik = []
    if "xl/sharedStrings.xml" in z.namelist():
        ss = z.read("xl/sharedStrings.xml").decode("utf8", "replace")
        slownik = [
            "".join(_re.findall(r"<t[^>]*>([^<]*)</t>", si))
            for si in _re.findall(r"<si>([\s\S]*?)</si>", ss)
        ]
    out: list[tuple[str, str]] = []
    for nazwa in sorted(n for n in z.namelist() if _re.match(r"xl/worksheets/sheet\d+\.xml$", n)):
        xml = z.read(nazwa).decode("utf8", "replace")
        for w in xml.split("<row")[1:]:
            wart: list[str] = []
            for c in w.split("<c")[1:]:
                typ = _re.search(r'\st="([^"]+)"', c)
                v = _re.search(r"<v>([^<]*)</v>", c)
                if not v:
                    continue
                wart.append(slownik[int(v.group(1))] if typ and typ.group(1) == "s" and slownik else v.group(1))
            wart = [x for x in wart if x.strip()]
            if len(wart) >= 2:
                out.append((wart[0], wart[-1]))
            if len(out) >= maks:
                return out
    return out


def policz(case_id, dzien=None):
    try:
        _, cb = _req("GET", f"{BASE}/rest/v1/cases?id=eq.{case_id}&select=name,typ")
        arr = json.loads(cb or b"[]")
        if not arr:
            return (404, {"ok": False, "error": "Nie znaleziono sprawy."})
        if (arr[0].get("typ") or "") != "ryzyko_bankowe":
            return (409, {"ok": False, "error": "Moduł dotyczy wyłącznie spraw o ryzyko bankowe."})

        _, db = _req("GET", f"{BASE}/rest/v1/documents?case_id=eq.{case_id}"
                            f"&select=rel_path,doc_type,storage_path,warstwa_tekstu")
        docs = json.loads(db or b"[]")

        istotne = [
            d for d in docs
            if any(f in d["rel_path"].lower() for f in CDS + RATING)
            and d["doc_type"] != "AKT_PRAWNY"  # rozporządzenie o ratingach to podstawa prawna, nie dane
        ]

        szeregi, obliczenia, obrazy, tabele, findings = [], [], [], [], []
        for d in istotne:
            nazwa = d["rel_path"].split("/")[-1]
            low = nazwa.lower()
            if d["doc_type"] == "GRAFIKA" or low.endswith((".png", ".jpg", ".jpeg")):
                obrazy.append(nazwa)
                continue
            if not d.get("storage_path"):
                continue
            obj = f"{BASE}/storage/v1/object/case-files/{urllib.parse.quote(d['storage_path'])}"
            _, dane = _req("GET", obj)
            if low.endswith(".csv"):
                s = czytaj_csv(dane, nazwa)
                if s:
                    szeregi.append(s)
                    continue
            if low.endswith((".xlsx", ".xlsm")):
                pary = _komorki_xlsx(dane)
                if pary:
                    obliczenia.append({"plik": nazwa, "pozycje": pary})

        for s in szeregi:
            st = statystyki(s, dzien)
            if not st:
                continue
            tabele.append({
                "caption": f"Tabela. {s.nazwa} — wartości na koniec miesiąca ({st.od} – {st.do})",
                "head": ["Miesiąc", "Wartość"],
                "rows": [[p.dzien, _fmt(p.wartosc)] for p in proba_miesieczna(s)],
            })
            findings.append(
                f"{s.nazwa}: szczyt {_fmt(st.szczyt.wartosc)} ({st.szczyt.dzien}), "
                f"zmiana w okresie {st.zmiana_pct:+.1f}%."
            )
            if st.w_dniu:
                findings.append(
                    f"{s.nazwa} w dniu ocenianego zdarzenia ({st.w_dniu.dzien}): {_fmt(st.w_dniu.wartosc)}."
                )

        for o in obliczenia:
            tabele.append({
                "caption": f"Tabela. Parametry obliczenia z pliku {o['plik']}",
                "head": ["Pozycja", "Wartość"],
                "rows": [[a, b] for a, b in o["pozycje"]],
            })
            findings.append(
                f"{o['plik']}: arkusz zawiera {len(o['pozycje'])} parametrów obliczenia, nie szereg notowań. "
                f"Parametry można zreferować, ale nie stanowią danych o poziomach spreadów w czasie."
            )

        # LUKA DOWODOWA — wypowiedziana wprost, nie przemilczana.
        braki = []
        if not any("cds" in s.nazwa.lower() or "spread" in s.nazwa.lower() for s in szeregi):
            braki.append(
                "Notowania spreadów CDS nie występują w aktach jako dane (szereg czasowy). "
                + (f"W aktach jest wykres: {', '.join(obrazy)} — obraz, z którego nie da się odczytać wartości. "
                   if obrazy else "")
                + "Teza o CDS jako sygnale ostrzegawczym wymaga wskazania źródła notowań."
            )
        if not any(any(f in s.nazwa.lower() for f in RATING) for s in szeregi):
            braki.append(
                "Decyzje i perspektywy agencji ratingowych nie występują w aktach jako dane. "
                "Do rozdziału potrzebne są komunikaty agencji z datami zmian ocen."
            )

        sub = {
            "case_id": case_id, "kind": "sygnaly_rynkowe", "chapter_no": "V",
            "title": "Sygnały rynkowe: CDS i ratingi",
            "status": "szkic", "body_md": "",
            "data": {
                "tables": tabele,
                "table": tabele[0] if tabele else None,
                "findings": findings,
                "braki": braki,
                "obrazy": obrazy,
                "dzienZdarzenia": dzien,
            },
        }
        _req("POST", f"{BASE}/rest/v1/subanalyses?on_conflict=case_id,kind",
             json.dumps(sub, ensure_ascii=False).encode(),
             {"Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"})

        return (200, {"ok": True, "szeregow": len(szeregi), "obliczen": len(obliczenia),
                      "obrazow": len(obrazy), "braki": braki})
    except KeyError as e:
        return (400, {"ok": False, "error": f"Brak pola: {e}"})
    except Exception as e:  # noqa: BLE001
        return (500, {"ok": False, "error": str(e)})


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("content-length", 0))
        b = json.loads(self.rfile.read(length) or b"{}")
        kod, payload = policz(b.get("caseId"), (b.get("dzienZdarzenia") or "").strip() or None)
        self._json(kod, payload)

    def _json(self, code, payload):
        b = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)


if __name__ == "__main__":
    kod, payload = policz(sys.argv[1] if len(sys.argv) > 1 else "",
                          sys.argv[2] if len(sys.argv) > 2 else None)
    print(kod, json.dumps(payload, ensure_ascii=False, indent=1))
