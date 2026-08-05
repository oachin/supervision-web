"""
scanners/threat_intel.py
Free threat-intelligence enrichment for banner-derived CVEs, to drive
*prioritisation* (not just detection).

Two keyless, public sources are used:

  * **CISA KEV** (Known Exploited Vulnerabilities) — the authoritative catalog
    of CVEs that are being *actively exploited in the wild*. A KEV hit is the
    single strongest "fix this first" signal an EASM can attach to a finding.
    Source: https://www.cisa.gov/.../known_exploited_vulnerabilities.json
  * **EPSS** (Exploit Prediction Scoring System, FIRST.org) — a 0..1 probability
    that a CVE will be exploited in the next 30 days. Complements CVSS (how bad)
    with likelihood (how probable), which is what real prioritisation needs.
    Source: https://api.first.org/data/v1/epss

Design notes
------------
* **Free, keyless, fail-safe.** Both endpoints are public and need no API key.
  Any network/parse error degrades to "no enrichment" (never raises), so a slow
  or unreachable feed never blocks or crashes a scan.
* **Cached with a TTL.** The KEV catalog and EPSS scores change slowly relative
  to a scan cadence, so results are memoised (``KEV_CACHE_TTL`` / per-CVE EPSS
  cache) — a fleet of sites on the same stack costs one fetch, not one per site.
* **Opt-out via env.** Enrichment is on by default; set ``CVE_ENRICH=false`` to
  skip the network calls entirely.
"""

from __future__ import annotations

import os
import threading
import time

import requests

KEV_URL = ("https://www.cisa.gov/sites/default/files/feeds/"
           "known_exploited_vulnerabilities.json")
EPSS_URL = "https://api.first.org/data/v1/epss"
_USER_AGENT = {"User-Agent": "SecurityAuditTool/1.0"}
_DEFAULT_TIMEOUT = 10


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except (ValueError, TypeError):
        return default


_KEV_CACHE_TTL = _env_float("KEV_CACHE_TTL", 6 * 3600.0)
_EPSS_CACHE_TTL = _env_float("EPSS_CACHE_TTL", 6 * 3600.0)

# (expiry_monotonic, {cve_id})
_kev_cache: tuple[float, set[str]] | None = None
_kev_lock = threading.Lock()
# cve_id -> (expiry_monotonic, epss_float)
_epss_cache: dict[str, tuple[float, float]] = {}
_epss_lock = threading.Lock()


def enrichment_enabled() -> bool:
    """Whether KEV/EPSS enrichment should run (env ``CVE_ENRICH``, default on)."""
    return os.getenv("CVE_ENRICH", "true").strip().lower() not in ("0", "false", "no")


def fetch_kev_set(timeout: int = _DEFAULT_TIMEOUT,
                  session: requests.Session | None = None) -> set[str]:
    """Returns the set of KEV CVE ids (upper-cased). Cached; never raises.

    On any error returns whatever is cached, else an empty set."""
    global _kev_cache
    now = time.monotonic()
    with _kev_lock:
        if _kev_cache and _kev_cache[0] > now:
            return _kev_cache[1]
    getter = session.get if session is not None else requests.get
    try:
        resp = getter(KEV_URL, headers=_USER_AGENT, timeout=timeout)
        resp.raise_for_status()
        payload = resp.json()
        ids = {str(v.get("cveID", "")).upper()
               for v in payload.get("vulnerabilities", [])
               if v.get("cveID")}
    except (requests.RequestException, ValueError):
        with _kev_lock:
            return _kev_cache[1] if _kev_cache else set()
    with _kev_lock:
        _kev_cache = (now + _KEV_CACHE_TTL, ids)
    return ids


def fetch_epss_scores(cve_ids: list[str], timeout: int = _DEFAULT_TIMEOUT,
                      session: requests.Session | None = None) -> dict[str, float]:
    """Returns ``{cve_id: epss_probability}`` for the requested CVEs.

    Only misses (not already cached) are queried, in one batched request.
    Cached per-CVE with a TTL; never raises (missing scores are simply absent).
    """
    wanted = [c.upper() for c in cve_ids if c]
    now = time.monotonic()
    out: dict[str, float] = {}
    misses: list[str] = []
    with _epss_lock:
        for cid in wanted:
            entry = _epss_cache.get(cid)
            if entry and entry[0] > now:
                out[cid] = entry[1]
            else:
                misses.append(cid)
    if not misses:
        return out
    getter = session.get if session is not None else requests.get
    try:
        resp = getter(EPSS_URL,
                      params={"cve": ",".join(misses), "envelope": "false"},
                      headers=_USER_AGENT, timeout=timeout)
        resp.raise_for_status()
        payload = resp.json()
        fetched: dict[str, float] = {}
        for row in payload.get("data", []) or []:
            cid = str(row.get("cve", "")).upper()
            if not cid:
                continue
            try:
                fetched[cid] = float(row.get("epss", 0.0))
            except (ValueError, TypeError):
                continue
    except (requests.RequestException, ValueError):
        return out
    with _epss_lock:
        for cid, score in fetched.items():
            _epss_cache[cid] = (now + _EPSS_CACHE_TTL, score)
    out.update(fetched)
    return out


def enrich_vulns(vulnerabilities: dict, timeout: int = _DEFAULT_TIMEOUT,
                 session: requests.Session | None = None) -> dict:
    """Annotates each CVE in a ``check_cve`` ``vulnerabilities`` mapping in place
    with ``kev`` (bool, actively exploited) and ``epss`` (float 0..1, exploit
    probability). Returns the same mapping. Fail-safe: on any error the CVEs are
    left untouched.
    """
    if not vulnerabilities:
        return vulnerabilities
    all_ids: list[str] = []
    for vulns in vulnerabilities.values():
        for v in vulns:
            cid = v.get("id")
            if cid:
                all_ids.append(cid)
    if not all_ids:
        return vulnerabilities

    kev = fetch_kev_set(timeout=timeout, session=session)
    epss = fetch_epss_scores(all_ids, timeout=timeout, session=session)
    for vulns in vulnerabilities.values():
        for v in vulns:
            cid = str(v.get("id", "")).upper()
            v["kev"] = cid in kev
            if cid in epss:
                v["epss"] = epss[cid]
        # Re-sort so actively-exploited (KEV), then higher EPSS, then CVSS, lead.
        vulns.sort(key=lambda x: (bool(x.get("kev")), x.get("epss") or 0.0,
                                  x.get("cvss") or 0.0), reverse=True)
    return vulnerabilities


def clear_cache() -> None:
    """Drops the KEV/EPSS caches (mainly for tests / forced refresh)."""
    global _kev_cache
    with _kev_lock:
        _kev_cache = None
    with _epss_lock:
        _epss_cache.clear()
