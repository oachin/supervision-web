"""
scanners/testssl.py
Deep TLS/SSL analysis via `testssl.sh` (https://testssl.sh).

Why this exists
---------------
The built-in ``tls.py`` scanner (sslyze) covers the essentials — expiry, chain
trust and obsolete protocols. ``testssl.sh`` goes much deeper and is the de-facto
open-source standard for TLS auditing: individual cipher strength, known TLS
attacks (ROBOT, BEAST, Heartbleed, POODLE, LUCKY13, Sweet32, …), forward
secrecy, RSA key size, TLS 1.3 support, OCSP stapling, and more. Running the
maintained tool is far more trustworthy than re-implementing those checks.

Safety
------
testssl.sh is a read-only TLS prober; it does not attack or fuzz the web
application. It is therefore safe to run without ``--authorized``.

The engine binary is optional: if it is not installed the scan is reported as
inconclusive (see scanners/_external.py) rather than failing the audit.
"""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from scanners._external import (
    SCORED_SEVERITIES, count_severities, empty_result, find_binary, run_command,
)

# testssl.sh severity labels -> our canonical bands. OK/INFO/WARN/DEBUG are not
# weaknesses, so they are dropped for scoring purposes.
_SEVERITY_MAP = {
    "CRITICAL": "critical",
    "HIGH": "high",
    "MEDIUM": "medium",
    "LOW": "low",
}


def _host_port(url: str) -> str:
    parsed = urlparse(url)
    host = parsed.hostname or url
    port = parsed.port or 443
    return f"{host}:{port}"


def _run_testssl(target: str, timeout: int) -> tuple[list[dict], str | None]:
    """Runs testssl.sh against ``target`` (host:port), returning (raw_findings, error).

    ``raw_findings`` is testssl's own JSON list of ``{id, severity, finding, …}``
    objects. Returns an error string (and empty list) when the tool is missing,
    times out, or produces no parseable JSON.
    """
    binary = find_binary("testssl.sh", "testssl")
    if not binary:
        return [], "testssl.sh not installed"

    with tempfile.TemporaryDirectory() as tmp:
        out_file = Path(tmp) / "testssl.json"
        cmd = [
            binary, "--quiet", "--color", "0",
            "--severity", "LOW",           # only log LOW+ findings
            "--jsonfile", str(out_file),
            target,
        ]
        try:
            run_command(cmd, timeout=timeout)
        except subprocess.TimeoutExpired:
            return [], f"testssl.sh timed out after {timeout}s"
        except OSError as e:
            return [], f"testssl.sh could not run: {e}"

        if not out_file.exists():
            return [], "testssl.sh produced no output"
        try:
            data = json.loads(out_file.read_text() or "[]")
        except (ValueError, OSError) as e:
            return [], f"testssl.sh output unreadable: {e}"

    # testssl may emit either a flat list or {"scanResult": [...]} depending on
    # version/flags; normalise both to a flat list of finding objects.
    if isinstance(data, dict):
        scan = data.get("scanResult") or []
        findings: list[dict] = []
        for host_block in scan if isinstance(scan, list) else []:
            for section in host_block.values():
                if isinstance(section, list):
                    findings.extend(x for x in section if isinstance(x, dict))
        return findings, None
    if isinstance(data, list):
        return data, None
    return [], "testssl.sh returned an unexpected JSON shape"


def check_testssl(url: str, timeout: int = 180, runner=_run_testssl) -> dict:
    """Runs a deep TLS scan and returns the normalised engine result envelope."""
    raw, error = runner(_host_port(url), timeout)
    if error and not raw:
        installed = "not installed" not in error
        return empty_result(url, "testssl", error=error, installed=installed)

    findings: list[dict] = []
    for item in raw:
        sev = _SEVERITY_MAP.get(str(item.get("severity", "")).upper())
        if sev not in SCORED_SEVERITIES:
            continue
        findings.append({
            "id": item.get("id", ""),
            "name": item.get("id", "TLS finding"),
            "severity": sev,
            "detail": item.get("finding", ""),
        })

    result = empty_result(url, "testssl")
    result["findings"] = findings
    result["counts"] = count_severities(findings)
    return result
