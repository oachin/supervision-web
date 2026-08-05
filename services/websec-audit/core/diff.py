"""
core/diff.py
Compares a site's current findings against its previous scan so the dashboard
and alerts can highlight what changed ("suivre l'évolution dans le temps").

A finding is identified by (code, message): the stable `code` groups the same
class of issue, and the message disambiguates instances (e.g. two different
exposed paths). Informational findings are ignored — they are advisory, not
regressions or fixes.
"""

from __future__ import annotations


def _key(finding: dict) -> tuple:
    return (finding.get("code"), finding.get("message"))


def _actionable(findings: list[dict]) -> list[dict]:
    return [f for f in findings if f.get("severity") != "info"]


def diff_findings(current: list[dict], previous: list[dict] | None) -> dict:
    """Returns {"new": [...], "resolved": [...]} comparing current vs previous.

    * new      — actionable findings present now but not in the previous scan.
    * resolved — actionable findings present previously but gone now.

    When `previous` is None (the site has only ever been scanned once) there is
    nothing to compare against, so both lists are empty.
    """
    if previous is None:
        return {"new": [], "resolved": []}

    prev_keys = {_key(f) for f in previous}
    cur_keys = {_key(f) for f in current}

    new = [f for f in _actionable(current) if _key(f) not in prev_keys]
    resolved = [f for f in _actionable(previous) if _key(f) not in cur_keys]
    return {"new": new, "resolved": resolved}
