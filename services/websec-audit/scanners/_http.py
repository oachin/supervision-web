"""
_http.py
Shared HTTP layer for the core scanners, with anti-bot interstitial handling.

Why this exists
---------------
Every core scanner used to call ``requests`` directly and treat *any* 200 as
"this is the application". That is wrong in front of a bot-mitigation layer.
Many hosts (InfinityFree/openresty, Cloudflare, Sucuri, Imperva, …) answer the
first request with a tiny **interstitial**: a JavaScript challenge page that
carries none of the application's headers and is served for *every* path,
including paths that do not exist.

Scanning that page produces a report that is entirely false:

* all security headers look "missing" (they belong to the real app behind it),
* every probed sensitive path looks "exposed" (the interstitial answers 200),
* the score collapses to 0/100 for a site that is in fact correctly configured.

So this module gives the scanners three things:

1. :func:`detect_challenge` — recognise an interstitial instead of trusting it.
2. :func:`solve_challenge` — get *past* it when the challenge is computable, so
   the audit measures the real application.
3. ``FetchResult.blocked_by_challenge`` — when it cannot be solved, say so, so
   callers report *inconclusive* rather than inventing vulnerabilities.

The guiding rule, and the reason this module is the only entry point for
scanner HTTP: **never turn "I could not measure" into "this is vulnerable".**

Solving the challenge
---------------------
The InfinityFree/openresty interstitial is a self-contained AES-128-CBC
computation: the page ships key, IV and ciphertext as hex, decrypts them in the
browser, and stores the result in a ``__test`` cookie. That is reproducible in
Python, so no headless browser is needed — we decrypt, set the cookie on the
session and replay the request. Every later request on the same session carries
the cookie, so one solve unblocks the whole site scan.

Challenges that genuinely require a JS engine (Cloudflare's) are *detected* but
not solved; they are reported as blocking so the result is marked inconclusive.

Certificate failures
--------------------
A certificate that fails verification does not mean the server is silent, and
those are exactly the sites an audit cares about. As before, an ``SSLError``
triggers one retry with ``verify=False``, flagged via
``FetchResult.tls_verify_failed``. That retry logic lived in four scanners; it
now lives here once.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from urllib.parse import urlparse

import requests
import urllib3
from requests.exceptions import SSLError

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

USER_AGENT = "SecurityAuditTool/1.0"
DEFAULT_TIMEOUT = 8

# An interstitial is by nature a tiny stub page. Requiring a small body keeps
# the signatures below from ever matching a real application page that merely
# mentions one of these strings (a blog post about Cloudflare, say).
_MAX_INTERSTITIAL_BYTES = 8192

# Ordered signatures: (kind, predicate over the lowercased body, header check).
# `kind` is reported to the operator so the report says *why* it was blocked.
_CHALLENGE_SIGNATURES: list[tuple[str, tuple[str, ...]]] = [
    # InfinityFree / openresty: AES-in-JS, sets a __test cookie then reloads.
    ("infinityfree-aes", ("slowaes.decrypt", "__test=")),
    ("infinityfree-aes", ("aes.js", "tonumbers(")),
    # Cloudflare "Just a moment..." / managed challenge. Matched on the page
    # title, not the bare phrase: an article that merely mentions Cloudflare or
    # says "just a moment" must not be mistaken for a challenge.
    ("cloudflare", ("cf_chl_opt",)),
    ("cloudflare", ("<title>just a moment",)),
    ("cloudflare", ("checking your browser before accessing",)),
    # Sucuri WAF block page.
    ("sucuri", ("sucuri website firewall",)),
    # Imperva / Incapsula.
    ("imperva", ("_incapsula_resource",)),
    ("imperva", ("incapsula incident id",)),
    # DDoS-Guard.
    ("ddos-guard", ("ddos-guard.net",)),
    # Generic JS gate: no-JS notice plus a scripted redirect, nothing else.
    ("js-interstitial", ("this site requires javascript", "location.href")),
]

# Headers that identify a mitigation layer even when the body is opaque.
_CHALLENGE_HEADERS = {
    "cf-mitigated": "cloudflare",
    "x-sucuri-block": "sucuri",
    "x-iinfo": "imperva",
}


def detect_challenge(response: requests.Response) -> str | None:
    """Returns the kind of anti-bot interstitial served, or ``None``.

    Deliberately conservative: a false "blocked" hides real findings, so a page
    only counts as an interstitial when it is both small and carries an
    unambiguous mitigation signature.
    """
    for header, kind in _CHALLENGE_HEADERS.items():
        if header in response.headers:
            return kind

    body = response.content or b""
    if len(body) > _MAX_INTERSTITIAL_BYTES:
        return None

    try:
        text = body.decode(response.encoding or "utf-8", errors="replace").lower()
    except (LookupError, UnicodeDecodeError):
        return None

    for kind, markers in _CHALLENGE_SIGNATURES:
        if all(marker in text for marker in markers):
            return kind
    return None


# The three hex blobs the InfinityFree interstitial passes to slowAES.decrypt:
# key, IV and ciphertext, each an AES-128 block (32 hex chars).
_AES_CHALLENGE_RE = re.compile(
    r'toNumbers\("([0-9a-fA-F]{32})"\)\s*,\s*'
    r'\w+\s*=\s*toNumbers\("([0-9a-fA-F]{32})"\)\s*,\s*'
    r'\w+\s*=\s*toNumbers\("([0-9a-fA-F]{32})"\)'
)


def _aes_cbc_decrypt(key: bytes, iv: bytes, ciphertext: bytes) -> bytes:
    # `cryptography` ships with sslyze, so this needs no extra dependency.
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

    decryptor = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
    return decryptor.update(ciphertext) + decryptor.finalize()


def solve_challenge(session: requests.Session, response: requests.Response,
                    kind: str) -> bool:
    """Computes the challenge answer and stores it on ``session``.

    Returns ``True`` when the session should now be able to reach the real
    application (the caller replays the request). Returns ``False`` for
    challenges that cannot be solved without a JavaScript engine.
    """
    if kind != "infinityfree-aes":
        return False

    match = _AES_CHALLENGE_RE.search(response.text or "")
    if not match:
        return False

    try:
        key, iv, ciphertext = (bytes.fromhex(group) for group in match.groups())
        token = _aes_cbc_decrypt(key, iv, ciphertext).hex()
    except Exception:
        return False

    host = urlparse(response.url).hostname
    if not host:
        return False
    session.cookies.set("__test", token, domain=host, path="/")
    return True


@dataclass
class FetchResult:
    """Outcome of one scanner request.

    ``blocked_by_challenge`` is the important field: it means the bytes in
    ``response`` are a mitigation page, not the target application, so nothing
    about the site's security posture may be inferred from them.
    """

    response: requests.Response | None = None
    tls_verify_failed: bool = False
    tls_error: str | None = None
    blocked_by_challenge: bool = False
    challenge_kind: str | None = None
    error: str | None = None

    @property
    def ok(self) -> bool:
        """True when we hold a response that really is the target application."""
        return self.response is not None and not self.blocked_by_challenge


def audit_session() -> requests.Session:
    """A session for scanning one site.

    Share it across the scanners for that site: a challenge solved by the first
    check leaves its cookie here, so the rest of the audit sees the real
    application instead of solving the challenge over and over.
    """
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    return session


def fetch(url: str, session: requests.Session | None = None, method: str = "GET",
          timeout: int = DEFAULT_TIMEOUT, allow_redirects: bool = True,
          solve: bool = True, **kwargs) -> FetchResult:
    """Requests ``url``, transparently getting past a solvable interstitial.

    Raises nothing: transport failures are returned in ``FetchResult.error`` so
    a single dead path can never abort an audit.
    """
    owned = session is None
    session = session or audit_session()
    result = FetchResult()

    def _request(verify: bool) -> requests.Response:
        return session.request(method, url, timeout=timeout,
                               allow_redirects=allow_redirects, verify=verify,
                               **kwargs)

    try:
        try:
            response = _request(verify=True)
        except SSLError as ssl_err:
            # Server is up, the certificate just does not validate — keep going
            # so bad-certificate sites are still audited.
            result.tls_verify_failed = True
            result.tls_error = str(ssl_err)
            response = _request(verify=False)
    except requests.RequestException as e:
        result.error = str(e)
        if owned:
            session.close()
        return result

    kind = detect_challenge(response)
    if kind and solve and solve_challenge(session, response, kind):
        try:
            response = _request(verify=not result.tls_verify_failed)
        except requests.RequestException as e:
            result.error = str(e)
            if owned:
                session.close()
            return result
        kind = detect_challenge(response)

    result.response = response
    if kind:
        result.blocked_by_challenge = True
        result.challenge_kind = kind

    if owned:
        # The response is fully consumed by now; closing frees the connection.
        session.close()
    return result


CHALLENGE_NOTE = (
    "the target is behind an anti-bot/WAF interstitial that could not be "
    "solved, so the application itself was never reached"
)


def challenge_error(kind: str | None) -> str:
    """Human-readable explanation for an unsolved challenge, for reports."""
    return f"Blocked by anti-bot challenge ({kind or 'unknown'}) — {CHALLENGE_NOTE}"


@dataclass
class Baseline:
    """Reference response for a URL that cannot exist on the target.

    Content discovery is meaningless without it: a server that answers 200 to
    everything (interstitial, soft-404, SPA catch-all) otherwise "exposes"
    every path you ask about.
    """

    status: int | None = None
    body_hash: str | None = None
    length: int = 0
    always_200: bool = False
    fingerprints: set[str] = field(default_factory=set)

    def matches(self, response: requests.Response) -> bool:
        """Whether ``response`` is indistinguishable from the not-found control."""
        import hashlib

        if self.status is None:
            return False
        digest = hashlib.sha256(response.content or b"").hexdigest()
        if digest in self.fingerprints:
            return True
        if response.status_code != self.status:
            return False
        # Same status and near-identical size: a template with the path echoed
        # into it differs by a few bytes, so allow a small tolerance.
        return abs(len(response.content or b"") - self.length) <= 64
