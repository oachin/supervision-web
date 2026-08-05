"""Tests for the free EASM feature set (no real network):
KEV/EPSS threat-intel enrichment, new-asset surface-change alerting, cloud
bucket enumeration, DNS brute-force and ASN/IP-range expansion."""

import requests

import alerts.mailer as mailer
import scanners.discovery as discovery
import scanners.threat_intel as ti
from scanners.cve import check_cve
from scoring.engine import _score_cve
from tests.conftest import FakeResponse, install_http


class _FakeResp:
    def __init__(self, payload=None, status=200, text=""):
        self._payload = payload
        self.status_code = status
        self.text = text

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}")

    def json(self):
        return self._payload


class _FakeSession:
    """Routes .get(url, ...) to a caller-provided handler."""

    def __init__(self, handler):
        self._handler = handler

    def get(self, url, **kwargs):
        return self._handler(url, kwargs)


# --- KEV / EPSS enrichment -------------------------------------------------

def test_fetch_kev_set_parses_and_uppercases():
    ti.clear_cache()
    payload = {"vulnerabilities": [{"cveID": "CVE-2021-44228"},
                                   {"cveID": "cve-2014-0160"}]}
    session = _FakeSession(lambda url, kw: _FakeResp(payload))
    kev = ti.fetch_kev_set(session=session)
    assert kev == {"CVE-2021-44228", "CVE-2014-0160"}


def test_fetch_kev_set_failsafe_on_error():
    ti.clear_cache()
    session = _FakeSession(lambda url, kw: _FakeResp(status=503))
    assert ti.fetch_kev_set(session=session) == set()


def test_fetch_epss_scores_batches_and_parses():
    ti.clear_cache()
    payload = {"data": [{"cve": "CVE-2021-44228", "epss": "0.97"},
                        {"cve": "CVE-2000-0001", "epss": "0.01"}]}
    session = _FakeSession(lambda url, kw: _FakeResp(payload))
    scores = ti.fetch_epss_scores(["CVE-2021-44228", "CVE-2000-0001"], session=session)
    assert scores["CVE-2021-44228"] == 0.97
    assert scores["CVE-2000-0001"] == 0.01


def test_enrich_vulns_tags_and_reorders():
    ti.clear_cache()

    def handler(url, kw):
        if "known_exploited" in url:
            return _FakeResp({"vulnerabilities": [{"cveID": "CVE-2021-44228"}]})
        return _FakeResp({"data": [{"cve": "CVE-2021-44228", "epss": "0.97"},
                                   {"cve": "CVE-2010-0001", "epss": "0.10"}]})

    session = _FakeSession(handler)
    vulns = {"apache 2.4.49": [
        {"id": "CVE-2010-0001", "cvss": 9.8, "severity": "critical"},
        {"id": "CVE-2021-44228", "cvss": 7.5, "severity": "high"},
    ]}
    ti.enrich_vulns(vulns, session=session)
    first = vulns["apache 2.4.49"][0]
    # KEV (actively exploited) should be re-ordered to the front despite lower CVSS.
    assert first["id"] == "CVE-2021-44228"
    assert first["kev"] is True
    assert first["epss"] == 0.97


def test_check_cve_enrich_disabled_leaves_vulns_untagged(monkeypatch):
    # The site banner GET goes through the shared HTTP layer (scanners/_http.py).
    install_http(monkeypatch,
                 lambda method, url: FakeResponse(headers={"Server": "Apache/2.4.49"}))

    def searcher(product, version, timeout=10):
        return [{"id": "CVE-2021-44228", "cvss": 7.5, "severity": "high"}]

    # enrich=False must skip enrichment entirely (no KEV/EPSS lookup, no tags).
    result = check_cve("https://x.example", searcher=searcher, enrich=False)
    v = result["vulnerabilities"]["apache 2.4.49"][0]
    assert "kev" not in v and "epss" not in v


# --- scoring: KEV escalation ----------------------------------------------

def test_score_cve_kev_escalates_to_critical():
    cve = {"url": "https://x", "error": None, "vulnerabilities": {
        "nginx 1.0.0": [{"id": "CVE-2021-44228", "cvss": 5.0, "severity": "medium",
                         "kev": True, "epss": 0.9}],
    }}
    findings = _score_cve(cve)
    assert len(findings) == 1
    f = findings[0]
    assert f["severity"] == "critical"
    assert f["kev"] is True
    assert "[KEV: actively exploited]" in f["message"]
    assert "EPSS" in f["message"]


def test_score_cve_without_intel_unchanged():
    cve = {"url": "https://x", "error": None, "vulnerabilities": {
        "nginx 1.0.0": [{"id": "CVE-1", "cvss": 5.0, "severity": "medium"}],
    }}
    f = _score_cve(cve)[0]
    assert f["severity"] == "medium"
    assert "KEV" not in f["message"]
    assert "kev" not in f


# --- new-asset surface-change alerting ------------------------------------

def test_surface_change_alert_triggers_on_added():
    out = mailer.send_surface_change_alert(["new.example.com"], [], dry_run=True)
    assert out["triggered"] is True
    assert "new.example.com" in out["body"]


def test_surface_change_alert_silent_without_added():
    out = mailer.send_surface_change_alert([], ["gone.example.com"], dry_run=True)
    assert out["triggered"] is False


# --- cloud bucket enumeration ---------------------------------------------

def test_bucket_candidates_derives_names():
    names = discovery.bucket_candidates(["example.com"])
    assert "example" in names
    assert "example-assets" in names
    assert "example-com" in names
    assert all(3 <= len(n) <= 63 for n in names)


def test_check_bucket_classifies_exposure():
    def handler(url, kw):
        if "s3.amazonaws.com" in url:
            return _FakeResp(status=200)      # public
        if "storage.googleapis.com" in url:
            return _FakeResp(status=403)      # private
        return _FakeResp(status=404)          # azure: absent

    session = _FakeSession(handler)
    out = discovery.check_bucket("acme-assets", session=session)
    by_provider = {b["provider"]: b["exposure"] for b in out}
    assert by_provider["s3"] == "public"
    assert by_provider["gcs"] == "private"
    assert "azure" not in by_provider


def test_discover_buckets_public_first():
    def handler(url, kw):
        # Only the exact name "example" is public on S3; everything else absent.
        if "example.s3.amazonaws.com" in url:
            return _FakeResp(status=200)
        return _FakeResp(status=404)

    session = _FakeSession(handler)
    found = discovery.discover_buckets(["example.com"], session=session)
    assert found
    assert found[0]["exposure"] == "public"
    assert found[0]["name"] == "example"


# --- DNS brute-force -------------------------------------------------------

def test_bruteforce_keeps_only_resolving(monkeypatch):
    live = {"www.example.com", "api.example.com"}
    monkeypatch.setattr(discovery, "resolves", lambda h: h in live)
    out = discovery.discover_subdomains_bruteforce("example.com",
                                                   wordlist=["www", "api", "nope"])
    assert out == ["api.example.com", "www.example.com"]


def test_discover_subdomains_merges_bruteforce(monkeypatch):
    # Disable the network CT/passive sources; only brute-force runs.
    monkeypatch.setattr(discovery, "_SUBDOMAIN_SOURCES", ())
    monkeypatch.setattr(discovery, "resolves", lambda h: h == "vpn.example.com")
    out = discovery.discover_subdomains("example.com", bruteforce=True)
    assert "vpn.example.com" in out   # "vpn" is in COMMON_SUBDOMAINS
    assert "example.com" in out       # apex always included


# --- ASN / IP-range expansion ---------------------------------------------

def test_asn_prefixes_parses(monkeypatch):
    payload = {"data": {"ipv4_prefixes": [{"prefix": "203.0.113.0/24"}],
                        "ipv6_prefixes": [{"prefix": "2001:db8::/32"}]}}
    session = _FakeSession(lambda url, kw: _FakeResp(payload))
    out = discovery.asn_prefixes("AS64500", session=session)
    assert out == ["2001:db8::/32", "203.0.113.0/24"]


def test_asn_prefixes_rejects_non_numeric():
    assert discovery.asn_prefixes("not-an-asn") == []


def test_reverse_sweep_prefix_bounds_and_scopes(monkeypatch):
    def fake_ptr(ip):
        return "host.example.com" if ip == "203.0.113.1" else "other.notmine.com"

    monkeypatch.setattr(discovery, "reverse_dns", fake_ptr)
    out = discovery.reverse_sweep_prefix("203.0.113.0/30", ["example.com"])
    assert out == ["host.example.com"]


def test_reverse_sweep_prefix_skips_large_ranges():
    # A /16 has far more than the default 256-host limit -> skipped, no sweep.
    assert discovery.reverse_sweep_prefix("10.0.0.0/16", ["example.com"]) == []
