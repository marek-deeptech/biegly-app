#!/usr/bin/env python3
"""Wskaźniki dodatkowe (NMaxC, WNK, Taker/Maker, VWAP, WT%, ŚczasT) — bieg na sprawie.

    python3 scripts/wskazniki_dodatkowe.py ZASTAL [--maks-sesji 40]

Liczy ODRĘBNIE DLA KAŻDEGO INSTRUMENTU (patrz lib/opinion/instrumenty.ts): sumowanie
wolumenów dwóch różnych papierów i zestawianie ich kursów nie daje wielkości o znaczeniu
ekonomicznym, a wskaźniki 1–3 porównują kolejne transakcje TEGO SAMEGO waloru.

Definicje i założenia metodyczne: engine/wskazniki_dodatkowe.py.
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
from engine.wskazniki_tabele import zloz  # noqa: E402

def _env() -> tuple[str, str]:
    out = {}
    sciezka = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env.local")
    for line in open(sciezka, encoding="utf8"):
        m = re.match(r"^([A-Z_]+)=(.*)$", line.strip())
        if m:
            out[m.group(1)] = m.group(2).strip().strip("\"'")
    return out["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/"), out["SUPABASE_SERVICE_ROLE_KEY"]


def pl(v, frac=0):
    if v is None:
        return "—"
    return f"{v:,.{frac}f}".replace(",", " ").replace(".", ",")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("sprawa")
    ap.add_argument("--maks-sesji", type=int, default=40, help="ile sesji w tabeli szczegółowej")
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
        print("✗ wskaźniki dodatkowe dotyczą spraw o manipulację GPW")
        return 1
    fragmenty = [str(x).strip().lower() for x in (c.get("group_roster") or {}).get("fragments", []) if str(x).strip()]
    if not fragmenty:
        print("✗ sprawa nie ma rostera Grupy (group_roster.fragments) — atrybucja byłaby zmyślona")
        return 1

    docs = get(f"documents?case_id=eq.{c['id']}&select=rel_path,storage_path&limit=3000")
    # ⚠️ DEDUP KOPII. Ten sam arkusz TREM leży w aktach w kilku TOM-ach: w sprawie
    # ZASTAL „UTP TREM CSY.xlsx” występuje trzy razy, więc bez odsiewu każda
    # transakcja liczyłaby się trzykrotnie — wolumen sesji rósł z 237 tys. do
    # 711 tys. sztuk, a udziały procentowe zostawały bez zmian, więc błąd nie
    # rzucał się w oczy. Klucz to nazwa pliku, tak samo jak w engine/uslugi/trem.py.
    widziane, pliki = set(), []
    for d in sorted(docs, key=lambda x: x["rel_path"]):
        nazwa = d["rel_path"].rsplit("/", 1)[-1]
        if not d.get("storage_path") or not re.search(r"(UTP )?TREM.*\.xlsx$", nazwa, re.I):
            continue
        if not str(d["storage_path"]).startswith(f"{c['id']}/"):  # izolacja spraw
            continue
        klucz = nazwa.strip().lower()
        if klucz in widziane:
            continue
        widziane.add(klucz)
        pliki.append(d)
    if not pliki:
        print("✗ w aktach nie ma plików TREM (arkusz transakcji sparowanych)")
        return 1
    print(f"plików TREM po odsiewie kopii: {len(pliki)}")

    wg_instrumentu: dict[str, list] = {}
    for d in pliki:
        nazwa = d["rel_path"].split("/")[-1]
        with urllib.request.urlopen(
            urllib.request.Request(f"{base}/storage/v1/object/case-files/{urllib.parse.quote(d['storage_path'])}", headers=h),
            timeout=600,
        ) as r:
            blob = r.read()
        try:
            rows = load_trem_paired(blob)
        except KeyError as e:
            print(f"  pomijam {nazwa}: {e}")
            continue
        for row in rows:
            isin = str(row.get("INSTRISIN") or row.get("SYMBOL") or "").strip()
            wg_instrumentu.setdefault(isin, []).append(row)
        print(f"  {nazwa}: {len(rows)} transakcji")

    z = zloz(wg_instrumentu, fragmenty, args.maks_sesji)
    tables, findings, wyniki = z["tables"], z["findings"], z["wyniki"]

    payload = [{
        "case_id": c["id"], "kind": "wskazniki_dodatkowe", "chapter_no": "IV",
        "title": "Wskaźniki dodatkowe (NMaxC, WNK, VWAP, WT%, Taker/Maker)",
        "status": "szkic", "body_md": "",
        "data": {"table": tables[0] if tables else None, "tables": tables, "findings": findings,
                 "wyniki": wyniki, "instrumenty": list(wyniki.keys())},
    }]
    req = urllib.request.Request(
        f"{base}/rest/v1/subanalyses?on_conflict=case_id,kind",
        data=json.dumps(payload, ensure_ascii=False).encode(),
        headers={**h, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"},
        method="POST")
    urllib.request.urlopen(req, timeout=180).read()

    print(f"\n✓ wskaźniki dodatkowe: {len(wyniki)} instrument(ów), {len(tables)} tabel")
    for f in findings[: 4 * len(wyniki)]:
        print(f"   • {f[:150]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
