"""Wskaźniki dodatkowe z arkusza transakcji TREM (specyfikacja biegłego, 7.08.2026).

Siedem wskaźników opisanych w dokumencie „Wskazniki.docx”:

  1. NMaxC          — nowe maksima cenowe dzienne (na tick, bez wolumenu)
  2. WNKSumaSesja   — wpływ na kurs: suma dodatnich zmian ceny w PLN
  3. WNKSumaSesja%  — to samo w procentach względem poprzedniej transakcji
  4. Taker/Maker    — agresywność zleceń
  5. WNK VWAP       — VWAP podmiotu wobec VWAP sesji
  6. WT%            — udział transakcji wzajemnych Grupy w wolumenie dnia
  7. ŚczasT         — średni czas od złożenia zlecenia do zawarcia transakcji

⚠️ KTO „SPOWODOWAŁ” ZMIANĘ CENY. Arkusz TREM nie ma znacznika agresora: kolumna
TRADEORIGIN w pliku CSY ma jedną wartość ('B') dla wszystkich 724 transakcji, więc
nie rozróżnia stron. Przyjęto regułę wynikającą z mechaniki arkusza zleceń: wzrost
kursu względem poprzedniej transakcji oznacza, że KUPUJĄCY sięgnął po ofertę
sprzedaży (podniósł limit), a spadek — że SPRZEDAJĄCY zszedł do oferty kupna.
Zmiany dodatnie przypisujemy zatem stronie kupującej. Reguła jest założeniem
metodycznym, nie odczytem z danych, i musi być wypowiedziana w opinii.

⚠️ TAKER/MAKER I ŚczasT SĄ OGRANICZONE DANYMI. Dokument proponuje porównanie czasu
złożenia zlecenia z czasem realizacji. Numery zleceń w zestawieniu KNF („Nr zlecenia”
= 59180817) NIE odpowiadają identyfikatorom z TREM (ORDERID_K = 20171130000023) —
części wspólnej jest ZERO na 532 zleceniach CSY, więc złączenie po numerze nie
istnieje. Z samego TREM da się orzec tylko jedną stronę: identyfikator zlecenia
zawiera datę jego złożenia, więc zlecenie z wcześniejszej sesji NA PEWNO leżało
w arkuszu (MAKER). Reszta pozostaje nieokreślona i tak jest raportowana — zamiast
domyślnego zaklasyfikowania jako TAKER, które zawyżałoby tezę o agresywności.
"""
from __future__ import annotations

import datetime as _dt
import re
from collections import defaultdict

from engine.analysis import is_group, session_date

__all__ = ["wskazniki_dodatkowe", "porzadek_transakcji", "vwap"]

ZAOKR_VWAP = 4


def _f(v) -> float:
    """Liczba z komórki arkusza; przecinek dziesiętny i spacje jako separatory."""
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).replace("\xa0", "").replace(" ", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return 0.0


def _czas(r: dict) -> str:
    """Znacznik czasu transakcji — TRANSACTTIME ma mikrosekundy, CZAS_TR sekundy."""
    t = str(r.get("TRANSACTTIME") or "").strip()
    if t:
        return t
    return f"{session_date(r.get('DATA_SESJI'))} {str(r.get('CZAS_TR') or '').strip()}"


def porzadek_transakcji(transakcje: list[dict]) -> list[dict]:
    """Transakcje w kolejności zawarcia — po czasie, a przy równym po UTPEXID.

    ⚠️ Kolejność jest tu wszystkim: wskaźniki 1–3 porównują każdą transakcję
    z POPRZEDNIĄ, więc plik posortowany inaczej (np. po rachunku) dałby zmyślony
    ciąg zmian cen. Sortujemy sami, nie ufamy układowi pliku.
    """
    def klucz(r: dict):
        return (session_date(r.get("DATA_SESJI")) or "", _czas(r), _f(r.get("UTPEXID")))

    return sorted(transakcje, key=klucz)


def vwap(wartosc: float, wolumen: float) -> float | None:
    """Średnia ważona wolumenem — None, gdy nie było obrotu (nie zero!)."""
    if not wolumen:
        return None
    return round(wartosc / wolumen, ZAOKR_VWAP)


def _data_ze_zlecenia(orderid) -> str | None:
    """Identyfikator zlecenia UTP zaczyna się datą złożenia: 20171130000023."""
    m = re.match(r"^(\d{4})(\d{2})(\d{2})\d+$", str(orderid or "").strip())
    if not m:
        return None
    rok, mies, dzien = m.groups()
    try:
        _dt.date(int(rok), int(mies), int(dzien))
    except ValueError:
        return None
    return f"{rok}-{mies}-{dzien}"


def wskazniki_dodatkowe(
    transakcje: list[dict],
    fragmenty_grupy: list[str] | None = None,
    etykieta: str | None = None,
) -> dict:
    """Liczy komplet wskaźników dodatkowych dla JEDNEGO instrumentu.

    Zwraca strukturę: {"sesje": [...], "okres": {...}, "podmioty": [...], "uwagi": [...]}.
    Wszystkie wielkości są liczone; nic nie jest przepisywane z pliku.
    """
    tr = porzadek_transakcji(transakcje)
    uwagi: list[str] = []

    sesje: dict[str, dict] = defaultdict(
        lambda: {
            "nmaxc_grupa": 0, "nmaxc_pozostali": 0, "nmaxc_razem": 0,
            "wnk_pln_grupa": 0.0, "wnk_pln_pozostali": 0.0, "wnk_pln_sesja": 0.0,
            "wnk_pct_grupa": 0.0, "wnk_pct_pozostali": 0.0, "wnk_pct_sesja": 0.0,
            "wol_sesja": 0.0, "wart_sesja": 0.0,
            "wol_grupa_k": 0.0, "wart_grupa_k": 0.0,
            "wol_grupa_s": 0.0, "wart_grupa_s": 0.0,
            "wol_wewn": 0.0, "transakcji": 0,
        }
    )
    # NMaxC i WNK per podmiot — atrybucja imienna, tak jak w pytaniu 1 postanowienia.
    podmioty: dict[str, dict] = defaultdict(lambda: {"nmaxc": 0, "wnk_pln": 0.0, "wnk_pct": 0.0, "transakcji": 0})
    maks_dnia: dict[str, float] = {}
    poprzednia: dict[str, float] = {}
    tm = {"maker_pewny": 0, "nieokreslone": 0}

    for r in tr:
        d = session_date(r.get("DATA_SESJI"))
        if not d:
            continue
        kurs = _f(r.get("KURS"))
        wol = _f(r.get("WOLUMEN"))
        wart = _f(r.get("WARTOSC_TR"))
        kupujacy = r.get("ACCTOWNR_POPRAWIONY_K") or r.get("ACCTOWNR_POPRAWIONY_B")
        sprzedajacy = r.get("ACCTOWNR_POPRAWIONY_S")
        gk = is_group(kupujacy, fragmenty_grupy)
        gs = is_group(sprzedajacy, fragmenty_grupy)

        s = sesje[d]
        s["transakcji"] += 1
        s["wol_sesja"] += wol
        s["wart_sesja"] += wart
        if gk:
            s["wol_grupa_k"] += wol
            s["wart_grupa_k"] += wart
        if gs:
            s["wol_grupa_s"] += wol
            s["wart_grupa_s"] += wart
        if gk and gs:
            s["wol_wewn"] += wol

        # ── 1. NMaxC — nowe maksimum dzienne (na tick, bez wolumenu) ──────
        if kurs > maks_dnia.get(d, float("-inf")):
            if d in maks_dnia:  # pierwsza transakcja dnia ustala poziom, nie „nowe maksimum”
                s["nmaxc_razem"] += 1
                if gk:
                    s["nmaxc_grupa"] += 1
                    podmioty[str(kupujacy)]["nmaxc"] += 1
                else:
                    s["nmaxc_pozostali"] += 1
            maks_dnia[d] = kurs

        # ── 2/3. WNK — dodatnia zmiana wobec POPRZEDNIEJ transakcji ───────
        prev = poprzednia.get(d)
        if prev is not None and kurs > prev:
            delta = round(kurs - prev, 6)
            pct = round(100.0 * delta / prev, 6) if prev else 0.0
            s["wnk_pln_sesja"] += delta
            s["wnk_pct_sesja"] += pct
            if gk:
                s["wnk_pln_grupa"] += delta
                s["wnk_pct_grupa"] += pct
                podmioty[str(kupujacy)]["wnk_pln"] += delta
                podmioty[str(kupujacy)]["wnk_pct"] += pct
            else:
                s["wnk_pln_pozostali"] += delta
                s["wnk_pct_pozostali"] += pct
        poprzednia[d] = kurs

        if gk:
            podmioty[str(kupujacy)]["transakcji"] += 1

        # ── 4. Taker/Maker — tylko strona pewna (zlecenie z wcześniejszej sesji) ──
        if gk:
            dz = _data_ze_zlecenia(r.get("ORDERID_K"))
            if dz and dz < d:
                tm["maker_pewny"] += 1
            else:
                tm["nieokreslone"] += 1

    wynik_sesje = []
    for d in sorted(sesje):
        s = sesje[d]
        wynik_sesje.append({
            "dzien": d,
            "transakcji": s["transakcji"],
            "nmaxc_grupa": s["nmaxc_grupa"],
            "nmaxc_pozostali": s["nmaxc_pozostali"],
            "nmaxc_razem": s["nmaxc_razem"],
            "wnk_pln_grupa": round(s["wnk_pln_grupa"], 4),
            "wnk_pln_pozostali": round(s["wnk_pln_pozostali"], 4),
            "wnk_pln_sesja": round(s["wnk_pln_sesja"], 4),
            "wnk_pct_grupa": round(s["wnk_pct_grupa"], 2),
            "wnk_pct_pozostali": round(s["wnk_pct_pozostali"], 2),
            "wnk_pct_sesja": round(s["wnk_pct_sesja"], 2),
            "udzial_wnk_pln": round(100.0 * s["wnk_pln_grupa"] / s["wnk_pln_sesja"], 2) if s["wnk_pln_sesja"] else None,
            "vwap_sesja": vwap(s["wart_sesja"], s["wol_sesja"]),
            "vwap_grupa_kupno": vwap(s["wart_grupa_k"], s["wol_grupa_k"]),
            "vwap_grupa_sprzedaz": vwap(s["wart_grupa_s"], s["wol_grupa_s"]),
            "wt_pct": round(100.0 * s["wol_wewn"] / s["wol_sesja"], 2) if s["wol_sesja"] else None,
            "wol_sesja": round(s["wol_sesja"], 4),
            "wol_wewn": round(s["wol_wewn"], 4),
        })

    ok = {
        "instrument": etykieta,
        "sesji": len(wynik_sesje),
        "transakcji": len(tr),
        "od": wynik_sesje[0]["dzien"] if wynik_sesje else None,
        "do": wynik_sesje[-1]["dzien"] if wynik_sesje else None,
        "nmaxc_grupa": sum(x["nmaxc_grupa"] for x in wynik_sesje),
        "nmaxc_pozostali": sum(x["nmaxc_pozostali"] for x in wynik_sesje),
        "nmaxc_razem": sum(x["nmaxc_razem"] for x in wynik_sesje),
        "wnk_pln_grupa": round(sum(x["wnk_pln_grupa"] for x in wynik_sesje), 4),
        "wnk_pln_sesja": round(sum(x["wnk_pln_sesja"] for x in wynik_sesje), 4),
        "wnk_pct_grupa": round(sum(x["wnk_pct_grupa"] for x in wynik_sesje), 2),
        "wnk_pct_sesja": round(sum(x["wnk_pct_sesja"] for x in wynik_sesje), 2),
        "vwap_sesja": vwap(sum(sesje[d]["wart_sesja"] for d in sesje), sum(sesje[d]["wol_sesja"] for d in sesje)),
        "vwap_grupa_kupno": vwap(sum(sesje[d]["wart_grupa_k"] for d in sesje), sum(sesje[d]["wol_grupa_k"] for d in sesje)),
        "vwap_grupa_sprzedaz": vwap(sum(sesje[d]["wart_grupa_s"] for d in sesje), sum(sesje[d]["wol_grupa_s"] for d in sesje)),
        "wol_sesja": round(sum(sesje[d]["wol_sesja"] for d in sesje), 4),
        "wol_wewn": round(sum(sesje[d]["wol_wewn"] for d in sesje), 4),
        "taker_maker": tm,
    }
    ok["udzial_nmaxc"] = round(100.0 * ok["nmaxc_grupa"] / ok["nmaxc_razem"], 2) if ok["nmaxc_razem"] else None
    ok["udzial_wnk_pln"] = round(100.0 * ok["wnk_pln_grupa"] / ok["wnk_pln_sesja"], 2) if ok["wnk_pln_sesja"] else None
    ok["udzial_wnk_pct"] = round(100.0 * ok["wnk_pct_grupa"] / ok["wnk_pct_sesja"], 2) if ok["wnk_pct_sesja"] else None
    ok["wt_pct"] = round(100.0 * ok["wol_wewn"] / ok["wol_sesja"], 2) if ok["wol_sesja"] else None
    # Premia VWAP: o ile Grupa kupowała drożej niż przeciętny uczestnik sesji.
    if ok["vwap_grupa_kupno"] and ok["vwap_sesja"]:
        ok["premia_vwap_kupno_pct"] = round(100.0 * (ok["vwap_grupa_kupno"] / ok["vwap_sesja"] - 1), 2)

    uwagi.append(
        "Zmianę ceny w górę przypisano stronie KUPUJĄCEJ. Arkusz TREM nie zawiera znacznika "
        "agresora (kolumna TRADEORIGIN ma jedną wartość dla wszystkich transakcji), a wzrost kursu "
        "wobec poprzedniej transakcji oznacza sięgnięcie po ofertę sprzedaży. Jest to założenie "
        "metodyczne wynikające z mechaniki arkusza zleceń, nie odczyt z danych."
    )
    uwagi.append(
        "Pierwsza transakcja sesji ustala poziom odniesienia i NIE jest liczona jako nowe maksimum "
        "ani jako zmiana kursu — inaczej każda sesja zaczynałaby się sztucznym zdarzeniem."
    )
    if tm["nieokreslone"]:
        uwagi.append(
            f"Taker/Maker: dla {tm['maker_pewny']} transakcji Grupy zlecenie pochodziło z WCZEŚNIEJSZEJ "
            f"sesji, co przesądza o charakterze MAKER; {tm['nieokreslone']} pozostaje NIEOKREŚLONYCH. "
            "Rozstrzygnięcie wymaga czasu złożenia zlecenia zestawionego z czasem realizacji, a numery "
            "zleceń w zestawieniu KNF nie odpowiadają identyfikatorom z TREM (część wspólna: zero). "
            "Źródłem, które to domknie, są zestawienia zleceń i transakcji z firm inwestycyjnych."
        )
    uwagi.append(
        "ŚczasT (średni czas od złożenia zlecenia do zawarcia transakcji) nie został policzony: "
        "wymaga powiązania zlecenia z transakcją, którego dostępne pliki nie pozwalają wykonać "
        "(brak wspólnego identyfikatora). Do policzenia po uzupełnieniu akt o dane firm inwestycyjnych."
    )
    return {"sesje": wynik_sesje, "okres": ok, "podmioty": dict(podmioty), "uwagi": uwagi}
