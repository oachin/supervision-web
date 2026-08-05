"""
scanners/zap.py
Web-application scanning via the OWASP ZAP **baseline** scan
(https://www.zaproxy.org/docs/docker/baseline-scan/).

Why this exists
---------------
None of the built-in scanners look at the web *application* itself. The ZAP
baseline spiders the site and runs ZAP's **passive** rules, flagging real
app-layer issues — missing anti-CSRF tokens, cookie problems, information
leakage, mixed content, weak CSP, XSS-enabling responses, etc. ZAP is the
reference open-source web app scanner, so we drive it rather than reinventing it.

Safety
------
The *baseline* scan is passive: it crawls and observes responses but does not
launch active attacks (no injection/fuzzing payloads), so it is safe to run
against your own sites. (A full active ZAP scan is intentionally NOT run here;
that belongs behind an explicit authorization workflow.)

The engine is optional: if `zap-baseline.py`/`zap.sh` is not installed the scan
is reported as inconclusive rather than failing the audit.
"""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

from scanners._external import (
    count_severities, empty_result, find_binary, run_command,
)

# ZAP riskcode (in the JSON report) -> our canonical severity band.
# 0 = informational, 1 = low, 2 = medium, 3 = high.
_RISK_MAP = {"3": "high", "2": "medium", "1": "low", "0": "info"}


def _run_zap(url: str, timeout: int) -> tuple[list[dict], str | None]:
    """Runs the ZAP baseline scan against ``url``, returning (alerts, error).

    ``alerts`` is the flattened list of ZAP alert objects from the JSON report.
    Returns an error string (and empty list) when ZAP is missing, times out, or
    produces no parseable report.
    """
    binary = find_binary("zap-baseline.py", "zap-baseline", "zap.sh")
    if not binary:
        return [], "OWASP ZAP (zap-baseline.py) not installed"

    with tempfile.TemporaryDirectory() as tmp:
        report = Path(tmp) / "zap.json"
        # -J writes a JSON report; -I => don't fail the process on warnings;
        # -m bounds the passive-scan wait. The baseline runs no active attacks.
        cmd = [binary, "-t", url, "-J", str(report), "-I", "-m", "2"]
        try:
            run_command(cmd, timeout=timeout)
        except subprocess.TimeoutExpired:
            return [], f"ZAP baseline timed out after {timeout}s"
        except OSError as e:
            return [], f"ZAP baseline could not run: {e}"

        if not report.exists():
            return [], "ZAP produced no report"
        try:
            data = json.loads(report.read_text() or "{}")
        except (ValueError, OSError) as e:
            return [], f"ZAP report unreadable: {e}"

    alerts: list[dict] = []
    for site in data.get("site", []) if isinstance(data, dict) else []:
        alerts.extend(a for a in site.get("alerts", []) if isinstance(a, dict))
    return alerts, None


def check_zap(url: str, timeout: int = 300, runner=_run_zap) -> dict:
    """Runs the ZAP baseline scan and returns the normalised result envelope."""
    raw, error = runner(url, timeout)
    if error and not raw:
        installed = "not installed" not in error
        return empty_result(url, "zap", error=error, installed=installed)

    findings: list[dict] = []
    for alert in raw:
        sev = _RISK_MAP.get(str(alert.get("riskcode", "")), "info")
        if sev == "info":
            continue
        instances = alert.get("instances") or []
        detail = ""
        if instances and isinstance(instances[0], dict):
            detail = instances[0].get("uri", "")
        findings.append({
            "id": str(alert.get("pluginid", "")),
            "name": alert.get("alert") or alert.get("name", "ZAP alert"),
            "severity": sev,
            "detail": detail,
        })

    result = empty_result(url, "zap")
    result["findings"] = findings
    result["counts"] = count_severities(findings)
    return result
