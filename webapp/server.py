"""FastAPI: serwuje UI i wystawia klasyfikację intake jako API.

To prototyp lokalny — wskazujemy katalog sprawy na dysku (tak, jak dane leżą
dziś). Wersja produkcyjna zastąpi to wgrywaniem plików do chmury UE.

Uruchomienie:
    uvicorn webapp.server:app --port 8000
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Optional

from fastapi import FastAPI
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from intake.payload import build_payload  # noqa: E402

app = FastAPI(title="Biegły GPW — intake")
STATIC = Path(__file__).parent / "static"

# Skróty do dwóch realnych spraw (slug -> etykieta). Wyniki są pre-generowane
# do static/cases/<slug>.json (serwer preview nie ma dostępu poza projekt).
KNOWN_CASES = {
    "hubtech": "HubTech (RP I Ds 4.2019)",
    "milisystem": "Milisystem (RP I Ds 4.2019)",
}


class CaseReq(BaseModel):
    path: str
    name: Optional[str] = None


@app.get("/api/cases")
def cases():
    return KNOWN_CASES


@app.get("/cases/{slug}")
def case_json(slug: str):
    """Pre-generowany inwentarz znanej sprawy (demo)."""
    return JSONResponse(json.loads((STATIC / "cases" / f"{slug}.json").read_text("utf-8")))


@app.post("/api/classify")
def classify(req: CaseReq):
    """Klasyfikacja katalogu na żądanie (działa, gdy katalog jest dostępny)."""
    return build_payload(req.path, req.name)


@app.get("/", response_class=HTMLResponse)
def index():
    return (STATIC / "index.html").read_text(encoding="utf-8")
