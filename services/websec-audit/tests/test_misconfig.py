"""Tests for the misconfiguration scanner, with HTTP fully mocked out."""

import scanners.misconfig as mc
from tests.conftest import FakeResponse, install_http


def _Resp(status_code=200, headers=None, text="", content=b"x"):
    return FakeResponse(status_code=status_code, headers=headers, text=text,
                        content=content)


def _install(monkeypatch, handler):
    """handler(method, url) -> _Resp, routed through the shared HTTP layer."""
    install_http(monkeypatch, handler)


def test_clean_site_has_no_issues_except_security_txt(monkeypatch):
    def handler(method, url):
        # Everything 404 except the root, no banner headers, has security.txt.
        if url.endswith("/.well-known/security.txt"):
            return _Resp(200)
        if url.rstrip("/") == "https://clean.example":
            return _Resp(200, headers={}, text="<html>ok</html>")
        return _Resp(404, content=b"")
    _install(monkeypatch, handler)
    res = mc.check_misconfig("https://clean.example")
    assert res["exposed_paths"] == []
    assert res["directory_listing"] is False
    assert res["security_txt"] is True
    assert res["error"] is None


def test_detects_tech_disclosure(monkeypatch):
    def handler(method, url):
        if "security.txt" in url:
            return _Resp(404, content=b"")
        return _Resp(200, headers={"Server": "Apache/2.4.1", "X-Powered-By": "PHP/7.2"},
                     text="hello")
    _install(monkeypatch, handler)
    res = mc.check_misconfig("https://x.example")
    assert any("Server" in d for d in res["tech_disclosure"])
    assert any("X-Powered-By" in d for d in res["tech_disclosure"])


def test_detects_exposed_git(monkeypatch):
    def handler(method, url):
        if url.endswith("/.git/HEAD"):
            return _Resp(200, content=b"ref: refs/heads/main")
        if "security.txt" in url:
            return _Resp(404, content=b"")
        return _Resp(404, content=b"")
    _install(monkeypatch, handler)
    res = mc.check_misconfig("https://x.example")
    paths = {p["path"] for p in res["exposed_paths"]}
    assert "/.git/HEAD" in paths
    assert any(p["severity"] == "high" for p in res["exposed_paths"])


def test_detects_directory_listing(monkeypatch):
    def handler(method, url):
        if "security.txt" in url:
            return _Resp(404, content=b"")
        if url.rstrip("/") == "https://x.example":
            return _Resp(200, text="<title>Index of /</title>")
        return _Resp(404, content=b"")
    _install(monkeypatch, handler)
    res = mc.check_misconfig("https://x.example")
    assert res["directory_listing"] is True


def test_detects_trace_method(monkeypatch):
    def handler(method, url):
        if method == "OPTIONS":
            return _Resp(200, headers={"Allow": "GET, POST, TRACE"})
        if "security.txt" in url:
            return _Resp(404, content=b"")
        return _Resp(200, text="ok")
    _install(monkeypatch, handler)
    res = mc.check_misconfig("https://x.example")
    assert "TRACE" in res["dangerous_methods"]
