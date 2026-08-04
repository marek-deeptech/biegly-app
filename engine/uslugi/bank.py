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

# Katalog repozytorium — o dwa poziomy wyżej niż ten plik (engine/uslugi/…).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from dataclasses import fields as _pola_dataclass  # noqa: E402

from engine.bank import Pozycje, prog_na_dzien, szereg, wskazniki, zmiany  # noqa: E402
from engine.przeklad_bps import wartosci_wykazane  # noqa: E402
from engine.analiza_ekonomiczna import (  # noqa: E402
    OBSZARY,
    OPIS_OCENY,
    ROZBIEZNOSC_WAGI,
    WSKAZNIKI_EF,
    brakujace_pozycje,
    ocena_czastkowa,
    ocena_globalna,
    punktacja,
    wartosc as wartosc_ef,
    bufor_do_progu,
    rwa_implikowane,
    wskaznik_czastkowy,
    wskaznik_syntetyczny,
    zestaw_oceny,
)
from engine.chronologia import (  # noqa: E402
    OkresNadzorczy,
    jako_pozycje,
    wykazane_wspolczynniki,
)

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


# Lustro `ROLE[*].tytulKwot` z lib/domain/rola.ts. Trzy napisy powielone przez granicę
# TS/Python — tak jak reszta mostów silnika; źródłem prawdy jest moduł TypeScriptowy.
TYTUL_KWOT = {
    "ocena_kontrahenta": "Analiza sprawozdań finansowych kontrahenta",
    "nadzor_nad_bankiem": "Wielkości bilansowe banku w okresach sprawozdawczych",
    "organy_banku": "Analiza sprawozdań finansowych banku",
}


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


def _z_chronologii(case_id):
    """Okresy zapisane przez moduł chronologii nadzorczej — gałąź zapasowa odczytu.

    Akta bywają bez sprawozdań z badanego okresu: w sprawie SK Banku jedyne dwa
    pochodzą z 2019 r., z postępowania upadłościowego, a pytanie dotyczy lat
    2012–2015. Wielkości bilansowe z tamtych lat są w harmonogramie działań
    nadzorczych i moduł chronologii już je odczytał — nie ma powodu, by zakładka
    wskaźników pokazywała pustkę, skoro liczby leżą w tej samej sprawie.

    Zwraca ([], [], "") także wtedy, gdy chronologii nie uruchomiono — brak danych
    nie może udawać zera.
    """
    try:
        _, b = _req("GET", f"{BASE}/rest/v1/subanalyses?case_id=eq.{case_id}"
                           f"&kind=eq.chronologia_nadzoru&select=data")
        arr = json.loads(b or b"[]")
    except Exception:  # noqa: BLE001
        return [], [], ""
    if not arr:
        return [], [], ""
    surowe = (arr[0].get("data") or {}).get("okresy") or []
    if not surowe:
        return [], [], ""
    pola = {f.name for f in _pola_dataclass(OkresNadzorczy)}
    okresy = [OkresNadzorczy(**{k: v for k, v in o.items() if k in pola}) for o in surowe if o.get("dzien")]
    # Sortowanie NUMERYCZNE: po tekście „str. 14" wypadało przed „str. 7".
    strony = {o.zrodlo for o in okresy if o.zrodlo}
    def _nr(t):
        cyfry = "".join(c for c in t if c.isdigit())
        return int(cyfry) if cyfry else 0
    return jako_pozycje(okresy), wykazane_wspolczynniki(okresy), ", ".join(sorted(strony, key=_nr))


def analiza_ekonomiczna(case_id, unikalne, okresy, wykazane=(), z_ocen=None):
    """Rubryka 16 wskaźników w 4 obszarach — z rejestrem tego, czego policzyć NIE MOŻNA.

    ⚠️ REJESTR BRAKÓW JEST TU RÓWNIE WAŻNY JAK TABELA. W sprawie SK Banku dziesięciu
    z szesnastu wskaźników nie da się policzyć, bo akta nie zawierają pozycji
    sprawozdawczych, których wymagają (aktywa pracujące, rezerwy wymagane, pasywa
    niestabilne, depozyty stabilne…). To nie jest usterka aplikacji, tylko ustalenie
    o materiale dowodowym — i gotowa treść wniosku do sądu. Tabela pokazująca sześć
    wskaźników bez powiedzenia, że brakuje dziesięciu, sugerowałaby, że analiza
    jest kompletna.
    """
    wiersze, braki_pol, policzone, wykazane_kody = [], {}, set(), set()
    # Ile OKRESÓW nie ma danej pozycji. Zliczanie samego faktu braku mieszało dwie
    # różne rzeczy: pozycję nieobecną w aktach w ogóle (aktywa pracujące) z pozycją
    # obecną prawie wszędzie (suma bilansowa brakuje wyłącznie na 30.09.2014).
    # We wniosku do sądu to jest różnica między „proszę o dokument" a „proszę
    # o uzupełnienie jednego okresu".
    # ZBIÓR OKRESÓW, nie licznik trafień: ta sama pozycja bywa potrzebna kilku
    # wskaźnikom, więc zliczanie par (wskaźnik, okres) dawało liczby większe niż
    # liczba okresów i „brak w 5 okresach" przy dwóch okresach w sprawie.
    # Wartości WYKAZANE PRZEZ BANK ZRZESZAJĄCY — wypełniają rubrykę tam, gdzie
    # z pozycji sprawozdawczych policzyć się nie da (a w tej sprawie nie da się
    # w dwunastu wierszach na szesnaście, bo akta pozycji nie zawierają).
    #
    # ⚠️ OZNACZONE GWIAZDKĄ, NIE WMIESZANE. Wartość policzona przez biegłego to
    # ustalenie własne; wartość przepisana z oceny BPS to ustalenie o TREŚCI
    # DOKUMENTU. W tej sprawie różnica jest istotą rzeczy: bank wykazywał
    # współczynnik wypłacalności 13,84% przy nietworzeniu wymaganych rezerw, więc
    # wartość wykazana bywa właśnie tym, co się kwestionuje. Tabela, która by je
    # zlała, przypisywałaby biegłemu cudze wyliczenie.
    zocen = z_ocen or {}
    # OŚ OKRESÓW RUBRYKI = okresy sprawozdań ∪ dni ocen BPS z ≥1 przetłumaczoną
    # wartością. ⚠️ POWÓD: oś budowana wyłącznie z okresów sprawozdań GUBIŁA dni
    # ocen spoza niej — ocena na 31.03.2014 niosła 12 wartości rubryki (w tym trzy
    # wskaźniki płynności), a kolumny nie było, więc wartości nie miały gdzie wejść.
    # Dzień oceny bez żadnej przetłumaczonej wartości kolumny NIE tworzy: kolumna
    # samych „—" niczego nie ustala.
    dni_ocen = {d for wart in zocen.values() for d in wart}
    os_okresow = sorted(set(okresy) | dni_ocen)
    wg_dnia_poz = {pz.dzien: pz for pz in unikalne}
    wykazanych = 0
    okresy_bez = {}
    for w in WSKAZNIKI_EF:
        kolumny, ma, ma_wyk = [], False, False
        for d in os_okresow:
            pz = wg_dnia_poz.get(d)
            v = wartosc_ef(w, pz) if pz is not None else None
            if v is None:
                zew = zocen.get(w.kod, {}).get(d)
                if zew is not None:
                    ma_wyk = True
                    wykazanych += 1
                    kolumny.append(f"{_fmt(zew)} %*")
                    continue
                # Rejestr braków dotyczy TREŚCI SPRAWOZDAŃ — dzień obecny w osi
                # wyłącznie dzięki ocenie BPS nie jest brakiem pozycji sprawozdawczej.
                if pz is not None:
                    for pole in brakujace_pozycje(w, pz):
                        braki_pol.setdefault(pole, set()).add(w.nazwa)
                        okresy_bez.setdefault(pole, set()).add(d)
                kolumny.append("—")
            else:
                ma = True
                kolumny.append(f"{_fmt(v)} %")
        if ma:
            policzone.add(w.kod)
        if ma_wyk:
            wykazane_kody.add(w.kod)
        wiersze.append([OBSZARY[w.obszar], w.nazwa, f"{w.waga:.2f}".replace(".", ","), *kolumny])

    # Punktacja — wyłącznie tam, gdzie uchwała podaje przedziały. Poza tym milczymy.
    punkty, ostatni = {}, unikalne[-1] if unikalne else None
    if ostatni is not None:
        for w in WSKAZNIKI_EF:
            v = wartosc_ef(w, ostatni)
            if v is None:
                continue
            pkt = punktacja(w, v)
            if pkt is not None:
                punkty[w.kod] = pkt
    czastkowe = {o: wskaznik_czastkowy(o, punkty) for o in OBSZARY}
    czastkowe_pelne = {o: v for o, v in czastkowe.items() if v is not None}
    synt = wskaznik_syntetyczny(czastkowe_pelne)
    globalna = ocena_globalna(synt)

    obszary_stan = []
    for kod, nazwa in OBSZARY.items():
        wsz = [w for w in WSKAZNIKI_EF if w.obszar == kod]
        ile = len([w for w in wsz if w.kod in policzone])
        waga_pokryta = round(sum(w.waga for w in wsz if w.kod in policzone), 2)
        obszary_stan.append({
            "obszar": nazwa,
            "policzone": ile,
            "wszystkie": len(wsz),
            "waga_pokryta": waga_pokryta,
            "ocena": ocena_czastkowa(czastkowe.get(kod)),
        })

    n_okresow = len(unikalne)
    zamowienie = sorted(
        ({
            "pozycja": pole,
            "wskazniki": sorted(nazwy),
            # Pozycja brakująca we wszystkich okresach jest NIEOBECNA W AKTACH;
            # brakująca w części — obecna, ale niekompletna.
            "brak_zupelny": len(okresy_bez.get(pole, ())) >= n_okresow,
            "okresow_bez": len(okresy_bez.get(pole, ())),
        } for pole, nazwy in braki_pol.items()),
        key=lambda x: (not x["brak_zupelny"], -len(x["wskazniki"])),
    )
    # ── Odtworzenie aktywów ważonych ryzykiem ─────────────────────────────────
    # Współczynnika wypłacalności nie da się z akt POLICZYĆ (brak RWA), ale da się
    # odtworzyć mianownik z dwóch wartości wykazanych — a wtedy odpowiedzieć na
    # pytanie, o które w tej sprawie chodzi: jak duża korekta wyniku wystarczyłaby,
    # żeby bank przestał spełniać normę.
    wg_dnia_wyk = dict(wykazane)
    wiersze_rwa = []
    for pz in unikalne:
        wsp = wg_dnia_wyk.get(pz.dzien)
        rwa = rwa_implikowane(pz.fundusze_wlasne, wsp)
        if rwa is None:
            continue
        prog = prog_na_dzien("tcr", pz.dzien)
        bufor = bufor_do_progu(pz.fundusze_wlasne, wsp, prog.minimum) if prog else None
        wiersze_rwa.append([
            pz.dzien,
            _fmt(pz.fundusze_wlasne),
            f"{_fmt(wsp)} %",
            _fmt(rwa),
            (f"{_fmt(prog.minimum)} %" if prog else "—"),
            (_fmt(bufor) if bufor is not None else "—"),
        ])

    return {
        "table": {
            "caption": "Tabela. Analiza ekonomiczno-finansowa banku wg rubryki banku zrzeszającego",
            "head": ["Obszar", "Wskaźnik", "Waga", *os_okresow],
            "rows": wiersze,
        },
        "obszary": obszary_stan,
        "policzonych": len(policzone),
        "wszystkich": len(WSKAZNIKI_EF),
        "wskaznik_syntetyczny": synt,
        "ocena_globalna": globalna,
        "opis_oceny": OPIS_OCENY.get(globalna) if globalna else None,
        "braki": zamowienie,
        "rwa": {
            "caption": "Tabela. Odtworzone aktywa ważone ryzykiem i bufor funduszy własnych do progu",
            "head": ["Dzień", "Fundusze własne", "Wsp. wykazany", "RWA odtworzone",
                     "Próg", "Bufor do progu"],
            "rows": wiersze_rwa,
        },
        "uwagi": ([ROZBIEZNOSC_WAGI] if punkty else []) + ([
            f"Wartości oznaczone gwiazdką (*) — {wykazanych} odczytów w "
            f"{len(wykazane_kody)} wskaźnikach — NIE zostały policzone przez biegłego "
            "z pozycji sprawozdawczych, lecz PRZEPISANE Z OCEN BANKU ZRZESZAJĄCEGO, który "
            "liczył je własną metodyką na podstawie uchwały nr 12/14/AB/BS/2002. Są "
            "ustaleniem o TREŚCI DOKUMENTU — zrzeszający tak wykazał — a nie samodzielnym "
            "pomiarem biegłego, i dziedziczą wiarygodność swojego źródła."
        ] if wykazane_kody else []) + ([
            "Aktywa ważone ryzykiem odtworzono z funduszy własnych i WYKAZANEGO współczynnika "
            "wypłacalności — odtworzenie dziedziczy wiarygodność tych wartości i nie jest pomiarem "
            "niezależnym. Bufor do progu mówi, o ile mogłyby spaść fundusze własne (np. wskutek "
            "dotworzenia wymaganych rezerw), zanim współczynnik zszedłby poniżej normy."
        ] if wiersze_rwa else []),
    }


def _uniewaznij(case_id, uwagi):
    """Kasuje tabelę zapisaną przez WCZEŚNIEJSZY, udany odczyt, gdy bieżący nic nie dał.

    Prozy nie rusza: jeżeli biegły zredagował rozdział, tekst zostaje wraz ze
    znacznikiem `proza_sprzed_przeliczenia` — to on mówi, że opis dotyczy liczb,
    których już nie ma. Skasowanie cudzej pracy byłoby gorsze niż nieaktualna tabela;
    zmyślona tabela bez ostrzeżenia jest gorsza od obu.
    """
    for kind in ("wskazniki_bank", "sprawozdania"):
        proza, byla = _zachowaj_proze(case_id, kind)
        if not proza and not byla:
            # Pusty szkic po nieudanym odczycie nie ma czego opisywać — usuwamy go,
            # żeby rozdział nie figurował jako istniejący i policzony.
            _req("DELETE", f"{BASE}/rest/v1/subanalyses?case_id=eq.{case_id}&kind=eq.{kind}")
            continue
        _req("PATCH", f"{BASE}/rest/v1/subanalyses?case_id=eq.{case_id}&kind=eq.{kind}",
             json.dumps({"data": {"uwagi": uwagi, "odczyt_niepowiodl_sie": True,
                                  "proza_sprzed_przeliczenia": True}}).encode(),
             {"Content-Type": "application/json", "Prefer": "return=minimal"})
    # Metryki pochodzą z tego samego odczytu — nieaktualne muszą zniknąć razem z tabelą.
    # Klucz `bank_*` nadaje wyłącznie ten moduł (patrz `metryki.append` niżej), więc
    # kasowanie po prefiksie nie dotyka metryk z innych kroków sprawy.
    _req("DELETE", f"{BASE}/rest/v1/metrics?case_id=eq.{case_id}&key=like.bank\\_%25")


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
            _, cb = _req("GET", f"{BASE}/rest/v1/cases?id=eq.{case_id}&select=name,typ,rola")
            arr = json.loads(cb or b"[]")
            if not arr:
                return (404, {"ok": False, "error": "Nie znaleziono sprawy."})
            rola = arr[0].get("rola") or "ocena_kontrahenta"
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
            bez_pozycji = []   # pliki, z których nie wyszedł ani jeden okres
            # Uwagi w POSTACI DANYCH: plik + strona, żeby aplikacja dała odnośnik
            # wprost do miejsca w sprawozdaniu. Numer strony w samym zdaniu zmuszał
            # biegłego do szukania pliku i kartkowania.
            uwagi_zrodla = []
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
                z_pliku = []
                poz = zbuduj_pozycje(odczyt, uwagi=uwagi, zrodla=z_pliku)
                if not poz:
                    # Rozróżnienie ma znaczenie diagnostyczne: skan bez warstwy tekstowej
                    # wymaga OCR, a dokument Z tekstem, ale bez kolumn dat, to po prostu
                    # nie jest sprawozdanie z tabelą bilansową (w aktach SK Banku była to
                    # informacja dodatkowa o należnościach walutowych i opinia biegłego
                    # rewidenta). Wspólny komunikat „skan wymaga OCR" wysyłał wtedy
                    # biegłego do naprawiania czegoś, co było już naprawione.
                    diagnoza = ("brak warstwy tekstowej — wymaga OCR"
                                if odczyt.znakow < 200 else
                                f"tekst jest ({odczyt.znakow:,} zn.".replace(",", "\u00a0")
                                + "), ale nie ma w nim tabeli z kolumnami dat bilansowych")
                    uwagi.append(f"{os.path.basename(p)}: {diagnoza} — pominięto")
                    bez_pozycji.append(os.path.basename(p))
                    continue
                uwagi += uzupelnij_z_tozsamosci(odczyt, poz, zrodla=z_pliku)
                for u in z_pliku:
                    u["plik"] = os.path.basename(p)
                    u["sciezka"] = p
                uwagi_zrodla += z_pliku
                zastrzezenia += sprawdz_spojnosc(odczyt, poz)
                for pole, gdzie in strony_pol(odczyt, os.path.basename(p) if len(paths) > 1 else "").items():
                    miejsca.setdefault(pole, gdzie)
                strony = sorted({k.strona for k in odczyt.kandydaci})
                zrodla.append({"plik": os.path.basename(p), "strony": strony[:12],
                               "okresy": [x.dzien for x in poz]})
                pozycje += poz

            # GAŁĄŹ ZAPASOWA: skoro ze sprawozdań nic nie wyszło, a chronologia nadzorcza
            # ma odczytane okresy — liczymy z nich. To ten sam materiał liczbowy, tylko
            # z innego dokumentu, więc te same wzory obowiązują.
            z_chronologii, wykazane = False, []
            if not pozycje:
                pozycje, wykazane, skad = _z_chronologii(case_id)
                if pozycje:
                    z_chronologii = True
                    uwagi.append(
                        "Sprawozdań finansowych z badanego okresu w aktach nie ma — wskaźniki "
                        "policzone z okresów odczytanych przez moduł chronologii nadzorczej "
                        "z narracji nadzorczej (harmonogram działań, wystąpienia pokontrolne)"
                        + (f", {skad}" if skad else "") + "."
                    )
                    zrodla.append({"plik": skad or "chronologia nadzorcza",
                                   "strony": [], "okresy": [p.dzien for p in pozycje]})

            if not pozycje:
                # ⚠️ KOMUNIKAT MUSI MÓWIĆ, CO SIĘ STAŁO Z KAŻDYM PLIKIEM. Wcześniej
                # jedno zdanie o brakującym OCR-ze padało niezależnie od przyczyny —
                # także wtedy, gdy OCR był zrobiony, a dokumenty po prostu nie zawierały
                # bilansu. Biegły widział wtedy wezwanie do naprawy kroku, który wykonał.
                # ⚠️ NIEUDANY ODCZYT MUSI SPRZĄTNĄĆ PO POPRZEDNIM. Wcześniejszy przebieg
                # zapisał w subanalizach tabelę z kolumnami „2016-12-31 | 2028-12-31"
                # i zerem wierszy — nagłówek z daty przekręconej przez OCR wyglądał
                # w aplikacji jak wynik analizy. Zostawiony po błędzie, poszedłby do
                # redakcji rozdziału jako szereg czasowy sprawy.
                _uniewaznij(case_id, uwagi)
                return (422, {
                    "ok": False,
                    "error": "Z żadnego sprawozdania nie odczytano ani jednego okresu.",
                    "uwagi": uwagi,
                    "pliki": bez_pozycji,
                    "podpowiedz": "Jeżeli akta nie zawierają sprawozdań z badanego okresu, wskaźniki "
                                  "policz z chronologii nadzorczej — moduł czyta wskaźniki z narracji "
                                  "nadzorcy (harmonogram działań, wystąpienia pokontrolne), a nie "
                                  "z tabel sprawozdania.",
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

            # ⚠️ WSPÓŁCZYNNIK WYPŁACALNOŚCI Z CHRONOLOGII JEST WARTOŚCIĄ WYKAZANĄ.
            # Silnik liczy go z funduszy własnych i aktywów ważonych ryzykiem; narracja
            # nadzorcza RWA nie podaje, więc policzyć się go NIE DA — można go wyłącznie
            # przepisać za dokumentem. Różnica nie jest formalna: SK Bank wykazywał
            # 13,84% przy jednoczesnym nietworzeniu wymaganych rezerw, a po ich
            # utworzeniu wynik spadł o 123 mln zł. Dlatego osobny wiersz, własna nazwa
            # i klucz metryki `bank_tcr_wykazany` — nigdy `bank_tcr`.
            if z_chronologii and wykazane:
                wg_dnia_wyk = dict(wykazane)
                ostatni_dzien = max(wg_dnia_wyk)
                prog = prog_na_dzien("tcr", ostatni_dzien)
                pary = sorted(wg_dnia_wyk.items())
                rows.append([
                    "Współczynnik wypłacalności — WYKAZANY przez bank (nie policzony)",
                    *[(f"{_fmt(wg_dnia_wyk[d])} %" if d in wg_dnia_wyk else "—") for d in okresy],
                    (f"{pary[-1][1] - pary[-2][1]:+.2f} p.p." if len(pary) > 1 else "—"),
                    (f"{_fmt(prog.minimum)}%" if prog else "—"),
                    (prog.podstawa if prog else "brak progu w tym stanie prawnym"),
                ])
                for d, v in pary:
                    metryki.append({
                        "case_id": case_id, "key": "bank_tcr_wykazany",
                        "label": "Współczynnik wypłacalności wykazany przez bank",
                        "value": v, "unit": "%",
                        "target": (prog_na_dzien("tcr", d).minimum if prog_na_dzien("tcr", d) else None),
                        "session_day": d,
                    })
                zastrzezenia.append(
                    "Współczynnik wypłacalności pochodzi z narracji nadzorczej i jest wartością "
                    "WYKAZANĄ przez bank, nie policzoną przez silnik z funduszy własnych i aktywów "
                    "ważonych ryzykiem — ustalenie, ile wynosił rzeczywiście, wymaga oceny, czy bank "
                    "utworzył wymagane rezerwy."
                )

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

            # Ten sam okres bywa w dwóch sprawozdaniach, więc ta sama uwaga potrafiła
            # pojawić się dwa razy (Tier 2 za 2007 w obu plikach Glitnira).
            widziane_uwagi = set()
            uwagi_zrodla = [
                u for u in uwagi_zrodla
                if not ((u["dzien"], u["pole"]) in widziane_uwagi or widziane_uwagi.add((u["dzien"], u["pole"])))
            ]
            uwagi = list(dict.fromkeys(uwagi))

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
                    "uwagi_zrodla": uwagi_zrodla,
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
                # ⚠️ NAZWA ROZDZIAŁU WYNIKA Z ROLI PROCESOWEJ, nie z tego, skąd akurat
                # przyszły liczby. „Sprawozdania kontrahenta" to rama sprawy MBR, gdzie
                # oceniano decyzję banku wobec kontrahenta zagranicznego; w sprawie
                # o nadzór badany jest sam bank i kontrahenta nie ma w ogóle.
                "title": TYTUL_KWOT.get(rola, TYTUL_KWOT["ocena_kontrahenta"]),
                "status": "szkic",
                "data": {
                    "table": {
                        **{k: zest[k] for k in ("caption", "head", "rows")},
                        **({"caption": "Tabela. Wielkości bilansowe banku w kolejnych okresach "
                                       "sprawozdawczych, w postaci podanej przez organ nadzoru "
                                       "(odczyt surowy — bez przeliczeń)"} if z_chronologii else {}),
                    },
                    "okresy": zest["okresy"],
                    "zrodla": zrodla,
                    "uwagi": uwagi,
                    "uwagi_zrodla": uwagi_zrodla,
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

            # ── Analiza ekonomiczno-finansowa wg rubryki banku zrzeszającego ──
            # Oceny zrzeszającego wczytujemy PRZED rubryką: niosą wartości wskaźników,
            # których z pozycji sprawozdawczych policzyć się nie da, a które BPS
            # policzył sam własną metodyką (patrz engine/przeklad_bps.py).
            try:
                _, _ob = _req("GET", f"{BASE}/rest/v1/subanalyses?case_id=eq.{case_id}"
                                     f"&kind=eq.oceny_zrzeszajacego&select=data")
                _arr = json.loads(_ob or b"[]")
                oceny_zrz = ((_arr[0].get("data") or {}).get("oceny") or []) if _arr else []
            except Exception:  # noqa: BLE001
                oceny_zrz = []
            aef = analiza_ekonomiczna(case_id, unikalne, okresy, wykazane,
                                      z_ocen=wartosci_wykazane(oceny_zrz))

            # ZESTAWIENIE Z OCENAMI BANKU ZRZESZAJĄCEGO. BPS oceniał SK Bank własną
            # rubryką kwartalnie; zestawienie tych ocen z wartościami policzonymi
            # z akt nadzorczych odpowiada na pytanie, którego żadne z tych źródeł
            # nie rozstrzyga osobno: CZY OCENA NADĄŻAŁA ZA LICZBAMI. Brak ocen
            # (sprawa bez takiego materiału) po prostu pomija sekcję.
            if oceny_zrz:
                wart = {}
                for pz in unikalne:
                    per = {w.kod: v for w in WSKAZNIKI_EF
                           if (v := wartosc_ef(w, pz)) is not None}
                    if per:
                        wart[pz.dzien] = per
                aef["zestawienie_ocen"] = zestaw_oceny(oceny_zrz, wart)

            proza_a, byla_a = _zachowaj_proze(case_id, "analiza_ekonomiczna")
            _req("POST", f"{BASE}/rest/v1/subanalyses?on_conflict=case_id,kind",
                 json.dumps({
                     "case_id": case_id,
                     "kind": "analiza_ekonomiczna",
                     "chapter_no": "V",
                     "title": "Analiza ekonomiczno-finansowa banku",
                     "status": "szkic",
                     "data": {**aef, "zrodla": zrodla, "proza_sprzed_przeliczenia": byla_a},
                     "body_md": proza_a,
                 }, ensure_ascii=False).encode(),
                 {"Content-Type": "application/json",
                  "Prefer": "resolution=merge-duplicates,return=minimal"})
            for o in aef["obszary"]:
                metryki_ef = [{
                    "case_id": case_id, "key": "bank_ef_pokrycie",
                    "label": f"Pokrycie wagowe obszaru: {o['obszar']}",
                    "value": o["waga_pokryta"], "unit": "", "target": 1.0,
                    "session_day": okresy[-1],
                }]
                _req("POST", f"{BASE}/rest/v1/metrics", json.dumps(metryki_ef).encode(),
                     {"Content-Type": "application/json", "Prefer": "return=minimal"})

            return (200, {"ok": True, "okresy": okresy, "wskaznikow": len(rows),
                             "pozycji_sprawozdan": len([r for r in zest["rows"] if r[1]]),
                             "ponizej_progu": len(findings), "uwagi": uwagi,
                             "zastrzezenia": zastrzezenia, "zrodla": zrodla,
                             "analiza_ef": {"policzonych": aef["policzonych"],
                                            "wszystkich": aef["wszystkich"],
                                            "brakow": len(aef["braki"])}})
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
    # Uruchomienie z konsoli: python3 -m engine.uslugi.bank <case_id>
    kod, payload = policz(sys.argv[1] if len(sys.argv) > 1 else "")
    print(kod, json.dumps(payload, ensure_ascii=False, indent=1))
