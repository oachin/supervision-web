"""
availability.py
Checks whether a site is up, how fast it responds, and whether it
correctly redirects HTTP -> HTTPS.

Design notes:
    A site with an expired / self-signed / mismatched certificate is NOT
    "down" — the server is answering, it just fails TLS verification.
    Reporting it as unreachable would be wrong (and dangerous in an audit,
    because those are exactly the sites you care about most). So on a
    certificate-verification error the request is retried without verification
    (see scanners/_http.py) and the site is marked reachable but with
    `tls_verify_failed = True`.

    A site behind an anti-bot interstitial is also up — availability is the one
    check an unsolved challenge does not invalidate, since something did answer.
    It is still recorded (`blocked_by_challenge`) because it runs first and
    warms the shared session: solving the challenge here means every later
    scanner sees the real application.
"""

import time

from scanners._http import fetch


def check_availability(url: str, timeout: int = 8, session=None) -> dict:
    """
    Checks a single site's availability.

    Returns a dict with:
        - reachable: bool
        - status_code: int | None
        - response_time_ms: float | None
        - final_url: str | None (after redirects)
        - forces_https: bool
        - tls_verify_failed: bool  (True = up, but certificate could not be verified)
        - tls_error: str | None    (the certificate error, if any)
        - blocked_by_challenge: bool  (an anti-bot page answered, not the app)
        - challenge_kind: str | None
        - error: str | None        (only set when the site is genuinely unreachable)
    """
    result = {
        "url": url,
        "reachable": False,
        "status_code": None,
        "response_time_ms": None,
        "final_url": None,
        "forces_https": False,
        "tls_verify_failed": False,
        "tls_error": None,
        "blocked_by_challenge": False,
        "challenge_kind": None,
        "error": None,
    }

    start = time.perf_counter()
    fetched = fetch(url, session=session, timeout=timeout)
    elapsed_ms = (time.perf_counter() - start) * 1000

    result["tls_verify_failed"] = fetched.tls_verify_failed
    result["tls_error"] = fetched.tls_error

    if fetched.error:
        # Genuinely unreachable: DNS failure, connection refused, timeout, etc.
        result["error"] = fetched.error
        return result

    response = fetched.response
    result["reachable"] = True
    result["status_code"] = response.status_code
    result["response_time_ms"] = round(elapsed_ms, 2)
    result["final_url"] = response.url
    result["blocked_by_challenge"] = fetched.blocked_by_challenge
    result["challenge_kind"] = fetched.challenge_kind

    # forces_https: an http:// request that ends up on https://,
    # or a request that was https from the start.
    if url.startswith("http://") and response.url.startswith("https://"):
        result["forces_https"] = True
    elif url.startswith("https://"):
        result["forces_https"] = True

    return result
