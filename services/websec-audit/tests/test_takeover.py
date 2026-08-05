"""Tests for the subdomain-takeover / dangling-DNS scanner (no real network)."""

import scanners.takeover as takeover
from scanners.takeover import check_takeover, _match_service


def test_no_cname_is_not_a_candidate(monkeypatch):
    monkeypatch.setattr(takeover, "_cname_chain", lambda host: [])
    result = check_takeover("https://apex.example.com")
    assert result["cname_chain"] == []
    assert result["vulnerable"] is False and result["dangling"] is False
    assert result["error"] is None


def test_confirmed_takeover_on_fingerprint(monkeypatch):
    monkeypatch.setattr(takeover, "_cname_chain",
                        lambda host: ["victim.github.io"])
    monkeypatch.setattr(takeover, "_resolution_status", lambda name: "resolves")
    monkeypatch.setattr(takeover, "_fetch_body",
                        lambda url, timeout: "There isn't a GitHub Pages site here.")
    result = check_takeover("https://blog.example.com")
    assert result["vulnerable"] is True
    assert result["service"] == "GitHub Pages"
    assert "GitHub Pages" in result["evidence"] or result["evidence"]


def test_dangling_dns_when_cname_target_nxdomain(monkeypatch):
    monkeypatch.setattr(takeover, "_cname_chain",
                        lambda host: ["gone.herokudns.com"])
    monkeypatch.setattr(takeover, "_resolution_status", lambda name: "nxdomain")
    monkeypatch.setattr(takeover, "_fetch_body", lambda url, timeout: None)
    result = check_takeover("https://app.example.com")
    assert result["dangling"] is True
    assert result["vulnerable"] is False
    assert any("NXDOMAIN" in i for i in result["issues"])


def test_third_party_service_without_fingerprint_is_informational(monkeypatch):
    monkeypatch.setattr(takeover, "_cname_chain",
                        lambda host: ["shop.myshopify.com"])
    monkeypatch.setattr(takeover, "_resolution_status", lambda name: "resolves")
    monkeypatch.setattr(takeover, "_fetch_body",
                        lambda url, timeout: "<html>Live store</html>")
    result = check_takeover("https://store.example.com")
    assert result["service"] == "Shopify"
    assert result["vulnerable"] is False and result["dangling"] is False
    assert any("third-party service" in i for i in result["issues"])


def test_failsafe_on_unexpected_error(monkeypatch):
    def boom(host):
        raise RuntimeError("resolver exploded")
    monkeypatch.setattr(takeover, "_cname_chain", boom)
    result = check_takeover("https://x.example.com")
    assert result["error"] and "exploded" in result["error"]
    assert result["vulnerable"] is False


def test_match_service_matches_suffix():
    assert _match_service(["a.s3.amazonaws.com"])["service"] == "AWS S3"
    assert _match_service(["nothing.example.com"]) is None
