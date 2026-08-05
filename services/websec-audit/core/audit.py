"""
core/audit.py
Reusable audit orchestration shared by the CLI and the web dashboard.

This is the single place that knows how to turn a list of target sites into
scored, persisted, reported results. Both `main.py` (CLI) and the FastAPI
dashboard call `run_audit()` so the two front-ends can never drift apart.

Concurrency
-----------
Scanning is network-bound (TLS handshakes, DNS, HTTP), not CPU-bound, so sites
are scanned in parallel with a bounded thread pool. Because each worker spends
almost all of its time waiting on the network, the pool can be far larger than
the CPU count; it is limited by file descriptors and network capacity, not
cores.

By default the pool auto-sizes to one worker per site (`max_workers <= 0`), so
every site is scanned at the same time, capped at `MAX_WORKERS_CAP` to protect
the host and the targets from an unreasonable burst of connections. A full
sweep of a few hundred sites therefore takes about as long as the single
slowest site rather than the sum of all of them. Result order always matches
the input order, regardless of completion order.
"""

from __future__ import annotations

import concurrent.futures
import contextlib
import logging
import os
import threading
import time
import uuid
from pathlib import Path
from typing import Callable
from urllib.parse import urlparse

import yaml

from core.diff import diff_findings
from scanners._http import audit_session
from scanners.availability import check_availability
from scanners.tls import check_tls
from scanners.headers import check_headers
from scanners.dns_auth import check_dns_auth
from scanners.takeover import check_takeover
from scanners.misconfig import check_misconfig
from scanners.cve import check_cve
from scanners.nuclei import check_nuclei
from scanners.testssl import check_testssl
from scanners.zap import check_zap
from scanners.ports import check_ports
from scoring.engine import score_all

logger = logging.getLogger("websec_audit")

# Fast, always-safe posture checks (network/config hygiene).
CORE_SCANNERS = ["availability", "tls", "headers", "dns_auth", "takeover",
                 "misconfig", "cve"]
# External-engine scanners: much deeper, but heavy (spawn a subprocess, spider,
# many requests) and require the engine binaries installed. Opt-in, not default.
ENGINE_SCANNERS = ["testssl", "nuclei", "zap"]
ALL_SCANNERS = CORE_SCANNERS + ENGINE_SCANNERS + ["ports"]
# The default sweep is the fast core set. Ports needs written authorization and
# the engine scanners are slow, so both are opt-in (enable via --scan / --deep).
DEFAULT_SCANNERS = list(CORE_SCANNERS)
# 0 (or any non-positive value) means "auto": use one worker per site so every
# site is scanned in parallel. This is the default; scanning is IO-bound, so
# maxing out concurrency is the fast, sensible choice.
AUTO_WORKERS = 0
DEFAULT_MAX_WORKERS = AUTO_WORKERS
# Absolute ceiling on the pool size, even in auto mode. Threads are cheap for
# IO-bound work, but each concurrent scan still costs sockets/file descriptors
# and connection slots, so we cap the burst to keep the host and targets safe.
# 500 leaves generous headroom above the ~150-site fleet this tool targets so
# growth "just works"; raise it further if you scan into the thousands.
MAX_WORKERS_CAP = 500


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (ValueError, TypeError):
        return default


# Automatic false-positive / noise reduction. When set, findings below this
# confidence tier ("low" < "potential" < "confirmed") are dropped from the
# score, reports and alerts with no manual triage. "confirmed" keeps only
# actively-verified detections (nuclei/ZAP/testssl) and directly-observed facts;
# "potential" additionally keeps precise CPE version matches but drops fuzzy
# keyword guesses. Empty/unset keeps every finding (no filtering).
_VALID_CONFIDENCE = {"low", "potential", "confirmed"}


def _env_min_confidence() -> str | None:
    raw = (os.getenv("AUDIT_MIN_CONFIDENCE") or "").strip().lower()
    return raw if raw in _VALID_CONFIDENCE else None


# The engine scanners (testssl/nuclei/zap) each spawn a heavy subprocess, so —
# unlike the IO-bound core checks — running one per site would fork hundreds of
# CPU/RAM-hungry processes at fleet scale and melt the host. They are therefore
# gated by a separate, much smaller global concurrency limit, independent of the
# site-level pool: the fleet is still walked in parallel, but only this many
# engine subprocesses run at any instant. Tune with AUDIT_ENGINE_WORKERS.
ENGINE_MAX_CONCURRENCY = max(1, _env_int("AUDIT_ENGINE_WORKERS", 4))
_engine_semaphore = threading.BoundedSemaphore(ENGINE_MAX_CONCURRENCY)


@contextlib.contextmanager
def _engine_slot(gate: threading.BoundedSemaphore | None):
    """Acquires an engine-concurrency slot (no-op when gating is disabled)."""
    if gate is None:
        yield
        return
    with gate:
        yield


ProgressFn = Callable[[str], None]
# Structured, per-site progress events for a live UI (one row per site). The
# payload is a dict with a ``type`` key: ``site_start`` / ``check`` / ``site_done``
# (see ``scan_site`` / ``run_scans`` for the exact fields).
SiteEventFn = Callable[[dict], None]

# Human-facing check order/labels for the live progress view, in run order.
SITE_CHECK_ORDER = ["availability", "tls", "headers", "dns_auth", "takeover",
                    "misconfig", "cve", "testssl", "nuclei", "zap", "ports"]


def resolve_workers(requested: int | None, n_sites: int) -> int:
    """Translate a requested worker count into an effective thread-pool size.

    - ``requested`` <= 0 or ``None`` means "auto": one worker per site so the
      whole fleet is scanned at once.
    - A positive value is honored as an explicit cap chosen by the operator.

    The result is always clamped to ``[1, n_sites]`` (never spin up more
    workers than there is work for) and to ``MAX_WORKERS_CAP``.
    """
    if n_sites <= 0:
        return 1
    if requested is None or requested <= 0:
        requested = n_sites
    return max(1, min(requested, n_sites, MAX_WORKERS_CAP))


def _merge_targets(base: list[dict], extra: list[dict]) -> list[dict]:
    """Appends ``extra`` targets to ``base``, skipping ones already present
    (matched by url, else domain), so static and discovered sites don't dup."""
    seen = {(s.get("url") or s.get("domain")) for s in base}
    merged = list(base)
    for s in extra:
        key = s.get("url") or s.get("domain")
        if key and key not in seen:
            seen.add(key)
            merged.append(s)
    return merged


def load_targets(config_path: str = "config/targets.yaml",
                 discover: bool = True) -> list[dict]:
    """Loads the scan targets from ``config_path``.

    Beyond the static ``sites:`` list, the config may declare an EASM
    ``discover:`` section to auto-expand the surface from root domains::

        discover:
          enabled: true
          domains: [example.com]
          resolve: true       # keep only hostnames that resolve (default true)
          expand: false       # reverse-DNS (PTR) expansion of resolved IPs
          bruteforce: false   # keyless DNS brute-force of common labels

    Discovered assets are merged with the static sites (de-duplicated). Set
    ``discover=False`` to load only the static list (discovery is fail-safe, but
    this avoids the network call entirely).
    """
    data = yaml.safe_load(Path(config_path).read_text()) or {}
    sites = list(data.get("sites", []) or [])

    disc = data.get("discover") or {}
    if discover and disc.get("enabled") and disc.get("domains"):
        from scanners.discovery import discover_assets
        found = discover_assets(disc["domains"],
                                resolve=disc.get("resolve", True),
                                expand=disc.get("expand", False),
                                bruteforce=disc.get("bruteforce", False))
        sites = _merge_targets(sites, found)
    return sites


def scan_site(site: dict, enabled: list[str], authorized: bool,
              engine_gate: threading.BoundedSemaphore | None = _engine_semaphore,
              suppressed_cve_ids: list[str] | None = None,
              verify_backports: bool | None = None,
              on_site_event: SiteEventFn | None = None) -> dict:
    """Runs the enabled scanners against a single site and returns raw results.

    ``engine_gate`` bounds how many heavy engine subprocesses (testssl/nuclei/
    zap) run concurrently across the whole fleet; pass ``None`` to disable the
    gate (e.g. in single-site tests). ``suppressed_cve_ids`` drops known
    false-positive CVEs from the CVE scanner. ``verify_backports`` turns on
    automatic OSV cross-verification of CVEs (``None`` => AUDIT_VERIFY_BACKPORTS
    env var).

    ``on_site_event`` receives structured progress events for a live UI: a
    ``{"type": "site_start", ...}`` when the site is picked up and a
    ``{"type": "check", "check": <name>, ...}`` immediately before each scanner
    runs, so the dashboard can show which check each site is on in real time.
    """
    name = site["name"]
    url = site["url"]
    # domain is preferred from config; fall back to parsing the URL host.
    domain = site.get("domain") or urlparse(url).hostname

    # Checks that will actually run, in order — lets the UI show a per-site
    # progress bar (check N of total) that fills as each site advances.
    planned = [c for c in SITE_CHECK_ORDER if c in enabled]
    total_checks = len(planned)

    def _emit(check: str) -> None:
        if on_site_event:
            on_site_event({"type": "check", "url": url, "name": name, "check": check,
                           "index": planned.index(check) + 1, "total": total_checks})

    if on_site_event:
        on_site_event({"type": "site_start", "url": url, "name": name,
                       "total": total_checks})

    out = {"name": name, "url": url, "domain": domain}

    # One HTTP session for the whole site: connections are reused, and if the
    # target sits behind a solvable anti-bot interstitial, the cookie earned by
    # the first check carries to the rest so they audit the real application
    # instead of the challenge page.
    with audit_session() as http:
        if "availability" in enabled:
            _emit("availability")
            out["availability"] = check_availability(url, session=http)
        if "tls" in enabled:
            _emit("tls")
            out["tls"] = check_tls(url)
        if "headers" in enabled:
            _emit("headers")
            out["headers"] = check_headers(url, session=http)
        if "dns_auth" in enabled:
            _emit("dns_auth")
            out["dns_auth"] = check_dns_auth(domain)
        if "takeover" in enabled:
            _emit("takeover")
            out["takeover"] = check_takeover(url)
        if "misconfig" in enabled:
            _emit("misconfig")
            out["misconfig"] = check_misconfig(url, session=http)
        if "cve" in enabled:
            _emit("cve")
            out["cve"] = check_cve(url, suppressed_cve_ids=suppressed_cve_ids,
                                   verify_backports=verify_backports, session=http)
    # Engine scanners are gated so only ENGINE_MAX_CONCURRENCY subprocesses run
    # at once, regardless of how many sites are scanned in parallel.
    if "testssl" in enabled:
        _emit("testssl")
        with _engine_slot(engine_gate):
            out["testssl"] = check_testssl(url)
    if "nuclei" in enabled:
        _emit("nuclei")
        with _engine_slot(engine_gate):
            out["nuclei"] = check_nuclei(url, authorized=authorized)
    if "zap" in enabled:
        _emit("zap")
        with _engine_slot(engine_gate):
            out["zap"] = check_zap(url)
    if "ports" in enabled:
        _emit("ports")
        out["ports"] = check_ports(domain, authorized=authorized)

    return out


def _site_error(site: dict, message: str) -> dict:
    return {
        "name": site.get("name"), "url": site.get("url"),
        "domain": site.get("domain") or urlparse(site.get("url", "")).hostname,
        "error": message,
    }


def _site_done_event(result: dict, min_confidence: str | None) -> dict:
    """Builds a ``site_done`` progress event, scoring the site for a live score.

    Scoring one finished site is cheap and lets the dashboard show each site's
    score/grade the moment it completes, instead of waiting for the whole sweep.
    """
    event = {"type": "site_done", "url": result.get("url"),
             "name": result.get("name"), "error": result.get("error")}
    if not result.get("error"):
        from scoring.engine import score_site
        try:
            scored = score_site(result, min_confidence=min_confidence)
            event.update(score=scored["score"], grade=scored["grade"],
                         findings=len(scored["findings"]))
        except Exception:  # never let live scoring break the sweep
            pass
    return event


def run_scans(
    sites: list[dict],
    enabled: list[str],
    authorized: bool,
    max_workers: int = DEFAULT_MAX_WORKERS,
    on_progress: ProgressFn | None = None,
    engine_workers: int | None = None,
    batch_timeout: float | None = None,
    suppressed_cve_ids: list[str] | None = None,
    verify_backports: bool | None = None,
    on_site_event: SiteEventFn | None = None,
    min_confidence: str | None = None,
) -> list[dict]:
    """Scans every site concurrently, preserving input order.

    A failure scanning one site is captured as an `error` on that site's result
    instead of aborting the whole sweep. ``engine_workers`` overrides the global
    cap on concurrent engine (testssl/nuclei/zap) subprocesses for this sweep.
    ``batch_timeout`` sets a wall-clock budget (seconds) for the whole sweep: any
    site still running when it elapses is recorded as an error rather than
    hanging the batch — essential for a 24/7 fleet on a fixed cadence.

    ``on_site_event`` receives per-site progress events (``site_start`` /
    ``check`` / ``site_done``) for a live UI; ``min_confidence`` is used only to
    score each finished site for its live ``site_done`` event.
    """
    results: list[dict | None] = [None] * len(sites)
    workers = resolve_workers(max_workers, len(sites))
    gate = (_engine_semaphore if engine_workers is None
            else threading.BoundedSemaphore(max(1, engine_workers)))
    timed_out = 0

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        future_to_index = {
            pool.submit(scan_site, site, enabled, authorized, gate,
                        suppressed_cve_ids, verify_backports, on_site_event): i
            for i, site in enumerate(sites)
        }
        try:
            for future in concurrent.futures.as_completed(future_to_index,
                                                          timeout=batch_timeout):
                i = future_to_index[future]
                site = sites[i]
                try:
                    results[i] = future.result()
                except Exception as e:  # never let one site crash the sweep
                    results[i] = _site_error(site, f"Scan failed: {e}")
                    logger.warning("site scan failed: %s: %s", site.get("url"), e)
                if on_progress:
                    done = sum(1 for r in results if r is not None)
                    on_progress(f"[{done}/{len(sites)}] {site.get('name')}")
                if on_site_event:
                    on_site_event(_site_done_event(results[i], min_confidence))
        except concurrent.futures.TimeoutError:
            # Budget exhausted: stop waiting, cancel what hasn't started, and
            # record the still-unfinished sites as timed out.
            for future, i in future_to_index.items():
                if results[i] is None:
                    future.cancel()
                    results[i] = _site_error(
                        sites[i], "Scan timed out (batch time budget exceeded)")
                    timed_out += 1
                    if on_site_event:
                        on_site_event(_site_done_event(results[i], min_confidence))
            logger.warning("batch time budget (%.0fs) exceeded; %d site(s) timed out",
                           batch_timeout, timed_out)

    return [r for r in results if r is not None]


def run_audit(
    config_path: str = "config/targets.yaml",
    sites: list[dict] | None = None,
    enabled: list[str] | None = None,
    authorized: bool = False,
    persist: bool = True,
    generate_reports: bool = True,
    per_site_reports: bool = False,
    send_alert: bool = False,
    max_workers: int = DEFAULT_MAX_WORKERS,
    on_progress: ProgressFn | None = None,
    on_site_event: SiteEventFn | None = None,
    engine_workers: int | None = None,
    batch_timeout: float | None = None,
    suppressed_cve_ids: list[str] | None = None,
    verify_backports: bool | None = None,
    min_confidence: str | None = None,
    run_uuid: str | None = None,
    engine=None,
    discover_domains: list[str] | None = None,
) -> dict:
    """End-to-end audit: scan -> score -> persist -> history -> reports -> alert.

    Returns a dict:
        {
          "run_uuid": str,             # correlation id for logs/host tracing
          "run_id": int | None,        # DB run id (when persisted)
          "duration_s": float,         # wall-clock scan+score time
          "scored": list[dict],        # score_all() output, with "history" attached
          "stats": {"sites", "errors", "avg_score"},
          "reports": {"global": {...}, "per_site": {url: {...}}},
          "alert": dict | None,
        }

    ``engine`` is an optional SQLAlchemy engine so a host can supply its own
    (per-tenant) database instead of the process default.

    ``min_confidence`` ("low"/"potential"/"confirmed") turns on automatic
    false-positive reduction: findings below that confidence tier are dropped
    from the score, reports and alerts without any manual triage. ``None``
    falls back to the ``AUDIT_MIN_CONFIDENCE`` env var (unset = keep everything).

    ``verify_backports`` turns on automatic OSV cross-verification of CVEs: any
    CVE OSV reports as not affecting the detected version is dropped as a false
    positive. ``None`` falls back to the ``AUDIT_VERIFY_BACKPORTS`` env var.

    ``discover_domains`` runs EASM asset discovery on those root domains and
    scans what it finds, merged with ``sites``. It lets an embedding host drive
    discovery entirely from code, without a ``config/targets.yaml`` file.
    """
    enabled = enabled if enabled is not None else list(DEFAULT_SCANNERS)
    if discover_domains:
        # EASM discovery driven by the caller: no YAML file needed. Discovered
        # assets are merged with (and de-duplicated against) any explicit sites.
        from scanners.discovery import discover_assets
        sites = _merge_targets(list(sites or []), discover_assets(discover_domains))
    elif sites is None:
        sites = load_targets(config_path)
    run_uuid = run_uuid or uuid.uuid4().hex
    started = time.monotonic()
    logger.info("audit start run_uuid=%s sites=%d scanners=%s authorized=%s",
                run_uuid, len(sites), ",".join(enabled), authorized)

    if min_confidence is None:
        min_confidence = _env_min_confidence()

    raw_results = run_scans(sites, enabled, authorized, max_workers, on_progress,
                            engine_workers=engine_workers, batch_timeout=batch_timeout,
                            suppressed_cve_ids=suppressed_cve_ids,
                            verify_backports=verify_backports,
                            on_site_event=on_site_event, min_confidence=min_confidence)
    scored = score_all(raw_results, min_confidence=min_confidence)
    duration_s = round(time.monotonic() - started, 2)
    if min_confidence:
        logger.info("audit run_uuid=%s applying min_confidence=%s (auto noise reduction)",
                    run_uuid, min_confidence)

    errors = sum(1 for r in raw_results if r.get("error"))
    valid_scores = [s["score"] for s in scored if s.get("score") is not None]
    stats = {
        "sites": len(scored),
        "errors": errors,
        "avg_score": round(sum(valid_scores) / len(valid_scores), 1) if valid_scores else None,
    }
    outcome: dict = {"run_uuid": run_uuid, "run_id": None, "duration_s": duration_s,
                     "scored": scored, "stats": stats, "min_confidence": min_confidence,
                     "reports": {"global": None, "per_site": {}}, "alert": None}

    if persist:
        from db.models import previous_findings, save_run, score_history

        outcome["run_id"] = save_run(scored, engine=engine)
        for s in scored:
            s["history"] = score_history(s.get("url"), limit=20, engine=engine)
            # The current run is now the newest; previous_findings() therefore
            # returns the run before it, so we can flag what is new this scan.
            delta = diff_findings(s.get("findings", []),
                                  previous_findings(s.get("url"), engine=engine))
            s["new_finding_keys"] = [[f.get("code"), f.get("message")] for f in delta["new"]]

    if generate_reports:
        from reports.generator import generate_report, generate_site_report
        outcome["reports"]["global"] = generate_report(scored)
        if per_site_reports:
            for s in scored:
                outcome["reports"]["per_site"][s.get("url")] = generate_site_report(s)

    if send_alert:
        from alerts.mailer import send_alerts
        outcome["alert"] = send_alerts(scored)

    logger.info("audit done run_uuid=%s run_id=%s sites=%d errors=%d avg_score=%s "
                "duration=%.2fs", run_uuid, outcome["run_id"], stats["sites"],
                stats["errors"], stats["avg_score"], duration_s)
    return outcome
