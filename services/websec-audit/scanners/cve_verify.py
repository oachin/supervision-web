"""
cve_verify.py
Automatic cross-verification of banner-derived CVEs against the OSV database
(https://osv.dev), to cut false positives without any manual triage.

Why
---
CVEs derived from a version banner are only *potential*: the advertised version
can match an NVD applicability range that is broader than reality, or the build
may already be patched. OSV is a second, independent, version-precise
vulnerability source that aggregates upstream and distro advisories. Asking OSV
"is *this exact version* actually affected by CVE-X?" lets us:

* **drop** a CVE OSV positively reports as *not affecting* the detected version
  (a strong false-positive signal — a second authoritative source disagrees), and
* **corroborate** a CVE OSV confirms *does* affect the version.

Design
------
* **Fail-safe / conservative.** A CVE is only dropped when OSV *knows the record*
  and its affected-version data positively excludes the detected version. When
  OSV has no data, errors, or is ambiguous, the CVE is kept unchanged — we never
  hide a vulnerability because a lookup was inconclusive (no false negatives from
  a flaky network).
* **No new dependency.** Version comparison is a small, self-contained
  dotted-numeric comparator (good enough for the semver-ish versions in banners);
  it degrades to "unknown" (keep the CVE) when a version can't be parsed.
* **Injectable fetcher** so it is unit-testable offline and so a host can point
  it at a mirror.
* Each verified CVE gains an ``osv`` field: ``"affected"`` / ``"not_affected"``
  / ``"unknown"``.
"""

from __future__ import annotations

import os
import re

import requests
from requests.exceptions import RequestException

OSV_VULN_URL = "https://api.osv.dev/v1/vulns/{id}"


def _version_key(version: str) -> tuple[int, ...] | None:
    """Parses a dotted version into a comparable tuple of ints, or None.

    Keeps the leading numeric release components (``1.18.0`` -> ``(1, 18, 0)``),
    stopping at the first non-numeric component (``2.4.49p1`` -> ``(2, 4, 49)``)
    so pre-release/patch suffixes don't break the comparison. Returns None when
    there is no leading numeric component to compare (caller treats as unknown).
    """
    parts: list[int] = []
    for token in re.split(r"[.\-_+~]", version.strip()):
        m = re.match(r"^(\d+)", token)
        if not m:
            break
        parts.append(int(m.group(1)))
    return tuple(parts) if parts else None


def _cmp(a: str, b: str) -> int | None:
    """Compares two versions: -1/0/1, or None when either is unparseable."""
    ka, kb = _version_key(a), _version_key(b)
    if ka is None or kb is None:
        return None
    # Pad to equal length so 1.18 == 1.18.0.
    n = max(len(ka), len(kb))
    ka += (0,) * (n - len(ka))
    kb += (0,) * (n - len(kb))
    return (ka > kb) - (ka < kb)


def _range_affects(version: str, events: list[dict]) -> bool | None:
    """Whether ``version`` is affected per one OSV range's ordered events.

    OSV range events are ordered introduced/fixed/last_affected markers. A
    version is affected iff it is >= some ``introduced`` and not yet cut off by a
    following ``fixed`` (exclusive) or ``last_affected`` (inclusive). Returns
    None when any relevant comparison is unparseable (ambiguous)."""
    affected = False
    ambiguous = False
    for event in events:
        if "introduced" in event:
            introduced = event["introduced"]
            if introduced == "0":
                affected = True
                continue
            c = _cmp(version, introduced)
            if c is None:
                ambiguous = True
            elif c >= 0:
                affected = True
        elif "fixed" in event:
            c = _cmp(version, event["fixed"])
            if c is None:
                ambiguous = True
            elif c >= 0:
                affected = False
        elif "last_affected" in event:
            c = _cmp(version, event["last_affected"])
            if c is None:
                ambiguous = True
            elif c > 0:
                affected = False
    if affected:
        return True
    return None if ambiguous else False


def _product_matches(product: str, package_name: str) -> bool:
    """Loose match between a banner product token and an OSV package name."""
    p = product.lower()
    name = (package_name or "").lower()
    # OSV names can be "nginx", "apache-httpd", "org.apache.tomcat:tomcat", …
    return bool(name) and (p in name or name in p or name.split(":")[-1] == p)


def _status_from_record(product: str, version: str, record: dict) -> str:
    """'affected' / 'not_affected' / 'unknown' for a version given an OSV record."""
    matched = False
    saw_affected_data = False
    for affected in record.get("affected", []):
        pkg = affected.get("package", {}) or {}
        if not _product_matches(product, pkg.get("name", "")):
            continue
        matched = True
        # Explicit enumerated versions are authoritative when present.
        versions = affected.get("versions") or []
        if versions:
            saw_affected_data = True
            if version in versions:
                return "affected"
        for rng in affected.get("ranges", []) or []:
            events = rng.get("events") or []
            if not events:
                continue
            saw_affected_data = True
            verdict = _range_affects(version, events)
            if verdict is True:
                return "affected"
            if verdict is None:
                return "unknown"  # ambiguous parse -> keep the CVE
    if matched and saw_affected_data:
        # OSV tracks this product/CVE and the version is in none of the affected
        # sets -> a positive "not affected" signal (likely false positive).
        return "not_affected"
    return "unknown"


def _osv_fetch(cve_id: str, timeout: int = 10) -> dict | None:
    """Fetches the OSV record aliased to ``cve_id``; None if OSV has none."""
    resp = requests.get(OSV_VULN_URL.format(id=cve_id), timeout=timeout)
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    return resp.json()


def verify_vulns(product: str, version: str, vulns: list[dict], *,
                 fetcher=_osv_fetch, timeout: int = 10) -> list[dict]:
    """Annotates ``vulns`` with an ``osv`` status and drops false positives.

    For each CVE, OSV is asked whether ``version`` is actually affected. A CVE
    OSV positively reports as *not affecting* this version is dropped (its
    ``osv`` would be ``"not_affected"``); all others are kept, tagged with
    ``osv`` = ``"affected"`` / ``"unknown"``. Any lookup error leaves the CVE
    untouched and unfiltered (fail-safe).
    """
    kept: list[dict] = []
    for vuln in vulns:
        cve_id = str(vuln.get("id", ""))
        status = "unknown"
        if cve_id.upper().startswith("CVE-"):
            try:
                record = fetcher(cve_id, timeout=timeout)
                if record:
                    status = _status_from_record(product, version, record)
            except RequestException:
                status = "unknown"
        enriched = dict(vuln, osv=status)
        if status == "not_affected":
            continue  # OSV says this version isn't affected -> drop false positive
        kept.append(enriched)
    return kept


def backport_verification_enabled() -> bool:
    """True when AUDIT_VERIFY_BACKPORTS is set truthy (opt-in, network calls)."""
    return (os.getenv("AUDIT_VERIFY_BACKPORTS") or "").strip().lower() in (
        "1", "true", "yes", "on")
