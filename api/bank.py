"""Funkcja serverless: wskaźniki finansowe banku ze sprawozdań w Storage.

POST /api/bank  body: {"caseId": "...", "storagePaths": ["<id>/…", …]}  (ścieżki opcjonalne)

Reużywa `engine.sprawozdania` (odczyt pozycji) i `engine.bank` (wskaźniki) — deterministycznie,
bez modelu. Wynik zapisuje jako subanalizę `wskazniki_bank` oraz wiersze w `metrics`,
dzięki czemu audytor opinii może weryfikować liczby wobec wykazu metryk silnika.

⚠️ TA TRASA NIE DOTYCZY SPRAW O MANIPULACJĘ. Sprawdza `cases.typ` i odmawia pracy
dla innej dziedziny — tak jak /api/spoofing odmawia bez rostera Grupy. Wskaźnik
adekwatności policzony w sprawie manipulacyjnej byłby liczbą bez przedmiotu.
"""
import io
import json
import os
import sys
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from engine.bank import szereg, wskazniki, zmiany  # noqa: E402
from engine.sprawozdania import (  # noqa: E402
    czytaj_pdf,
    sprawdz_spojnosc,
    uzupelnij_z_tozsamosci,
    zbuduj_pozycje,
)

BASE = (os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL") or "").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
AUTH = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}


def _req(method, url, data=None, headers=None):
    req = urllib.request.Request(url, data=data, method=method, headers={**AUTH, **(headers or {})})
    with urllib.request.urlopen(req, timeout=55) as r:
        return r.status, r.read()


def _fmt(v):
    """Liczba w zapisie polskim, bez zbędnych zer po przecinku."""
    s = f"{v:,.2f}".replace(",", " ").replace(".", ",")
    return s[:-3] if s.endswith(",00") else s


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers.get("content-length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            case_id = body["caseId"]

            # DZIEDZINA — twarda bramka. Ta trasa liczy adekwatność kapitałową;
            # w sprawie o manipulację instrumentem finansowym nie ma czego liczyć.
            _, cb = _req("GET", f"{BASE}/rest/v1/cases?id=eq.{case_id}&select=name,typ")
            arr = json.loads(cb or b"[]")
            if not arr:
                self._json(404, {"ok": False, "error": "Nie znaleziono sprawy."})
                return
            if (arr[0].get("typ") or "") != "ryzyko_bankowe":
                self._json(409, {
                    "ok": False,
                    "error": "Ta analiza dotyczy wyłącznie spraw o ryzyko bankowe. "
                             "Sprawa ma inną dziedzinę — wskaźniki adekwatności byłyby liczbą bez przedmiotu.",
                })
                return

            # Sprawozdania: z body albo wszystkie z akt (szereg czasowy wymaga min. dwóch okresów).
            paths = body.get("storagePaths") or []
            if not paths:
                _, db = _req("GET", f"{BASE}/rest/v1/documents?case_id=eq.{case_id}"
                                    f"&doc_type=eq.SPRAWOZDANIE_BANK&select=rel_path,storage_path")
                docs = json.loads(db or b"[]")
                paths = [d["storage_path"] for d in docs
                         if d.get("storage_path") and str(d.get("rel_path", "")).lower().endswith(".pdf")]
            if not paths:
                self._json(400, {"ok": False, "error": "Brak sprawozdań finansowych (SPRAWOZDANIE_BANK) w aktach."})
                return

            # Izolacja spraw — plik musi należeć do TEJ sprawy.
            for p in paths:
                if not str(p).startswith(f"{case_id}/"):
                    self._json(403, {"ok": False, "error": "Plik nie należy do tej sprawy."})
                    return

            pozycje, uwagi, zrodla = [], [], []
            for p in paths:
                obj = f"{BASE}/storage/v1/object/case-files/{urllib.parse.quote(p)}"
                _, data = _req("GET", obj)
                tmp = f"/tmp/{os.path.basename(p).replace('/', '_')}"
                with open(tmp, "wb") as fh:
                    fh.write(data)
                try:
                    odczyt = czytaj_pdf(tmp)
                finally:
                    try:
                        os.remove(tmp)
                    except OSError:
                        pass
                poz = zbuduj_pozycje(odczyt)
                if not poz:
                    uwagi.append(f"{os.path.basename(p)}: nie rozpoznano kolumn dat — pominięto")
                    continue
                uwagi += uzupelnij_z_tozsamosci(odczyt, poz)
                uwagi += sprawdz_spojnosc(odczyt, poz)
                strony = sorted({k.strona for k in odczyt.kandydaci})
                zrodla.append({"plik": os.path.basename(p), "strony": strony[:12],
                               "okresy": [x.dzien for x in poz]})
                pozycje += poz

            if not pozycje:
                self._json(422, {
                    "ok": False,
                    "error": "Ze sprawozdań nie udało się odczytać pozycji. Sprawdź, czy PDF-y mają "
                             "warstwę tekstową (skan wymaga OCR — patrz scripts/ocr_akta.py).",
                })
                return

            # Duplikaty dat (ten sam okres w dwóch sprawozdaniach) — pierwszy wygrywa,
            # bo sprawozdania są przetwarzane w kolejności podanej przez biegłego.
            widziane, unikalne = set(), []
            for p in pozycje:
                if p.dzien in widziane:
                    continue
                widziane.add(p.dzien)
                unikalne.append(p)

            s = szereg(unikalne)
            okresy = sorted(widziane)

            # Tabela: wiersz na wskaźnik, kolumna na okres — postać, w jakiej rozdział
            # „Współczynniki kapitałowe w czasie" wchodzi do opinii.
            head = ["Wskaźnik"] + okresy + ["Zmiana", "Próg", "Podstawa progu"]
            rows, metryki = [], []
            for kod, seria in s.items():
                wg_dnia = {w.dzien: w for w in seria}
                ostatni = seria[-1]
                zm = zmiany(seria)
                rows.append([
                    ostatni.nazwa,
                    *[(f"{_fmt(wg_dnia[d].wartosc)} {wg_dnia[d].jednostka}" if d in wg_dnia else "—") for d in okresy],
                    (f"{zm[-1][1]:+.2f} p.p." if zm else "—"),
                    (f"{_fmt(ostatni.prog)}%" if ostatni.prog is not None else "—"),
                    ostatni.podstawa_progu or "brak progu w tym stanie prawnym",
                ])
                for w in seria:
                    metryki.append({
                        "case_id": case_id, "key": f"bank_{w.kod}", "label": w.nazwa,
                        "value": w.wartosc, "unit": w.jednostka, "target": w.prog,
                        "session_day": w.dzien,
                    })

            ponizej = [w for p in unikalne for w in wskazniki(p) if w.spelniony is False]
            findings = [
                f"{w.dzien}: {w.nazwa} = {_fmt(w.wartosc)}{w.jednostka} — poniżej progu "
                f"{_fmt(w.prog)}% ({w.podstawa_progu})"
                for w in ponizej
            ]

            # Metryki nadpisujemy w całości: ponowne uruchomienie ma dać ten sam stan,
            # a nie dokleić drugi komplet wierszy.
            _req("DELETE", f"{BASE}/rest/v1/metrics?case_id=eq.{case_id}&key=like.bank_*")
            for i in range(0, len(metryki), 100):
                _req("POST", f"{BASE}/rest/v1/metrics",
                     json.dumps(metryki[i:i + 100]).encode(),
                     {"Content-Type": "application/json", "Prefer": "return=minimal"})

            sub = {
                "case_id": case_id,
                "kind": "wskazniki_bank",
                "chapter_no": "V",
                "title": "Współczynniki kapitałowe i sytuacja finansowa w czasie",
                "status": "szkic",
                "data": {
                    "table": {"caption": "Tabela. Wskaźniki finansowe w szeregu czasowym",
                              "head": head, "rows": rows},
                    "okresy": okresy,
                    "zrodla": zrodla,
                    "uwagi": uwagi,
                    "findings": findings,
                },
                "body_md": "",
            }
            _req("POST", f"{BASE}/rest/v1/subanalyses?on_conflict=case_id,kind",
                 json.dumps(sub).encode(),
                 {"Content-Type": "application/json",
                  "Prefer": "resolution=merge-duplicates,return=minimal"})

            self._json(200, {"ok": True, "okresy": okresy, "wskaznikow": len(rows),
                             "ponizej_progu": len(findings), "uwagi": uwagi, "zrodla": zrodla})
        except KeyError as e:
            self._json(400, {"ok": False, "error": f"Brak pola: {e}"})
        except Exception as e:  # noqa: BLE001
            self._json(500, {"ok": False, "error": str(e)})

    def _json(self, code, payload):
        b = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)
