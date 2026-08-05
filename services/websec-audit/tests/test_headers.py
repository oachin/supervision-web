"""Tests for the HTTP security-header scanner, with requests mocked out."""

import scanners.headers as headers_mod
from tests.conftest import FakeResponse, install_http


def _patch_get(monkeypatch, response):
    install_http(monkeypatch, lambda method, url: response)


def _response(headers, cookies=None):
    return FakeResponse(headers=headers, set_cookie=cookies or [])


def test_all_headers_present(monkeypatch):
    present = {h: "x" for h in headers_mod.SECURITY_HEADERS}
    _patch_get(monkeypatch, _response(present))
    res = headers_mod.check_headers("https://example.com")
    assert res["missing"] == []
    assert len(res["present"]) == len(headers_mod.SECURITY_HEADERS)


def test_missing_headers_reported_with_severity(monkeypatch):
    _patch_get(monkeypatch, _response({}))
    res = headers_mod.check_headers("https://example.com")
    missing_names = {m["header"] for m in res["missing"]}
    assert "Content-Security-Policy" in missing_names
    assert any(m["severity"] == "high" for m in res["missing"])


def test_insecure_cookie_flags_detected(monkeypatch):
    _patch_get(monkeypatch, _response({}, cookies=["session=abc; Path=/"]))
    res = headers_mod.check_headers("https://example.com")
    joined = " ".join(res["cookie_issues"])
    assert "Secure" in joined and "HttpOnly" in joined and "SameSite" in joined
