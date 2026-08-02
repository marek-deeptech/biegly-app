"""Funkcja serverless: wskaźniki finansowe banku ze sprawozdań w Storage.

POST /api/bank  body: {"caseId": "...", "storagePaths": ["<id>/…", …]}  (ścieżki opcjonalne)

Reużywa `engine.sprawozdania` (odczyt pozycji) i `engine.bank` (wskaźniki) — deterministycznie,
bez modelu. Wynik zapisuje jako subanalizę `wskazniki_bank` oraz wiersze w `metrics`,
dzięki czemu audytor opinii może weryfikować liczby wobec wykazu metryk silnika.

⚠️ TA TRASA NIE DOTYCZY SPRAW O MANIPULACJĘ. Sprawdza `cases.typ` i odmawia pracy
dla innej dziedziny — tak jak /api/spoofing odmawia bez rostera Grupy. Wskaźnik
adekwatności policzony w sprawie manipulacyjnej byłby liczbą bez przedmiotu.
"""
import io
import json
import os
import sys
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dataclasses import fields as _pola_dataclass  # noqa: E402

from engine.bank import Pozycje, szereg, wskazniki, zmiany  # noqa: E402

# Nazwy pól scalanych między sprawozdaniami — z definicji dataclass, nie przepisane,
# żeby dodanie pozycji do modelu nie wymagało pamiętania o tym miejscu.
POLA_POZYCJI = [f.name for f in _pola_dataclass(Pozycje) if f.name not in ("dzien", "waluta")]
from engine.sprawozdania import (  # noqa: E402
    czytaj_pdf,
    GRUPY,
    sprawdz_bilans,
    strony_pol,
    zestawienie,
    sprawdz_spojnosc,
    uzupelnij_z_tozsamosci,
    zbuduj_pozycje,
)

BASE = (os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL") or "").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
AUTH = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}


def _req(method, url, data=None, headers=None):
    req = urllib.request.Request(url, data=data, method=method, headers={**AUTH, **(headers or {})})
    with urllib.request.urlopen(req, timeout=55) as r:
        return r.status, r.read()


def _fmt(v):
    """Liczba w zapisie polskim, bez zbędnych zer po przecinku."""
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


def policz(case_id, paths=None):
    """Rdzeń analizy — wspólny dla trasy HTTP i uruchomienia z konsoli.

    Wydzielony, bo funkcja serverless jest nietestowalna: żeby sprawdzić liczby,
    trzeba by postawić serwer. Zwraca (kod_http, payload) — handler tylko to opakowuje.
    """
    if True:
        try:
            body = {"caseId": case_id, "storagePaths": paths or []}

            # DZIEDZINA — twarda bramka. Ta trasa liczy adekwatność kapitałową;
            # w sprawie o manipulację instrumentem finansowym nie ma czego liczyć.
            _, cb = _req("GET", f"{BASE}/rest/v1/cases?id=eq.{case_id}&select=name,typ")
            arr = json.loads(cb or b"[]")
            if not arr:
                return (404, {"ok": False, "error": "Nie znaleziono sprawy."})
            if (arr[0].get("typ") or "") != "ryzyko_bankowe":
                return (409, {
                    "ok": False,
                    "error": "Ta analiza dotyczy wyłącznie spraw o ryzyko bankowe. "
                             "Sprawa ma inną dziedzinę — wskaźniki adekwatności byłyby liczbą bez przedmiotu.",
                })

            # Sprawozdania: z body albo wszystkie z akt (szereg czasowy wymaga min. dwóch okresów).
            paths = body.get("storagePaths") or []
            if not paths:
                _, db = _req("GET", f"{BASE}/rest/v1/documents?case_id=eq.{case_id}"
                                    f"&doc_type=eq.SPRAWOZDANIE_BANK&select=rel_path,storage_path")
                docs = json.loads(db or b"[]")
                paths = [d["storage_path"] for d in docs
                         if d.get("storage_path") and str(d.get("rel_path", "")).lower().endswith(".pdf")]
            if not paths:
                return (400, {"ok": False, "error": "Brak sprawozdań finansowych (SPRAWOZDANIE_BANK) w aktach."})

            # Izolacja spraw — plik musi należeć do TEJ sprawy.
            for p in paths:
                if not str(p).startswith(f"{case_id}/"):
                    return (403, {"ok": False, "error": "Plik nie należy do tej sprawy."})

            # DWIE RÓŻNE KATEGORIE, celowo nie w jednej liście:
            # `uwagi`        — wartość doliczona z tożsamości. Jest UŻYTECZNA, wymaga tylko
            #                  ujawnienia, skąd pochodzi.
            # `zastrzezenia` — odczyt jest NIEWIARYGODNY (bilans się nie domyka, składnik
            #                  większy od całości, powielona kolumna). Na takiej wartości
            #                  nie wolno oprzeć wniosku.
            # Zlane w jedną listę osłabiały się nawzajem: 14 rutynowych dopełnień topiło
            # 4 realne błędy odczytu, a do Wniosków szło hurtem „nie opieraj się na tym".
            pozycje, uwagi, zastrzezenia, zrodla = [], [], [], []
            # Miejsce odczytu każdej pozycji — do kolumny „Źródło" w rozdziale
            # o sprawozdaniach. Nazwę pliku dopisujemy tylko przy wielu sprawozdaniach,
            # bo inaczej „str. 47" nie wskazuje jednoznacznie żadnego dokumentu.
            miejsca = {}
            for p in paths:
                obj = f"{BASE}/storage/v1/object/case-files/{urllib.parse.quote(p)}"
                _, data = _req("GET", obj)
                tmp = f"/tmp/{os.path.basename(p).replace('/', '_')}"
                with open(tmp, "wb") as fh:
                    fh.write(data)
                try:
                    odczyt = czytaj_pdf(tmp)
                finally:
                    try:
                        os.remove(tmp)
                    except OSError:
                        pass
                poz = zbuduj_pozycje(odczyt, uwagi=uwagi)
                if not poz:
                    uwagi.append(f"{os.path.basename(p)}: nie rozpoznano kolumn dat — pominięto")
                    continue
                uwagi += uzupelnij_z_tozsamosci(odczyt, poz)
                zastrzezenia += sprawdz_spojnosc(odczyt, poz)
                for pole, gdzie in strony_pol(odczyt, os.path.basename(p) if len(paths) > 1 else "").items():
                    miejsca.setdefault(pole, gdzie)
                strony = sorted({k.strona for k in odczyt.kandydaci})
                zrodla.append({"plik": os.path.basename(p), "strony": strony[:12],
                               "okresy": [x.dzien for x in poz]})
                pozycje += poz

            if not pozycje:
                return (422, {
                    "ok": False,
                    "error": "Ze sprawozdań nie udało się odczytać pozycji. Sprawdź, czy PDF-y mają "
                             "warstwę tekstową (skan wymaga OCR — patrz scripts/ocr_akta.py).",
                })

            # Ten sam okres w dwóch sprawozdaniach — scalamy POLE PO POLU, a nie
            # „pierwszy plik wygrywa".
            #
            # ⚠️ POWÓD: sprawozdanie za I półrocze 2008 podaje kolumnę porównawczą
            # 31.12.2007, ale nie wszystkie pozycje da się z niej odczytać; pełne
            # sprawozdanie roczne za 2007 ma je w tabeli głównej. Odrzucanie całego
            # dnia jako „już widzianego" wyrzucało prawidłowe wartości: aktywa
            # Glitnira na 31.12.2007 (2 948 910) były odczytane, po czym ginęły,
            # a w tabeli zostawała liczba z tabeli kwartalnej.
            # Pierwsze źródło nadal ma pierwszeństwo dla pola, które już wypełniło —
            # scalanie tylko UZUPEŁNIA luki, nie nadpisuje odczytów.
            wg_dnia: dict[str, Pozycje] = {}
            for p in pozycje:
                cel = wg_dnia.get(p.dzien)
                if cel is None:
                    wg_dnia[p.dzien] = p
                    continue
                for pole in POLA_POZYCJI:
                    if getattr(cel, pole, None) is None and getattr(p, pole, None) is not None:
                        setattr(cel, pole, getattr(p, pole))
            unikalne = [wg_dnia[d] for d in sorted(wg_dnia)]
            widziane = set(wg_dnia)

            s = szereg(unikalne)
            okresy = sorted(widziane)

            # Tabela: wiersz na wskaźnik, kolumna na okres — postać, w jakiej rozdział
            # „Współczynniki kapitałowe w czasie" wchodzi do opinii.
            head = ["Wskaźnik"] + okresy + ["Zmiana", "Próg", "Podstawa progu"]
            rows, metryki = [], []
            for kod, seria in s.items():
                wg_dnia = {w.dzien: w for w in seria}
                ostatni = seria[-1]
                zm = zmiany(seria)
                rows.append([
                    ostatni.nazwa,
                    *[(f"{_fmt(wg_dnia[d].wartosc)} {wg_dnia[d].jednostka}" if d in wg_dnia else "—") for d in okresy],
                    (f"{zm[-1][1]:+.2f} p.p." if zm else "—"),
                    (f"{_fmt(ostatni.prog)}%" if ostatni.prog is not None else "—"),
                    ostatni.podstawa_progu or "brak progu w tym stanie prawnym",
                ])
                for w in seria:
                    metryki.append({
                        "case_id": case_id, "key": f"bank_{w.kod}", "label": w.nazwa,
                        "value": w.wartosc, "unit": w.jednostka, "target": w.prog,
                        "session_day": w.dzien,
                    })

            # Ostrzeżenia arytmetyczne (udział > 100%) trafiają do uwag razem z uwagami
            # odczytu — biegły ma je zobaczyć w tym samym miejscu.
            for pz in unikalne:
                for w in wskazniki(pz):
                    if w.ostrzezenie:
                        zastrzezenia.append(f"{w.dzien}: {w.nazwa} — {w.ostrzezenie}")

            ponizej = [w for p in unikalne for w in wskazniki(p) if w.spelniony is False]
            findings = [
                f"{w.dzien}: {w.nazwa} = {_fmt(w.wartosc)}{w.jednostka} — poniżej progu "
                f"{_fmt(w.prog)}% ({w.podstawa_progu})"
                for w in ponizej
            ]

            zest = zestawienie(unikalne, miejsca)
            # Kontrola pozycji bilansowych — inna niż kontrola kapitału, bo bilans
            # i wynik nie są przypięte do jednej strony i kolumna potrafi się rozjechać
            # przy scalaniu dwóch sprawozdań. Uwagi idą do OBU rozdziałów: wskaźniki
            # liczą się z tych samych odczytów.
            zastrzezenia += sprawdz_bilans(unikalne)
            # POZYCJE SPRAWOZDAŃ TEŻ SĄ METRYKAMI.
            # `metrics` jest w aplikacji zadeklarowanym źródłem prawdy dla liczb — audytor
            # i kontroler opinii sprawdzają w nim każdą wartość z tekstu. Dopóki trafiały
            # tam wyłącznie wskaźniki procentowe, kwoty (aktywa, RWA, fundusze własne)
            # były w opinii NIEWERYFIKOWALNE: audyt zgłaszał je hurtem jako niepotwierdzone,
            # choć pochodziły wprost z odczytu sprawozdań.
            for pz in unikalne:
                for pole, etykieta in [(f, e) for _, pola in GRUPY for f, e in pola]:
                    v = getattr(pz, pole, None)
                    if v is None:
                        continue
                    metryki.append({
                        "case_id": case_id, "key": f"bank_poz_{pole}", "label": etykieta,
                        "value": v, "unit": "", "target": None, "session_day": pz.dzien,
                    })

            # PRZELICZENIA TEŻ SĄ LICZBAMI, KTÓRE OPINIA CYTUJE.
            # Audyt zgłaszał dynamiki (+72,0%, +62,2%) jako niepotwierdzone, choć składniki
            # bazowe były w wykazie — bo `metrics` miało tylko poziomy. Liczba wyliczona
            # przez silnik ma być tak samo sprawdzalna jak odczytana.
            for w_ in zest["rows"]:
                if not w_[1] or w_[-2] in ("—", ""):
                    continue
                try:
                    v = float(w_[-2].replace("%", "").replace("+", "").replace(",", ".").strip())
                except ValueError:
                    continue
                metryki.append({
                    "case_id": case_id, "key": "bank_zmiana_pozycji", "label": f"{w_[0]} — zmiana",
                    "value": v, "unit": "%", "target": None, "session_day": okresy[-1],
                })

            # Metryki nadpisujemy w całości: ponowne uruchomienie ma dać ten sam stan,
            # a nie dokleić drugi komplet wierszy.
            _req("DELETE", f"{BASE}/rest/v1/metrics?case_id=eq.{case_id}&key=like.bank_*")
            for i in range(0, len(metryki), 100):
                _req("POST", f"{BASE}/rest/v1/metrics",
                     json.dumps(metryki[i:i + 100]).encode(),
                     {"Content-Type": "application/json", "Prefer": "return=minimal"})

            proza_w, byla_w = _zachowaj_proze(case_id, "wskazniki_bank")
            sub = {
                "case_id": case_id,
                "kind": "wskazniki_bank",
                "chapter_no": "V",
                "title": "Współczynniki kapitałowe i sytuacja finansowa w czasie",
                "status": "szkic",
                "data": {
                    "table": {"caption": "Tabela. Wskaźniki finansowe w szeregu czasowym",
                              "head": head, "rows": rows},
                    "okresy": okresy,
                    "zrodla": zrodla,
                    "uwagi": uwagi,
                    "zastrzezenia": zastrzezenia,
                    "findings": findings,
                    "proza_sprzed_przeliczenia": byla_w,
                },
                "body_md": proza_w,
            }
            _req("POST", f"{BASE}/rest/v1/subanalyses?on_conflict=case_id,kind",
                 json.dumps(sub).encode(),
                 {"Content-Type": "application/json",
                  "Prefer": "resolution=merge-duplicates,return=minimal"})

            # ── Rozdział o sprawozdaniach: KWOTY, nie wskaźniki ──
            # Wskaźnik jest ilorazem i ukrywa skalę — udział depozytów 22% nie mówi,
            # czy bank urósł dwukrotnie, czy skurczył się o połowę. Ta sama lektura
            # PDF-ów zasila oba rozdziały, więc nie kosztuje dodatkowego odczytu.
            proza_s, byla_s = _zachowaj_proze(case_id, "sprawozdania")
            sub_spr = {
                "case_id": case_id,
                "kind": "sprawozdania",
                "chapter_no": "V",
                "title": "Analiza sprawozdań finansowych kontrahenta",
                "status": "szkic",
                "data": {
                    "table": {k: zest[k] for k in ("caption", "head", "rows")},
                    "okresy": zest["okresy"],
                    "zrodla": zrodla,
                    "uwagi": uwagi,
                    "zastrzezenia": zastrzezenia,
                    "findings": zest["findings"] or [
                        "Odczytano pozycje sprawozdań, ale żadna nie zmieniła się o więcej niż 20% "
                        "między skrajnymi okresami."
                    ],
                    "proza_sprzed_przeliczenia": byla_s,
                },
                "body_md": proza_s,
            }
            _req("POST", f"{BASE}/rest/v1/subanalyses?on_conflict=case_id,kind",
                 json.dumps(sub_spr, ensure_ascii=False).encode(),
                 {"Content-Type": "application/json",
                  "Prefer": "resolution=merge-duplicates,return=minimal"})

            return (200, {"ok": True, "okresy": okresy, "wskaznikow": len(rows),
                             "pozycji_sprawozdan": len([r for r in zest["rows"] if r[1]]),
                             "ponizej_progu": len(findings), "uwagi": uwagi,
                             "zastrzezenia": zastrzezenia, "zrodla": zrodla})
        except KeyError as e:
            return (400, {"ok": False, "error": f"Brak pola: {e}"})
        except Exception as e:  # noqa: BLE001
            return (500, {"ok": False, "error": str(e)})


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("content-length", 0))
        b = json.loads(self.rfile.read(length) or b"{}")
        kod, payload = policz(b.get("caseId"), b.get("storagePaths"))
        self._json(kod, payload)


    def _json(self, code, payload):
        b = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)


if __name__ == "__main__":
    # Uruchomienie z konsoli: python3 api/bank.py <case_id>
    kod, payload = policz(sys.argv[1] if len(sys.argv) > 1 else "")
    print(kod, json.dumps(payload, ensure_ascii=False, indent=1))
