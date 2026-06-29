"""Funkcja serverless: policz wskaźniki z pliku UTP w Storage i zapisz do `metrics`.

POST /api/analyze  body: {"caseId": "...", "storagePath": "<id>/<ścieżka pliku>"}
Reużywa zwalidowanego rdzenia engine.compute_all (jedno źródło prawdy).
"""
import io
import json
import os
import sys
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from engine.analysis import compute_all  # noqa: E402
from engine.loader import load_rows  # noqa: E402
from engine.settings import SHEET_ORDERS, SHEET_TRANSACTIONS  # noqa: E402

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

            tx = load_rows(io.BytesIO(data), SHEET_TRANSACTIONS)
            zo = load_rows(io.BytesIO(data), SHEET_ORDERS)
            rows = compute_all(tx, zo)

            _req("DELETE", f"{BASE}/rest/v1/metrics?case_id=eq.{case_id}",
                 headers={"Prefer": "return=minimal"})
            payload = [{"case_id": case_id, **r} for r in rows]
            _req("POST", f"{BASE}/rest/v1/metrics", data=json.dumps(payload).encode("utf-8"),
                 headers={"Content-Type": "application/json", "Prefer": "return=minimal"})

            self._json(200, {"ok": True, "metrics": len(rows)})
        except Exception as e:  # noqa: BLE001
            self._json(500, {"ok": False, "error": str(e)})

    def _json(self, code, obj):
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(json.dumps(obj, ensure_ascii=False).encode("utf-8"))
