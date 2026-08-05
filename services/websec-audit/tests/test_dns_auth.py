"""Tests for DNS-based email-auth checks (SPF/DMARC/DKIM), with DNS mocked out."""

import scanners.dns_auth as dns_auth


def _patch_txt(monkeypatch, mapping):
    """mapping: name -> (records_list, error). Missing names => ([], None)."""
    def fake_query(name):
        return mapping.get(name, ([], None))
    monkeypatch.setattr(dns_auth, "_query_txt", fake_query)


def _patch_caa(monkeypatch, mapping):
    """mapping: name -> (records_list, error). Missing names => ([], None)."""
    def fake_query(name):
        return mapping.get(name, ([], None))
    monkeypatch.setattr(dns_auth, "_query_caa", fake_query)


def test_spf_missing(monkeypatch):
    _patch_txt(monkeypatch, {})
    res = dns_auth.check_spf("example.com")
    assert res["present"] is False
    assert any("No SPF" in i for i in res["issues"])


def test_spf_permissive_all_flagged(monkeypatch):
    _patch_txt(monkeypatch, {"example.com": (["v=spf1 +all"], None)})
    res = dns_auth.check_spf("example.com")
    assert res["present"] is True
    assert any("+all" in i for i in res["issues"])


def test_spf_hard_fail_is_clean(monkeypatch):
    _patch_txt(monkeypatch, {"example.com": (["v=spf1 include:_spf.google.com -all"], None)})
    res = dns_auth.check_spf("example.com")
    assert res["present"] is True
    assert res["issues"] == []


def test_spf_query_error_is_inconclusive(monkeypatch):
    _patch_txt(monkeypatch, {"example.com": ([], "DNS query timed out")})
    res = dns_auth.check_spf("example.com")
    assert res["error"]
    assert res["present"] is False


def test_dmarc_policy_none(monkeypatch):
    _patch_txt(monkeypatch, {"_dmarc.example.com": (["v=DMARC1; p=none"], None)})
    res = dns_auth.check_dmarc("example.com")
    assert res["policy"] == "none"
    assert any("none" in i for i in res["issues"])


def test_dmarc_reject_is_clean(monkeypatch):
    _patch_txt(monkeypatch, {"_dmarc.example.com": (["v=DMARC1; p=reject"], None)})
    res = dns_auth.check_dmarc("example.com")
    assert res["policy"] == "reject"
    assert res["issues"] == []


def test_dkim_found_on_selector(monkeypatch):
    _patch_txt(monkeypatch, {"google._domainkey.example.com": (["v=DKIM1; k=rsa; p=ABC"], None)})
    res = dns_auth.check_dkim("example.com")
    assert res["present"] is True
    assert "google" in res["found_selectors"]


def test_caa_missing_is_reported(monkeypatch):
    _patch_caa(monkeypatch, {})
    res = dns_auth.check_caa("example.com")
    assert res["present"] is False
    assert any("No CAA" in i for i in res["issues"])


def test_caa_present_is_clean(monkeypatch):
    _patch_caa(monkeypatch, {"example.com": (['0 issue "letsencrypt.org"'], None)})
    res = dns_auth.check_caa("example.com")
    assert res["present"] is True
    assert res["records"] == ['0 issue "letsencrypt.org"']
    assert res["issues"] == []


def test_caa_query_error_is_inconclusive(monkeypatch):
    _patch_caa(monkeypatch, {"example.com": ([], "DNS query timed out")})
    res = dns_auth.check_caa("example.com")
    assert res["error"]
    assert res["present"] is False


def test_check_dns_auth_aggregates(monkeypatch):
    _patch_txt(monkeypatch, {})
    _patch_caa(monkeypatch, {})
    res = dns_auth.check_dns_auth("example.com")
    assert set(res.keys()) == {"domain", "spf", "dmarc", "dkim", "caa"}
