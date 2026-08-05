"""Tests for EASM ownership attribution & confidence scoring (no real network)."""

import scanners.scoping as scoping
from scanners.discovery import ip_in_any_prefix
from scanners.scoping import (
    _org_tokens,
    _orgs_match,
    build_identity,
    score_asset,
    scope_assets,
)


def test_org_tokens_strips_boilerplate_and_punctuation():
    assert _org_tokens("Example, Inc.") == frozenset({"example"})
    assert _org_tokens("The Example Company LLC") == frozenset({"example"})
    assert _org_tokens("") == frozenset()
    assert _org_tokens(None) == frozenset()


def test_orgs_match_on_distinctive_token_only():
    assert _orgs_match("Example, Inc.", "Example LLC")
    assert _orgs_match("Contoso Technologies", "Contoso Systems")
    assert not _orgs_match("Example Inc", "Acme Corp")
    # Only boilerplate in common must not count as a match.
    assert not _orgs_match("Alpha Inc", "Beta Inc")
    assert not _orgs_match("Example", None)


def test_ip_in_any_prefix_v4_v6_and_malformed():
    assert ip_in_any_prefix("1.2.3.4", ["1.2.3.0/24"])
    assert not ip_in_any_prefix("1.2.4.4", ["1.2.3.0/24"])
    assert ip_in_any_prefix("2606:4700::1", ["2606:4700::/32"])
    assert not ip_in_any_prefix("not-an-ip", ["1.2.3.0/24"])
    assert not ip_in_any_prefix("1.2.3.4", ["garbage"])


def test_build_identity_fuses_signals(monkeypatch):
    monkeypatch.setattr(scoping, "rdap_domain",
                        lambda d, session=None: {"registrant": "Example, Inc."})
    monkeypatch.setattr(scoping, "attribute_host",
                        lambda h: {"asn": "AS64500", "asn_owner": "EXAMPLE-AS"})
    monkeypatch.setattr(scoping, "cert_org", lambda h, **kw: "Example Inc")
    monkeypatch.setattr(scoping, "asn_prefixes",
                        lambda asn, session=None: ["203.0.113.0/24"])

    identity = build_identity(["example.com"])
    assert "AS64500" in identity["asns"]
    assert "203.0.113.0/24" in identity["prefixes"]
    assert identity["root_domains"] == ["example.com"]
    # registrant, asn_owner and cert org all collected.
    assert {"Example, Inc.", "EXAMPLE-AS", "Example Inc"} <= identity["orgs"]


def test_score_asset_in_scope_dns_is_probable():
    identity = {"root_domains": ["example.com"], "orgs": set(),
                "asns": set(), "prefixes": []}
    out = score_asset({"domain": "api.example.com"}, identity, with_cert=False)
    assert "dns-in-scope" in out["signals"]
    assert out["label"] == "probable"
    assert out["confidence"] >= 0.5


def test_score_asset_unrelated_when_no_signal(monkeypatch):
    monkeypatch.setattr(scoping, "resolve_ip", lambda h: None)
    identity = {"root_domains": ["example.com"], "orgs": {"Example"},
                "asns": {"AS64500"}, "prefixes": ["203.0.113.0/24"]}
    out = score_asset({"domain": "unrelated.tenant.net"}, identity,
                      with_cert=False)
    assert out["signals"] == []
    assert out["label"] == "unrelated"
    assert out["confidence"] == 0.0


def test_score_asset_ip_and_asn_corroborate(monkeypatch):
    monkeypatch.setattr(scoping, "resolve_ip", lambda h: "203.0.113.7")
    identity = {"root_domains": ["example.com"], "orgs": set(),
                "asns": {"AS64500"}, "prefixes": ["203.0.113.0/24"]}
    asset = {"domain": "shadow.example.com",
             "attribution": {"ip": "203.0.113.7", "asn": "AS64500"}}
    out = score_asset(asset, identity, with_cert=False)
    assert set(out["signals"]) >= {"dns-in-scope", "ip-in-owned-prefix",
                                   "asn-match"}
    assert out["label"] == "confirmed"


def test_score_asset_cert_org_match(monkeypatch):
    monkeypatch.setattr(scoping, "cert_org", lambda h, **kw: "Example, Inc.")
    monkeypatch.setattr(scoping, "resolve_ip", lambda h: None)
    identity = {"root_domains": [], "orgs": {"Example LLC"},
                "asns": set(), "prefixes": []}
    out = score_asset({"domain": "co-hosted.example.org"}, identity)
    assert out["signals"] == ["cert-org-match"]
    assert out["confidence"] == 0.4


def test_score_asset_out_of_asn_prefix_gives_no_credit(monkeypatch):
    monkeypatch.setattr(scoping, "resolve_ip", lambda h: "198.51.100.5")
    identity = {"root_domains": [], "orgs": set(),
                "asns": {"AS64500"}, "prefixes": ["203.0.113.0/24"]}
    asset = {"domain": "neighbor.net",
             "attribution": {"ip": "198.51.100.5", "asn": "AS99999"}}
    out = score_asset(asset, identity, with_cert=False)
    assert out["signals"] == []
    assert out["label"] == "unrelated"


def test_scope_assets_annotates_each_asset(monkeypatch):
    monkeypatch.setattr(scoping, "build_identity",
                        lambda roots, **kw: {"root_domains": ["example.com"],
                                             "orgs": set(), "asns": set(),
                                             "prefixes": []})
    assets = [{"domain": "www.example.com"}, {"domain": "elsewhere.io"}]
    scope_assets(assets, root_domains=["example.com"], with_cert=False)
    labels = {a["domain"]: a["ownership"]["label"] for a in assets}
    assert labels["www.example.com"] == "probable"
    assert labels["elsewhere.io"] == "unrelated"
