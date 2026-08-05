"""
alerts/mailer.py
Sends an email alert (via smtplib) when a scan surfaces a critical problem.

v1 scope (kept deliberately small): ONE alert type — a single summary email
listing the sites that breached the alert conditions. Slack/Teams = future work.

Trigger conditions (a site alerts if ANY of these is true):
  * its score is below ALERT_SCORE_THRESHOLD, or
  * it has a finding of severity 'critical' (e.g. expired cert, site down).

Configuration comes from environment variables (never hardcode credentials):
    SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD,
    ALERT_FROM, ALERT_TO (comma-separated), SMTP_USE_TLS (default "true"),
    ALERT_SCORE_THRESHOLD (default "60").
Load them from a .env file with python-dotenv in main.py.
"""

import os
import smtplib
from email.message import EmailMessage


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def find_alertable(scored_results: list[dict], threshold: int) -> list[dict]:
    """Returns the subset of sites that meet an alert condition, with the reason.

    Critical findings that are new since the site's previous scan are tagged
    [NEW] when the caller has attached `new_finding_keys` (see core.audit), so
    admins can tell a fresh regression apart from a known, unresolved issue.
    """
    alertable = []
    for s in scored_results:
        reasons = []
        if s.get("score", 100) < threshold:
            reasons.append(f"score {s.get('score')}/100 below threshold {threshold}")
        new_keys = {tuple(k) for k in s.get("new_finding_keys", [])}
        # Only *exposed* criticals alert: a present-but-not-exposed weakness
        # (unconfirmed version-based CVE) does not raise an alert until it
        # becomes exposed (actively confirmed). `exposed` defaults to True so
        # findings scored before this field existed still alert.
        criticals = [f for f in s.get("findings", [])
                     if f.get("severity") == "critical" and f.get("exposed", True)]
        for f in criticals:
            tag = " [NEW]" if (f.get("code"), f.get("message")) in new_keys else ""
            reasons.append(f"CRITICAL{tag}: {f.get('message')}")
        if reasons:
            alertable.append({"site": s, "reasons": reasons})
    return alertable


def build_alert_body(alertable: list[dict]) -> str:
    lines = ["Web Security Audit — critical findings detected", ""]
    for item in alertable:
        s = item["site"]
        lines.append(f"[{s.get('grade')}] {s.get('name')} ({s.get('url')}) — {s.get('score')}/100")
        for reason in item["reasons"]:
            lines.append(f"    - {reason}")
        lines.append("")
    lines.append("See the full HTML/PDF report for details.")
    return "\n".join(lines)


def build_surface_change_body(added: list[str], removed: list[str]) -> str:
    """Human-readable body for an external-surface-change alert."""
    lines = ["Web Security Audit — external attack surface changed", ""]
    if added:
        lines.append(f"NEW assets discovered ({len(added)}) — verify ownership "
                     "and that exposure is intended:")
        lines += [f"    + {h}" for h in added]
        lines.append("")
    if removed:
        lines.append(f"Assets no longer seen ({len(removed)}):")
        lines += [f"    - {h}" for h in removed]
        lines.append("")
    lines.append("Newly-appeared assets are the classic EASM signal — an "
                 "internet-exposed host you may not have known about.")
    return "\n".join(lines)


def send_surface_change_alert(added: list[str], removed: list[str],
                              dry_run: bool = False) -> dict:
    """Emails a summary when the discovered external surface changed.

    Triggers when any asset is **newly discovered** (``added``) — the defining
    "you didn't know this existed" EASM signal; ``removed`` assets are included
    for context but do not, on their own, raise an alert. Reuses the same SMTP
    env configuration as ``send_alerts``. Returns the same outcome shape.
    """
    outcome = {"triggered": False, "sent": False, "recipients": [],
               "body": None, "error": None}
    if not added:
        return outcome  # only newly-exposed assets are alert-worthy

    outcome["triggered"] = True
    body = build_surface_change_body(added, removed)
    outcome["body"] = body

    recipients = [a.strip() for a in os.getenv("ALERT_TO", "").split(",") if a.strip()]
    outcome["recipients"] = recipients
    if dry_run:
        return outcome

    host = os.getenv("SMTP_HOST")
    if not host or not recipients:
        outcome["error"] = "SMTP not configured (need SMTP_HOST and ALERT_TO)"
        return outcome

    port = _env_int("SMTP_PORT", 587)
    user = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASSWORD")
    sender = os.getenv("ALERT_FROM", user or "audit@localhost")
    use_tls = os.getenv("SMTP_USE_TLS", "true").lower() == "true"

    msg = EmailMessage()
    msg["Subject"] = f"[EASM] {len(added)} new asset(s) discovered"
    msg["From"] = sender
    msg["To"] = ", ".join(recipients)
    msg.set_content(body)

    try:
        with smtplib.SMTP(host, port, timeout=15) as server:
            if use_tls:
                server.starttls()
            if user and password:
                server.login(user, password)
            server.send_message(msg)
        outcome["sent"] = True
    except Exception as e:
        outcome["error"] = f"Failed to send alert: {e}"
    return outcome


def send_alerts(scored_results: list[dict], dry_run: bool = False) -> dict:
    """
    Evaluates alert conditions and, if any site qualifies, sends one summary email.

    Args:
        dry_run: if True, build the message but do NOT connect/send (for testing).

    Returns {"triggered": bool, "sent": bool, "recipients": [...], "body": str|None,
             "error": str|None}.
    """
    threshold = _env_int("ALERT_SCORE_THRESHOLD", 60)
    outcome = {"triggered": False, "sent": False, "recipients": [], "body": None, "error": None}

    alertable = find_alertable(scored_results, threshold)
    if not alertable:
        return outcome  # nothing to alert on

    outcome["triggered"] = True
    body = build_alert_body(alertable)
    outcome["body"] = body

    recipients = [a.strip() for a in os.getenv("ALERT_TO", "").split(",") if a.strip()]
    outcome["recipients"] = recipients

    if dry_run:
        return outcome

    host = os.getenv("SMTP_HOST")
    if not host or not recipients:
        outcome["error"] = "SMTP not configured (need SMTP_HOST and ALERT_TO)"
        return outcome

    port = _env_int("SMTP_PORT", 587)
    user = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASSWORD")
    sender = os.getenv("ALERT_FROM", user or "audit@localhost")
    use_tls = os.getenv("SMTP_USE_TLS", "true").lower() == "true"

    msg = EmailMessage()
    msg["Subject"] = f"[Security Audit] {len(alertable)} site(s) need attention"
    msg["From"] = sender
    msg["To"] = ", ".join(recipients)
    msg.set_content(body)

    try:
        with smtplib.SMTP(host, port, timeout=15) as server:
            if use_tls:
                server.starttls()
            if user and password:
                server.login(user, password)
            server.send_message(msg)
        outcome["sent"] = True
    except Exception as e:
        outcome["error"] = f"Failed to send alert: {e}"

    return outcome
