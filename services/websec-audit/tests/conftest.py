"""Pytest configuration: make the project root importable when running `pytest`."""

import os
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Point the default DB at a throwaway file so tests never touch the real audit.db.
# Must be set before db.models is first imported (conftest loads before tests).
os.environ.setdefault(
    "AUDIT_DB_URL",
    f"sqlite:///{Path(tempfile.mkdtemp(prefix='audit_test_')) / 'test_default.db'}",
)

# Threat-intel (KEV/EPSS) enrichment hits live public feeds; keep it off by
# default in the test suite so unit tests never make network calls. The
# dedicated enrichment tests opt in explicitly with injected fakes.
os.environ.setdefault("CVE_ENRICH", "false")


class FakeResponse:
    """Minimal stand-in for a ``requests.Response`` as the scanners use it."""

    def __init__(self, status_code=200, headers=None, text=None, content=b"x",
                 url="https://example.test/", set_cookie=()):
        self.status_code = status_code
        self.headers = headers or {}
        self.content = content
        self.text = text if text is not None else _decode(content)
        self.url = url
        self.encoding = "utf-8"
        self.raw = _FakeRaw(set_cookie)


def _decode(content):
    return content.decode("utf-8", errors="replace") if isinstance(content, bytes) else str(content)


class _FakeRaw:
    def __init__(self, set_cookie):
        self.headers = _FakeRawHeaders(list(set_cookie))


class _FakeRawHeaders:
    def __init__(self, cookies):
        self._cookies = cookies

    def get_all(self, name):
        return self._cookies if name.lower() == "set-cookie" else None


def install_http(monkeypatch, handler):
    """Routes every scanner HTTP call to ``handler(method, url) -> FakeResponse``.

    The scanners all go through ``scanners._http``, which issues requests on a
    ``requests.Session``. Patching ``Session.request`` is therefore the single
    choke point that mocks the whole HTTP layer, challenge handling included.
    """
    import requests

    def fake_request(self, method, url, **kwargs):
        return handler(method, url)

    monkeypatch.setattr(requests.Session, "request", fake_request)


@pytest.fixture
def http(monkeypatch):
    """Fixture form of :func:`install_http`."""
    def _install(handler):
        install_http(monkeypatch, handler)
    return _install
