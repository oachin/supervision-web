"""
cve.py
Maps the software/version banners a site advertises (Server, X-Powered-By, …)
to publicly known vulnerabilities (CVEs) via the NVD (National Vulnerability
Database) 2.0 API.

What it does
------------
1. Reads the response banner headers of the target (the same ones misconfig.py
   flags as version disclosure) and extracts ``product`` + ``version`` pairs,
   e.g. ``Server: Apache/2.4.49 (Ubuntu)`` -> ``("apache", "2.4.49")``.
2. Looks each pair up in the NVD and reports the known CVEs, worst-first, with
   their CVSS score and severity.

Design notes
------------
* **CPE-based matching where possible.** For known products we resolve the
  banner to an official NVD **CPE** (vendor:product) and query by
  ``virtualMatchString`` with the exact version, so the NVD returns only CVEs
  whose applicability configurations actually cover that version (precise, and
  it honours affected-version ranges). Unknown products fall back to the old
  keyword search. Every CVE records how it was matched (``"cpe"`` vs
  ``"keyword"``) so a keyword (fuzzy) match can be flagged as needing
  verification rather than presented as confirmed.
* **Confidence, not certainty.** All banner-derived CVEs are *potential*: the
  advertised version can be a distro-backported build that is already patched,
  so we never present them as confirmed exploitable. Each CVE carries a
  ``confidence`` (``"potential"`` for a precise CPE version match,
  ``"low"`` for a fuzzy keyword match). Callers/operators can suppress known
  false positives by CVE id via ``suppressed_cve_ids``.
* **Rate-limit aware.** At fleet scale (hundreds of sites) the NVD throttles
  hard (~5 requests/30s without a key, ~50 with one). Lookups honour
  ``Retry-After`` on 429/403 and retry with bounded backoff, so a burst is not
  silently turned into "no CVEs found". Set ``NVD_API_KEY`` for the higher limit.
* **Best-effort and fail-safe.** Scanning must never hang or crash because the
  NVD is slow or unreachable: every network call has a short timeout and any
  error is captured in ``error`` (the site is simply not CVE-scored, exactly
  like an inconclusive TLS/DNS result).
* **Cached with a TTL.** A fleet usually runs a handful of distinct server
  stacks, so lookups are memoised by ``(product, version)`` — 150 sites on
  nginx/1.18.0 cost one NVD query, not 150. The cache is time-bounded
  (``NVD_CACHE_TTL``, default 6h) so a long-lived host process picks up newly
  published CVEs, and size-bounded (``NVD_CACHE_MAX``) so it cannot grow without
  limit.
* **Only versioned products are looked up.** A bare ``Server: cloudflare`` (no
  version) is skipped: without a version the query is pure noise.
* **Non-intrusive.** One ordinary GET to the site's own URL, nothing else.
* **Banner must come from the application.** The banner GET goes through
  scanners/_http.py. Behind an unsolved anti-bot interstitial the ``Server``
  header belongs to the mitigation layer, not the target, so looking its CVEs
  up would attribute someone else's vulnerabilities to the site; the scan is
  reported inconclusive instead.
* An optional ``NVD_API_KEY`` (env) raises the NVD rate limit; it is not
  required.
"""

from __future__ import annotations

import os
import re
import threading
import time

import requests
from requests.exceptions import RequestException
import urllib3

from scanners._http import challenge_error, fetch

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Banner headers that advertise software + version (superset of misconfig's).
BANNER_HEADERS = [
    "Server",
    "X-Powered-By",
    "X-AspNet-Version",
    "X-AspNetMvc-Version",
    "X-Generator",
    "X-Runtime",
]

# "product/version" tokens, e.g. Apache/2.4.49, nginx/1.18.0, PHP/7.4.3,
# OpenSSL/1.1.1f. Version must have at least one dot so we don't match noise.
_PRODUCT_RE = re.compile(r"([A-Za-z][A-Za-z0-9._+-]*?)/(\d+(?:\.\d+)+[A-Za-z0-9._-]*)")

NVD_API_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0"
USER_AGENT = {"User-Agent": "SecurityAuditTool/1.0"}


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (ValueError, TypeError):
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except (ValueError, TypeError):
        return default


# NVD throttles hard at fleet scale. On 429/403 we honour Retry-After and retry
# with capped exponential backoff instead of turning a throttle into "no CVEs".
NVD_MAX_RETRIES = _env_int("NVD_MAX_RETRIES", 3)
NVD_BACKOFF_BASE = _env_float("NVD_BACKOFF_BASE", 6.0)   # seconds, doubled per retry
NVD_BACKOFF_CAP = _env_float("NVD_BACKOFF_CAP", 60.0)    # never sleep longer than this
# Lookup cache bounds: TTL so a long-lived process eventually re-checks the NVD
# (new CVEs get published), and a hard entry cap so a diverse fleet can't grow it
# without limit.
CACHE_TTL_SECONDS = _env_float("NVD_CACHE_TTL", 6 * 3600.0)
CACHE_MAX_ENTRIES = _env_int("NVD_CACHE_MAX", 5000)

# Maps a lower-cased banner product token to its official NVD CPE
# (vendor, product). When a banner matches, we query the NVD by CPE + exact
# version instead of a fuzzy keyword search, which removes most false positives.
# Products not listed here transparently fall back to the keyword search.
_CPE_MAP: dict[str, tuple[str, str]] = {
    "apache": ("apache", "http_server"),
    "httpd": ("apache", "http_server"),
    "apache-coyote": ("apache", "tomcat"),
    "tomcat": ("apache", "tomcat"),
    "nginx": ("nginx", "nginx"),
    "openresty": ("openresty", "openresty"),
    "lighttpd": ("lighttpd", "lighttpd"),
    "iis": ("microsoft", "internet_information_services"),
    "microsoft-iis": ("microsoft", "internet_information_services"),
    "php": ("php", "php"),
    "openssl": ("openssl", "openssl"),
    "openssh": ("openbsd", "openssh"),
    "node": ("nodejs", "node.js"),
    "nodejs": ("nodejs", "node.js"),
    "gunicorn": ("gunicorn", "gunicorn"),
    "python": ("python", "python"),
    "jetty": ("eclipse", "jetty"),
    "mysql": ("oracle", "mysql"),
    "postfix": ("postfix", "postfix"),
    "wordpress": ("wordpress", "wordpress"),
    "jquery": ("jquery", "jquery"),
}


def cpe_match_string(product: str, version: str) -> str | None:
    """Builds an NVD ``virtualMatchString`` (CPE 2.3) for a known product, or
    None when the product is unknown (caller then uses keyword search)."""
    mapped = _CPE_MAP.get(product.lower())
    if not mapped:
        return None
    vendor, cpe_product = mapped
    return f"cpe:2.3:a:{vendor}:{cpe_product}:{version}:*:*:*:*:*:*:*"


# Maps (product, version) -> (expiry_monotonic, vulnerabilities). TTL/size
# bounded via CACHE_TTL_SECONDS / CACHE_MAX_ENTRIES.
_cache: dict[tuple[str, str], tuple[float, list[dict]]] = {}
_cache_lock = threading.Lock()


def _parse_suppressions(raw: str | None) -> set[str]:
    """Parses a comma/space-separated list of CVE ids to suppress (upper-cased)."""
    if not raw:
        return set()
    return {token.strip().upper() for token in re.split(r"[,\s]+", raw) if token.strip()}


def parse_products(headers: dict) -> list[dict]:
    """Extracts ``[{product, version, source}]`` from banner response headers.

    De-duplicated on ``(product, version)``; ``headers`` is a case-insensitive
    mapping (``requests`` response headers) or a plain dict.
    """
    seen: set[tuple[str, str]] = set()
    products: list[dict] = []
    for header in BANNER_HEADERS:
        value = headers.get(header)
        if not value:
            continue
        for product, version in _PRODUCT_RE.findall(value):
            key = (product.lower(), version)
            if key in seen:
                continue
            seen.add(key)
            products.append({"product": product.lower(), "version": version,
                             "source": f"{header}: {value}"})
    return products


def _severity_from_cvss(score: float) -> str:
    """CVSS v3 qualitative severity band for a base score."""
    if score >= 9.0:
        return "critical"
    if score >= 7.0:
        return "high"
    if score >= 4.0:
        return "medium"
    if score > 0.0:
        return "low"
    return "info"


def _extract_cvss(metrics: dict) -> tuple[float, str]:
    """Best available CVSS base score + severity from an NVD ``metrics`` block."""
    for key in ("cvssMetricV31", "cvssMetricV30", "cvssMetricV2"):
        entries = metrics.get(key) or []
        if entries:
            data = entries[0].get("cvssData", {})
            score = float(data.get("baseScore", 0.0) or 0.0)
            sev = data.get("baseSeverity") or _severity_from_cvss(score)
            return score, sev.lower()
    return 0.0, "info"


def _retry_delay(resp, attempt: int) -> float:
    """Seconds to wait before retrying a throttled NVD request.

    Honours a numeric ``Retry-After`` header when present, otherwise uses capped
    exponential backoff. Always bounded by ``NVD_BACKOFF_CAP``.
    """
    headers = getattr(resp, "headers", None) or {}
    raw = headers.get("Retry-After")
    if raw:
        try:
            return min(float(raw), NVD_BACKOFF_CAP)
        except (ValueError, TypeError):
            pass
    return min(NVD_BACKOFF_BASE * (2 ** attempt), NVD_BACKOFF_CAP)


def _nvd_get(params: dict, headers: dict, timeout: int, sleep=time.sleep) -> dict:
    """GETs the NVD API with rate-limit-aware retries; returns the JSON payload.

    On HTTP 429/403 (throttling) it waits (Retry-After or backoff) and retries up
    to ``NVD_MAX_RETRIES`` times; after that it raises via ``raise_for_status`` so
    the caller records an error rather than silently seeing "no CVEs".
    """
    for attempt in range(NVD_MAX_RETRIES + 1):
        resp = requests.get(NVD_API_URL, params=params, headers=headers, timeout=timeout)
        if getattr(resp, "status_code", 200) in (429, 403) and attempt < NVD_MAX_RETRIES:
            sleep(_retry_delay(resp, attempt))
            continue
        resp.raise_for_status()
        return resp.json()
    # Loop always returns/raises above; this keeps type-checkers happy.
    resp.raise_for_status()
    return resp.json()


def nvd_cve_lookup(product: str, version: str, timeout: int = 10,
                   max_results: int = 20) -> list[dict]:
    """Queries the NVD for CVEs affecting ``product version``.

    Returns ``[{id, cvss, severity, description, match, confidence}]`` (may be
    empty). ``match`` is ``"cpe"`` (precise version match) or ``"keyword"``
    (fuzzy); ``confidence`` is ``"potential"`` for a CPE match and ``"low"`` for
    a keyword match — banner-derived CVEs are never "confirmed" (the version may
    be a distro-backported, already-patched build). Raises ``RequestException``
    on network/HTTP failure so the caller can record it.
    """
    match_string = cpe_match_string(product, version)
    if match_string:
        params = {"virtualMatchString": match_string, "resultsPerPage": max_results}
        match_type, confidence = "cpe", "potential"
    else:
        params = {"keywordSearch": f"{product} {version}",
                  "keywordExactMatch": "", "resultsPerPage": max_results}
        match_type, confidence = "keyword", "low"
    req_headers = dict(USER_AGENT)
    api_key = os.getenv("NVD_API_KEY")
    if api_key:
        req_headers["apiKey"] = api_key

    payload = _nvd_get(params, req_headers, timeout)

    vulns: list[dict] = []
    for item in payload.get("vulnerabilities", []):
        cve = item.get("cve", {})
        cve_id = cve.get("id")
        if not cve_id:
            continue
        score, severity = _extract_cvss(cve.get("metrics", {}))
        descriptions = cve.get("descriptions", [])
        desc = next((d.get("value") for d in descriptions if d.get("lang") == "en"), "")
        vulns.append({"id": cve_id, "cvss": score, "severity": severity,
                      "description": desc, "match": match_type, "confidence": confidence})
    vulns.sort(key=lambda v: v["cvss"], reverse=True)
    return vulns


def _cached_lookup(product: str, version: str, searcher, timeout: int) -> list[dict]:
    key = (product, version)
    now = time.monotonic()
    with _cache_lock:
        entry = _cache.get(key)
        if entry is not None and entry[0] > now:
            return entry[1]
    result = searcher(product, version, timeout=timeout)
    with _cache_lock:
        if (CACHE_MAX_ENTRIES > 0 and key not in _cache
                and len(_cache) >= CACHE_MAX_ENTRIES):
            # Evict the entry closest to expiry to stay within the size bound.
            _cache.pop(min(_cache, key=lambda k: _cache[k][0]), None)
        _cache[key] = (now + CACHE_TTL_SECONDS, result)
    return result


def check_cve(url: str, timeout: int = 10, searcher=nvd_cve_lookup,
              suppressed_cve_ids=None, verify_backports=None, verifier=None,
              enrich=None, enricher=None, session=None) -> dict:
    """
    Detects software banners for ``url`` and looks up known CVEs for each.

    Returns a dict with:
        - url
        - products: list of {product, version, source}
        - vulnerabilities: {"<product> <version>": [ {id, cvss, severity,
          description, match, confidence, osv?} ]}
        - blocked_by_challenge: bool  (an anti-bot page answered, not the app)
        - error: str | None   (banner request failed, blocked, or every lookup failed)

    ``searcher`` is injectable for testing; it must accept
    ``(product, version, timeout=...)`` and return a list of vulnerability dicts.
    ``suppressed_cve_ids`` is an iterable of CVE ids to drop (known false
    positives, e.g. distro-backported fixes); when ``None`` it defaults to the
    ``CVE_SUPPRESS`` env var so operators can suppress without code changes.

    ``verify_backports`` turns on automatic OSV cross-verification: each CVE is
    checked against the OSV database and any CVE OSV positively reports as *not
    affecting* the detected version is dropped as a false positive (see
    ``scanners.cve_verify``). When ``None`` it defaults to the
    ``AUDIT_VERIFY_BACKPORTS`` env var. ``verifier`` is an injectable override of
    the verification function (for testing / a host-supplied OSV mirror).

    ``enrich`` turns on free threat-intel enrichment: each CVE is tagged with
    ``kev`` (CISA Known-Exploited, actively exploited in the wild) and ``epss``
    (FIRST exploit-probability), and the list is re-ordered so the most
    exploitable lead — driving prioritisation, not just detection. When ``None``
    it defaults to the ``CVE_ENRICH`` env var (on unless set false). ``enricher``
    is an injectable override of the enrichment function (for testing).
    """
    if suppressed_cve_ids is None:
        suppressed = _parse_suppressions(os.getenv("CVE_SUPPRESS"))
    else:
        suppressed = {str(c).upper() for c in suppressed_cve_ids}

    if verify_backports is None:
        from scanners.cve_verify import backport_verification_enabled
        verify_backports = backport_verification_enabled()
    if verify_backports and verifier is None:
        from scanners.cve_verify import verify_vulns as verifier

    result: dict = {"url": url, "products": [], "vulnerabilities": {}, "error": None}

    fetched = fetch(url, session=session, timeout=timeout)
    if fetched.error:
        result["error"] = f"Banner request failed: {fetched.error}"
        return result
    if fetched.blocked_by_challenge:
        result["blocked_by_challenge"] = True
        result["challenge_kind"] = fetched.challenge_kind
        result["error"] = challenge_error(fetched.challenge_kind)
        return result

    result["products"] = parse_products(fetched.response.headers)
    if not result["products"]:
        return result

    lookup_errors = 0
    for entry in result["products"]:
        product, version = entry["product"], entry["version"]
        try:
            vulns = _cached_lookup(product, version, searcher, timeout)
        except RequestException as e:
            lookup_errors += 1
            result["error"] = f"CVE lookup failed: {e}"
            continue
        if vulns and suppressed:
            vulns = [v for v in vulns if str(v.get("id", "")).upper() not in suppressed]
        # Automatic OSV cross-verification: drop CVEs OSV says don't affect this
        # version. Fail-safe: any error leaves the CVEs untouched.
        if vulns and verify_backports and verifier is not None:
            vulns = verifier(product, version, vulns, timeout=timeout)
        if vulns:
            result["vulnerabilities"][f"{product} {version}"] = vulns

    # If every lookup failed, surface the error; if at least one succeeded, the
    # partial result is still useful, so keep error cleared.
    if lookup_errors and lookup_errors < len(result["products"]):
        result["error"] = None

    # Free threat-intel enrichment (KEV + EPSS) for prioritisation. Fail-safe:
    # any error leaves the CVEs exactly as found.
    if enrich is None:
        from scanners.threat_intel import enrichment_enabled
        enrich = enrichment_enabled()
    if enrich and result["vulnerabilities"]:
        if enricher is None:
            from scanners.threat_intel import enrich_vulns as enricher
        try:
            enricher(result["vulnerabilities"], timeout=timeout)
        except Exception:
            pass
    return result
