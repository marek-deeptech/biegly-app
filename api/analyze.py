"""Funkcja serverless: policz wskaźniki z pliku UTP w Storage i zapisz do `metrics`.

POST /api/analyze  body: {"caseId": "...", "storagePath": "<id>/<ścieżka pliku>"}
Reużywa zwalidowanego rdzenia engine.compute_all (jedno źródło prawdy).
"""
import io
import json
import math
import os
import sys
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from engine.analysis import compute_all  # noqa: E402
from engine.loader import load_rows  # noqa: E402
from engine.settings import SHEET_ORDERS, SHEET_TRANSACTIONS  # noqa: E402


def clean_metrics(case_id, rows):
    """Payload odporny na INSERT: pomija wartości niepoprawne w JSON (NaN/Inf) i
    zamienia pustą datę sesji na None (kolumna date nie przyjmie '' → PostgREST 400)."""
    out = []
    for r in rows:
        v = r.get("value")
        if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
            continue
        out.append({"case_id": case_id, **r, "session_day": r.get("session_day") or None})
    return out

BASE = (os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL") or "").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
AUTH = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}


def _req(method, url, data=None, headers=None):
    req = urllib.request.Request(url, data=data, method=method, headers={**AUTH, **(headers or {})})
    with urllib.request.urlopen(req, timeout=55) as r:
        return r.status, r.read()


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers.get("content-length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            case_id = body["caseId"]
            storage_path = body["storagePath"]

            # Izolacja spraw: plik musi należeć do TEJ sprawy (storage_path = "<case_id>/…").
            if not str(storage_path).startswith(f"{case_id}/"):
                self._json(403, {"ok": False, "error": "Plik nie należy do tej sprawy."})
                return

            obj_url = f"{BASE}/storage/v1/object/case-files/{urllib.parse.quote(storage_path)}"
            _, data = _req("GET", obj_url)

            try:
                tx = load_rows(io.BytesIO(data), SHEET_TRANSACTIONS)
                zo = load_rows(io.BytesIO(data), SHEET_ORDERS)
            except KeyError:
                self._json(400, {
                    "ok": False,
                    "error": "Ten plik nie jest głównym plikiem UTP (brak arkuszy "
                             "'Transakcje' i 'Zlecenia BO'). Wybierz plik typu "
                             "'Transakcje_i_Zlecenia ... prok.xlsx'.",
                })
                return

            # Krok 2: roster „Grupy" per sprawa (z zawiadomienia) → group_fragments.
            # Roster jest OBOWIĄZKOWY: bez niego atrybucja Grupy poszłaby po domyślnych
            # fragmentach HubTechu (settings) — ciche złe przypisanie w innej sprawie.
            fragments = None
            try:
                _, rb = _req("GET", f"{BASE}/rest/v1/cases?id=eq.{case_id}&select=group_roster")
                arr = json.loads(rb or b"[]")
                gr = (arr[0].get("group_roster") if arr else None) or {}
                frs = gr.get("fragments")
                if isinstance(frs, list) and frs:
                    fragments = [str(x).strip().lower() for x in frs if str(x).strip()]
            except Exception:  # noqa: BLE001
                fragments = None

            if not fragments:
                self._json(409, {
                    "ok": False,
                    "error": "Sprawa nie ma zdefiniowanego składu Grupy (group_roster.fragments). "
                             "Uzupełnij roster Grupy w zakładce Sprawa przed liczeniem wskaźników — "
                             "bez niego atrybucja Grupy byłaby liczona po podmiotach innej sprawy.",
                })
                return

            rows = compute_all(tx, zo, fragments)

            _req("DELETE", f"{BASE}/rest/v1/metrics?case_id=eq.{case_id}",
                 headers={"Prefer": "return=minimal"})
            payload = clean_metrics(case_id, rows)
            # INSERT partiami — sprawy skali MLM mają >3000 metryk.
            for i in range(0, len(payload), 500):
                _req("POST", f"{BASE}/rest/v1/metrics",
                     data=json.dumps(payload[i:i + 500]).encode("utf-8"),
                     headers={"Content-Type": "application/json", "Prefer": "return=minimal"})

            self._json(200, {"ok": True, "metrics": len(payload)})
        except Exception as e:  # noqa: BLE001
            self._json(500, {"ok": False, "error": str(e)})

    def _json(self, code, obj):
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(json.dumps(obj, ensure_ascii=False).encode("utf-8"))
