"""Tests for the CVE scanner and its scoring (no real network calls)."""

import pytest

from scanners import cve
from scoring import engine
from tests.conftest import FakeResponse, install_http


def _patch_banner(monkeypatch, headers):
    """Mocks the site banner GET (which goes through the shared HTTP layer).

    NVD lookups stay on ``cve.requests.get`` and are patched separately.
    """
    install_http(monkeypatch, lambda method, url: FakeResponse(headers=headers))


@pytest.fixture(autouse=True)
def _clear_cache():
    cve._cache.clear()
    yield
    cve._cache.clear()


def test_parse_products_extracts_product_version_pairs():
    headers = {"Server": "Apache/2.4.49 (Ubuntu)", "X-Powered-By": "PHP/7.4.3"}
    products = cve.parse_products(headers)
    pairs = {(p["product"], p["version"]) for p in products}
    assert ("apache", "2.4.49") in pairs
    assert ("php", "7.4.3") in pairs


def test_parse_products_skips_versionless_banner():
    assert cve.parse_products({"Server": "cloudflare"}) == []


def test_parse_products_dedups():
    headers = {"Server": "nginx/1.18.0", "X-Generator": "nginx/1.18.0"}
    assert len(cve.parse_products(headers)) == 1


@pytest.mark.parametrize("score,sev", [
    (9.8, "critical"), (7.5, "high"), (5.0, "medium"), (2.1, "low"), (0.0, "info"),
])
def test_severity_from_cvss(score, sev):
    assert cve._severity_from_cvss(score) == sev


def test_cpe_match_string_known_product():
    assert cve.cpe_match_string("Apache", "2.4.49") == \
        "cpe:2.3:a:apache:http_server:2.4.49:*:*:*:*:*:*:*"
    assert cve.cpe_match_string("nginx", "1.18.0") == \
        "cpe:2.3:a:nginx:nginx:1.18.0:*:*:*:*:*:*:*"


def test_cpe_match_string_unknown_product_falls_back_to_none():
    assert cve.cpe_match_string("acme-frobnicator", "1.2.3") is None


def test_nvd_lookup_uses_cpe_for_known_product(monkeypatch):
    captured = {}

    class _Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"vulnerabilities": [
                {"cve": {"id": "CVE-2021-41773", "metrics": {}, "descriptions": []}}]}

    def fake_get(url, params=None, headers=None, timeout=None):
        captured.update(params or {})
        return _Resp()

    monkeypatch.setattr(cve.requests, "get", fake_get)
    vulns = cve.nvd_cve_lookup("apache", "2.4.49")
    assert "virtualMatchString" in captured and "keywordSearch" not in captured
    assert captured["virtualMatchString"] == "cpe:2.3:a:apache:http_server:2.4.49:*:*:*:*:*:*:*"
    assert vulns[0]["match"] == "cpe"


def test_nvd_lookup_falls_back_to_keyword(monkeypatch):
    captured = {}

    class _Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"vulnerabilities": []}

    def fake_get(url, params=None, headers=None, timeout=None):
        captured.update(params or {})
        return _Resp()

    monkeypatch.setattr(cve.requests, "get", fake_get)
    cve.nvd_cve_lookup("acme-frobnicator", "1.2.3")
    assert "keywordSearch" in captured and "virtualMatchString" not in captured


def test_score_cve_flags_keyword_match():
    result = {"vulnerabilities": {"acme 1.0": [
        {"id": "CVE-9999-0001", "cvss": 9.8, "severity": "critical",
         "description": "x", "match": "keyword"}]}, "error": None}
    findings = engine._score_cve(result)
    assert "keyword match" in findings[0]["message"]


def test_check_cve_uses_injected_searcher(monkeypatch):
    _patch_banner(monkeypatch, {"Server": "nginx/1.18.0"})

    calls = []

    def fake_searcher(product, version, timeout=10):
        calls.append((product, version))
        return [{"id": "CVE-2021-23017", "cvss": 9.8, "severity": "critical",
                 "description": "off-by-one"}]

    result = cve.check_cve("https://x.example", searcher=fake_searcher)
    assert result["error"] is None
    assert calls == [("nginx", "1.18.0")]
    assert "nginx 1.18.0" in result["vulnerabilities"]


def test_check_cve_caches_across_calls(monkeypatch):
    _patch_banner(monkeypatch, {"Server": "nginx/1.18.0"})
    calls = []

    def fake_searcher(product, version, timeout=10):
        calls.append((product, version))
        return []

    cve.check_cve("https://a.example", searcher=fake_searcher)
    cve.check_cve("https://b.example", searcher=fake_searcher)
    assert calls == [("nginx", "1.18.0")]  # second call served from cache


def test_check_cve_records_banner_error(monkeypatch):
    def boom(*a, **k):
        raise cve.RequestException("timeout")

    monkeypatch.setattr("requests.Session.request", boom)
    result = cve.check_cve("https://x.example", searcher=lambda *a, **k: [])
    assert result["error"] and "Banner request failed" in result["error"]


def test_score_cve_penalises_worst_severity():
    cve_result = {
        "vulnerabilities": {
            "apache 2.4.49": [
                {"id": "CVE-2021-41773", "cvss": 9.8, "severity": "critical",
                 "description": "path traversal"},
                {"id": "CVE-2021-42013", "cvss": 7.5, "severity": "high",
                 "description": "rce"},
            ]
        },
        "error": None,
    }
    findings = engine._score_cve(cve_result)
    assert len(findings) == 1
    f = findings[0]
    assert f["severity"] == "critical"
    assert f["penalty"] == engine.RUBRIC["cve"]["critical"]
    assert "CVE-2021-41773" in f["message"]


def test_score_cve_caps_total_penalty():
    vulns = [{"id": "CVE-0000-0001", "cvss": 9.9, "severity": "critical",
              "description": "x"}]
    cve_result = {"vulnerabilities": {f"p{i} 1.0": list(vulns) for i in range(5)},
                  "error": None}
    findings = engine._score_cve(cve_result)
    assert sum(f["penalty"] for f in findings) <= engine.RUBRIC["cve"]["cap"]


def test_score_cve_inconclusive_is_info_only():
    findings = engine._score_cve({"error": "CVE lookup failed: boom"})
    assert len(findings) == 1
    assert findings[0]["severity"] == "info"
    assert findings[0]["penalty"] == 0


# --- rate-limit backoff (S2) ------------------------------------------------

class _FakeHTTP:
    def __init__(self, status, payload=None, retry_after=None):
        self.status_code = status
        self._payload = payload if payload is not None else {"vulnerabilities": []}
        self.headers = {"Retry-After": retry_after} if retry_after is not None else {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise cve.RequestException(f"HTTP {self.status_code}")

    def json(self):
        return self._payload


def test_nvd_get_retries_then_succeeds(monkeypatch):
    responses = [_FakeHTTP(429, retry_after="0"), _FakeHTTP(403), _FakeHTTP(200)]
    idx = {"n": 0}

    def fake_get(*a, **k):
        r = responses[idx["n"]]
        idx["n"] += 1
        return r

    monkeypatch.setattr(cve.requests, "get", fake_get)
    slept = []
    payload = cve._nvd_get({}, {}, 10, sleep=slept.append)
    assert idx["n"] == 3
    assert payload == {"vulnerabilities": []}
    assert len(slept) == 2  # slept before each of the two retries


def test_nvd_get_raises_after_max_retries(monkeypatch):
    monkeypatch.setattr(cve.requests, "get", lambda *a, **k: _FakeHTTP(429))
    with pytest.raises(cve.RequestException):
        cve._nvd_get({}, {}, 10, sleep=lambda _s: None)


def test_retry_delay_honours_retry_after():
    resp = _FakeHTTP(429, retry_after="12")
    assert cve._retry_delay(resp, 0) == 12.0


# --- cache TTL + size bound (T2) --------------------------------------------

def test_cache_respects_ttl(monkeypatch):
    monkeypatch.setattr(cve, "CACHE_TTL_SECONDS", -1.0)  # expire immediately
    calls = []
    cve._cached_lookup("nginx", "1.18.0", lambda p, v, timeout=10: calls.append((p, v)) or [], 10)
    cve._cached_lookup("nginx", "1.18.0", lambda p, v, timeout=10: calls.append((p, v)) or [], 10)
    assert len(calls) == 2  # not served from cache because it expired


def test_cache_evicts_when_full(monkeypatch):
    monkeypatch.setattr(cve, "CACHE_MAX_ENTRIES", 2)
    searcher = lambda p, v, timeout=10: []  # noqa: E731
    cve._cached_lookup("a", "1.0", searcher, 10)
    cve._cached_lookup("b", "1.0", searcher, 10)
    cve._cached_lookup("c", "1.0", searcher, 10)
    assert len(cve._cache) <= 2


# --- confidence + suppression (T1) ------------------------------------------

def test_nvd_lookup_sets_confidence(monkeypatch):
    class _Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"vulnerabilities": [
                {"cve": {"id": "CVE-1", "metrics": {}, "descriptions": []}}]}

    monkeypatch.setattr(cve.requests, "get", lambda *a, **k: _Resp())
    assert cve.nvd_cve_lookup("apache", "2.4.49")[0]["confidence"] == "potential"
    assert cve.nvd_cve_lookup("acme-frobnicator", "1.2.3")[0]["confidence"] == "low"


def test_check_cve_suppresses_ids(monkeypatch):
    _patch_banner(monkeypatch, {"Server": "nginx/1.18.0"})

    def searcher(product, version, timeout=10):
        return [{"id": "CVE-2021-23017", "cvss": 9.8, "severity": "critical",
                 "description": "x", "match": "cpe", "confidence": "potential"}]

    result = cve.check_cve("https://x.example", searcher=searcher,
                           suppressed_cve_ids=["cve-2021-23017"])
    assert result["vulnerabilities"] == {}


def test_check_cve_backport_verifier_drops_false_positive(monkeypatch):
    _patch_banner(monkeypatch, {"Server": "nginx/1.18.0"})

    def searcher(product, version, timeout=10):
        return [
            {"id": "CVE-AAA", "cvss": 9.8, "severity": "critical",
             "match": "cpe", "confidence": "potential"},
            {"id": "CVE-BBB", "cvss": 7.5, "severity": "high",
             "match": "cpe", "confidence": "potential"},
        ]

    def fake_verifier(product, version, vulns, timeout=10):
        # Simulate OSV dropping CVE-AAA as not affecting this version.
        return [dict(v, osv="affected") for v in vulns if v["id"] != "CVE-AAA"]

    result = cve.check_cve("https://x.example", searcher=searcher,
                           verify_backports=True, verifier=fake_verifier)
    kept = result["vulnerabilities"]["nginx 1.18.0"]
    assert [v["id"] for v in kept] == ["CVE-BBB"]
    assert kept[0]["osv"] == "affected"


def test_check_cve_backport_disabled_keeps_all(monkeypatch):
    _patch_banner(monkeypatch, {"Server": "nginx/1.18.0"})
    called = []

    def searcher(product, version, timeout=10):
        return [{"id": "CVE-AAA", "cvss": 9.8, "severity": "critical",
                 "match": "cpe", "confidence": "potential"}]

    def verifier(*a, **k):
        called.append(True)
        return []

    result = cve.check_cve("https://x.example", searcher=searcher,
                           verify_backports=False, verifier=verifier)
    assert not called  # verifier not invoked when disabled
    assert "nginx 1.18.0" in result["vulnerabilities"]


def test_score_cve_low_confidence_gets_reduced_penalty():
    high = {"vulnerabilities": {"apache 2.4.49": [
        {"id": "CVE-1", "cvss": 9.8, "severity": "critical", "description": "x",
         "match": "cpe", "confidence": "potential"}]}, "error": None}
    low = {"vulnerabilities": {"acme 1.0": [
        {"id": "CVE-2", "cvss": 9.8, "severity": "critical", "description": "x",
         "match": "keyword", "confidence": "low"}]}, "error": None}
    p_full = engine._score_cve(high)[0]
    p_low = engine._score_cve(low)[0]
    assert p_low["penalty"] < p_full["penalty"]
    assert p_low["confidence"] == "low"
    assert p_full["confidence"] == "potential"
