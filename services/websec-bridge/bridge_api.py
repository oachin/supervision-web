"""
JSON bridge between Havet Supervision and the Web Security Audit Tool (EASM).

Authenticated with header ``X-Websec-Key`` (shared secret with Nest).
Runs scans via ``websec_audit.AuditConfig`` and exposes latest results from
the audit database, including live per-site progress while a scan runs.
"""

from __future__ import annotations

import os
import secrets
import threading
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from db.models import (
    delete_site_results,
    fleet_trend,
    get_site_state,
    latest_site_states,
    score_history,
)
from reports.generator import generate_report, generate_site_report
from websec_audit import CORE_SCANNERS, DEFAULT_SCANNERS, ENGINE_SCANNERS, AuditConfig

REPORT_OUT = Path(os.getenv("AUDIT_REPORT_DIR", "/data/reports"))

API_KEY = os.getenv("WEBSEC_API_KEY", "")
DB_URL = os.getenv("AUDIT_DB_URL", "sqlite:////data/audit.db")

# Conservative defaults: scanning all sites at once (AUDIT_WORKERS=auto) triggers
# Fail2Ban/CSF on shared hosting. Cap parallel sites + heavy engines.
def _env_int(name: str, default: int) -> int:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _parse_site_workers(raw: str | None, default: int = 3) -> int:
    """Positive = cap; auto/max/0 = one worker per site (legacy aggressive mode)."""
    if raw is None or not str(raw).strip():
        return default
    v = str(raw).strip().lower()
    if v in ("auto", "max"):
        return 0
    try:
        n = int(v)
    except ValueError:
        return default
    return n if n > 0 else 0


AUDIT_SITE_WORKERS = _parse_site_workers(os.getenv("AUDIT_WORKERS"), default=3)
AUDIT_ENGINE_WORKERS = max(1, _env_int("AUDIT_ENGINE_WORKERS", 2))
# Pause before each site starts (seconds). Softens burstiness toward the same IP.
AUDIT_SITE_STAGGER_SEC = max(0.0, float(os.getenv("AUDIT_SITE_STAGGER_SEC") or "0.4"))


def _spread_sites_by_host(sites: list[dict]) -> list[dict]:
    """Round-robin sites by hostname so parallel workers hit different hosts."""
    buckets: dict[str, list[dict]] = defaultdict(list)
    for s in sites:
        host = (s.get("domain") or urlparse(s.get("url") or "").hostname or "").lower()
        buckets[host or "_"].append(s)
    out: list[dict] = []
    while buckets:
        for host in list(buckets.keys()):
            out.append(buckets[host].pop(0))
            if not buckets[host]:
                del buckets[host]
    return out

app = FastAPI(title="Havet WebSec Bridge", version="1.1.0")

_scan_lock = threading.Lock()
_scan_state: dict[str, Any] = {
    "running": False,
    "trigger": None,
    "started_at": None,
    "finished_at": None,
    "error": None,
    "stats": None,
    "run_uuid": None,
    "progress": None,
    "total": 0,
    "done": 0,
    "percent": 0,
    "sites": [],
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
    return enabled or list(CORE_SCANNERS)


def _seed_progress(sites: list[dict]) -> list[dict]:
    return [
        {
            "url": s.get("url"),
            "name": s.get("name"),
            "status": "queued",
            "check": None,
            "checks_done": 0,
            "checks_total": 0,
            "percent": 0,
            "score": None,
            "grade": None,
            "findings": None,
            "error": None,
        }
        for s in sites
    ]


def _recompute_global_percent(locked: bool = False) -> None:
    """Weighted global % from per-site percent (call with lock held if locked=True)."""

    def _update() -> None:
        rows = _scan_state.get("sites") or []
        total = len(rows)
        _scan_state["total"] = total
        _scan_state["done"] = sum(1 for s in rows if s.get("status") in ("done", "error"))
        if total <= 0:
            _scan_state["percent"] = 0
            return
        _scan_state["percent"] = int(round(sum(int(s.get("percent") or 0) for s in rows) / total))

    if locked:
        _update()
    else:
        with _scan_lock:
            _update()


def _on_site_event(event: dict) -> None:
    url = event.get("url")
    etype = event.get("type")
    if etype == "site_start" and AUDIT_SITE_STAGGER_SEC > 0:
        time.sleep(AUDIT_SITE_STAGGER_SEC)
    with _scan_lock:
        site = next((s for s in _scan_state["sites"] if s.get("url") == url), None)
        if site is None:
            return
        if etype == "site_start":
            site["status"] = "scanning"
            site["checks_total"] = event.get("total") or site["checks_total"]
        elif etype == "check":
            site["status"] = "scanning"
            site["check"] = event.get("check")
            total = event.get("total") or site["checks_total"]
            index = event.get("index") or 0
            site["checks_total"] = total
            site["checks_done"] = max(0, index - 1)
            site["percent"] = int(100 * (index - 1) / total) if total else 0
        elif etype == "site_done":
            site["check"] = None
            site["percent"] = 100
            site["checks_done"] = site["checks_total"]
            if event.get("error"):
                site["status"] = "error"
                site["error"] = event.get("error")
            else:
                site["status"] = "done"
                site["score"] = event.get("score")
                site["grade"] = event.get("grade")
                site["findings"] = event.get("findings")
        _recompute_global_percent(locked=True)


def _run_scan(payload: ScanRequest) -> None:
    global _scan_state
    try:
        sites = _spread_sites_by_host([s.model_dump() for s in payload.sites])

        def on_progress(msg: str) -> None:
            with _scan_lock:
                _scan_state["progress"] = msg

        workers = AUDIT_SITE_WORKERS
        outcome = AuditConfig(
            sites=sites,
            enabled=_enabled(payload.deep),
            authorized=payload.authorized,
            max_workers=workers,
            engine_workers=AUDIT_ENGINE_WORKERS,
            db_url=DB_URL,
            generate_reports=False,
            min_confidence=os.getenv("AUDIT_MIN_CONFIDENCE") or None,
            verify_backports=os.getenv("AUDIT_VERIFY_BACKPORTS", "true").lower()
            in ("1", "true", "yes"),
        ).run(on_progress=on_progress, on_site_event=_on_site_event)

        with _scan_lock:
            _scan_state.update(
                {
                    "running": False,
                    "finished_at": datetime.utcnow().isoformat() + "Z",
                    "error": None,
                    "stats": outcome.get("stats"),
                    "run_uuid": outcome.get("run_uuid"),
                    "progress": "Terminé",
                    "percent": 100,
                    "done": _scan_state.get("total") or 0,
                }
            )
    except Exception as exc:  # noqa: BLE001 — surface to API
        with _scan_lock:
            _scan_state.update(
                {
                    "running": False,
                    "finished_at": datetime.utcnow().isoformat() + "Z",
                    "error": str(exc),
                    "progress": "Échec",
                }
            )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/v1/status", dependencies=[Depends(require_key)])
def status() -> dict[str, Any]:
    with _scan_lock:
        snapshot = dict(_scan_state)
        snapshot["sites"] = [dict(s) for s in _scan_state.get("sites", [])]
        return snapshot


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


@app.delete("/v1/sites", dependencies=[Depends(require_key)])
def delete_site(url: str = Query(...)) -> dict[str, Any]:
    """Purge scan history for a URL removed from Supervision targets."""
    if not (url or "").strip():
        raise HTTPException(400, "URL requise")
    deleted = delete_site_results(url.strip())
    return {"success": True, "url": url.strip(), **deleted}


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
    ordered = _spread_sites_by_host([s.model_dump() for s in payload.sites])
    with _scan_lock:
        if _scan_state["running"]:
            raise HTTPException(409, "Un scan est déjà en cours")
        seeded = _seed_progress(ordered)
        workers_label = "auto" if AUDIT_SITE_WORKERS <= 0 else str(AUDIT_SITE_WORKERS)
        _scan_state.update(
            {
                "running": True,
                "trigger": "api",
                "started_at": datetime.utcnow().isoformat() + "Z",
                "finished_at": None,
                "error": None,
                "stats": None,
                "run_uuid": None,
                "progress": f"Démarrage… (workers={workers_label}, engine={AUDIT_ENGINE_WORKERS})",
                "total": len(seeded),
                "done": 0,
                "percent": 0,
                "sites": seeded,
                "workers": AUDIT_SITE_WORKERS,
                "engine_workers": AUDIT_ENGINE_WORKERS,
            }
        )
    # Rebuild payload sites in spread order for the worker thread.
    payload = ScanRequest(
        sites=[SiteIn(**s) for s in ordered],
        deep=payload.deep,
        authorized=payload.authorized,
    )
    thread = threading.Thread(target=_run_scan, args=(payload,), daemon=True)
    thread.start()
    return {
        "started": True,
        "sites": len(ordered),
        "deep": payload.deep,
        "workers": AUDIT_SITE_WORKERS,
        "engine_workers": AUDIT_ENGINE_WORKERS,
    }
