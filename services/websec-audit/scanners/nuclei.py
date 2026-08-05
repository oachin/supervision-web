"""
scanners/nuclei.py
Templated vulnerability & misconfiguration scanning via `nuclei`
(https://github.com/projectdiscovery/nuclei).

Why this exists
---------------
nuclei runs a large, community-maintained library of detection templates:
known-CVE checks (with real request signatures, not just banner guessing),
exposed panels/config files, default credentials, misconfigurations, and
technology fingerprints. It is fast, actively maintained, and widely trusted —
exactly the kind of engine you should reuse rather than re-implement.

Safety
------
By default this scanner excludes intrusive template tags
(``dos``, ``intrusive``, ``fuzzing``, ``brute-force``) so it stays a safe,
mostly-passive external check. Those heavier templates are only enabled when the
caller passes ``authorized=True`` (the same gate as the port scanner), because
running them without written authorization can disrupt a target.

The engine binary is optional: if nuclei is not installed the scan is reported
as inconclusive rather than failing the audit.
"""

from __future__ import annotations

import json
import subprocess

from scanners._external import (
    SCORED_SEVERITIES, count_severities, empty_result, find_binary, run_command,
)

# Template tags that can be disruptive; excluded unless the scan is authorized.
_UNSAFE_TAGS = "dos,intrusive,fuzzing,brute-force"


def _run_nuclei(url: str, timeout: int, authorized: bool) -> tuple[list[dict], str | None]:
    """Runs nuclei against ``url``, returning (raw_jsonl_objects, error).

    Emits one JSON object per finding (``-jsonl``). Returns an error string
    (and empty list) when the tool is missing, times out, or errors out.
    """
    binary = find_binary("nuclei")
    if not binary:
        return [], "nuclei not installed"

    cmd = [
        binary, "-u", url,
        "-jsonl", "-silent", "-disable-update-check",
        "-severity", "low,medium,high,critical",
        "-timeout", "10",
    ]
    if not authorized:
        cmd += ["-exclude-tags", _UNSAFE_TAGS]

    try:
        proc = run_command(cmd, timeout=timeout)
    except subprocess.TimeoutExpired:
        return [], f"nuclei timed out after {timeout}s"
    except OSError as e:
        return [], f"nuclei could not run: {e}"

    findings: list[dict] = []
    for line in (proc.stdout or "").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            findings.append(json.loads(line))
        except ValueError:
            continue  # skip non-JSON noise
    return findings, None


def check_nuclei(url: str, timeout: int = 300, authorized: bool = False,
                 runner=_run_nuclei) -> dict:
    """Runs nuclei and returns the normalised engine result envelope."""
    raw, error = runner(url, timeout, authorized)
    if error and not raw:
        installed = "not installed" not in error
        return empty_result(url, "nuclei", error=error, installed=installed)

    findings: list[dict] = []
    for item in raw:
        info = item.get("info", {}) if isinstance(item, dict) else {}
        sev = str(info.get("severity", "")).lower()
        if sev not in SCORED_SEVERITIES:
            continue
        findings.append({
            "id": item.get("template-id", ""),
            "name": info.get("name", item.get("template-id", "nuclei finding")),
            "severity": sev,
            "detail": item.get("matched-at", "") or item.get("host", ""),
        })

    result = empty_result(url, "nuclei")
    result["findings"] = findings
    result["counts"] = count_severities(findings)
    return result
