"""
dashboard/live_monitor.py
Lightweight, high-frequency liveness monitor that powers the dashboard's
"real-time" view.

Why this exists separately from the full audit
----------------------------------------------
Security posture (HTTP headers, DNS records, TLS configuration, misconfig
exposure) changes on the scale of days, so the heavy audit runs on a slow
cadence. The only things that genuinely change minute-to-minute are whether a
site is **up** and how close its certificate is to **expiry** — and both are
cheap to check. So they get their own fast loop here, giving operators a live
status board without re-running full scans (which would waste resources and
hammer the targets).

State is kept in memory only: it is ephemeral "current status", not history
(history lives in the DB via the audit). Each entry:
    {name, url, up, status_code, response_time_ms, tls_verify_failed,
     cert_days, error, checked_at}
"""

from __future__ import annotations

import socket
import ssl
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from urllib.parse import urlparse

from cryptography import x509

from core.audit import load_targets, resolve_workers
from scanners.availability import check_availability

DEFAULT_INTERVAL_SECONDS = 60
# Liveness checks are a single cheap request + TLS handshake per site, so the
# sweep runs every site in parallel (auto), bounded by core.audit's cap.
_MAX_WORKERS = 0


def _cert_days_left(hostname: str, port: int = 443, timeout: int = 5) -> int | None:
    """Days until the served certificate expires, or None if it can't be read.

    Uses a single quick TLS handshake (far cheaper than the full sslyze scan)
    and reads the leaf certificate even when it is untrusted/self-signed/expired
    by disabling verification and parsing the DER form directly.
    """
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        with socket.create_connection((hostname, port), timeout=timeout) as sock:
            with ctx.wrap_socket(sock, server_hostname=hostname) as ssock:
                der = ssock.getpeercert(binary_form=True)
        if not der:
            return None
        cert = x509.load_der_x509_certificate(der)
        not_after = getattr(cert, "not_valid_after_utc", None)
        if not_after is None:
            not_after = cert.not_valid_after
            if not_after.tzinfo is None:
                not_after = not_after.replace(tzinfo=timezone.utc)
        return (not_after - datetime.now(timezone.utc)).days
    except Exception:
        return None


class LiveMonitor:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._statuses: dict[str, dict] = {}
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._interval = DEFAULT_INTERVAL_SECONDS
        self._config_path: str | None = None

    def snapshot(self) -> list[dict]:
        """Current status of every monitored site, down-sites first then by name."""
        with self._lock:
            items = [dict(v) for v in self._statuses.values()]
        items.sort(key=lambda s: (s.get("up") is not False, (s.get("name") or "").lower()))
        return items

    def _check_site(self, site: dict) -> dict:
        url = site["url"]
        # The certificate is host-specific, so connect to the URL's actual host
        # (e.g. expired.badssl.com), NOT the config `domain` field (which is the
        # apex used for DNS-auth checks and would serve a different cert).
        hostname = urlparse(url).hostname or site.get("domain") or ""
        avail = check_availability(url, timeout=6)
        cert_days = None
        if url.startswith("https://") and hostname:
            cert_days = _cert_days_left(hostname)
        return {
            "name": site.get("name"),
            "url": url,
            "up": bool(avail.get("reachable")),
            "status_code": avail.get("status_code"),
            "response_time_ms": avail.get("response_time_ms"),
            "tls_verify_failed": bool(avail.get("tls_verify_failed")),
            "cert_days": cert_days,
            "error": avail.get("error"),
            "checked_at": datetime.now(timezone.utc).isoformat(),
        }

    def check_once(self, sites: list[dict] | None = None,
                   config_path: str | None = None) -> list[dict]:
        """Runs one concurrent liveness sweep and stores the result."""
        if sites is None:
            sites = load_targets(config_path or self._config_path or "config/targets.yaml")
        results: dict[str, dict] = {}
        if sites:
            workers = resolve_workers(_MAX_WORKERS, len(sites))
            with ThreadPoolExecutor(max_workers=workers) as pool:
                futures = {pool.submit(self._check_site, s): s for s in sites}
                for future in as_completed(futures):
                    s = futures[future]
                    try:
                        status = future.result()
                    except Exception as e:
                        status = {
                            "name": s.get("name"), "url": s.get("url"),
                            "up": False, "status_code": None,
                            "response_time_ms": None, "tls_verify_failed": False,
                            "cert_days": None, "error": str(e),
                            "checked_at": datetime.now(timezone.utc).isoformat(),
                        }
                    results[status["url"]] = status
        with self._lock:
            self._statuses = results
        return self.snapshot()

    def start(self, config_path: str, interval: int = DEFAULT_INTERVAL_SECONDS) -> None:
        """Starts the background loop (idempotent — a running loop is left alone)."""
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self._config_path = config_path
            self._interval = max(5, interval)
            self._stop.clear()

        def _loop() -> None:
            while not self._stop.is_set():
                try:
                    self.check_once()
                except Exception:  # never let the loop die on a transient error
                    pass
                self._stop.wait(self._interval)

        self._thread = threading.Thread(target=_loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()


# Module-level singleton shared by the app.
live_monitor = LiveMonitor()
