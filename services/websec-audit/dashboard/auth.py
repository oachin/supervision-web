"""
dashboard/auth.py
Lightweight, dependency-free authentication for the dashboard.

The dashboard triggers scans and mutates remediation state, so it must not be
usable anonymously by anyone who can reach it. This adds a single shared-secret
login gate with a signed, expiring session cookie (HMAC-SHA256, stdlib only — no
new dependency, no server-side session store).

Configuration (all via environment):
* ``DASHBOARD_PASSWORD``   — enables auth when set. **Unset ⇒ auth disabled**
                             (backwards compatible) and a loud warning is logged.
* ``DASHBOARD_USERNAME``   — optional username (default ``admin``).
* ``DASHBOARD_SECRET_KEY`` — cookie-signing key. Unset ⇒ a random key is
                             generated at boot (sessions drop on restart).
* ``DASHBOARD_SESSION_HOURS`` — session lifetime in hours (default ``12``).

Security notes: constant-time comparisons throughout; the cookie carries only an
issue timestamp (no secret material) and is ``HttpOnly`` + ``SameSite=Lax``, and
marked ``Secure`` unless ``DASHBOARD_INSECURE_COOKIE`` opts out (e.g. plain-HTTP
LAN use). Set the dashboard behind TLS in production.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import secrets
import time

logger = logging.getLogger("dashboard.auth")

SESSION_COOKIE = "dash_session"
_DEFAULT_SESSION_HOURS = 12


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default)


def auth_enabled() -> bool:
    """Auth is active only when a dashboard password is configured."""
    return bool(_env("DASHBOARD_PASSWORD"))


def _username() -> str:
    return _env("DASHBOARD_USERNAME", "admin")


def _session_seconds() -> int:
    try:
        hours = int(_env("DASHBOARD_SESSION_HOURS", str(_DEFAULT_SESSION_HOURS)))
    except ValueError:
        hours = _DEFAULT_SESSION_HOURS
    return max(1, hours) * 3600


# Signing key: prefer a configured stable key so sessions survive restarts and
# scale across workers; otherwise generate an ephemeral per-process key.
_SECRET = _env("DASHBOARD_SECRET_KEY") or secrets.token_hex(32)
if not _env("DASHBOARD_SECRET_KEY") and auth_enabled():
    logger.warning("DASHBOARD_SECRET_KEY not set — using an ephemeral signing key; "
                   "sessions will not survive a restart or span multiple workers.")
if not auth_enabled():
    logger.warning("DASHBOARD_PASSWORD not set — the dashboard is UNAUTHENTICATED. "
                   "Anyone who can reach it can trigger scans and change state. "
                   "Set DASHBOARD_PASSWORD to enable the login gate.")


def secure_cookie() -> bool:
    """Whether the session cookie is marked ``Secure`` (TLS-only)."""
    return not _env("DASHBOARD_INSECURE_COOKIE")


def _sign(payload: str) -> str:
    return hmac.new(_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()


def verify_credentials(username: str, password: str) -> bool:
    """Constant-time check of a submitted username/password."""
    expected_pw = _env("DASHBOARD_PASSWORD")
    if not expected_pw:
        return False
    ok_user = hmac.compare_digest(username or "", _username())
    ok_pw = hmac.compare_digest(password or "", expected_pw)
    return ok_user and ok_pw


def issue_session() -> str:
    """Creates a signed session token: ``<issued_ts>.<hmac>``."""
    issued = str(int(time.time()))
    return f"{issued}.{_sign(issued)}"


def valid_session(token: str | None) -> bool:
    """Validates a session cookie: intact signature and not expired."""
    if not token or "." not in token:
        return False
    issued, sig = token.rsplit(".", 1)
    if not hmac.compare_digest(sig, _sign(issued)):
        return False
    try:
        issued_ts = int(issued)
    except ValueError:
        return False
    return (time.time() - issued_ts) <= _session_seconds()
