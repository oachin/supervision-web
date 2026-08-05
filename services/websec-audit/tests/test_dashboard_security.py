"""Auth login gate + CSP/security-headers tests for the dashboard."""

import pytest
from starlette.testclient import TestClient

import dashboard.app as dashboard_app


@pytest.fixture
def client():
    return TestClient(dashboard_app.app)


@pytest.fixture
def auth_env(monkeypatch):
    monkeypatch.setenv("DASHBOARD_PASSWORD", "s3cret")
    monkeypatch.setenv("DASHBOARD_USERNAME", "admin")
    # Stable signing key so issued sessions validate within the test.
    monkeypatch.setattr(dashboard_app.auth, "_SECRET", "test-signing-key")


def test_csp_and_security_headers_present(client):
    r = client.get("/")
    assert r.status_code == 200
    csp = r.headers.get("Content-Security-Policy", "")
    assert "script-src 'self' 'nonce-" in csp
    assert "object-src 'none'" in csp
    assert r.headers.get("X-Content-Type-Options") == "nosniff"
    assert r.headers.get("X-Frame-Options") == "DENY"


def test_nonce_is_per_response(client):
    a = client.get("/").headers["Content-Security-Policy"]
    b = client.get("/").headers["Content-Security-Policy"]
    assert a != b  # nonce regenerated each request


def test_no_auth_when_password_unset(client, monkeypatch):
    monkeypatch.delenv("DASHBOARD_PASSWORD", raising=False)
    r = client.get("/", follow_redirects=False)
    assert r.status_code == 200  # open when no password configured


def test_protected_page_redirects_to_login(client, auth_env):
    r = client.get("/", follow_redirects=False)
    assert r.status_code == 303
    assert r.headers["location"] == "/login"


def test_post_without_session_is_401(client, auth_env):
    r = client.post("/scan", follow_redirects=False)
    assert r.status_code == 401


def test_static_assets_public_under_auth(client, auth_env):
    r = client.get("/static/js/app.js", follow_redirects=False)
    assert r.status_code == 200


def test_login_flow_grants_access(client, auth_env):
    bad = client.post("/login", data={"username": "admin", "password": "wrong"},
                      follow_redirects=False)
    assert bad.status_code == 303
    assert bad.headers["location"] == "/login?error=1"

    ok = client.post("/login", data={"username": "admin", "password": "s3cret"},
                     follow_redirects=False)
    assert ok.status_code == 303
    assert ok.headers["location"] == "/"
    assert dashboard_app.auth.SESSION_COOKIE in ok.cookies

    # The session cookie now unlocks the protected dashboard.
    client.cookies.set(dashboard_app.auth.SESSION_COOKIE,
                       ok.cookies[dashboard_app.auth.SESSION_COOKIE])
    page = client.get("/", follow_redirects=False)
    assert page.status_code == 200
    assert 'action="/logout"' in page.text  # logout control shown when authed


def test_session_token_validation(monkeypatch):
    from dashboard import auth
    monkeypatch.setattr(auth, "_SECRET", "k")
    token = auth.issue_session()
    assert auth.valid_session(token)
    assert not auth.valid_session(token + "x")     # tampered signature
    assert not auth.valid_session("garbage")
    assert not auth.valid_session(None)
    # Expired: issued longer ago than the session window.
    monkeypatch.setenv("DASHBOARD_SESSION_HOURS", "1")
    issued = str(int(__import__("time").time()) - 7200)
    stale = f"{issued}.{auth._sign(issued)}"
    assert not auth.valid_session(stale)


def test_logout_clears_session(client, auth_env):
    ok = client.post("/login", data={"username": "admin", "password": "s3cret"},
                     follow_redirects=False)
    token = ok.cookies[dashboard_app.auth.SESSION_COOKIE]
    client.cookies.set(dashboard_app.auth.SESSION_COOKIE, token)
    out = client.post("/logout", follow_redirects=False)
    assert out.status_code == 303
    assert out.headers["location"] == "/login"
