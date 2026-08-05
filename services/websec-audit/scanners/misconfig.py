"""
misconfig.py
Lightweight checks for common web misconfigurations and known-bad exposures.

This complements the dedicated tls/headers/dns scanners by catching a handful of
frequent, high-signal problems that a boss/auditor expects to see flagged:

    * Software/version disclosure via banner headers (Server, X-Powered-By, ...)
    * Directory listing left enabled ("Index of /")
    * Sensitive files/paths accidentally exposed (.git/, .env, backups, ...)
    * Dangerous HTTP methods enabled (TRACE -> Cross-Site Tracing)
    * Missing security.txt (informational, per RFC 9116)

Design notes
------------
* Non-intrusive & read-only: this performs a small number of ordinary GET/OPTIONS
  requests to the target's own URLs. It does NOT fuzz, brute-force, or exploit.
  (Port scanning, which *is* sensitive, lives in ports.py behind --authorized.)
* HTTP goes through scanners/_http.py, which handles certificate-failure retries
  (flagged via `tls_verify_failed`) and anti-bot interstitials. If an unsolved
  interstitial answers, the application was never reached, so no finding is
  emitted at all — its banner and its blanket 200s say nothing about the site.
* **Exposure is proven by difference, not by status code.** Before probing, a
  random path that cannot exist is requested as a negative control. A server
  that answers 200 to that answers 200 to everything (soft-404, SPA catch-all,
  WAF), so a bare `200` there is not evidence of anything; without this control
  such a server "exposes" the entire sensitive-path list. A path is only
  reported when its response differs from the control *and* its body looks like
  the file it claims to be.
* A network error while probing one path is recorded, never fatal: a single
  timeout must not invalidate the rest of the audit.
"""

import hashlib
import re
from urllib.parse import urljoin
from uuid import uuid4

from scanners._http import Baseline, challenge_error, fetch

# Response headers that commonly leak software/versions useful to an attacker.
DISCLOSURE_HEADERS = [
    "Server",
    "X-Powered-By",
    "X-AspNet-Version",
    "X-AspNetMvc-Version",
    "X-Generator",
    "X-Runtime",
]

# Well-known sensitive paths that should never be publicly served. Kept short and
# curated on purpose — this is a sanity check, not a content-discovery brute-forcer.
# Each entry: path -> (severity, human description).
SENSITIVE_PATHS = {
    "/.git/HEAD": ("high", "Exposed .git repository — source code and history may be downloadable"),
    "/.env": ("high", "Exposed .env file — often contains credentials and secrets"),
    "/.svn/entries": ("high", "Exposed .svn metadata — source code may be recoverable"),
    "/config.php.bak": ("high", "Exposed backup of configuration file"),
    "/wp-config.php.bak": ("high", "Exposed WordPress config backup — database credentials"),
    "/.DS_Store": ("low", "Exposed .DS_Store — leaks directory structure"),
    "/phpinfo.php": ("medium", "Exposed phpinfo() — leaks environment and configuration"),
    "/server-status": ("medium", "Exposed Apache server-status — leaks requests and internals"),
}

# What the real file looks like. A 200 whose body does not match its path is a
# generic page (error template, login redirect, WAF notice), not the file — this
# is what stops "200 everywhere" servers from producing a wall of false highs.
_PATH_SIGNATURES = {
    "/.git/HEAD": re.compile(rb"^\s*(ref:\s*refs/|[0-9a-f]{40}\s*$)"),
    "/.env": re.compile(rb"^\s*(#|[A-Za-z_][A-Za-z0-9_]*\s*=)", re.M),
    "/.svn/entries": re.compile(rb"^\s*(\d+\s*$|<\?xml)"),
    "/config.php.bak": re.compile(rb"<\?php|\$[A-Za-z_]", re.I),
    "/wp-config.php.bak": re.compile(rb"<\?php|DB_NAME|DB_PASSWORD", re.I),
    "/.DS_Store": re.compile(rb"^\x00\x00\x00\x01Bud1"),
    "/phpinfo.php": re.compile(rb"phpinfo\(\)|PHP Version|php-logo", re.I),
    "/server-status": re.compile(rb"Apache Server Status|Server uptime|Total accesses", re.I),
}

# A soft-404 template is usually a stable size; a real leaked file rarely lands
# within a few bytes of it. Used together with the content signature above.
_MIN_SIZE_DELTA = 64


def _looks_like_directory_listing(text: str) -> bool:
    sample = text[:2048].lower()
    return "index of /" in sample or "<title>directory listing for" in sample


def _content_matches_path(path: str, body: bytes) -> bool:
    """Whether ``body`` actually looks like the file served at ``path``."""
    signature = _PATH_SIGNATURES.get(path)
    if signature is None:
        return True
    return bool(signature.search(body or b""))


def _build_baseline(url: str, session, timeout: int) -> Baseline:
    """Probes paths that cannot exist, to learn what "not found" looks like here.

    Two controls are used because some servers only fall back to a catch-all for
    paths that look like routes, and others only for file-like paths.
    """
    baseline = Baseline()
    for suffix in (f"{uuid4().hex}", f"{uuid4().hex}.bak"):
        control = fetch(urljoin(url, f"/{suffix}"), session=session, timeout=timeout,
                        allow_redirects=False)
        if control.error or control.response is None:
            continue
        response = control.response
        body = response.content or b""
        baseline.fingerprints.add(hashlib.sha256(body).hexdigest())
        if baseline.status is None:
            baseline.status = response.status_code
            baseline.length = len(body)
        if response.status_code == 200:
            baseline.always_200 = True
    return baseline


def check_misconfig(url: str, timeout: int = 8, session=None) -> dict:
    """
    Runs the misconfiguration checks against a single site.

    Returns a dict with:
        - url
        - tech_disclosure: list of "Header: value" strings that leak software info
        - directory_listing: bool
        - exposed_paths: list of {path, status, severity, description}
        - dangerous_methods: list[str]  (e.g. ["TRACE"])
        - security_txt: bool             (True if /.well-known/security.txt exists)
        - soft_404: bool                 (server answers 200 to paths that cannot exist)
        - issues: list[str]              (human-readable, for scoring/report)
        - tls_verify_failed: bool
        - blocked_by_challenge: bool     (an anti-bot page answered, not the app)
        - challenge_kind: str | None
        - error: str | None              (only set if the base request fails entirely)
    """
    result = {
        "url": url,
        "tech_disclosure": [],
        "directory_listing": False,
        "exposed_paths": [],
        "dangerous_methods": [],
        "security_txt": False,
        "soft_404": False,
        "issues": [],
        "tls_verify_failed": False,
        "blocked_by_challenge": False,
        "challenge_kind": None,
        "error": None,
    }

    # 1) Base request: banner headers + directory listing on the root document.
    base = fetch(url, session=session, timeout=timeout, allow_redirects=False)
    result["tls_verify_failed"] = base.tls_verify_failed

    if base.error:
        result["error"] = base.error
        return result

    if base.blocked_by_challenge:
        # The interstitial answers 200 on every path, so probing would report
        # the whole sensitive-path list as exposed. Report nothing instead.
        result["blocked_by_challenge"] = True
        result["challenge_kind"] = base.challenge_kind
        result["error"] = challenge_error(base.challenge_kind)
        return result

    resp = base.response
    for header in DISCLOSURE_HEADERS:
        value = resp.headers.get(header)
        if value:
            result["tech_disclosure"].append(f"{header}: {value}")
            result["issues"].append(f"Software/version disclosure: {header}: {value}")

    if _looks_like_directory_listing(resp.text or ""):
        result["directory_listing"] = True
        result["issues"].append("Directory listing appears to be enabled at the site root")

    # 2) Dangerous HTTP methods (TRACE -> Cross-Site Tracing).
    options = fetch(url, session=session, method="OPTIONS", timeout=timeout,
                    allow_redirects=False)
    if options.ok:
        allow = options.response.headers.get("Allow", "")
        methods = {m.strip().upper() for m in allow.split(",") if m.strip()}
        for dangerous in ("TRACE", "TRACK"):
            if dangerous in methods:
                result["dangerous_methods"].append(dangerous)
                result["issues"].append(f"Dangerous HTTP method enabled: {dangerous}")

    # 3) Sensitive path probing, against a negative control (see module docstring).
    baseline = _build_baseline(url, session, timeout)
    result["soft_404"] = baseline.always_200
    if baseline.always_200:
        result["issues"].append(
            "Server answers 200 to paths that cannot exist (soft-404 / catch-all) — "
            "sensitive-path probing is not conclusive on this host"
        )

    for path, (severity, description) in SENSITIVE_PATHS.items():
        probe = fetch(urljoin(url, path), session=session, timeout=timeout,
                      allow_redirects=False)
        if not probe.ok:
            continue
        response = probe.response
        body = response.content or b""
        if response.status_code != 200 or not body:
            continue
        # Indistinguishable from a path we know does not exist -> not evidence.
        if baseline.matches(response):
            continue
        if baseline.always_200 and abs(len(body) - baseline.length) <= _MIN_SIZE_DELTA:
            continue
        # Final gate: the body must look like the file it claims to be.
        if not _content_matches_path(path, body):
            continue
        result["exposed_paths"].append(
            {"path": path, "status": response.status_code,
             "severity": severity, "description": description}
        )
        result["issues"].append(f"Exposed sensitive path {path} ({severity}): {description}")

    # 4) security.txt presence (informational, RFC 9116).
    for candidate in ("/.well-known/security.txt", "/security.txt"):
        sec = fetch(urljoin(url, candidate), session=session, timeout=timeout,
                    allow_redirects=False)
        if not sec.ok:
            continue
        if sec.response.status_code == 200 and not baseline.matches(sec.response):
            result["security_txt"] = True
            break
    if not result["security_txt"]:
        result["issues"].append("No security.txt found (RFC 9116) — no documented security contact")

    return result
