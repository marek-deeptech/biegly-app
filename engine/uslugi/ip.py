"""Funkcja serverless: korelacja IP z pliku logowań w Storage → subanaliza A3.

POST /api/ip  body: {"caseId": "...", "storagePath": "<id>/<ścieżka pliku>"}
Reużywa engine.ip (deterministycznie). Wynik zapisuje jako subanaliza
kind=powiazania_dane (Krok 4) — pary użytkowników dzielących adresy IP.
"""
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

# Katalog repozytorium — o dwa poziomy wyżej niż ten plik (engine/uslugi/…).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from engine.ip import ip_correlation, load_login_events  # noqa: E402

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

            # „Kompleksowo": łączymy WSZYSTKIE pliki logowań sprawy (…logowania.xls/xlsx/txt),
            # każdy w swoim formacie (epromak/DM BOŚ/ip|od|do/FIX/txt), tożsamość z nazwy pliku.
            # Izolacja per case_id, dedup po nazwie (te same pliki leżą w kilku TOM-ach).
            _, db = _req("GET", f"{BASE}/rest/v1/documents?case_id=eq.{case_id}"
                                f"&doc_type=eq.DANE_IP&select=rel_path,storage_path&limit=2000")
            docs = json.loads(db or b"[]")
            seen, candidates = set(), []
            for d in docs:
                sp = d.get("storage_path")
                base = str(d.get("rel_path") or "").rsplit("/", 1)[-1]
                if not sp or not str(sp).startswith(f"{case_id}/"):  # izolacja spraw
                    continue
                if not re.search(r"logowania", base, re.I):  # tylko surowe logi (nie PDF/analizy)
                    continue
                if not re.search(r"\.(xlsx?|xlsm|txt)$", base, re.I):
                    continue
                key = base.strip().lower()
                if key in seen:  # dedup kopii z różnych TOM-ów
                    continue
                seen.add(key)
                candidates.append((base, sp))

            rows, used, skipped = [], [], []
            for base, sp in candidates[:80]:
                try:
                    _, data = _req("GET", f"{BASE}/storage/v1/object/case-files/{urllib.parse.quote(sp)}")
                    ev = load_login_events(data, base)
                except Exception:  # noqa: BLE001 — plik nieczytelny/nieznany format
                    skipped.append(base)
                    continue
                if ev:
                    rows.extend(ev)
                    used.append(base)
                else:
                    skipped.append(base)

            if not rows:
                self._json(400, {
                    "ok": False,
                    "error": "Brak czytelnych plików logowań w aktach (…logowania.xls/.xlsx/.txt). "
                             + (f"Pominięto: {', '.join(skipped[:10])}." if skipped else ""),
                })
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
                f"Analiza logowań z {len(used)} plików ({len(rows)} zdarzeń logowań): {res['user_count']} "
                f"podmiotów, {res['ip_count']} adresów IP, {res['shared_ip_count']} adresów współdzielonych, "
                f"{len(res['pairs'])} par podmiotów dzielących co najmniej jeden adres IP. Zbieżność IP jest "
                f"surowym dowodem współdzielenia infrastruktury — interpretację co do działania w porozumieniu "
                f"przeprowadza biegły.\n\nŹródła (pliki logowań): " + "; ".join(used) + "."
                + (f"\n\nPominięto (nieczytelne/nieznany format): {'; '.join(skipped)}." if skipped else "")
            )
            payload = [{
                "case_id": case_id,
                "kind": "powiazania_dane",
                "chapter_no": "IV",
                "title": "Powiązania — zbieżność IP (Krok 4)",
                "body_md": body_md,
                # chart.events: (data, IP, użytkownik) ze WSPÓLNYCH adresów — materiał
                # wykresu „data × IP" (jak wykres nr 6 analizy specjalisty); cap 6000.
                "data": {"table": table, "chart": {"events": res["events"][:6000]}, "sources": used,
                         "skipped": skipped, "findings": [
                    f"{len(res['pairs'])} par podmiotów dzieli adresy IP; najsilniejsza para: "
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
                             "users": res["user_count"], "ips": res["ip_count"],
                             "logins": len(rows), "files": used, "skipped": skipped})
        except Exception as e:  # noqa: BLE001
            self._json(500, {"ok": False, "error": str(e)})

    def _json(self, code, obj):
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(json.dumps(obj, ensure_ascii=False).encode("utf-8"))
