"""Regression tests for anti-bot interstitial handling and soft-404 controls.

These cover the false-positive class that made a correctly-configured site
(gestdoc.site.je, behind InfinityFree's AES challenge) score 0/100 while Mozilla
Observatory graded it B/75: the scanners were reading the challenge page, which
carries none of the application's headers and answers 200 on every path.

The rule under test throughout: a scanner must never turn "I could not measure"
into "this is vulnerable".
"""

import hashlib

import pytest

from scanners import _http
from scanners.headers import check_headers
from scanners.misconfig import check_misconfig
from scoring.engine import score_site
from tests.conftest import FakeResponse, install_http

# The real interstitial served by gestdoc.site.je (842 bytes, verbatim shape).
# key/iv/ciphertext are the three AES-128 blocks the page decrypts in-browser.
CHALLENGE_BODY = (
    b'<html><body><script type="text/javascript" src="/aes.js" ></script><script>'
    b'function toNumbers(d){var e=[];d.replace(/(..)/g,function(d){'
    b'e.push(parseInt(d,16))});return e}function toHex(){return "x"}'
    b'var a=toNumbers("f655ba9d09a112d4968c63579db590b4"),'
    b'b=toNumbers("98344c2eee86c3994890592585b49f80"),'
    b'c=toNumbers("a5f853f431312fa12c995d472209506e");'
    b'document.cookie="__test="+toHex(slowAES.decrypt(c,2,a,b))+'
    b'"; max-age=21600; path=/";location.href="https://gestdoc.site.je/?i=1";'
    b'</script><noscript>This site requires Javascript to work, please enable '
    b'Javascript in your browser</noscript></body></html>'
)

# The real Laravel response behind the challenge: every security header set.
REAL_HEADERS = {
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Content-Security-Policy": "default-src 'self'; object-src 'none'",
    "X-Frame-Options": "SAMEORIGIN",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Server": "openresty",
}


def _challenge_response(url="https://gestdoc.site.je/"):
    return FakeResponse(status_code=200, headers={"Server": "openresty"},
                        content=CHALLENGE_BODY, url=url)


# --------------------------------------------------------------------------
# Detection
# --------------------------------------------------------------------------

def test_detects_infinityfree_aes_interstitial():
    assert _http.detect_challenge(_challenge_response()) == "infinityfree-aes"


@pytest.mark.parametrize("body,expected", [
    (b"<html><head><title>Just a moment...</title></head></html>", "cloudflare"),
    (b'<html><script>window._cf_chl_opt={};</script></html>', "cloudflare"),
    (b"<html>Sucuri WebSite Firewall - Access Denied</html>", "sucuri"),
    (b"<html>Incapsula incident ID: 1-2-3</html>", "imperva"),
])
def test_detects_other_mitigation_pages(body, expected):
    assert _http.detect_challenge(FakeResponse(content=body)) == expected


def test_detects_challenge_from_response_header():
    response = FakeResponse(headers={"cf-mitigated": "challenge"}, content=b"")
    assert _http.detect_challenge(response) == "cloudflare"


def test_real_page_is_not_mistaken_for_a_challenge():
    """A false 'blocked' hides real findings, so detection must not overreach."""
    body = b"<html><body>" + b"<p>Welcome to our site.</p>" * 200 + b"</body></html>"
    assert _http.detect_challenge(FakeResponse(content=body)) is None


def test_page_merely_mentioning_cloudflare_is_not_a_challenge():
    body = (b"<html><body><h1>Blog</h1>" +
            b"<p>How we moved to Cloudflare, just a moment of history.</p>" * 100 +
            b"</body></html>")
    assert _http.detect_challenge(FakeResponse(content=body)) is None


# --------------------------------------------------------------------------
# Solving: the challenge is pure AES-128-CBC, so no browser is needed
# --------------------------------------------------------------------------

def test_solves_challenge_and_reads_the_real_headers(monkeypatch):
    """After the __test cookie is set, the audit must see the real application."""
    calls = []

    def handler(method, url):
        calls.append(url)
        if len(calls) == 1:
            return _challenge_response(url)
        return FakeResponse(headers=REAL_HEADERS, content=b"<html>Laravel</html>", url=url)

    install_http(monkeypatch, handler)
    result = check_headers("https://gestdoc.site.je")

    assert result["blocked_by_challenge"] is False
    assert result["missing"] == []
    assert len(result["present"]) == 6
    assert len(calls) == 2  # challenge, then the replayed request


def test_solve_sets_the_expected_test_cookie():
    import requests

    session = requests.Session()
    assert _http.solve_challenge(session, _challenge_response(), "infinityfree-aes")
    # AES-128-CBC(key=a, iv=b) over ciphertext c, exactly as slowAES.decrypt(c,2,a,b)
    # does in the page. Replaying this cookie against the live host returns the
    # real application instead of the interstitial.
    assert session.cookies.get("__test") == "27d43460d98c2a20a3a946859eeb3383"


CLOUDFLARE_BODY = b"<html><head><title>Just a moment...</title></head></html>"


def test_unsolvable_challenge_is_reported_not_guessed(monkeypatch):
    install_http(monkeypatch, lambda method, url: FakeResponse(
        content=CLOUDFLARE_BODY, url=url))
    result = check_headers("https://cf.example")

    assert result["blocked_by_challenge"] is True
    assert result["challenge_kind"] == "cloudflare"
    # The crucial part: nothing is asserted about the site's headers.
    assert result["missing"] == []
    assert result["present"] == {}


# --------------------------------------------------------------------------
# The original bug, end to end
# --------------------------------------------------------------------------

def test_site_behind_unsolvable_challenge_is_inconclusive_not_zero(monkeypatch):
    """The regression: 11 invented findings and a 0/100 on a healthy site."""
    install_http(monkeypatch, lambda method, url: FakeResponse(
        content=CLOUDFLARE_BODY, url=url))

    site = {
        "name": "blocked", "url": "https://cf.example", "domain": "cf.example",
        "headers": check_headers("https://cf.example"),
        "misconfig": check_misconfig("https://cf.example"),
    }
    scored = score_site(site)

    assert scored["score"] == 100
    assert scored["grade"] == "A"
    assert all(f["penalty"] == 0 for f in scored["findings"])
    assert scored["coverage"]["headers"] == "inconclusive"
    assert scored["coverage"]["misconfig"] == "inconclusive"
    # The operator must be told why, not shown a silently clean report.
    assert any("blocked_by_challenge" in (f.get("code") or "")
               for f in scored["findings"])


def test_challenge_page_does_not_expose_every_sensitive_path(monkeypatch):
    """The interstitial answers 200 everywhere; that is not an exposure."""
    install_http(monkeypatch, lambda method, url: _challenge_response(url))
    result = check_misconfig("https://gestdoc.site.je")

    assert result["blocked_by_challenge"] is True
    assert result["exposed_paths"] == []
    assert result["tech_disclosure"] == []


# --------------------------------------------------------------------------
# Soft-404 negative control (independent of any anti-bot layer)
# --------------------------------------------------------------------------

def test_soft_404_server_exposes_nothing(monkeypatch):
    """A catch-all 200 must not turn the whole path list into 'high' findings."""
    page = b"<html><body>Page not found, try our search.</body></html>"
    install_http(monkeypatch, lambda method, url: FakeResponse(content=page, url=url))

    result = check_misconfig("https://spa.example")

    assert result["soft_404"] is True
    assert result["exposed_paths"] == []
    assert result["security_txt"] is False


def test_soft_404_is_surfaced_as_inconclusive_not_clean(monkeypatch):
    page = b"<html><body>Page not found, try our search.</body></html>"
    install_http(monkeypatch, lambda method, url: FakeResponse(content=page, url=url))

    scored = score_site({"name": "spa", "url": "https://spa.example",
                         "misconfig": check_misconfig("https://spa.example")})
    assert any(f.get("code") == "misconfig.soft_404" for f in scored["findings"])


def test_genuinely_exposed_git_is_still_detected(monkeypatch):
    """Guard against over-correcting: real positives must survive."""
    def handler(method, url):
        if url.endswith("/.git/HEAD"):
            return FakeResponse(content=b"ref: refs/heads/main\n", url=url)
        return FakeResponse(status_code=404, content=b"not found", url=url)

    install_http(monkeypatch, handler)
    result = check_misconfig("https://leaky.example")

    assert [p["path"] for p in result["exposed_paths"]] == ["/.git/HEAD"]
    assert result["soft_404"] is False


def test_200_that_is_not_the_file_is_rejected(monkeypatch):
    """A login page served at /.env is not an exposed .env."""
    login = b"<html><body><form>Please sign in</form></body></html>"

    def handler(method, url):
        if url.endswith("/.env"):
            return FakeResponse(content=login, url=url)
        return FakeResponse(status_code=404, content=b"nope", url=url)

    install_http(monkeypatch, handler)
    assert check_misconfig("https://app.example")["exposed_paths"] == []


def test_baseline_matches_identical_body():
    baseline = _http.Baseline(status=200, length=10,
                              fingerprints={hashlib.sha256(b"same body!").hexdigest()})
    assert baseline.matches(FakeResponse(content=b"same body!"))
    assert not baseline.matches(FakeResponse(content=b"a" * 4096))
