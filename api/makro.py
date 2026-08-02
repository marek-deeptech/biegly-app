"""Funkcja serverless: moduł „otoczenie makroekonomiczne" opinii bankowej.

POST /api/makro  body: {"caseId": "...", "dzienZdarzenia": "YYYY-MM-DD"}

Buduje subanalizę `makro` z szeregów danych rynkowych w aktach (DANE_RYNKOWE_SZEREG).
Deterministycznie: parsowanie, statystyki i tabela to kod; model dostanie je gotowe
i ma je opisać prozą, a nie wyliczać.

⚠️ CZEGO NIE MA W AKTACH, TEGO NIE DOPISUJEMY
Biuletyny banków centralnych podają inflację i kursy CZĘSTO WYŁĄCZNIE JAKO WYKRESY —
w sprawie PO III Ds 84.2020 tak właśnie jest, a biegły przepisał je ze strony banku
centralnego. Funkcja raportuje, których szeregów w aktach nie ma jako danych,
zamiast pozwolić opinii powołać liczbę bez źródła.
"""
import json
import os
import sys
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from engine.szeregi import czytaj_csv, proba_miesieczna, statystyki  # noqa: E402

BASE = (os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL") or "").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
AUTH = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}

# Szeregi, których moduł makro oczekuje. Brak któregoś jest USTALENIEM opinii
# („w aktach nie ma danych o…"), a nie powodem do pominięcia tematu w milczeniu.
OCZEKIWANE = [
    ("indeks", ["icex", "indeks", "index", "wig", "omx"], "Indeks giełdowy kraju kontrahenta"),
    ("inflacja", ["cpi", "inflacj", "inflation"], "Inflacja konsumencka (CPI)"),
    ("kurs", ["kurs", "fx", "exchange", "eurisk", "usd", "eur"], "Kurs walutowy"),
    ("stopy", ["stop", "rate", "interest", "wibor", "libor"], "Stopy procentowe"),
]


def _req(method, url, data=None, headers=None):
    r = urllib.request.Request(url, data=data, method=method, headers={**AUTH, **(headers or {})})
    with urllib.request.urlopen(r, timeout=55) as resp:
        return resp.status, resp.read()


def _etykieta(nazwa):
    """Czytelna nazwa szeregu z nazwy pliku eksportu."""
    rdzen = nazwa.rsplit(".", 1)[0].strip()
    rdzen = rdzen.lstrip("^").replace("_d", "").replace("_", " ").strip()
    rdzen = rdzen.split("(")[0].strip()
    znane = {
        "icex": "Indeks giełdowy ICEX (Islandia)",
        "omx": "Indeks giełdowy OMX",
        "wig": "Indeks WIG",
    }
    for k, v in znane.items():
        if k in rdzen.lower():
            return v
    return rdzen or nazwa


def _fmt(v):
    s = f"{v:,.2f}".replace(",", " ").replace(".", ",")
    return s[:-3] if s.endswith(",00") else s

def _zachowaj_proze(case_id, kind):
    """Zwraca (body_md, czy_byla_proza) dla istniejącej subanalizy.

    ⚠️ POWÓD: upsert wysyłał `body_md: ""` i przy KAŻDYM ponownym przeliczeniu
    kasował gotową prozę rozdziału. Biegły redagował rozdział, potem uruchamiał
    krok liczbowy jeszcze raz — i tekst znikał bez ostrzeżenia. Zaobserwowane
    wprost: trzy zredagowane rozdziały opinii MBR wyzerowały się po dodaniu metryk.

    Prozy nie kasujemy, ale ZNACZYMY, że opisuje wcześniejszy odczyt: tekst opisujący
    liczby sprzed przeliczenia jest gorszy niż brak tekstu, bo wygląda na aktualny.
    """
    try:
        _, b = _req("GET", f"{BASE}/rest/v1/subanalyses?case_id=eq.{case_id}&kind=eq.{kind}&select=body_md")
        arr = json.loads(b or b"[]")
        tresc = (arr[0].get("body_md") or "") if arr else ""
        return tresc, bool(tresc.strip())
    except Exception:  # noqa: BLE001
        return "", False


def policz(case_id, dzien=None):
    try:
        _, cb = _req("GET", f"{BASE}/rest/v1/cases?id=eq.{case_id}&select=name,typ")
        arr = json.loads(cb or b"[]")
        if not arr:
            return (404, {"ok": False, "error": "Nie znaleziono sprawy."})
        if (arr[0].get("typ") or "") != "ryzyko_bankowe":
            return (409, {"ok": False, "error": "Moduł makro dotyczy wyłącznie spraw o ryzyko bankowe."})

        _, db = _req("GET", f"{BASE}/rest/v1/documents?case_id=eq.{case_id}"
                            f"&doc_type=eq.DANE_RYNKOWE_SZEREG&select=rel_path,storage_path")
        docs = [d for d in json.loads(db or b"[]") if d.get("storage_path")]

        szeregi, odrzucone = [], []
        for d in docs:
            nazwa = d["rel_path"].split("/")[-1]
            if not nazwa.lower().endswith(".csv"):
                # .xls (OLE2) i .xlsx z pojedynczymi komórkami nie są szeregami —
                # mówimy o tym wprost zamiast wpuszczać śmieci do tabeli.
                odrzucone.append(f"{nazwa}: nie jest szeregiem w formacie CSV")
                continue
            obj = f"{BASE}/storage/v1/object/case-files/{urllib.parse.quote(d['storage_path'])}"
            _, dane = _req("GET", obj)
            # Nazwa serii dla tytułu wykresu i tabeli: nazwa pliku bywa techniczna
            # („^icex_d (1).csv"), a w opinii sądowej tytuł musi coś znaczyć.
            etykieta = _etykieta(nazwa)
            s = czytaj_csv(dane, etykieta)
            if not s:
                odrzucone.append(f"{nazwa}: nie rozpoznano kolumn data/wartość")
                continue
            szeregi.append(s)

        if not szeregi:
            return (422, {
                "ok": False,
                "error": "W aktach nie ma szeregów danych rynkowych w formacie nadającym się do analizy. "
                         "Sprawdź pliki oznaczone jako DANE_RYNKOWE_SZEREG.",
                "odrzucone": odrzucone,
            })

        tabele, findings, opis = [], [], []
        for s in szeregi:
            st = statystyki(s, dzien)
            if not st:
                continue
            m = proba_miesieczna(s)
            tabele.append({
                "caption": f"Tabela. {s.nazwa} — notowania na koniec miesiąca ({st.od} – {st.do})",
                "head": ["Miesiąc", "Wartość"],
                "rows": [[p.dzien, _fmt(p.wartosc)] for p in m],
            })
            opis.append({
                "szereg": s.nazwa, "od": st.od, "do": st.do, "obserwacji": st.obserwacji,
                "szczyt": {"dzien": st.szczyt.dzien, "wartosc": st.szczyt.wartosc},
                "dolek": {"dzien": st.dolek.dzien, "wartosc": st.dolek.wartosc},
                "w_dniu": ({"dzien": st.w_dniu.dzien, "wartosc": st.w_dniu.wartosc} if st.w_dniu else None),
            })
            findings.append(
                f"{s.nazwa}: {st.obserwacji} notowań od {st.od} do {st.do}; "
                f"szczyt {_fmt(st.szczyt.wartosc)} ({st.szczyt.dzien}), "
                f"dołek {_fmt(st.dolek.wartosc)} ({st.dolek.dzien}); zmiana w okresie {st.zmiana_pct:+.1f}%."
            )
            if st.w_dniu:
                od_szczytu = 100.0 * (st.w_dniu.wartosc - st.szczyt.wartosc) / st.szczyt.wartosc
                findings.append(
                    f"{s.nazwa} w dniu ocenianego zdarzenia ({st.w_dniu.dzien}): {_fmt(st.w_dniu.wartosc)} — "
                    f"{od_szczytu:+.1f}% względem szczytu z {st.szczyt.dzien}. "
                    f"Wartość dostępna publicznie w dniu decyzji."
                )

        # Szeregi oczekiwane, których w aktach NIE MA — to ustalenie, nie milczenie.
        obecne = " ".join(s.nazwa.lower() for s in szeregi)
        # Brak formułujemy ZDANIEM, nie etykietą. Sama etykieta („Inflacja konsumencka
        # (CPI)") wędruje do Wniosków i czyta się tam jak ustalenie, a nie jak luka —
        # czyli mówi coś przeciwnego do tego, co znaczy.
        braki = [
            f"W aktach nie ma szeregu danych: {etykieta}. Powołanie takiej wartości w opinii "
            f"wymaga wskazania źródła spoza akt."
            for _, frazy, etykieta in OCZEKIWANE
            if not any(f in obecne for f in frazy)
        ]

        # Szeregi rynkowe jako metryki — z tego samego powodu co pozycje sprawozdań:
        # bez nich poziom indeksu w dniu decyzji jest w opinii liczbą nie do sprawdzenia.
        metryki = []
        for s_, o_ in zip(szeregi, opis):
            st_ = statystyki(s_, dzien)
            if st_:
                metryki.append({
                    "case_id": case_id, "key": "makro_zmiana_pct", "label": f"{s_.nazwa} — zmiana w okresie",
                    "value": st_.zmiana_pct, "unit": "%", "target": None, "session_day": st_.do,
                })
                if st_.w_dniu and st_.szczyt.wartosc:
                    metryki.append({
                        "case_id": case_id, "key": "makro_od_szczytu_pct",
                        "label": f"{s_.nazwa} — odchylenie od szczytu w dniu zdarzenia",
                        "value": round(100.0 * (st_.w_dniu.wartosc - st_.szczyt.wartosc) / st_.szczyt.wartosc, 2),
                        "unit": "%", "target": None, "session_day": st_.w_dniu.dzien,
                    })
            for kod, pkt in (("szczyt", o_["szczyt"]), ("dolek", o_["dolek"]), ("w_dniu", o_["w_dniu"])):
                if not pkt:
                    continue
                metryki.append({
                    "case_id": case_id, "key": f"makro_{kod}", "label": f"{s_.nazwa} — {kod}",
                    "value": pkt["wartosc"], "unit": "", "target": None, "session_day": pkt["dzien"],
                })
        _req("DELETE", f"{BASE}/rest/v1/metrics?case_id=eq.{case_id}&key=like.makro_*")
        for i in range(0, len(metryki), 100):
            _req("POST", f"{BASE}/rest/v1/metrics", json.dumps(metryki[i:i + 100]).encode(),
                 {"Content-Type": "application/json", "Prefer": "return=minimal"})

        proza, byla = _zachowaj_proze(case_id, "makro")
        sub = {
            "case_id": case_id, "kind": "makro", "chapter_no": "V",
            "title": "Otoczenie makroekonomiczne",
            "status": "szkic", "body_md": proza,
            "data": {
                "tables": tabele,
                "table": tabele[0] if tabele else None,
                "findings": findings,
                "szeregi": opis,
                "braki": braki,
                "odrzucone": odrzucone,
                "dzienZdarzenia": dzien,
                "proza_sprzed_przeliczenia": byla,
            },
        }
        _req("POST", f"{BASE}/rest/v1/subanalyses?on_conflict=case_id,kind",
             json.dumps(sub, ensure_ascii=False).encode(),
             {"Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"})

        return (200, {"ok": True, "szeregow": len(szeregi), "tabel": len(tabele),
                      "braki": braki, "odrzucone": odrzucone})
    except KeyError as e:
        return (400, {"ok": False, "error": f"Brak pola: {e}"})
    except Exception as e:  # noqa: BLE001
        return (500, {"ok": False, "error": str(e)})


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("content-length", 0))
        b = json.loads(self.rfile.read(length) or b"{}")
        kod, payload = policz(b.get("caseId"), (b.get("dzienZdarzenia") or "").strip() or None)
        self._json(kod, payload)

    def _json(self, code, payload):
        b = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)


if __name__ == "__main__":
    kod, payload = policz(sys.argv[1] if len(sys.argv) > 1 else "",
                          sys.argv[2] if len(sys.argv) > 2 else None)
    print(kod, json.dumps(payload, ensure_ascii=False, indent=1))
