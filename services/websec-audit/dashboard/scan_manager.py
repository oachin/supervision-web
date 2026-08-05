"""
dashboard/scan_manager.py
Runs audits in the background for the dashboard and exposes their live state.

Only one audit runs at a time (a new request while one is in progress is
rejected, not queued) — appropriate for a single-operator internal tool and it
keeps the concurrency model easy to reason about. The actual per-site
concurrency lives in `core.audit.run_scans`.
"""

from __future__ import annotations
import logging
import os
import threading
from datetime import datetime, timezone, timedelta

from core.audit import (
    DEFAULT_MAX_WORKERS,
    DEFAULT_SCANNERS,
    load_targets,
    run_audit,
)
from db.models import prune_history

# Email an alert when a completed scan surfaces critical / below-threshold
# findings. Only attempted when SMTP is configured (send_alerts no-ops
# otherwise), so this is safe to leave on by default.
ALERT_ON_SCAN = bool(os.getenv("SMTP_HOST"))

logger = logging.getLogger("dashboard.scan_manager")
MAX_RUN_MINUTES = int(os.getenv("AUDIT_MAX_RUN_MINUTES", "45"))


def _prune_after_run() -> None:
    """Bounds history growth after a scan (unbounded otherwise on 24/7 fleets).

    Off unless ``AUDIT_PRUNE_KEEP_RUNS`` / ``AUDIT_PRUNE_DAYS`` is set. Never
    fails a scan: a pruning error is logged, not raised.
    """
    keep_runs = os.getenv("AUDIT_PRUNE_KEEP_RUNS")
    older_than_days = os.getenv("AUDIT_PRUNE_DAYS")
    if not keep_runs and not older_than_days:
        return
    try:
        deleted = prune_history(
            keep_runs=int(keep_runs) if keep_runs else None,
            older_than_days=int(older_than_days) if older_than_days else None,
        )
        if deleted:
            logger.info("pruned %d old run(s) from history", deleted)
    except Exception as e:
        logger.warning("history pruning failed: %s", e)


class ScanManager:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._state: dict = {
            "running": False,
            "started_at": None,
            "finished_at": None,
            "progress": None,
            "last_run_id": None,
            "error": None,
            "trigger": None,
            # Live per-site progress for the "row per site" view. Ordered as in
            # config; each entry: {name, url, status, check, score, grade,
            # findings, error}. status: queued -> scanning -> done | error.
            "sites": [],
            "done": 0,
            "total": 0,
            # Set once when a scan finishes successfully; consumed by the status
            # endpoint to trigger a single full-page reload (so Chart.js
            # re-renders) instead of reloading on every subsequent poll.
            "reload_pending": False,
        }

    def _init_sites(self, config_path: str) -> None:
        """Seed per-site progress (all 'queued') from the target list."""
        try:
            targets = load_targets(config_path)
        except Exception as e:  # bad/missing config shouldn't crash the trigger
            logger.warning("could not load targets for progress view: %s", e)
            targets = []
        self._state["sites"] = [
            {"name": t.get("name") or t.get("url"), "url": t.get("url"),
             "status": "queued", "check": None, "score": None, "grade": None,
             "findings": None, "error": None,
             "checks_done": 0, "checks_total": 0, "percent": 0}
            for t in targets
        ]
        self._state["done"] = 0
        self._state["total"] = len(self._state["sites"])

    def _on_site_event(self, event: dict) -> None:
        """Fold a per-site progress event into the live state (thread-safe)."""
        url = event.get("url")
        etype = event.get("type")
        with self._lock:
            site = next((s for s in self._state["sites"] if s["url"] == url), None)
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
                # The check is starting, so (index - 1) checks have finished.
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
                self._state["done"] = sum(
                    1 for s in self._state["sites"] if s["status"] in ("done", "error"))

    @property
    def state(self) -> dict:
        with self._lock:
            snapshot = dict(self._state)
            # Deep-copy the per-site rows so a poll render can't observe a row
            # being mutated mid-scan by a worker thread.
            snapshot["sites"] = [dict(s) for s in self._state.get("sites", [])]
            return snapshot

    def is_running(self) -> bool:
        with self._lock:
            return self._state["running"]

    def consume_reload(self) -> bool:
        """Return True at most once after each successful scan.

        Lets the UI do a single full-page reload when a scan completes (to
        re-run the Chart.js init) without reloading on every later poll.
        """
        with self._lock:
            if self._state.get("reload_pending") and not self._state["running"]:
                self._state["reload_pending"] = False
                return True
            return False

    def _clear_stale_lock_if_needed(self) -> bool:
        if not self._state["running"] or MAX_RUN_MINUTES <= 0:
            return False
        started = self._state.get("started_at")
        if not started:
            return False
        started_dt = datetime.fromisoformat(started)
        if datetime.now(timezone.utc) - started_dt < timedelta(minutes=MAX_RUN_MINUTES):
            return False
        logger.warning("Scan stuck since %s (>%s min) — clearing lock", started, MAX_RUN_MINUTES)
        self._state.update({"running": False, "finished_at": datetime.now(timezone.utc).isoformat(),
                            "error": f"Previous scan exceeded {MAX_RUN_MINUTES} min and was force-cleared.",
                            "progress": "Stuck / force-cleared"})
        return True

    def start(self, config_path: str, enabled: list[str] | None = None,
              authorized: bool = False, workers: int = DEFAULT_MAX_WORKERS, trigger: str = "manual") -> bool:
        """Starts a background audit. Returns False if one is already running."""
        with self._lock:
            if self._state["running"]:
                return False
            self._state.update({
                "running": True,
                "started_at": datetime.now(timezone.utc).isoformat(),
                "finished_at": None,
                "progress": "Starting…",
                "error": None,
                "trigger": None,
                "reload_pending": False,
            })
            self._init_sites(config_path)

        enabled = enabled if enabled is not None else list(DEFAULT_SCANNERS)

        def _run() -> None:
            try:
                def on_progress(msg: str) -> None:
                    with self._lock:
                        self._state["progress"] = msg

                outcome = run_audit(
                    config_path=config_path, enabled=enabled, authorized=authorized,
                    persist=True, generate_reports=False, max_workers=workers,
                    send_alert=ALERT_ON_SCAN, on_progress=on_progress,
                    on_site_event=self._on_site_event,
                )
                with self._lock:
                    self._state["last_run_id"] = outcome.get("run_id")
                    self._state["progress"] = "Completed"
                _prune_after_run()
            except Exception as e:  # surface, never crash the server
                with self._lock:
                    self._state["error"] = str(e)
                    self._state["progress"] = "Failed"
            finally:
                with self._lock:
                    self._state["running"] = False
                    self._state["finished_at"] = datetime.now(timezone.utc).isoformat()
                    if not self._state["error"]:
                        self._state["reload_pending"] = True

        self._thread = threading.Thread(target=_run, daemon=True)
        self._thread.start()
        return True


# Module-level singleton shared by the app and the scheduler.
manager = ScanManager()
