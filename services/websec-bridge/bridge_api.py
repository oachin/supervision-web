"""
JSON bridge between Havet Supervision and the Web Security Audit Tool (EASM).

Authenticated with header ``X-Websec-Key`` (shared secret with Nest).
Runs scans via ``websec_audit.AuditConfig`` and exposes latest results from
the audit database.
"""

from __future__ import annotations

import os
import secrets
import threading
from typing import Any

from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from db.models import fleet_trend, get_site_state, latest_site_states, score_history
from reports.generator import generate_report, generate_site_report
from websec_audit import CORE_SCANNERS, DEFAULT_SCANNERS, ENGINE_SCANNERS, AuditConfig

REPORT_OUT = Path(os.getenv("AUDIT_REPORT_DIR", "/data/reports"))

API_KEY = os.getenv("WEBSEC_API_KEY", "")
DB_URL = os.getenv("AUDIT_DB_URL", "sqlite:////data/audit.db")

app = FastAPI(title="Havet WebSec Bridge", version="1.0.0")

_scan_lock = threading.Lock()
_scan_state: dict[str, Any] = {
    "running": False,
    "trigger": None,
    "started_at": None,
    "finished_at": None,
    "error": None,
    "stats": None,
    "run_uuid": None,
}


def require_key(x_websec_key: str | None = Header(default=None)) -> None:
    if not API_KEY:
        raise HTTPException(503, "WEBSEC_API_KEY non configurée")
    if not x_websec_key or not secrets.compare_digest(x_websec_key, API_KEY):
        raise HTTPException(401, "Clé API invalide")


class SiteIn(BaseModel):
    name: str
    url: str
    domain: str | None = None


class ScanRequest(BaseModel):
    sites: list[SiteIn] = Field(default_factory=list)
    deep: bool = False
    authorized: bool = False
    workers: int | None = None


def _enabled(deep: bool) -> list[str]:
    enabled = list(DEFAULT_SCANNERS)
    if deep:
        for s in ENGINE_SCANNERS:
            if s not in enabled:
                enabled.append(s)
    # Prefer core when DEFAULT is empty for safety
    return enabled or list(CORE_SCANNERS)


def _run_scan(payload: ScanRequest) -> None:
    global _scan_state
    try:
        sites = [s.model_dump() for s in payload.sites]
        outcome = AuditConfig(
            sites=sites,
            enabled=_enabled(payload.deep),
            authorized=payload.authorized,
            engine_workers=int(os.getenv("AUDIT_ENGINE_WORKERS", "4") or 4),
            db_url=DB_URL,
            generate_reports=False,
            min_confidence=os.getenv("AUDIT_MIN_CONFIDENCE") or None,
            verify_backports=os.getenv("AUDIT_VERIFY_BACKPORTS", "true").lower()
            in ("1", "true", "yes"),
        ).run()
        with _scan_lock:
            _scan_state.update(
                {
                    "running": False,
                    "finished_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
                    "error": None,
                    "stats": outcome.get("stats"),
                    "run_uuid": outcome.get("run_uuid"),
                }
            )
    except Exception as exc:  # noqa: BLE001 — surface to API
        with _scan_lock:
            _scan_state.update(
                {
                    "running": False,
                    "finished_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
                    "error": str(exc),
                }
            )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/v1/status", dependencies=[Depends(require_key)])
def status() -> dict[str, Any]:
    with _scan_lock:
        return dict(_scan_state)


@app.get("/v1/sites", dependencies=[Depends(require_key)])
def list_sites(limit: int = 500, offset: int = 0) -> dict[str, Any]:
    states = latest_site_states(limit=limit, offset=offset)
    return {"sites": states, "count": len(states)}


@app.get("/v1/sites/by-url", dependencies=[Depends(require_key)])
def site_by_url(url: str) -> dict[str, Any]:
    state = get_site_state(url)
    if not state:
        raise HTTPException(404, "Aucun résultat pour cette URL")
    return state


@app.get("/v1/trend", dependencies=[Depends(require_key)])
def trend(limit: int = 30) -> dict[str, Any]:
    return {"trend": fleet_trend(limit=limit)}


@app.get("/v1/history", dependencies=[Depends(require_key)])
def history(url: str = Query(...), limit: int = 30) -> dict[str, Any]:
    return {"url": url, "history": score_history(url, limit=limit)}


def _serve_report(paths: dict, fmt: str) -> FileResponse:
    fmt = (fmt or "html").lower()
    if fmt == "pdf":
        if not paths.get("pdf"):
            raise HTTPException(
                503,
                "PDF indisponible (WeasyPrint ou dépendances manquantes)",
            )
        path = Path(paths["pdf"])
        return FileResponse(
            str(path),
            media_type="application/pdf",
            filename=path.name,
        )
    path = Path(paths["html"])
    return FileResponse(
        str(path),
        media_type="text/html; charset=utf-8",
        filename=path.name,
    )


@app.get("/v1/report/global", dependencies=[Depends(require_key)])
def report_global(fmt: str = "html", lang: str = "fr") -> FileResponse:
    states = latest_site_states()
    if not states:
        raise HTTPException(404, "Aucun résultat de scan à exporter")
    paths = generate_report(states, out_dir=str(REPORT_OUT), lang=lang or "fr")
    return _serve_report(paths, fmt)


@app.get("/v1/report/site", dependencies=[Depends(require_key)])
def report_site(
    url: str = Query(...),
    fmt: str = "html",
    lang: str = "fr",
) -> FileResponse:
    state = get_site_state(url)
    if not state:
        raise HTTPException(404, "Aucun résultat pour cette URL")
    paths = generate_site_report(state, out_dir=str(REPORT_OUT), lang=lang or "fr")
    return _serve_report(paths, fmt)


@app.post("/v1/scan", dependencies=[Depends(require_key)])
def start_scan(payload: ScanRequest) -> dict[str, Any]:
    if not payload.sites:
        raise HTTPException(400, "Aucune cible à scanner")
    with _scan_lock:
        if _scan_state["running"]:
            raise HTTPException(409, "Un scan est déjà en cours")
        _scan_state.update(
            {
                "running": True,
                "trigger": "api",
                "started_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
                "finished_at": None,
                "error": None,
                "stats": None,
                "run_uuid": None,
            }
        )
    thread = threading.Thread(target=_run_scan, args=(payload,), daemon=True)
    thread.start()
    return {"started": True, "sites": len(payload.sites), "deep": payload.deep}
