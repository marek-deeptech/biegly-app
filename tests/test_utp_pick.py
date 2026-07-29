"""Blokada wyboru GŁÓWNEGO pliku UTP spośród wielu wariantów w aktach.

Detektor (Spoofing/Layering, metryki, TREM) MUSI liczyć z najnowszego, najpełniejszego
wariantu skonsolidowanego arkusza — nie z pliku cząstkowego per dzień ani starszej wersji.
Nazwy i rozmiary = realne dane z akt HUBTECH i MLM (Supabase, doc_type=DANE_UTP).

Reguła: (1) tylko plik konsolidowany (nie „zrodlo"), (2) najwyższa wersja w nazwie
(-4, _pop, _pop2, final), (3) największy rozmiar jako dogrywka (kompletność).
Logika bliźniacza w TS: lib/intake/utp.ts.
"""
import importlib.util
import os

_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("api_spoofing", os.path.join(_HERE, "api", "spoofing.py"))
api_spoofing = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(api_spoofing)
_is_main = api_spoofing._is_main
_version = api_spoofing._utp_version_key


def _pick(files):
    """Odtwarza wybór z api/spoofing.py: filtr .xlsx + _is_main, sort (wersja, rozmiar) malejąco."""
    cand = [d for d in files if str(d["rel_path"]).lower().endswith(".xlsx")]
    pick = [d for d in cand if _is_main(d["rel_path"])] or cand
    pick.sort(key=lambda d: (_version(d["rel_path"]), d.get("size_bytes") or 0), reverse=True)
    return pick[0]["rel_path"].rsplit("/", 1)[-1]


# ── realne akta HUBTECH (10 plików DANE_UTP) ──────────────────────────────────
HUBTECH = [
    {"rel_path": "HUBTECH/x/Transakcje_i_Zlecenia_HUBTech 2020 prok.xlsx", "size_bytes": 32_530_364},
    {"rel_path": "HUBTECH/x/Transakcje_i_Zlecenia_HUBTech 2020 prok-4.xlsx", "size_bytes": 55_415_801},
    {"rel_path": "HUBTECH/x/Transakcje_i_Zlecenia_HUBTech 2020 prok-4_pop.xlsx", "size_bytes": 59_994_553},
    {"rel_path": "HUBTECH/x/Transakcje_i_Zlecenia_HUBTech 2020 prok-4_pop2.xlsx", "size_bytes": 59_751_673},
    {"rel_path": "HUBTECH/x/Zlecenia i transakcje_zrodlo_8.10.2020.xlsx", "size_bytes": 5_638_933},
    {"rel_path": "HUBTECH/x/zlecenia_zrodlo_2020-09-11.xlsx", "size_bytes": 532_190},
]

# ── realne akta MLM (dwie kopie tego samego pliku + większy plik o innej nazwie) ─
MLM = [
    {"rel_path": "MLM/MLM INPUT/UTP_Transakcje_i_Zlecenia_Milisystem_RP 1 Ds 4.2019.xlsx", "size_bytes": 10_721_232},
    {"rel_path": "MLM/uzup/UTP_Transakcje_i_Zlecenia_Milisystem_RP 1 Ds 4.2019.xlsx", "size_bytes": 10_363_432},
    {"rel_path": "MLM/x/MIL_TWO_TKO.xlsx", "size_bytes": 19_635_734},
]


def test_hubtech_picks_latest_variant():
    # najnowszy wg wersji (_pop2), CHOĆ _pop jest odrobinę większy — wersja > rozmiar
    assert _pick(HUBTECH) == "Transakcje_i_Zlecenia_HUBTech 2020 prok-4_pop2.xlsx"


def test_mlm_picks_fullest_copy():
    # brak wersji w nazwie → wygrywa większa (pełniejsza) kopia; MIL_TWO_TKO wykluczony (nie konsolidowany)
    assert _pick(MLM) == "UTP_Transakcje_i_Zlecenia_Milisystem_RP 1 Ds 4.2019.xlsx"
    assert _pick(MLM).startswith("UTP_")
    winner = next(d for d in MLM if d["rel_path"].endswith(_pick(MLM)) and d["size_bytes"] == 10_721_232)
    assert winner["size_bytes"] == 10_721_232


def test_zrodlo_and_offname_excluded_from_main():
    assert not _is_main("HUBTECH/x/Zlecenia i transakcje_zrodlo_8.10.2020.xlsx")
    assert not _is_main("HUBTECH/x/zlecenia_zrodlo_2020-09-11.xlsx")
    assert not _is_main("MLM/x/MIL_TWO_TKO.xlsx")
    assert _is_main("HUBTECH/x/Transakcje_i_Zlecenia_HUBTech 2020 prok-4_pop2.xlsx")


def test_version_key_ordering():
    v = lambda n: _version("x/" + n)  # noqa: E731
    assert v("Transakcje_i_Zlecenia_HUBTech 2020 prok.xlsx") == (0, 0, 0)
    assert v("Transakcje_i_Zlecenia_HUBTech 2020 prok-4.xlsx") == (0, 4, 0)
    assert v("Transakcje_i_Zlecenia_HUBTech 2020 prok-4_pop.xlsx") == (0, 4, 1)
    assert v("Transakcje_i_Zlecenia_HUBTech 2020 prok-4_pop2.xlsx") == (0, 4, 2)
    # monotoniczność
    assert v("...prok.xlsx") < v("...prok-4.xlsx") < v("...prok-4_pop.xlsx") < v("...prok-4_pop2.xlsx")


def test_dates_and_signature_not_mistaken_for_version():
    # „2020", „4.2019", „8.10.2020" NIE mogą podbijać numeru wersji
    assert _version("MLM/x/UTP_Transakcje_i_Zlecenia_Milisystem_RP 1 Ds 4.2019.xlsx") == (0, 0, 0)
    assert _version("HUBTECH/x/Transakcje_i_Zlecenia_HUBTech 2020 prok.xlsx") == (0, 0, 0)


def test_final_marker_wins():
    assert _version("x/UTP_2020_final.xlsx")[0] == 1
    assert _version("x/UTP_2020_final.xlsx") > _version("x/UTP_2020 prok-9_pop9.xlsx")
