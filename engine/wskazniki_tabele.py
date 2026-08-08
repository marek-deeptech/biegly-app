"""Złożenie wyników wskaźników dodatkowych w tabele i ustalenia.

Wydzielone z CLI, bo tych samych tabel używa usługa HTTP (`engine/uslugi/wskazniki.py`)
wywoływana przyciskiem w panelu. Rozjazd między jednym a drugim oznaczałby, że biegły
widzi w aplikacji inne liczby niż w wydruku.
"""
from engine.wskazniki_dodatkowe import wskazniki_dodatkowe

ISIN_ETYKIETA = {"PLCSYSA00016": "CSY", "PLRSYSA00014": "RSY", "PLZSTAL00012": "ZASTAL"}


def pl(v, frac=0):
    if v is None:
        return "—"
    return f"{v:,.{frac}f}".replace(",", "\u00a0").replace(".", ",")


def zloz(wg_instrumentu: dict, fragmenty: list, maks_sesji: int = 0) -> dict:
    """Tabele + ustalenia z surowych wierszy TREM pogrupowanych po ISIN.

    ⚠️ `maks_sesji = 0` znaczy TABELA PEŁNA. Domyślny limit 40 sesji był pomyłką
    w opinii: rozdział cytował wielkości za cały okres badany, a tabela pod spodem
    pokazywała wybrane czterdzieści sesji z dwustu trzech. Czytelnik nie mógł
    odtworzyć sumy z wierszy, które widzi. Limit zostaje jako opcja dla podglądu.
    """
    tables, findings, uwagi_wsp = [], [], []
    wyniki = {}
    for isin, rows in sorted(wg_instrumentu.items()):
        etykieta = ISIN_ETYKIETA.get(isin, isin or "instrument nieoznaczony")
        w = wskazniki_dodatkowe(rows, fragmenty, etykieta=etykieta)
        wyniki[etykieta] = w
        ok = w["okres"]
        uwagi_wsp = w["uwagi"]

        tables.append({
            "caption": f"Tabela. {etykieta} — wskaźniki dodatkowe za cały okres ({ok['od']} – {ok['do']}, "
                       f"{ok['sesji']} sesji, {ok['transakcji']} transakcji)",
            "head": ["Wskaźnik", "Grupa", "Pozostali uczestnicy", "Cała sesja / rynek", "Udział Grupy"],
            "rows": [
                ["NMaxC — nowe maksima cenowe", pl(ok["nmaxc_grupa"]), pl(ok["nmaxc_pozostali"]),
                 pl(ok["nmaxc_razem"]), f"{pl(ok['udzial_nmaxc'], 2)} %" if ok["udzial_nmaxc"] is not None else "—"],
                ["WNKSumaSesja — suma wzrostów kursu (zł)", pl(ok["wnk_pln_grupa"], 4), "—",
                 pl(ok["wnk_pln_sesja"], 4), f"{pl(ok['udzial_wnk_pln'], 2)} %" if ok["udzial_wnk_pln"] is not None else "—"],
                ["WNKSumaSesja% — suma wzrostów (p.p.)", pl(ok["wnk_pct_grupa"], 2), "—",
                 pl(ok["wnk_pct_sesja"], 2), f"{pl(ok['udzial_wnk_pct'], 2)} %" if ok["udzial_wnk_pct"] is not None else "—"],
                ["WNK VWAP — kupno Grupy wobec sesji", pl(ok["vwap_grupa_kupno"], 4), "—", pl(ok["vwap_sesja"], 4),
                 f"{pl(ok.get('premia_vwap_kupno_pct'), 2)} %" if ok.get("premia_vwap_kupno_pct") is not None else "—"],
                ["WT% — transakcje wzajemne w wolumenie", pl(ok["wol_wewn"]), "—", pl(ok["wol_sesja"]),
                 f"{pl(ok['wt_pct'], 2)} %" if ok["wt_pct"] is not None else "—"],
                ["Taker/Maker — zlecenia Grupy", f"MAKER (pewne): {pl(ok['taker_maker']['maker_pewny'])}", "—",
                 f"nieokreślone: {pl(ok['taker_maker']['nieokreslone'])}", "—"],
            ],
        })

        sesje = sorted(w["sesje"], key=lambda s: -(s["wnk_pln_grupa"] or 0))
        if maks_sesji:
            sesje = sesje[:maks_sesji]
        tables.append({
            "caption": f"Tabela. {etykieta} — wskaźniki dodatkowe per sesja " + (
                f"(wszystkie {len(sesje)} sesji okresu)" if not maks_sesji
                else f"({len(sesje)} sesji o największym wpływie Grupy na kurs, z {ok['sesji']})"
            ),
            "head": ["Sesja", "Transakcji", "NMaxC Grupa / razem", "WNK Grupa (zł)", "WNK sesja (zł)",
                     "Udział WNK", "WNK Grupa (p.p.)", "VWAP Grupa kupno", "VWAP sesja", "WT%"],
            "rows": [[
                s["dzien"], pl(s["transakcji"]), f"{pl(s['nmaxc_grupa'])} / {pl(s['nmaxc_razem'])}",
                pl(s["wnk_pln_grupa"], 4), pl(s["wnk_pln_sesja"], 4),
                f"{pl(s['udzial_wnk_pln'], 2)} %" if s["udzial_wnk_pln"] is not None else "—",
                pl(s["wnk_pct_grupa"], 2), pl(s["vwap_grupa_kupno"], 4), pl(s["vwap_sesja"], 4),
                f"{pl(s['wt_pct'], 2)} %" if s["wt_pct"] is not None else "—",
            ] for s in sorted(sesje, key=lambda s: s["dzien"])],
        })

        podmioty = sorted(w["podmioty"].items(), key=lambda kv: -kv[1]["wnk_pln"])
        if podmioty:
            tables.append({
                "caption": f"Tabela. {etykieta} — atrybucja imienna: kto ustanawiał maksima i podnosił kurs "
                           "(strona kupująca w transakcjach podwyższających cenę)",
                "head": ["Podmiot", "Nowe maksima (NMaxC)", "WNK (zł)", "WNK (p.p.)", "Transakcji kupna"],
                "rows": [[k, pl(v["nmaxc"]), pl(v["wnk_pln"], 4), pl(v["wnk_pct"], 2), pl(v["transakcji"])]
                         for k, v in podmioty],
            })

        findings.append(
            f"{etykieta}: podmioty z Grupy ustanowiły {ok['nmaxc_grupa']} z {ok['nmaxc_razem']} nowych maksimów "
            f"cenowych dziennych ({pl(ok['udzial_nmaxc'], 2)} %) w {ok['sesji']} sesjach."
        )
        findings.append(
            f"{etykieta}: transakcje Grupy odpowiadają za {pl(ok['wnk_pln_grupa'], 4)} zł z "
            f"{pl(ok['wnk_pln_sesja'], 4)} zł łącznej sumy wzrostów kursu "
            f"({pl(ok['udzial_wnk_pln'], 2)} %), co w ujęciu procentowym daje "
            f"{pl(ok['wnk_pct_grupa'], 2)} p.p. z {pl(ok['wnk_pct_sesja'], 2)} p.p."
        )
        if ok.get("premia_vwap_kupno_pct") is not None:
            kier = "wyższej" if ok["premia_vwap_kupno_pct"] > 0 else "niższej"
            findings.append(
                f"{etykieta}: Grupa kupowała po cenie średnio {kier} od przeciętnej ceny sesji — VWAP kupna "
                f"{pl(ok['vwap_grupa_kupno'], 4)} zł wobec VWAP sesji {pl(ok['vwap_sesja'], 4)} zł "
                f"({pl(ok['premia_vwap_kupno_pct'], 2)} %)."
            )
        if ok["wt_pct"] is not None:
            findings.append(
                f"{etykieta}: transakcje wzajemne wewnątrz Grupy objęły {pl(ok['wol_wewn'])} szt. z "
                f"{pl(ok['wol_sesja'])} szt. obrotu ({pl(ok['wt_pct'], 2)} %)."
            )

    findings.extend(uwagi_wsp)
    findings.append(
        "Wszystkie wielkości policzono ODRĘBNIE dla każdego instrumentu; wskaźniki 1–3 porównują kolejne "
        "transakcje tego samego waloru, więc zestaw łączny dałby ciąg zmian cen, który nie wystąpił."
    )
    return {"tables": tables, "findings": findings, "wyniki": wyniki}
