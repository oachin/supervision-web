"""
dashboard/app.py
FastAPI + HTMX dashboard for the Web Security Audit Tool.

Screens
-------
* GET /                 global dashboard: fleet summary, grade distribution,
                        fleet score trend, and a sortable table of all sites,
                        with a "Run audit now" button.
* GET /site             per-site view: score-over-time chart, findings with
                        recommendations, run history, report downloads.
* POST /scan            trigger a background audit (HTMX) — returns a status card.
* GET  /scan/status     HTMX poll target for live scan progress.
* GET  /report/global   download the consolidated HTML/PDF report.
* GET  /report/site     download a single-site HTML/PDF report.

Everything reads from the same SQLite DB and reuses core.audit / scoring /
reports, so the CLI and the dashboard can never disagree.

Run:  uvicorn dashboard.app:app --reload
"""

from __future__ import annotations
import logging
import os
import secrets
from collections import Counter
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from fastapi import FastAPI, Form, Request
from fastapi.responses import (
    FileResponse, HTMLResponse, RedirectResponse, Response,
)
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from dashboard import auth

from core.audit import AUTO_WORKERS, DEFAULT_SCANNERS, ENGINE_SCANNERS
from core.diff import diff_findings
from dashboard.i18n import SEVERITY_ORDER, resolve_lang, strings
from dashboard.live_monitor import live_monitor
from dashboard.scan_manager import manager
from dashboard.schedule_manager import ScheduleManager, parse_schedule_at
from db.models import (
    REMEDIATION_STATUSES, attach_finding_statuses, fleet_trend, get_site_state,
    latest_site_states, previous_findings, set_finding_status,
)
from reports.charts import history_svg, sparkline_svg
from reports.generator import generate_report, generate_site_report

CONFIG_PATH = os.getenv("AUDIT_CONFIG", "config/targets.yaml")
# Env vars only seed the *initial* schedule; the admin edits it from the UI
# afterwards and that (DB-persisted) choice takes over. See ScheduleManager.
SCHEDULE_MINUTES = int(os.getenv("AUDIT_SCHEDULE_MINUTES", "0"))
SCHEDULE_AT_ENV = os.getenv("AUDIT_SCHEDULE_AT", "")

# Backwards-compatible alias kept for tests/imports.
_parse_schedule_at = parse_schedule_at

logging.basicConfig(level=os.getenv("AUDIT_LOG_LEVEL", "INFO"))
logger = logging.getLogger("dashboard.app")
# Max parallel site scans. "auto"/"max" (or <= 0) scans every site at once;
# a positive integer caps it. Defaults to auto so the dashboard maxes out.
def _parse_workers(raw: str) -> int:
    if raw.strip().lower() in ("auto", "max"):
        return AUTO_WORKERS
    try:
        return int(raw)
    except ValueError:
        return AUTO_WORKERS


SCAN_WORKERS = _parse_workers(os.getenv("AUDIT_WORKERS", "auto"))


def _is_true(value: str) -> bool:
    return value.strip().lower() in ("1", "true", "yes", "on")


# Deep mode runs the external-engine scanners (testssl/nuclei/zap) in addition
# to the fast core set. Off by default because the engines are heavy and need
# their binaries installed. AUDIT_AUTHORIZED confirms written authorization
# (enables the port scan + nuclei's intrusive templates).
SCAN_DEEP = _is_true(os.getenv("AUDIT_DEEP", ""))
SCAN_AUTHORIZED = _is_true(os.getenv("AUDIT_AUTHORIZED", ""))


def _enabled_scanners() -> list[str]:
    enabled = list(DEFAULT_SCANNERS)
    if SCAN_DEEP:
        enabled += [s for s in ENGINE_SCANNERS if s not in enabled]
    return enabled


def _run_scheduled_audit() -> None:
    logger.info("Scheduled trigger fired")
    started = manager.start(CONFIG_PATH, enabled=_enabled_scanners(),
                            authorized=SCAN_AUTHORIZED, workers=SCAN_WORKERS,
                            trigger="scheduled")
    if not started:
        logger.warning("Scheduled trigger did NOT start a scan — one was already running.")


# Owns the live, admin-editable scan schedule (see dashboard/schedule_manager.py).
schedule_manager = ScheduleManager(_run_scheduled_audit)

# Live availability/cert monitor cadence (seconds). 0 disables it.
LIVE_INTERVAL_SECONDS = int(os.getenv("AUDIT_LIVE_INTERVAL", "60"))
# How often the browser re-polls the live panel (seconds).
LIVE_REFRESH_SECONDS = max(5, int(os.getenv("AUDIT_LIVE_REFRESH", "15")))

TEMPLATES = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))
TEMPLATES.env.filters["history_svg"] = history_svg
TEMPLATES.env.filters["sparkline_svg"] = sparkline_svg

LANG_COOKIE = "lang"
COOKIE_MAX_AGE = 60 * 60 * 24 * 365  # 1 year


def render(request: Request, template: str, ctx: dict) -> Response:
    """Render a template with the active language + translations, and persist the
    language choice in a cookie so every subsequent page stays in that language."""
    lang = resolve_lang(request.query_params.get("lang"), request.cookies.get(LANG_COOKIE))
    other = "fr" if lang == "en" else "en"
    ctx = {
        **ctx,
        "lang": lang,
        "other_lang": other,
        "t": strings(lang),
        "url_en": str(request.url.include_query_params(lang="en")),
        "url_fr": str(request.url.include_query_params(lang="fr")),
        "csp_nonce": getattr(request.state, "csp_nonce", ""),
        "authed": auth.auth_enabled() and auth.valid_session(
            request.cookies.get(auth.SESSION_COOKIE)),
    }
    response = TEMPLATES.TemplateResponse(request, template, ctx)
    response.set_cookie(LANG_COOKIE, lang, max_age=COOKIE_MAX_AGE, samesite="lax")
    return response

@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Continuous monitoring: a fast live-availability loop always runs, and the
    admin-editable scan scheduler runs the heavy audit at the chosen time(s)."""
    if LIVE_INTERVAL_SECONDS > 0:
        live_monitor.start(CONFIG_PATH, interval=LIVE_INTERVAL_SECONDS)
    # Load the persisted schedule (seeded from env vars on first ever boot) and
    # start the scheduler so the admin can edit it live from the UI.
    schedule_manager.load(env_at=SCHEDULE_AT_ENV, env_minutes=SCHEDULE_MINUTES)
    schedule_manager.start()
    try:
        yield
    finally:
        live_monitor.stop()
        schedule_manager.shutdown()


app = FastAPI(title="Web Security Audit Dashboard", lifespan=lifespan)

# Self-hosted frontend assets (Tailwind CSS build + vendored htmx/Chart.js), so
# the dashboard has no runtime CDN dependency and works fully offline.
app.mount("/static", StaticFiles(directory=str(Path(__file__).parent / "static")),
          name="static")

# Paths reachable without a session (the login gate itself + static assets).
_PUBLIC_PREFIXES = ("/static", "/login", "/favicon", "/healthz")
# Content-Security-Policy: no runtime CDN, so everything is same-origin. Scripts
# are 'self' + a per-response nonce (the data-driven chart inits carry it); no
# 'unsafe-inline' for scripts. Inline style attributes are still allowed.
_CSP_TEMPLATE = (
    "default-src 'self'; "
    "script-src 'self' 'nonce-{nonce}'; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data:; "
    "connect-src 'self'; "
    "base-uri 'self'; "
    "form-action 'self'; "
    "frame-ancestors 'none'; "
    "object-src 'none'"
)
_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
}


def _is_public_path(path: str) -> bool:
    return any(path == p or path.startswith(p + "/") or path.startswith(p)
              for p in _PUBLIC_PREFIXES)


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    """Per-request CSP nonce, the auth gate, and hardening response headers."""
    request.state.csp_nonce = secrets.token_urlsafe(16)

    # Auth gate: block everything but public paths until logged in.
    if auth.auth_enabled() and not _is_public_path(request.url.path):
        if not auth.valid_session(request.cookies.get(auth.SESSION_COOKIE)):
            if request.method == "GET":
                return RedirectResponse("/login", status_code=303)
            return Response("Authentication required", status_code=401)

    response = await call_next(request)

    # Report downloads are standalone generated HTML with their own inline
    # assets — don't impose the dashboard CSP on them.
    if not request.url.path.startswith("/report"):
        response.headers["Content-Security-Policy"] = _CSP_TEMPLATE.format(
            nonce=request.state.csp_nonce)
    for key, value in _SECURITY_HEADERS.items():
        response.headers.setdefault(key, value)
    return response


@app.get("/login", response_class=HTMLResponse)
def login_form(request: Request, error: bool = False):
    # If auth is disabled, or the visitor is already authenticated, skip the form.
    if not auth.auth_enabled() or auth.valid_session(
            request.cookies.get(auth.SESSION_COOKIE)):
        return RedirectResponse("/", status_code=303)
    return render(request, "login.html", {"error": error})


@app.post("/login")
def login_submit(request: Request, username: str = Form(""),
                 password: str = Form("")):
    if not auth.auth_enabled():
        return RedirectResponse("/", status_code=303)
    if not auth.verify_credentials(username, password):
        return RedirectResponse("/login?error=1", status_code=303)
    response = RedirectResponse("/", status_code=303)
    response.set_cookie(auth.SESSION_COOKIE, auth.issue_session(),
                        httponly=True, samesite="lax", secure=auth.secure_cookie(),
                        max_age=None)
    return response


@app.post("/logout")
def logout():
    response = RedirectResponse("/login", status_code=303)
    response.delete_cookie(auth.SESSION_COOKIE)
    return response


def _fleet_stats(states: list[dict]) -> dict:
    scores = [s["score"] for s in states if s.get("score") is not None]
    grade_counts = Counter(s.get("grade") for s in states)
    critical_sites = sum(
        1 for s in states
        if any(f.get("severity") == "critical" for f in s.get("findings", []))
    )
    at_risk = sum(1 for s in scores if s < 60)

    sev_counts: Counter = Counter()
    cat_counts: Counter = Counter()
    open_findings = 0
    clean_sites = 0
    for s in states:
        actionable = [f for f in s.get("findings", []) if f.get("severity") != "info"]
        if not actionable:
            clean_sites += 1
        for f in s.get("findings", []):
            sev_counts[f.get("severity")] += 1
            if f.get("severity") != "info":
                cat_counts[f.get("category") or "other"] += 1
                open_findings += 1

    categories = cat_counts.most_common()
    return {
        "total": len(states),
        "avg_score": round(sum(scores) / len(scores), 1) if scores else None,
        "critical_sites": critical_sites,
        "at_risk": at_risk,
        "clean_sites": clean_sites,
        "open_findings": open_findings,
        "grades": [grade_counts.get(g, 0) for g in ["A", "B", "C", "D", "E", "F"]],
        "severity": [sev_counts.get(sev, 0) for sev in SEVERITY_ORDER],
        "category_labels": [c for c, _ in categories],
        "category_counts": [n for _, n in categories],
    }


def _top_issues(states: list[dict], limit: int = 8) -> list[dict]:
    """Most frequent actionable findings across the fleet (by finding code)."""
    counts: Counter = Counter()
    meta: dict[str, dict] = {}
    for s in states:
        seen: set[str] = set()
        for f in s.get("findings", []):
            if f.get("severity") == "info":
                continue
            key = f.get("code") or f.get("message") or "unknown"
            if key in seen:
                continue
            seen.add(key)
            counts[key] += 1
            meta.setdefault(key, {
                "message": f.get("message"),
                "severity": f.get("severity"),
                "category": f.get("category"),
            })
    return [
        {**meta[key], "count": n}
        for key, n in counts.most_common(limit)
    ]


def _fleet_changes(states: list[dict]) -> dict:
    """Aggregate what changed across the fleet since each site's previous scan.

    Powers the "changes since last scan" panel: counts of newly-appeared
    critical/high findings and of resolved findings, plus the per-site rows that
    actually changed (so an admin can see regressions and fixes at a glance).
    """
    new_critical = new_high = resolved_total = 0
    changed: list[dict] = []
    for s in states:
        delta = diff_findings(s.get("findings", []), previous_findings(s["url"]))
        if not delta["new"] and not delta["resolved"]:
            continue
        nc = sum(1 for f in delta["new"] if f.get("severity") == "critical")
        nh = sum(1 for f in delta["new"] if f.get("severity") == "high")
        new_critical += nc
        new_high += nh
        resolved_total += len(delta["resolved"])
        changed.append({
            "name": s.get("name"),
            "url": s.get("url"),
            "new": len(delta["new"]),
            "resolved": len(delta["resolved"]),
        })
    return {
        "new_critical": new_critical,
        "new_high": new_high,
        "resolved": resolved_total,
        "sites": changed,
        "any": bool(changed),
    }


def _live_ctx() -> dict:
    """Current live snapshot + summary for the auto-refreshing status panel."""
    sites = live_monitor.snapshot()
    up = sum(1 for s in sites if s.get("up"))
    updated_secs = None
    stamps = [s.get("checked_at") for s in sites if s.get("checked_at")]
    if stamps:
        newest = max(datetime.fromisoformat(t) for t in stamps)
        updated_secs = int((datetime.now(timezone.utc) - newest).total_seconds())
    return {
        "live_sites": sites,
        "live_up": up,
        "live_down": len(sites) - up,
        "live_total": len(sites),
        "live_updated_secs": updated_secs,
        "live_refresh": LIVE_REFRESH_SECONDS,
    }
    


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    states = latest_site_states()
    return render(request, "index.html", {
        "states": states,
        "stats": _fleet_stats(states),
        "top_issues": _top_issues(states),
        "changes": _fleet_changes(states),
        "trend": fleet_trend(limit=30),
        "scan": manager.state,
        "poll": False,
        "scheduled": schedule_manager.interval_minutes,
        "scheduled_at": schedule_manager.times_str,
        "schedule_saved": request.query_params.get("schedule") == "saved",
        **_live_ctx(),
        **_schedule_ctx(),
        "schedule_tz": schedule_manager.timezone_name,
    })


@app.post("/schedule", response_class=HTMLResponse)
def update_schedule(request: Request, times: str = Form(""),
                    interval_minutes: str = Form("0")):
    """Admin sets the automatic-scan schedule from the dashboard.

    ``times`` is a comma-separated list of 24-hour HH:MM values; invalid entries
    are ignored. The schedule is persisted and the live scheduler re-programmed
    immediately (no restart)."""
    try:
        minutes = max(0, int(interval_minutes))
    except (ValueError, TypeError):
        minutes = 0
    schedule_manager.update(parse_schedule_at(times), minutes)
    # Redirect (PRG) so a refresh doesn't re-submit the form.
    return Response(status_code=303, headers={"Location": "/?schedule=saved"})


@app.get("/live/status", response_class=HTMLResponse)
def live_status(request: Request):
    return render(request, "_live_status.html", _live_ctx())


@app.get("/site", response_class=HTMLResponse)
def site_detail(request: Request, url: str):
    state = get_site_state(url)
    attach_finding_statuses(state)
    delta = diff_findings(state["findings"], previous_findings(url)) if state else {"new": [], "resolved": []}
    new_keys = [[f.get("code"), f.get("message")] for f in delta["new"]]
    return render(request, "site.html", {
        "site": state,
        "identifier": url,
        "new_keys": new_keys,
        "resolved": delta["resolved"],
        "statuses": REMEDIATION_STATUSES,
    })


@app.post("/finding/status", response_class=HTMLResponse)
def update_finding_status(request: Request, url: str = Form(...),
                          code: str = Form(""), message: str = Form(""),
                          status: str = Form(...)):
    try:
        set_finding_status(url, code, message, status)
    except ValueError:
        return HTMLResponse("Invalid status", status_code=400)
    return render(request, "_finding_status.html", {
        "f": {"code": code, "message": message, "status": status},
        "url": url,
        "statuses": REMEDIATION_STATUSES,
    })


@app.post("/scan", response_class=HTMLResponse)
def trigger_scan(request: Request):
    manager.start(CONFIG_PATH, enabled=_enabled_scanners(),
                  authorized=SCAN_AUTHORIZED, workers=SCAN_WORKERS, trigger="manual")
    return render(request, "_scan_status.html", {
        "scan": manager.state, "poll": True,
        **_schedule_ctx(),
    })


@app.get("/scan/status", response_class=HTMLResponse)
def scan_status(request: Request, poll: bool = False):
    state = manager.state
    # When a polled scan has *just* finished successfully, ask HTMX to do a full
    # page reload rather than swap the body: a real navigation re-runs the
    # Chart.js init scripts, so the grade/trend charts render again. This fires
    # exactly once per scan (consume_reload), so later polls don't keep
    # reloading the page and wiping in-progress input / scroll position.
    if poll and manager.consume_reload():
        return Response(status_code=204, headers={"HX-Refresh": "true"})
    return render(request, "_scan_status.html", {
        "scan": state, "poll": poll,
        **_schedule_ctx(),
    })


@app.get("/report/global")
def report_global(request: Request, fmt: str = "html"):
    states = latest_site_states()
    for st in states:
        attach_finding_statuses(st)
    lang = resolve_lang(request.query_params.get("lang"), request.cookies.get(LANG_COOKIE))
    paths = generate_report(states, lang=lang)
    return _serve_report(paths, fmt)


@app.get("/report/site")
def report_site(request: Request, url: str, fmt: str = "html"):
    state = get_site_state(url)
    if state is None:
        return HTMLResponse("Unknown site", status_code=404)
    attach_finding_statuses(state)
    lang = resolve_lang(request.query_params.get("lang"), request.cookies.get(LANG_COOKIE))
    paths = generate_site_report(state, lang=lang)
    return _serve_report(paths, fmt)


def _serve_report(paths: dict, fmt: str):
    if fmt == "pdf" and paths.get("pdf"):
        return FileResponse(str(paths["pdf"]), media_type="application/pdf",
                            filename=Path(paths["pdf"]).name)
    return FileResponse(str(paths["html"]), media_type="text/html",
                        filename=Path(paths["html"]).name)

def _schedule_ctx() -> dict:
    return {
        "next_interval_at": schedule_manager.next_interval_run_at,
        "next_at_at": schedule_manager.next_at_run_at,
    }
