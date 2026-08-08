#!/usr/bin/env python3
"""Obrót Grupy wobec rynku w trzech miarach — dane źródłowe do rozdziałów IV.3–IV.5.

    python3 scripts/obrot_miary.py ZASTAL [--maks-sesji 40]

Wzorzec: tabele 24–36 finału HubTech. Zapisuje subanalizę `obrot_miary` (ŹRÓDŁO),
z której składane rozdziały biorą gotowe tabele — tak jak `akcjonariat_*` zasilają
„Historię zmian w akcjonariacie". Dzięki temu ponowny bieg skryptu rozdziału nie
kasuje tych tabel, a ponowny bieg tego skryptu nie rusza prozy rozdziału.

Liczone ODRĘBNIE DLA KAŻDEGO INSTRUMENTU.
"""
import argparse
import json
import os
import re
import sys
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from engine.loader import load_trem_paired  # noqa: E402
from engine.obrot_wg_miar import hhmmss, kupno_sprzedaz, macierz_czasu, obrot_wg_miar, wewnatrzgrupowy  # noqa: E402

ISIN_ETYKIETA = {"PLCSYSA00016": "CSY", "PLRSYSA00014": "RSY", "PLZSTAL00012": "ZASTAL"}


def _env():
    out = {}
    p = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env.local")
    for line in open(p, encoding="utf8"):
        m = re.match(r"^([A-Z_]+)=(.*)$", line.strip())
        if m:
            out[m.group(1)] = m.group(2).strip().strip("\"'")
    return out["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/"), out["SUPABASE_SERVICE_ROLE_KEY"]


def pl(v, frac=0):
    if v is None:
        return "—"
    return f"{v:,.{frac}f}".replace(",", " ").replace(".", ",")


def proc(v):
    return "—" if v is None else f"{pl(v, 2)} %"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("sprawa")
    ap.add_argument("--maks-sesji", type=int, default=0, help="0 = wszystkie sesje (tabela pełna)")
    ap.add_argument("--maks-par", type=int, default=25)
    args = ap.parse_args()

    base, key = _env()
    h = {"apikey": key, "Authorization": f"Bearer {key}"}

    def get(p):
        with urllib.request.urlopen(urllib.request.Request(f"{base}/rest/v1/{p}", headers=h), timeout=120) as r:
            return json.loads(r.read())

    sprawy = get(f"cases?name=ilike.*{urllib.parse.quote(args.sprawa)}*&select=id,name,typ,group_roster")
    if not sprawy:
        print(f"✗ nie znaleziono sprawy {args.sprawa}")
        return 1
    c = sprawy[0]
    if c["typ"] != "manipulacja_gpw":
        print("✗ krok dotyczy spraw o manipulację GPW")
        return 1
    fragmenty = [str(x).strip().lower() for x in (c.get("group_roster") or {}).get("fragments", []) if str(x).strip()]
    if not fragmenty:
        print("✗ brak rostera Grupy — atrybucja byłaby zmyślona")
        return 1

    docs = get(f"documents?case_id=eq.{c['id']}&select=rel_path,storage_path&limit=3000")
    widziane, pliki = set(), []
    for d in sorted(docs, key=lambda x: x["rel_path"]):
        nazwa = d["rel_path"].rsplit("/", 1)[-1]
        if not d.get("storage_path") or not re.search(r"(UTP )?TREM.*\.xls[mx]$", nazwa, re.I):
            continue
        if not str(d["storage_path"]).startswith(f"{c['id']}/"):
            continue
        if nazwa.strip().lower() in widziane:  # kopie z różnych TOM-ów
            continue
        widziane.add(nazwa.strip().lower())
        pliki.append(d)
    if not pliki:
        print("✗ brak arkusza transakcji TREM")
        return 1

    wg_instr = {}
    for d in pliki:
        with urllib.request.urlopen(
            urllib.request.Request(f"{base}/storage/v1/object/case-files/{urllib.parse.quote(d['storage_path'])}", headers=h),
            timeout=600,
        ) as r:
            blob = r.read()
        try:
            rows = load_trem_paired(blob)
        except KeyError:
            continue
        for row in rows:
            wg_instr.setdefault(str(row.get("INSTRISIN") or row.get("SYMBOL") or "").strip(), []).append(row)
        print(f"  {d['rel_path'].split('/')[-1]}: {len(rows)} transakcji")

    tables, findings, dane = [], [], {}
    for isin, rows in sorted(wg_instr.items()):
        et = ISIN_ETYKIETA.get(isin, isin or "instrument")
        miary = obrot_wg_miar(rows, fragmenty)
        ks = kupno_sprzedaz(rows, fragmenty)
        wew = wewnatrzgrupowy(rows, fragmenty)
        mc = macierz_czasu(rows, fragmenty)
        dane[et] = {"miary": miary, "kupno_sprzedaz": ks, "wewnatrzgrupowy": wew, "macierz_czasu": mc}
        o = miary["okres"]

        # ── tabela A: trzy miary, poziom i udział (wzorzec: tab. 29–34) ──
        naj = sorted(miary["sesje"], key=lambda s: -(s["udzial_wolumenu"] or 0))
        if args.maks_sesji:
            naj = naj[: args.maks_sesji]
        tables.append({
            "caption": f"Tabela. {et} — obrót Grupy wobec obrotu ogółem w trzech miarach: liczba transakcji, "
                       f"wartość i wolumen ({len(naj)} sesji o najwyższym udziale wolumenowym z {o['sesji']})",
            "head": ["Sesja", "Transakcji ogółem", "Transakcji Grupy", "Udział", "Wartość ogółem [zł]",
                     "Wartość Grupy [zł]", "Udział", "Wolumen ogółem [szt.]", "Wolumen Grupy [szt.]", "Udział"],
            "rows": [[s["dzien"], pl(s["transakcji"]), pl(s["transakcji_grupa"]), proc(s["udzial_transakcji"]),
                      pl(s["wartosc"], 2), pl(s["wartosc_grupa"], 2), proc(s["udzial_wartosci"]),
                      pl(s["wolumen"]), pl(s["wolumen_grupa"]), proc(s["udzial_wolumenu"])]
                     for s in sorted(naj, key=lambda s: s["dzien"])],
        })

        # ── tabela B: kupno i sprzedaż Grupy per dzień (wzorzec: tab. 24–25) ──
        aktywne = [s for s in ks["sesje"] if s["kupno_wolumen"] or s["sprzedaz_wolumen"]]
        naj_ks = sorted(aktywne, key=lambda s: -(s["kupno_wolumen"] + s["sprzedaz_wolumen"]))
        if args.maks_sesji:
            naj_ks = naj_ks[: args.maks_sesji]
        tables.append({
            "caption": f"Tabela. {et} — transakcje kupna i sprzedaży podmiotów z Grupy z podziałem na dni " + (
                f"(wszystkie {len(naj_ks)} sesji z obrotem Grupy)" if not args.maks_sesji
                else f"({len(naj_ks)} sesji o największym obrocie Grupy z {len(aktywne)})"
            ),
            "head": ["Sesja", "Kupno — transakcji", "Kupno — wolumen [szt.]", "Kupno — wartość [zł]",
                     "Sprzedaż — transakcji", "Sprzedaż — wolumen [szt.]", "Sprzedaż — wartość [zł]",
                     "Saldo wolumenu [szt.]", "Saldo gotówki [zł]"],
            "rows": [[s["dzien"], pl(s["kupno_transakcji"]), pl(s["kupno_wolumen"]), pl(s["kupno_wartosc"], 2),
                      pl(s["sprzedaz_transakcji"]), pl(s["sprzedaz_wolumen"]), pl(s["sprzedaz_wartosc"], 2),
                      pl(s["saldo_wolumen"]), pl(s["saldo_wartosc"], 2)]
                     for s in sorted(naj_ks, key=lambda s: s["dzien"])],
        })

        # ── tabela C: obrót wewnątrzgrupowy w trzech miarach (wzorzec: tab. 26–28) ──
        if wew["sesje"]:
            naj_w = sorted(wew["sesje"], key=lambda s: -(s["udzial_wolumenu"] or 0))
            if args.maks_sesji:
                naj_w = naj_w[: args.maks_sesji]
            tables.append({
                "caption": f"Tabela. {et} — obrót MIĘDZY podmiotami z Grupy w trzech miarach " + (
                    f"(wszystkie {len(naj_w)} sesji, w których wystąpił)" if not args.maks_sesji
                    else f"({len(naj_w)} sesji z {wew['okres']['sesji_z_obrotem']}, w których wystąpił)"
                ),
                "head": ["Sesja", "Transakcji", "Udział w liczbie", "Wartość [zł]", "Udział w wartości",
                         "Wolumen [szt.]", "Udział w wolumenie"],
                "rows": [[s["dzien"], pl(s["transakcji"]), proc(s["udzial_transakcji"]), pl(s["wartosc"], 2),
                          proc(s["udzial_wartosci"]), pl(s["wolumen"]), proc(s["udzial_wolumenu"])]
                         for s in sorted(naj_w, key=lambda s: s["dzien"])],
            })

        # ── tabela D: macierz średniego odstępu par (wzorzec: tab. 35–36) ──
        if mc["pary"]:
            naj_p = sorted(mc["pary"], key=lambda p: p["sredni_odstep_s"])[: args.maks_par]
            tables.append({
                "caption": f"Tabela. {et} — średni odstęp między kolejnymi transakcjami tej samej pary "
                           f"kupujący–sprzedający ({len(naj_p)} par o najkrótszym odstępie z {len(mc['pary'])}); "
                           "odstęp liczony w obrębie sesji, w nawiasie średnia ważona wolumenem",
                "head": ["Kupujący", "Sprzedający", "Transakcji", "Odstępów", "Średni odstęp", "Ważony wolumenem"],
                "rows": [[p["kupujacy"], p["sprzedajacy"], pl(p["transakcji"]), pl(p["odstepow"]),
                          hhmmss(p["sredni_odstep_s"]), hhmmss(p["sredni_odstep_wazony_s"])] for p in naj_p],
            })

        findings.append(
            f"{et}: podmioty z Grupy uczestniczyły w {pl(o['transakcji_grupa'])} z {pl(o['transakcji'])} transakcji "
            f"({proc(o['udzial_transakcji'])}), co odpowiada {proc(o['udzial_wartosci'])} wartości obrotu "
            f"i {proc(o['udzial_wolumenu'])} wolumenu — trzy miary tego samego obrotu."
        )
        if wew["okres"]["transakcji"]:
            w = wew["okres"]
            findings.append(
                f"{et}: obrót między podmiotami z Grupy objął {pl(w['transakcji'])} transakcji "
                f"({proc(w['udzial_transakcji'])} liczby), {pl(w['wolumen'])} szt. ({proc(w['udzial_wolumenu'])} wolumenu) "
                f"i {pl(w['wartosc'], 2)} zł ({proc(w['udzial_wartosci'])} wartości) w {w['sesji_z_obrotem']} sesjach."
            )
        if mc["pary"]:
            naj = min(mc["pary"], key=lambda p: p["sredni_odstep_s"])
            findings.append(
                f"{et}: najkrótszy średni odstęp między kolejnymi transakcjami tej samej pary wyniósł "
                f"{hhmmss(naj['sredni_odstep_s'])} ({naj['kupujacy']} ← {naj['sprzedajacy']}, "
                f"{naj['transakcji']} transakcji)."
            )

    findings.append(
        "Liczba transakcji, wartość i wolumen są miarami NIEZALEŻNYMI: podmiot może odpowiadać za kilka procent "
        "transakcji i większość wolumenu (nieliczne wielkie zlecenia) albo odwrotnie. Wzorzec opinii podaje "
        "wszystkie trzy, bo każda odpowiada na inne pytanie o dominację w obrocie."
    )
    findings.append(
        "Odstęp w macierzy czasu liczony jest MIĘDZY KOLEJNYMI TRANSAKCJAMI tej samej pary w obrębie sesji, "
        "a nie od złożenia zlecenia do jego realizacji. Czasu realizacji nie da się ustalić z dostępnych plików: "
        "numery zleceń w zestawieniu KNF nie odpowiadają identyfikatorom z arkusza TREM. Definicja wymaga "
        "potwierdzenia przez biegłego."
    )

    payload = [{
        "case_id": c["id"], "kind": "obrot_miary", "chapter_no": "IV",
        "title": "Obrót Grupy wobec rynku w trzech miarach (dane źródłowe)",
        "status": "szkic", "body_md": "",
        "data": {"table": tables[0] if tables else None, "tables": tables, "findings": findings,
                 "wyniki": dane, "instrumenty": list(dane.keys())},
    }]
    req = urllib.request.Request(
        f"{base}/rest/v1/subanalyses?on_conflict=case_id,kind",
        data=json.dumps(payload, ensure_ascii=False).encode(),
        headers={**h, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"},
        method="POST")
    urllib.request.urlopen(req, timeout=180).read()

    print(f"\n✓ obrót w trzech miarach: {len(dane)} instrument(ów), {len(tables)} tabel")
    for f in findings[: 3 * len(dane)]:
        print(f"   • {f[:160]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
