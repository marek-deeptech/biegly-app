"""Budowanie payloadu inwentarza (wspólne dla API i generatora demo).

Wydzielone z serwera, bo dane akt leżą poza katalogiem projektu, a serwer
preview działa w piaskownicy ograniczonej do projektu. Payload generujemy więc
poza piaskownicą (CLI/Bash) i serwujemy jako plik z projektu — UI jest ten sam.
"""
from __future__ import annotations

from .report import build
from .taxonomy import DOC_TYPES, RECOMMENDED, REQUIRED


def build_payload(path: str, name: str | None = None) -> dict:
    res = build(path)
    total = len(res["records"])
    present = set(res["by_type"])
    return {
        "name": name or path,
        "path": path,
        "total": total,
        "classified": total - len(res["unknown"]),
        "prov": dict(res["by_prov"]),
        "by_type": [
            {"code": c, "count": n, "label": DOC_TYPES[c][0],
             "source": DOC_TYPES[c][1], "prov": DOC_TYPES[c][2]}
            for c, n in res["by_type"].most_common()
        ],
        "checklist": [
            {"label": DOC_TYPES[c][0], "present": c in present} for c in REQUIRED
        ],
        "recommended": [
            {"label": DOC_TYPES[c][0], "present": c in present} for c in RECOMMENDED
        ],
        "unknown": [r.path for r in res["unknown"]],
        "doc_types": [{"code": c, "label": DOC_TYPES[c][0]} for c in DOC_TYPES
                      if c != "UNKNOWN"],
    }
