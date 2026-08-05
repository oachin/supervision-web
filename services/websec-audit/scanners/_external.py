"""
scanners/_external.py
Shared helpers for the scanners that wrap external security engines
(testssl.sh, nuclei, OWASP ZAP baseline).

Design contract shared by all three engine scanners
---------------------------------------------------
* **Graceful degradation.** If the engine binary is not installed, the scanner
  never crashes: it returns ``installed=False`` with an ``error`` explaining it,
  and the scoring layer surfaces that as an informational (0-penalty) finding —
  exactly like an inconclusive TLS/DNS result. This keeps the tool usable even
  where an engine cannot be installed.
* **Bounded.** Every subprocess runs under a hard timeout; a hung engine can
  never stall the whole audit.
* **Injectable runner.** Each ``check_*`` accepts a ``runner`` callable so unit
  tests exercise the parsing/normalisation logic against captured engine output
  without invoking the real (heavy, network-bound) binary.
* **Normalised output.** Each scanner returns::

      {
        "url": str,
        "engine": "testssl" | "nuclei" | "zap",
        "installed": bool,
        "findings": [ {"id", "name", "severity", "detail"} ],
        "counts": {"critical": int, "high": int, "medium": int, "low": int},
        "error": str | None,
      }

  ``severity`` is one of the canonical bands in ``SEVERITIES``.
"""

from __future__ import annotations

import shutil
import subprocess

# Canonical severity bands used across the whole tool (see scoring/engine.py).
SEVERITIES = ("critical", "high", "medium", "low", "info")
SCORED_SEVERITIES = ("critical", "high", "medium", "low")


def find_binary(*names: str) -> str | None:
    """Returns the path to the first available binary among ``names``, or None."""
    for name in names:
        path = shutil.which(name)
        if path:
            return path
    return None


def run_command(cmd: list[str], timeout: int) -> subprocess.CompletedProcess:
    """Runs ``cmd`` capturing stdout/stderr as text, under a hard timeout.

    Raises ``subprocess.TimeoutExpired`` on timeout and ``OSError`` if the
    binary cannot be executed — callers translate these into an ``error``.
    """
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def empty_result(url: str, engine: str, error: str | None = None,
                 installed: bool = True) -> dict:
    """Builds the normalised, finding-free result envelope."""
    return {
        "url": url,
        "engine": engine,
        "installed": installed,
        "findings": [],
        "counts": {s: 0 for s in SCORED_SEVERITIES},
        "error": error,
    }


def count_severities(findings: list[dict]) -> dict[str, int]:
    """Tallies scored severities across a list of normalised findings."""
    counts = {s: 0 for s in SCORED_SEVERITIES}
    for f in findings:
        sev = f.get("severity")
        if sev in counts:
            counts[sev] += 1
    return counts
