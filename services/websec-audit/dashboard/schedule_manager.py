"""
dashboard/schedule_manager.py
Runtime-editable scan schedule for the dashboard.

The admin sets *when* audits run straight from the dashboard UI (no config
edits, no restart). This module owns a single APScheduler ``BackgroundScheduler``
whose jobs can be re-programmed live, and persists the chosen schedule in the
database (the ``settings`` table) so it survives restarts.

Schedule model
--------------
* ``times``            — daily clock times, a list of ``(hour, minute, second)``
                         -> one APScheduler ``cron`` job each.
* ``interval_minutes`` — optional fixed interval -> one ``interval`` job.

Both may be combined. An empty schedule simply means "no automatic scans"; the
scheduler still runs so the admin can add times later without a restart.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from datetime import timezone
from typing import Callable
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from db.models import get_setting, set_setting

SETTING_KEY = "scan_schedule"

logger = logging.getLogger("dashboard.schedule_manager")

def _resolve_tz():
    name = os.getenv("AUDIT_TZ", "UTC")
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError:
        logger.warning("Unknown AUDIT_TZ=%r, falling back to UTC", name)
        return ZoneInfo("UTC")

def parse_schedule_at(raw: str) -> list[tuple[int, int, int]]:
    times = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        bits = part.split(":")
        if len(bits) not in (2, 3):
            continue
        try:
            hour, minute = int(bits[0]), int(bits[1])
            second = int(bits[2]) if len(bits) == 3 else 0
        except ValueError:
            continue
        if 0 <= hour <= 23 and 0 <= minute <= 59 and 0 <= second <= 59 and (hour, minute, second) not in times:
            times.append((hour, minute, second))
    return sorted(times)


class ScheduleManager:
    """Owns the background scheduler and the persisted schedule settings."""

    def __init__(self, run_fn: Callable[[], None]):
        self._run_fn = run_fn
        self._scheduler = None
        self._lock = threading.Lock()
        self.times: list[tuple[int, int, int]] = []
        self.interval_minutes: int = 0
        self.tz = _resolve_tz()

    # --- persistence ---------------------------------------------------------
    def load(self, env_at: str = "", env_minutes: int = 0) -> None:
        """Loads the schedule from the DB, falling back to env-var defaults.
 
        A schedule saved from the UI (in the DB) always wins over the env vars,
        which only seed the very first run.
        """
        raw = get_setting(SETTING_KEY)
        if raw:
            try:
                data = json.loads(raw)
                # Accept both old 2-tuples ([h, m]) and new 3-tuples ([h, m, s])
                # so an existing DB setting from before seconds support still loads.
                entries = data.get("at", [])
                self.times = sorted({
                    (int(e[0]), int(e[1]), int(e[2]) if len(e) > 2 else 0)
                    for e in entries
                })
                self.interval_minutes = max(0, int(data.get("minutes", 0)))
                return
            except (ValueError, TypeError, IndexError):
                pass  # corrupt setting -> fall through to env defaults
        self.times = parse_schedule_at(env_at)
        self.interval_minutes = max(0, int(env_minutes or 0))
 
    def _persist(self) -> None:
        set_setting(SETTING_KEY, json.dumps(
            {"at": [[h, m, s] for h, m, s in self.times], "minutes": self.interval_minutes}
        ))

    # --- scheduler control ---------------------------------------------------
    def start(self) -> None:
        """Starts the scheduler and registers the current jobs. Always starts
        (even with an empty schedule) so jobs can be added live later."""
        from apscheduler.schedulers.background import BackgroundScheduler

        self._scheduler = BackgroundScheduler(daemon=True, timezone=self.tz)
        self._scheduler.start()
        self._apply_jobs()

    def _apply_jobs(self) -> None:
        if self._scheduler is None:
            return
        self._scheduler.remove_all_jobs()
        if self.interval_minutes > 0:
            self._scheduler.add_job(self._run_fn, "interval",
                                    minutes=self.interval_minutes, id="scheduled_interval")
        for hour, minute, second in self.times:
            self._scheduler.add_job(self._run_fn, "cron", hour=hour, minute=minute, second=second,
                                    id=f"scheduled_at_{hour:02d}{minute:02d}{second:02d}")

    def update(self, times: list[tuple[int, int, int]], interval_minutes: int) -> None:
        """Replaces the schedule (persisting it) and re-programs the live jobs."""
        with self._lock:
            self.times = sorted(set(times))
            self.interval_minutes = max(0, int(interval_minutes or 0))
            self._persist()
            self._apply_jobs()

    def shutdown(self) -> None:
        if self._scheduler is not None:
            self._scheduler.shutdown(wait=False)
            self._scheduler = None

    # --- views ---------------------------------------------------------------
    @property
    def times_str(self) -> list[str]:
        return [f"{h:02d}:{m:02d}:{s:02d}" for h, m, s in self.times]
    
    @property
    def timezone_name(self) -> str:
        return self.tz.key

    # --- views ---------------------------------------------------------------
    @property
    def next_at_run_at(self) -> str | None:
        """Next fire time among the fixed daily times, or None if none are set."""
        if self._scheduler is None or not self.times:
            return None
        times = [
            j.next_run_time for j in self._scheduler.get_jobs()
            if j.id.startswith("scheduled_at_") and j.next_run_time
        ]
        return min(times).astimezone(timezone.utc).isoformat() if times else None
    
    @property
    def next_interval_run_at(self) -> str | None:
        """Next fire time of the interval job, or None if no interval is set."""
        if self._scheduler is None or self.interval_minutes <= 0:
            return None
        job = self._scheduler.get_job("scheduled_interval")
        if job is None or job.next_run_time is None:
            return None
        return job.next_run_time.astimezone(timezone.utc).isoformat()
