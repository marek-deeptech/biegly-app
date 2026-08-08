"""Obrót Grupy wobec rynku w TRZECH MIARACH — wzorzec: tabele 24–36 finału HubTech.

Rozdział IV wzorcowej opinii pokazuje ten sam obrót w trzech niezależnych miarach:
LICZBA transakcji, WARTOŚĆ (zł) i WOLUMEN (szt.), każdą w poziomie i jako udział
Grupy w rynku. To nie jest powtórzenie: podmiot może odpowiadać za 3 % transakcji
i 60 % wolumenu (kilka wielkich zleceń) albo odwrotnie (setki drobnych). Aplikacja
liczyła dotąd wyłącznie wartość i wolumen zbiorczo — wymiar LICZBY transakcji
w ogóle nie istniał, więc argument „ile razy" nie miał pokrycia w danych.

Trzy zestawy:
  • `obrot_wg_miar`      — dzień po dniu: liczba / wartość / wolumen + udziały Grupy
  • `kupno_sprzedaz`     — rozbicie strony Grupy na kupno i sprzedaż (tab. 24–25)
  • `wewnatrzgrupowy`    — obrót między podmiotami Grupy w trzech miarach (tab. 26–28)
  • `macierz_czasu`      — średni odstęp między transakcjami PARY podmiotów (tab. 35–36)

⚠️ CZAS W MACIERZY TO ODSTĘP MIĘDZY TRANSAKCJAMI PARY, nie czas realizacji zlecenia.
Wzorzec KM podaje w tych tabelach wartości od ośmiu sekund do prawie dziewięciu godzin
w układzie kupujący × sprzedający; przy czasie realizacji zlecenia dziewięć godzin nie
miałoby sensu, przy odstępie między kolejnymi transakcjami rzadkiej pary — ma. Czas od
złożenia zlecenia do realizacji wymagałby złączenia arkusza zleceń z transakcjami,
którego dane ZASTAL nie pozwalają wykonać (numery zleceń KNF nie odpowiadają
identyfikatorom TREM). Definicja jest wypisana przy tabeli, żeby biegły mógł ją
potwierdzić albo odrzucić.
"""
from __future__ import annotations

import datetime as _dt
from collections import defaultdict

from engine.analysis import is_group, session_date
from engine.wskazniki_dodatkowe import _czas, _f, porzadek_transakcji

__all__ = ["obrot_wg_miar", "kupno_sprzedaz", "wewnatrzgrupowy", "macierz_czasu", "sekundy"]


def sekundy(znacznik: str) -> float | None:
    """Znacznik TREM („2017-12-04 12:04:14,644386") → sekundy od północy."""
    t = str(znacznik or "").strip().replace(",", ".")
    if " " in t:
        t = t.split(" ", 1)[1]
    try:
        h, m, s = t.split(":")
        return int(h) * 3600 + int(m) * 60 + float(s)
    except (ValueError, TypeError):
        return None


def _pusty() -> dict:
    return {"lt": 0, "wart": 0.0, "wol": 0.0, "lt_g": 0, "wart_g": 0.0, "wol_g": 0.0,
            "wart_k": 0.0, "wol_k": 0.0, "lt_k": 0, "wart_s": 0.0, "wol_s": 0.0, "lt_s": 0,
            "wart_w": 0.0, "wol_w": 0.0, "lt_w": 0}


def _przejdz(transakcje: list[dict], fragmenty: list[str] | None) -> dict[str, dict]:
    """Jedno przejście po transakcjach — wszystkie miary naraz, per sesja."""
    dni: dict[str, dict] = defaultdict(_pusty)
    for r in transakcje:
        d = session_date(r.get("DATA_SESJI"))
        if not d:
            continue
        wart = _f(r.get("WARTOSC_TR"))
        wol = _f(r.get("WOLUMEN"))
        gk = is_group(r.get("ACCTOWNR_POPRAWIONY_K") or r.get("ACCTOWNR_POPRAWIONY_B"), fragmenty)
        gs = is_group(r.get("ACCTOWNR_POPRAWIONY_S"), fragmenty)
        s = dni[d]
        s["lt"] += 1
        s["wart"] += wart
        s["wol"] += wol
        # ⚠️ „Transakcja Grupy" to transakcja, w której Grupa jest CHOĆ JEDNĄ stroną.
        # Sumowanie kupna i sprzedaży liczyłoby transakcje wewnątrzgrupowe dwa razy.
        if gk or gs:
            s["lt_g"] += 1
            s["wart_g"] += wart
            s["wol_g"] += wol
        if gk:
            s["lt_k"] += 1
            s["wart_k"] += wart
            s["wol_k"] += wol
        if gs:
            s["lt_s"] += 1
            s["wart_s"] += wart
            s["wol_s"] += wol
        if gk and gs:
            s["lt_w"] += 1
            s["wart_w"] += wart
            s["wol_w"] += wol
    return dni


def _udzial(czesc: float, calosc: float) -> float | None:
    return round(100.0 * czesc / calosc, 2) if calosc else None


def obrot_wg_miar(transakcje: list[dict], fragmenty: list[str] | None = None) -> dict:
    """Liczba / wartość / wolumen — poziom rynku, poziom Grupy i udział, dzień po dniu."""
    dni = _przejdz(transakcje, fragmenty)
    sesje = []
    for d in sorted(dni):
        s = dni[d]
        sesje.append({
            "dzien": d,
            "transakcji": s["lt"], "transakcji_grupa": s["lt_g"], "udzial_transakcji": _udzial(s["lt_g"], s["lt"]),
            "wartosc": round(s["wart"], 2), "wartosc_grupa": round(s["wart_g"], 2),
            "udzial_wartosci": _udzial(s["wart_g"], s["wart"]),
            "wolumen": round(s["wol"]), "wolumen_grupa": round(s["wol_g"]),
            "udzial_wolumenu": _udzial(s["wol_g"], s["wol"]),
        })
    suma = {k: sum(dni[d][k] for d in dni) for k in _pusty()}
    return {
        "sesje": sesje,
        "okres": {
            "sesji": len(sesje),
            "transakcji": suma["lt"], "transakcji_grupa": suma["lt_g"],
            "udzial_transakcji": _udzial(suma["lt_g"], suma["lt"]),
            "wartosc": round(suma["wart"], 2), "wartosc_grupa": round(suma["wart_g"], 2),
            "udzial_wartosci": _udzial(suma["wart_g"], suma["wart"]),
            "wolumen": round(suma["wol"]), "wolumen_grupa": round(suma["wol_g"]),
            "udzial_wolumenu": _udzial(suma["wol_g"], suma["wol"]),
        },
    }


def kupno_sprzedaz(transakcje: list[dict], fragmenty: list[str] | None = None) -> dict:
    """Strona Grupy rozbita na kupno i sprzedaż — wartość, wolumen, liczba (tab. 24–25)."""
    dni = _przejdz(transakcje, fragmenty)
    sesje = []
    for d in sorted(dni):
        s = dni[d]
        sesje.append({
            "dzien": d,
            "kupno_transakcji": s["lt_k"], "kupno_wartosc": round(s["wart_k"], 2), "kupno_wolumen": round(s["wol_k"]),
            "sprzedaz_transakcji": s["lt_s"], "sprzedaz_wartosc": round(s["wart_s"], 2), "sprzedaz_wolumen": round(s["wol_s"]),
            "saldo_wartosc": round(s["wart_s"] - s["wart_k"], 2),
            "saldo_wolumen": round(s["wol_k"] - s["wol_s"]),
            "udzial_kupna": _udzial(s["wol_k"], s["wol"]),
            "udzial_sprzedazy": _udzial(s["wol_s"], s["wol"]),
        })
    return {"sesje": sesje}


def wewnatrzgrupowy(transakcje: list[dict], fragmenty: list[str] | None = None) -> dict:
    """Obrót MIĘDZY podmiotami Grupy w trzech miarach (tab. 26–28), dzień po dniu."""
    dni = _przejdz(transakcje, fragmenty)
    sesje = []
    for d in sorted(dni):
        s = dni[d]
        if not s["lt_w"]:
            continue
        sesje.append({
            "dzien": d,
            "transakcji": s["lt_w"], "udzial_transakcji": _udzial(s["lt_w"], s["lt"]),
            "wartosc": round(s["wart_w"], 2), "udzial_wartosci": _udzial(s["wart_w"], s["wart"]),
            "wolumen": round(s["wol_w"]), "udzial_wolumenu": _udzial(s["wol_w"], s["wol"]),
        })
    suma = {k: sum(dni[d][k] for d in dni) for k in _pusty()}
    return {
        "sesje": sesje,
        "okres": {
            "transakcji": suma["lt_w"], "udzial_transakcji": _udzial(suma["lt_w"], suma["lt"]),
            "wartosc": round(suma["wart_w"], 2), "udzial_wartosci": _udzial(suma["wart_w"], suma["wart"]),
            "wolumen": round(suma["wol_w"]), "udzial_wolumenu": _udzial(suma["wol_w"], suma["wol"]),
            "sesji_z_obrotem": len(sesje),
        },
    }


def macierz_czasu(
    transakcje: list[dict],
    fragmenty: list[str] | None = None,
    tylko_grupa: bool = True,
) -> dict:
    """Średni odstęp między KOLEJNYMI transakcjami tej samej pary kupujący–sprzedający.

    Zwraca macierz (kupujący × sprzedający) w sekundach: średnią zwykłą i ważoną
    wolumenem — dwie tabele wzorca (35 i 36). Para z jedną transakcją nie ma odstępu
    i wchodzi do wyniku jako `None`, a nie zero: zero znaczyłoby „natychmiast".
    """
    tr = porzadek_transakcji(transakcje)
    pary: dict[tuple[str, str], list[tuple[float, float]]] = defaultdict(list)
    ostatnia: dict[tuple[str, str], float] = {}
    transakcji_pary: dict[tuple[str, str], int] = defaultdict(int)
    for r in tr:
        d = session_date(r.get("DATA_SESJI"))
        t = sekundy(_czas(r))
        if not d or t is None:
            continue
        k = str(r.get("ACCTOWNR_POPRAWIONY_K") or r.get("ACCTOWNR_POPRAWIONY_B") or "").strip()
        s = str(r.get("ACCTOWNR_POPRAWIONY_S") or "").strip()
        if not k or not s:
            continue
        if tylko_grupa and not (is_group(k, fragmenty) or is_group(s, fragmenty)):
            continue
        klucz = (k, s)
        transakcji_pary[klucz] += 1
        # ⚠️ ODSTĘPY LICZYMY W OBRĘBIE SESJI. Różnica między ostatnią transakcją dnia
        # a pierwszą nazajutrz to przerwa w handlu, nie tempo zawierania transakcji.
        poprz = ostatnia.get((k, s, d))  # type: ignore[arg-type]
        if poprz is not None:
            pary[klucz].append((t - poprz, _f(r.get("WOLUMEN"))))
        ostatnia[(k, s, d)] = t  # type: ignore[index]

    wynik = []
    for (k, s), odstepy in sorted(pary.items()):
        if not odstepy:
            continue
        sr = sum(o for o, _ in odstepy) / len(odstepy)
        wagi = sum(w for _, w in odstepy)
        srw = sum(o * w for o, w in odstepy) / wagi if wagi else None
        wynik.append({
            "kupujacy": k, "sprzedajacy": s, "transakcji": transakcji_pary[(k, s)],
            "odstepow": len(odstepy),
            "sredni_odstep_s": round(sr, 1),
            "sredni_odstep_wazony_s": round(srw, 1) if srw is not None else None,
        })
    bez_odstepu = [
        {"kupujacy": k, "sprzedajacy": s, "transakcji": n}
        for (k, s), n in sorted(transakcji_pary.items())
        if not pary.get((k, s))
    ]
    return {"pary": wynik, "pary_bez_odstepu": bez_odstepu}


def hhmmss(sek: float | None) -> str:
    """Sekundy → „0:04:03" jak we wzorcu; poniżej minuty z dokładnością do 0,1 s.

    ⚠️ ZAOKRĄGLENIE UKRYWAŁO USTALENIE. Para AMIDA ← GROCHOCKA ma średni odstęp
    poniżej sekundy — w formacie h:mm:ss wychodzi „0:00:00", co czyta się jak błąd
    formatowania albo brak danych, a jest najmocniejszym sygnałem w tej tabeli:
    kolejne transakcje tej samej pary zawierane w tej samej sekundzie. Arkusz TREM
    ma znacznik czasu z mikrosekundami, więc precyzja jest w danych, nie w domyśle.
    """
    if sek is None:
        return "—"
    if sek < 60:
        return f"{sek:.1f} s".replace(".", ",")
    return str(_dt.timedelta(seconds=int(round(sek))))
