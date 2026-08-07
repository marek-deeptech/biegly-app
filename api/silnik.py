"""JEDYNA funkcja serverless silnika — dyspozytor do modułów `engine/uslugi/*`.

DLACZEGO JEDNA ZAMIAST OŚMIU
Vercel liczy każdy plik `.py` w `api/` jako osobną funkcję serverless. Plan Hobby
dopuszcza dwanaście łącznie z trasami Next.js, a osiem modułów Pythona zjadało
dwie trzecie limitu — build padał na „No more than 12 Serverless Functions".

ADRESY POZOSTAJĄ BEZ ZMIAN. `vercel.json` przepisuje `/api/bank` → `/api/silnik?fn=bank`,
więc klient dalej woła te same ścieżki i nie zmieniła się ani jedna linijka w aplikacji.

JAK TO DZIAŁA — BEZ PRZEPISYWANIA MODUŁÓW
Moduły odpowiadają na żądanie w `handler.do_POST`, korzystając wyłącznie z pól
dostępnych w każdym `BaseHTTPRequestHandler` (`self.headers`, `self.rfile`) oraz
z własnego `_json`. Dyspozytor wywołuje więc ICH `do_POST` na SOBIE — jak metodę
niezwiązaną. Dzięki temu ciała modułów zostały nietknięte: przepisywanie ośmiu
funkcji na wspólny interfejs byłoby zmianą ryzykowną w kodzie, który liczy dowody
w sprawach karnych, a zysk byłby żaden.
"""
import importlib
import json
import urllib.parse
from http.server import BaseHTTPRequestHandler

# Biała lista — nazwa z zapytania NIE jest ścieżką importu. Bez niej `fn=../../coś`
# albo dowolny moduł z sys.path dałby się zaimportować i uruchomić.
USLUGI = {
    "analyze": "engine.uslugi.analyze",
    "bank": "engine.uslugi.bank",
    "ip": "engine.uslugi.ip",
    "makro": "engine.uslugi.makro",
    "spoofing": "engine.uslugi.spoofing",
    "sygnaly": "engine.uslugi.sygnaly",
    "trem": "engine.uslugi.trem",
    "wskazniki": "engine.uslugi.wskazniki",
}


class handler(BaseHTTPRequestHandler):
    def _nazwa(self):
        """Nazwa usługi z `?fn=` albo z ostatniego segmentu ścieżki.

        Dwa źródła, bo `rewrites` podaje ją w zapytaniu, a bezpośrednie wywołanie
        `/api/silnik/bank` (np. z curl przy diagnostyce) w ścieżce.
        """
        rozbite = urllib.parse.urlparse(self.path or "")
        fn = (urllib.parse.parse_qs(rozbite.query).get("fn") or [""])[0].strip()
        if not fn:
            czesci = [c for c in (rozbite.path or "").split("/") if c]
            if czesci and czesci[-1] not in ("silnik", "api"):
                fn = czesci[-1]
        return fn

    def _json(self, code, payload):
        b = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        # `/api/silnik` bez nazwy = health check (zastąpił dawne `api/health.py`).
        fn = self._nazwa()
        if not fn:
            self._json(200, {"ok": True, "uslugi": sorted(USLUGI)})
            return
        self._json(405, {"ok": False, "error": f"Usługa „{fn}” przyjmuje wyłącznie POST."})

    def do_POST(self):
        fn = self._nazwa()
        if fn not in USLUGI:
            # Nazwy nieznanej nie odsyłamy w treści — nie echujemy wejścia użytkownika.
            self._json(404, {"ok": False, "error": "Nieznana usługa silnika.",
                             "dostepne": sorted(USLUGI)})
            return
        modul = importlib.import_module(USLUGI[fn])
        # Wywołanie metody niezwiązanej: `self` to TEN handler, a ciało pochodzi
        # z modułu. Moduł zapisuje odpowiedź przez `self._json`, zdefiniowane wyżej.
        modul.handler.do_POST(self)
