"""Usługa: wskaźniki dodatkowe (NMaxC, WNK, VWAP, WT%, Taker/Maker) z arkusza TREM.

Wywoływana przyciskiem w kroku „Wskaźniki" (zakładka „Wskaźniki dodatkowe").
Liczy PER INSTRUMENT i zapisuje subanalizę `wskazniki_dodatkowe`.

Definicje i założenia metodyczne: engine/wskazniki_dodatkowe.py.
Złożenie tabel wspólne z CLI: engine/wskazniki_tabele.py.
"""
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from engine.loader import load_trem_paired  # noqa: E402
from engine.rest_url import url_rest  # noqa: E402
from engine.wskazniki_tabele import zloz  # noqa: E402

BASE = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""
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

            _, cb = _req("GET", url_rest(BASE, "cases", id=f"eq.{case_id}", select="name,typ,group_roster"))
            sprawy = json.loads(cb or b"[]")
            if not sprawy:
                self._json(404, {"ok": False, "error": "nie znaleziono sprawy"})
                return
            c = sprawy[0]
            if c.get("typ") != "manipulacja_gpw":
                self._json(409, {"ok": False, "error": "wskaźniki dodatkowe dotyczą spraw o manipulację GPW"})
                return
            fragmenty = [str(x).strip().lower() for x in (c.get("group_roster") or {}).get("fragments", []) if str(x).strip()]
            if not fragmenty:
                self._json(409, {
                    "ok": False,
                    "error": "Sprawa nie ma zdefiniowanego składu Grupy (group_roster.fragments). "
                             "Bez rostera atrybucja maksimów i wpływu na kurs byłaby liczona po podmiotach innej sprawy.",
                })
                return

            _, db = _req("GET", url_rest(BASE, "documents", case_id=f"eq.{case_id}",
                                         select="rel_path,storage_path", limit="3000"))
            docs = json.loads(db or b"[]")
            # Dedup kopii z różnych TOM-ów — ten sam arkusz bywa w aktach kilka razy,
            # a bez odsiewu każda transakcja liczyłaby się wielokrotnie.
            widziane, pliki = set(), []
            for d in sorted(docs, key=lambda x: x.get("rel_path") or ""):
                nazwa = str(d.get("rel_path") or "").rsplit("/", 1)[-1]
                sp = d.get("storage_path")
                if not sp or not re.search(r"(UTP )?TREM.*\.xls[mx]$", nazwa, re.I):
                    continue
                if not str(sp).startswith(f"{case_id}/"):  # izolacja spraw
                    continue
                klucz = nazwa.strip().lower()
                if klucz in widziane:
                    continue
                widziane.add(klucz)
                pliki.append((nazwa, sp))
            if not pliki:
                self._json(409, {"ok": False, "error": "w aktach nie ma arkusza transakcji TREM"})
                return

            wg_instrumentu = {}
            uzyte = []
            for nazwa, sp in pliki:
                _, blob = _req("GET", f"{BASE}/storage/v1/object/case-files/{urllib.parse.quote(sp)}")
                try:
                    rows = load_trem_paired(blob)
                except KeyError:
                    continue
                for row in rows:
                    isin = str(row.get("INSTRISIN") or row.get("SYMBOL") or "").strip()
                    wg_instrumentu.setdefault(isin, []).append(row)
                uzyte.append(nazwa)

            z = zloz(wg_instrumentu, fragmenty, int(body.get("maksSesji") or 40))
            payload = [{
                "case_id": case_id, "kind": "wskazniki_dodatkowe", "chapter_no": "IV",
                "title": "Wskaźniki dodatkowe (NMaxC, WNK, VWAP, WT%, Taker/Maker)",
                "status": "szkic", "body_md": "",
                "data": {"table": z["tables"][0] if z["tables"] else None, "tables": z["tables"],
                         "findings": z["findings"], "wyniki": z["wyniki"],
                         "instrumenty": list(z["wyniki"].keys()), "pliki": uzyte},
            }]
            _req("POST", f"{BASE}/rest/v1/subanalyses?on_conflict=case_id,kind",
                 data=json.dumps(payload, ensure_ascii=False).encode(),
                 headers={"Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"})

            self._json(200, {
                "ok": True,
                "instrumenty": list(z["wyniki"].keys()),
                "tabel": len(z["tables"]),
                "pliki": uzyte,
                "transakcji": sum(len(v) for v in wg_instrumentu.values()),
            })
        except Exception as e:  # noqa: BLE001
            self._json(500, {"ok": False, "error": f"{type(e).__name__}: {e}"})

    def _json(self, kod, dane):
        b = json.dumps(dane, ensure_ascii=False).encode()
        self.send_response(kod)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)
