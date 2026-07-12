"""Funkcja serverless: korelacja IP z pliku logowań w Storage → subanaliza A3.

POST /api/ip  body: {"caseId": "...", "storagePath": "<id>/<ścieżka pliku>"}
Reużywa engine.ip (deterministycznie). Wynik zapisuje jako subanaliza
kind=powiazania_dane (Krok 4) — pary użytkowników dzielących adresy IP.
"""
import io
import json
import os
import sys
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from engine.ip import ip_correlation, load_logins  # noqa: E402

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

            rows = load_logins(io.BytesIO(data))
            if not rows:
                self._json(400, {"ok": False, "error": "Pusty lub nieczytelny plik logowań."})
                return
            res = ip_correlation(rows)

            top = res["pairs"][:40]
            table = {
                "caption": "Tabela. Zbieżność adresów IP — pary użytkowników dzielących logowania z tych samych IP",
                "head": ["Użytkownik A", "Użytkownik B", "Wspólne IP", "Przykładowe adresy"],
                "rows": [
                    [p["user_a"], p["user_b"], str(p["n_shared"]), ", ".join(p["shared_ips"][:3])]
                    for p in top
                ],
            }
            body_md = (
                f"Analiza logowań: {res['user_count']} użytkowników, {res['ip_count']} adresów IP, "
                f"{res['shared_ip_count']} adresów współdzielonych, {len(res['pairs'])} par użytkowników "
                f"dzielących co najmniej jeden adres IP. Zbieżność IP jest surowym dowodem współdzielenia "
                f"infrastruktury — interpretację co do działania w porozumieniu przeprowadza biegły."
            )
            payload = [{
                "case_id": case_id,
                "kind": "powiazania_dane",
                "chapter_no": "IV",
                "title": "Powiązania — zbieżność IP (Krok 4)",
                "body_md": body_md,
                "data": {"table": table, "findings": [
                    f"{len(res['pairs'])} par użytkowników dzieli adresy IP; najsilniejsza para: "
                    f"{top[0]['user_a']} ↔ {top[0]['user_b']} ({top[0]['n_shared']} wspólnych IP)." if top else
                    "Brak par dzielących adresy IP."
                ], "legalRefs": ["art. 12 ust. 2 MAR"]},
                "status": "szkic",
            }]
            _req("POST", f"{BASE}/rest/v1/subanalyses?on_conflict=case_id,kind",
                 data=json.dumps(payload).encode("utf-8"),
                 headers={"Content-Type": "application/json",
                          "Prefer": "resolution=merge-duplicates,return=minimal"})

            self._json(200, {"ok": True, "pairs": len(res["pairs"]),
                             "users": res["user_count"], "ips": res["ip_count"]})
        except Exception as e:  # noqa: BLE001
            self._json(500, {"ok": False, "error": str(e)})

    def _json(self, code, obj):
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(json.dumps(obj, ensure_ascii=False).encode("utf-8"))
