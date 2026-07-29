"""Funkcja serverless: policz wskaźniki transakcyjne z pliku TREM (UKNF).

POST /api/trem  body: {"caseId": "...", "storagePath": "<id>/<ścieżka pliku>"}
Czyta arkusz IAD_C_TREM (transakcje sparowane B/S z tymi samymi kolumnami co UTP)
i liczy engine.compute_trem. Zapisuje do `metrics` (te same klucze co UTP), więc
zasila te same rozdziały. Roster Grupy per sprawa (jak w /api/analyze).
"""
import json
import math
import os
import re
import sys
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from engine.analysis import compute_trem  # noqa: E402
from engine.loader import load_trem_paired  # noqa: E402


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

            # „Łącznie": zbieramy WSZYSTKIE sparowane pliki TREM sprawy (np. ZASTAL: CSY + RSY)
            # i liczymy z nich jednym przebiegiem. Wybór po NAZWIE (UTP TREM / IAD_C), bo rozmiar
            # bywa mylący (paired MLM = 15 MB, surowy MiFIR per osoba = 8 MB); dedup po nazwie, bo
            # te same pliki bywają w wielu TOM-ach (inaczej podwójne/potrójne liczenie).
            _, db = _req("GET", f"{BASE}/rest/v1/documents?case_id=eq.{case_id}"
                                f"&doc_type=in.(DANE_TREM,DANE_UTP)&select=rel_path,storage_path&limit=2000")
            docs = json.loads(db or b"[]")
            paired_re = re.compile(r"utp[\s_-]*trem|iad[\s_-]*c", re.I)
            seen_names, candidates = set(), []
            for d in docs:
                sp = d.get("storage_path")
                base = str(d.get("rel_path") or "").rsplit("/", 1)[-1]
                if not sp or not re.search(r"\.xls[mx]$", base, re.I):
                    continue
                if not str(sp).startswith(f"{case_id}/"):  # izolacja spraw
                    continue
                if not paired_re.search(base):  # tylko sparowane pliki per instrument
                    continue
                key = base.strip().lower()
                if key in seen_names:  # dedup kopii z różnych TOM-ów
                    continue
                seen_names.add(key)
                candidates.append((base, sp))

            # Transakcje SPAROWANE B/S — helper akceptuje IAD_C_TREM (HubTech/MLM) i 2_stronnie
            # (ZASTAL) oraz aliasuje kupującego _K→_B. Łączymy wiersze ze wszystkich instrumentów.
            tx, files = [], []
            for base, sp in candidates[:16]:
                try:
                    _, data = _req("GET", f"{BASE}/storage/v1/object/case-files/{urllib.parse.quote(sp)}")
                    rows = load_trem_paired(data)
                except Exception:  # noqa: BLE001 — pomijamy plik nieczytelny/niesparowany (KeyError itp.)
                    continue
                if rows:
                    tx.extend(rows)
                    files.append(base)

            if not tx:
                self._json(400, {
                    "ok": False,
                    "error": "Brak w aktach sparowanych plików TREM (arkusz 'IAD_C_TREM' lub '2_stronnie'). "
                             "Wgraj/oznacz plik per instrument, np. 'UTP TREM CSY.xlsx' / 'UTP TREM RSY.xlsx' "
                             "(nie surowe pliki MiFIR per osoba — …_Uproszczony).",
                })
                return

            # Roster Grupy OBOWIĄZKOWY — jak w /api/analyze (bez niego fallback do HubTechu).
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

            rows = compute_trem(tx, fragments)

            # Zestaw ŁĄCZNY → tabela metrics (zasila opinię/Wnioski, zachowanie wsteczne).
            _req("DELETE", f"{BASE}/rest/v1/metrics?case_id=eq.{case_id}",
                 headers={"Prefer": "return=minimal"})
            payload = clean_metrics(case_id, rows)
            for i in range(0, len(payload), 500):
                _req("POST", f"{BASE}/rest/v1/metrics",
                     data=json.dumps(payload[i:i + 500]).encode("utf-8"),
                     headers={"Content-Type": "application/json", "Prefer": "return=minimal"})

            # Rozbicie PER INSTRUMENT (osobne sekcje wskaźników — ZASTAL: CSY i RSY). Instrument
            # z kolumny SYMBOL/INSTRISIN (ISIN); znane ISIN-y mapujemy na krótkie etykiety.
            isin_label = {"PLCSYSA00016": "CSY", "PLRSYSA00014": "RSY", "PLZSTAL00012": "ZASTAL"}
            groups = {}
            for r in tx:
                key = str(r.get("SYMBOL") or r.get("INSTRISIN") or "").strip()
                groups.setdefault(key, []).append(r)

            def _sanit(ms):
                out = []
                for m in ms:
                    v = m.get("value")
                    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                        m = {**m, "value": None}
                    out.append(m)
                return out

            # Zawsze czyścimy stare sekcje per-instrument; wpisujemy je tylko, gdy realnie >1 instrument.
            _req("DELETE", f"{BASE}/rest/v1/subanalyses?case_id=eq.{case_id}&kind=like.trem_*",
                 headers={"Prefer": "return=minimal"})
            instruments, subs_payload = [], []
            for isin, rows_i in sorted(groups.items(), key=lambda kv: isin_label.get(kv[0], kv[0])):
                if not rows_i:
                    continue
                label = isin_label.get(isin, isin or "—")
                mi = _sanit(compute_trem(rows_i, fragments))
                slug = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_") or "x"
                subs_payload.append({
                    "case_id": case_id, "kind": f"trem_{slug}", "chapter_no": "IV",
                    "title": f"TREM — {label}", "status": "szkic",
                    "body_md": f"Wskaźniki transakcyjne TREM dla instrumentu {label} ({isin}) — {len(rows_i)} transakcji.",
                    "data": {"label": label, "isin": isin, "transactions": len(rows_i), "metrics": mi},
                })
                instruments.append({"label": label, "isin": isin, "transactions": len(rows_i)})
            if len(subs_payload) >= 2:
                _req("POST", f"{BASE}/rest/v1/subanalyses?on_conflict=case_id,kind",
                     data=json.dumps(subs_payload).encode("utf-8"),
                     headers={"Content-Type": "application/json",
                              "Prefer": "resolution=merge-duplicates,return=minimal"})

            self._json(200, {"ok": True, "metrics": len(payload), "files": files,
                             "transactions": len(tx),
                             "instruments": instruments if len(instruments) >= 2 else []})
        except Exception as e:  # noqa: BLE001
            self._json(500, {"ok": False, "error": str(e)})

    def _json(self, code, obj):
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(json.dumps(obj, ensure_ascii=False).encode("utf-8"))
