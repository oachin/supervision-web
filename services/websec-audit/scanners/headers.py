"""
headers.py
Checks presence and basic configuration of key HTTP security headers,
based on the OWASP Secure Headers Project baseline.

Design notes:
    All requests go through scanners/_http.py, which owns certificate-failure
    retries and anti-bot interstitial handling.

    A certificate-verification failure does NOT mean the site has no headers to
    inspect — the server still responds — so headers are still read over the
    unverified connection (flagged via `tls_verify_failed`).

    An unsolved anti-bot interstitial is different in kind: its headers are the
    mitigation layer's, not the application's, so reporting them would declare
    every security header "missing" on a site that actually sets them all. In
    that case nothing is asserted: `blocked_by_challenge` is set and `missing`
    stays empty so the result is scored as inconclusive.
"""

from scanners._http import challenge_error, fetch

# Each entry: header name -> (severity if missing, short description)
SECURITY_HEADERS = {
    "Strict-Transport-Security": ("high", "Enforces HTTPS, prevents downgrade/MITM attacks"),
    "Content-Security-Policy": ("high", "Mitigates XSS and data injection attacks"),
    "X-Frame-Options": ("medium", "Prevents clickjacking via iframes"),
    "X-Content-Type-Options": ("medium", "Prevents MIME-sniffing attacks"),
    "Referrer-Policy": ("low", "Controls how much referrer info is leaked"),
    "Permissions-Policy": ("low", "Restricts access to browser features/APIs"),
}


def check_headers(url: str, timeout: int = 8, session=None) -> dict:
    """
    Fetches a URL and inspects its response headers.

    Returns a dict with:
        - present: dict of headers that were found (name -> value)
        - missing: list of {header, severity, description} for missing ones
        - cookie_issues: list of strings describing cookie flag problems
        - issues: list of human-readable findings (for scoring/report use)
        - tls_verify_failed: bool  (headers were read over an unverified TLS connection)
        - blocked_by_challenge: bool  (an anti-bot page answered, not the app)
        - challenge_kind: str | None
        - error: str | None
    """
    result = {
        "url": url,
        "present": {},
        "missing": [],
        "cookie_issues": [],
        "issues": [],
        "tls_verify_failed": False,
        "blocked_by_challenge": False,
        "challenge_kind": None,
        "error": None,
    }

    fetched = fetch(url, session=session, timeout=timeout)
    result["tls_verify_failed"] = fetched.tls_verify_failed

    if fetched.error:
        result["error"] = fetched.error
        return result

    if fetched.blocked_by_challenge:
        # We never saw the application. Asserting anything about its headers
        # here is how a correctly-configured site scores 0/100.
        result["blocked_by_challenge"] = True
        result["challenge_kind"] = fetched.challenge_kind
        result["error"] = challenge_error(fetched.challenge_kind)
        return result

    response = fetched.response
    headers = response.headers

    for header_name, (severity, description) in SECURITY_HEADERS.items():
        if header_name in headers:
            result["present"][header_name] = headers[header_name]
        else:
            result["missing"].append(
                {"header": header_name, "severity": severity, "description": description}
            )
            result["issues"].append(f"Missing header: {header_name} ({severity})")

    # --- Cookie flag checks ---
    set_cookie_headers = response.raw.headers.get_all("Set-Cookie") if response.raw else None
    if set_cookie_headers:
        for cookie in set_cookie_headers:
            cookie_lower = cookie.lower()
            cookie_name = cookie.split("=", 1)[0]
            if "secure" not in cookie_lower:
                result["cookie_issues"].append(f"Cookie missing Secure flag: {cookie_name}")
            if "httponly" not in cookie_lower:
                result["cookie_issues"].append(f"Cookie missing HttpOnly flag: {cookie_name}")
            if "samesite" not in cookie_lower:
                result["cookie_issues"].append(f"Cookie missing SameSite attribute: {cookie_name}")

    result["issues"].extend(result["cookie_issues"])

    return result
