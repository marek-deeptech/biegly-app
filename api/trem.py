"""Funkcja serverless: policz wskaźniki transakcyjne z pliku TREM (UKNF).

POST /api/trem  body: {"caseId": "...", "storagePath": "<id>/<ścieżka pliku>"}
Czyta arkusz IAD_C_TREM (transakcje sparowane B/S z tymi samymi kolumnami co UTP)
i liczy engine.compute_trem. Zapisuje do `metrics` (te same klucze co UTP), więc
zasila te same rozdziały. Roster Grupy per sprawa (jak w /api/analyze).
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
from engine.analysis import compute_trem  # noqa: E402
from engine.loader import load_rows  # noqa: E402


def clean_metrics(case_id, rows):
    """Payload odporny na INSERT: pomija NaN/Inf i zamienia pustą datę sesji na None
    (kolumna date nie przyjmie '' → PostgREST 400)."""
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

            obj_url = f"{BASE}/storage/v1/object/case-files/{urllib.parse.quote(storage_path)}"
            _, data = _req("GET", obj_url)

            try:
                tx = load_rows(io.BytesIO(data), "IAD_C_TREM")
            except KeyError:
                self._json(400, {
                    "ok": False,
                    "error": "Ten plik nie zawiera arkusza 'IAD_C_TREM'. Wybierz plik TREM "
                             "(UTP_TREM_ID ... .xlsm).",
                })
                return
            if not tx:
                self._json(400, {"ok": False, "error": "Pusty arkusz IAD_C_TREM."})
                return

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

            rows = compute_trem(tx, fragments)

            _req("DELETE", f"{BASE}/rest/v1/metrics?case_id=eq.{case_id}",
                 headers={"Prefer": "return=minimal"})
            payload = clean_metrics(case_id, rows)
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
