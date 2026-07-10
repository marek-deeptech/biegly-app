"""Funkcja serverless: wykrycie techniki Spoofing & Layering z pliku UTP w Storage.

POST /api/spoofing  body: {"caseId": "...", "storagePath": "<id>/<ścieżka pliku>"}
Reużywa engine.spoofing.detect_layering (deterministycznie, na arkuszu zleceń).
Wynik zapisuje jako subanaliza kind=`spoofing_analysis` (data.analysis) — renderowana
do PDF przez route /cases/[id]/opinion/spoofing.
"""
import io
import json
import os
import sys
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from engine.loader import load_rows  # noqa: E402
from engine.orderbook import parse_orderbook  # noqa: E402
from engine.settings import SHEET_ORDERS, SHEET_TRANSACTIONS  # noqa: E402
from engine.spoofing import detect_layering  # noqa: E402

BASE = (os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL") or "").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
AUTH = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}

# Szczegółowe sekwencje zleceń trzymamy tylko dla najsilniejszych dni (payload jsonb).
DETAIL_TOP = 12


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

            # Plik UTP: z body albo auto-rozpoznany z akt (DANE_UTP, główny „Transakcje_i_Zlecenia").
            storage_path = body.get("storagePath")
            if not storage_path:
                _, db = _req("GET", f"{BASE}/rest/v1/documents?case_id=eq.{case_id}&doc_type=eq.DANE_UTP&select=rel_path,storage_path")
                docs = json.loads(db or b"[]")
                cand = [d for d in docs if d.get("storage_path") and str(d.get("rel_path", "")).lower().endswith(".xlsx")]

                def _is_main(rp):
                    rp = rp.lower()
                    return "transakcje_i_zlecenia" in rp or ("transakcje" in rp and "zlecenia" in rp)

                pick = [d for d in cand if _is_main(str(d.get("rel_path", "")))] or cand
                if not pick:
                    self._json(400, {"ok": False, "error": "Brak głównego pliku UTP (Transakcje_i_Zlecenia) w aktach — wgraj dane transakcyjne."})
                    return
                storage_path = pick[0]["storage_path"]

            obj_url = f"{BASE}/storage/v1/object/case-files/{urllib.parse.quote(storage_path)}"
            _, data = _req("GET", obj_url)

            try:
                tx = load_rows(io.BytesIO(data), SHEET_TRANSACTIONS)
                zo = load_rows(io.BytesIO(data), SHEET_ORDERS)
            except KeyError:
                self._json(400, {"ok": False, "error": "Plik nie zawiera arkuszy 'Transakcje' i 'Zlecenia' — wybierz główny plik UTP (Transakcje_i_Zlecenia)."})
                return

            # group_fragments per sprawa (roster); brak → domyślne z settings.
            fragments = None
            try:
                _, rb = _req("GET", f"{BASE}/rest/v1/cases?id=eq.{case_id}&select=name,signature,group_roster")
                arr = json.loads(rb or b"[]")
                row = arr[0] if arr else {}
                gr = row.get("group_roster") or {}
                frs = gr.get("fragments")
                if isinstance(frs, list) and frs:
                    fragments = [str(x).strip().lower() for x in frs if str(x).strip()]
                case_name = row.get("name") or ""
                signature = row.get("signature") or ""
            except Exception:  # noqa: BLE001
                case_name, signature = "", ""

            res = detect_layering(zo, tx, fragments)

            # Przytnij szczegółowe sekwencje do najsilniejszych dni (reszta = tylko podsumowanie).
            manip = [d for d in res["days"] if d["manip"]]
            manip.sort(key=lambda x: -x["cancelled_buy"])
            keep = {d["day"] for d in manip[:DETAIL_TOP]}
            for d in res["days"]:
                if d["day"] not in keep:
                    d["orders"] = []

            # Opcjonalnie: tickowy „widok arkusza zleceń" w aktach → prawdziwe BestBid/BestAsk.
            # Wykrywamy kandydatów po nazwie (bez pliku uprawnień „widok" i głównego UTP),
            # parsujemy; jeśli dają kwotowania dla sesji — nadpisujemy serie. Inaczej fallback.
            book_source = False
            try:
                _, dbob = _req("GET", f"{BASE}/rest/v1/documents?case_id=eq.{case_id}&select=rel_path,storage_path")
                docs = json.loads(dbob or b"[]")

                def _is_ob(rp):
                    rp = rp.lower()
                    if "widok" in rp or "transakcje_i_zlecenia" in rp or not rp.endswith(".xlsx"):
                        return False
                    return any(k in rp for k in ["arkusz zlece", "arkusza zlece", "order book", "orderbook", "dziennik zlece", "kwotowa", "depth", "tick", "_l2", "best bid", "bestbid"])

                cands = [d for d in docs if d.get("storage_path") and _is_ob(str(d.get("rel_path", "")))][:3]
                book = None
                for c in cands:
                    _, bb = _req("GET", f"{BASE}/storage/v1/object/case-files/{urllib.parse.quote(c['storage_path'])}")
                    book = parse_orderbook(io.BytesIO(bb), want_days=keep)
                    if book:
                        break
                if book:
                    for d in res["days"]:
                        s, ob = d.get("series"), book.get(d["day"])
                        if s and ob:
                            s["bid"], s["ask"] = ob["bid"], ob["ask"]
                    book_source = True
            except Exception:  # noqa: BLE001
                pass

            # Matching engine (engine.spoofing.reconstruct_book) już policzył BestBid/BestAsk
            # z arkusza zleceń UTP — kwotowania są dostępne nawet bez zewnętrznego pliku tickowego.
            if not book_source:
                book_source = any(
                    (d.get("series") or {}).get("bid") and any(v is not None for v in d["series"]["bid"])
                    for d in res["days"]
                )

            analysis = {**res, "meta": {"caseName": case_name, "signature": signature, "book_source": book_source}}
            payload = [{
                "case_id": case_id,
                "kind": "spoofing_analysis",
                "chapter_no": "IV",
                "title": "Spoofing & Layering — analiza arkusza zleceń",
                "body_md": (
                    f"Wykryto {res['totals']['sessions_flagged']} sesji ze znamionami layering/spoofing "
                    f"(duże, w większości anulowane zlecenia kupna Grupy na wielu poziomach cen przy jednoczesnej "
                    f"sprzedaży). Łączny anulowany wolumen kupna: {res['totals']['cancelled_buy_total']:,} szt; "
                    f"warstw: {res['totals']['layer_orders_total']}. Detekcja deterministyczna na arkuszu zleceń UTP."
                ).replace(",", " "),
                "data": {"analysis": analysis},
                "status": "szkic",
            }]
            _req("POST", f"{BASE}/rest/v1/subanalyses?on_conflict=case_id,kind",
                 data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                 headers={"Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"})

            self._json(200, {"ok": True, "sessions": res["totals"]["sessions_flagged"],
                             "cancelled_buy": res["totals"]["cancelled_buy_total"],
                             "layers": res["totals"]["layer_orders_total"],
                             "entities": res["entities"]})
        except Exception as e:  # noqa: BLE001
            self._json(500, {"ok": False, "error": str(e)})

    def _json(self, code, obj):
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(json.dumps(obj, ensure_ascii=False).encode("utf-8"))
