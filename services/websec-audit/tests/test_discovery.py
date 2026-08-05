"""Tests for EASM asset discovery (no real network)."""

import scanners.discovery as discovery
from scanners.discovery import (
    _clean_ct_name,
    discover_assets,
    discover_subdomains,
    discover_subdomains_certspotter,
    discover_subdomains_crtsh,
    discover_subdomains_hackertarget,
    reverse_expand,
)


class _FakeTextResp:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        pass


class _FakeResp:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


def test_clean_ct_name_handles_wildcards_and_multiline():
    assert _clean_ct_name("*.example.com\nwww.example.com") == \
        ["example.com", "www.example.com"]


def test_crtsh_enumerates_and_filters_to_domain(monkeypatch):
    payload = [
        {"name_value": "www.example.com\n*.example.com"},
        {"name_value": "api.example.com"},
        {"name_value": "evil.notexample.com"},   # different domain -> dropped
    ]
    monkeypatch.setattr(discovery.requests, "get",
                        lambda *a, **k: _FakeResp(payload))
    hosts = discover_subdomains_crtsh("example.com")
    assert hosts == ["api.example.com", "example.com", "www.example.com"]


def test_crtsh_failsafe_on_network_error(monkeypatch):
    def boom(*a, **k):
        raise discovery.requests.RequestException("down")
    monkeypatch.setattr(discovery.requests, "get", boom)
    # Never raises; degrades to just the apex.
    assert discover_subdomains_crtsh("example.com") == ["example.com"]


def test_certspotter_enumerates_and_filters_to_domain(monkeypatch):
    payload = [
        {"dns_names": ["a.example.com", "*.example.com"]},
        {"dns_names": ["b.example.com", "other.notexample.com"]},  # foreign dropped
    ]
    monkeypatch.setattr(discovery.requests, "get",
                        lambda *a, **k: _FakeResp(payload))
    hosts = discover_subdomains_certspotter("example.com")
    assert hosts == ["a.example.com", "b.example.com", "example.com"]


def test_certspotter_failsafe_on_network_error(monkeypatch):
    def boom(*a, **k):
        raise discovery.requests.RequestException("down")
    monkeypatch.setattr(discovery.requests, "get", boom)
    # A source failure degrades to nothing (the other source still contributes).
    assert discover_subdomains_certspotter("example.com") == []


def test_hackertarget_parses_and_filters_to_domain(monkeypatch):
    text = ("a.example.com,1.2.3.4\n"
            "b.example.com,5.6.7.8\n"
            "other.notexample.com,9.9.9.9\n")  # foreign host dropped
    monkeypatch.setattr(discovery.requests, "get",
                        lambda *a, **k: _FakeTextResp(text))
    hosts = discover_subdomains_hackertarget("example.com")
    assert hosts == ["a.example.com", "b.example.com"]


def test_hackertarget_ignores_error_body(monkeypatch):
    # Rate-limit/error bodies have no in-scope host,ip rows -> nothing added.
    monkeypatch.setattr(discovery.requests, "get",
                        lambda *a, **k: _FakeTextResp("API count exceeded"))
    assert discover_subdomains_hackertarget("example.com") == []


def test_hackertarget_failsafe_on_network_error(monkeypatch):
    def boom(*a, **k):
        raise discovery.requests.RequestException("down")
    monkeypatch.setattr(discovery.requests, "get", boom)
    assert discover_subdomains_hackertarget("example.com") == []


def test_discover_subdomains_merges_sources(monkeypatch):
    monkeypatch.setattr(discovery, "discover_subdomains_crtsh",
                        lambda *a, **k: ["example.com", "a.example.com"])
    monkeypatch.setattr(discovery, "discover_subdomains_certspotter",
                        lambda *a, **k: ["a.example.com", "b.example.com"])
    monkeypatch.setattr(discovery, "discover_subdomains_hackertarget",
                        lambda *a, **k: ["c.example.com"])  # non-CT contribution
    # Union of every source, apex always included, de-duplicated and sorted.
    assert discover_subdomains("example.com") == [
        "a.example.com", "b.example.com", "c.example.com", "example.com"]


def test_discover_subdomains_survives_one_source_down(monkeypatch):
    monkeypatch.setattr(discovery, "discover_subdomains_crtsh",
                        lambda *a, **k: ["example.com", "a.example.com"])
    monkeypatch.setattr(discovery, "discover_subdomains_certspotter",
                        lambda *a, **k: [])  # this provider is down
    monkeypatch.setattr(discovery, "discover_subdomains_hackertarget",
                        lambda *a, **k: [])  # and so is this one
    assert discover_subdomains("example.com") == ["a.example.com", "example.com"]


def test_reverse_expand_keeps_only_in_scope_ptr(monkeypatch):
    ptr = {"1.1.1.1": "hidden.example.com",   # in scope -> kept
           "2.2.2.2": "vps.unrelated.net",    # out of scope -> dropped
           "3.3.3.3": None}                    # no PTR -> ignored
    monkeypatch.setattr(discovery, "reverse_dns", lambda ip: ptr.get(ip))
    out = reverse_expand({"1.1.1.1", "2.2.2.2", "3.3.3.3"}, ["example.com"])
    assert out == ["hidden.example.com"]


def test_discover_assets_keeps_only_resolving_hosts(monkeypatch):
    discovery.clear_cache()
    monkeypatch.setattr(discovery, "discover_subdomains_crtsh",
                        lambda *a, **k: ["example.com", "dead.example.com"])
    monkeypatch.setattr(discovery, "discover_subdomains_certspotter",
                        lambda *a, **k: [])
    monkeypatch.setattr(discovery, "discover_subdomains_hackertarget",
                        lambda *a, **k: [])
    monkeypatch.setattr(discovery, "resolve_ip",
                        lambda host: "1.2.3.4" if host == "example.com" else None)
    targets = discover_assets(["example.com"], use_cache=False)
    assert targets == [
        {"name": "example.com", "url": "https://example.com", "domain": "example.com"},
    ]


def test_discover_assets_expands_via_reverse_dns(monkeypatch):
    discovery.clear_cache()
    monkeypatch.setattr(discovery, "discover_subdomains_crtsh",
                        lambda *a, **k: ["example.com"])
    monkeypatch.setattr(discovery, "discover_subdomains_certspotter",
                        lambda *a, **k: [])
    monkeypatch.setattr(discovery, "discover_subdomains_hackertarget",
                        lambda *a, **k: [])
    monkeypatch.setattr(discovery, "resolve_ip", lambda host: "1.1.1.1")
    monkeypatch.setattr(discovery, "reverse_dns", lambda ip: "hidden.example.com")
    targets = discover_assets(["example.com"], expand=True, use_cache=False)
    domains = {t["domain"] for t in targets}
    assert domains == {"example.com", "hidden.example.com"}


def test_discover_assets_dedups_across_roots(monkeypatch):
    discovery.clear_cache()
    monkeypatch.setattr(discovery, "discover_subdomains_crtsh",
                        lambda root, **k: ["shared.example.com"])
    monkeypatch.setattr(discovery, "discover_subdomains_certspotter",
                        lambda root, **k: [])
    monkeypatch.setattr(discovery, "discover_subdomains_hackertarget",
                        lambda root, **k: [])
    monkeypatch.setattr(discovery, "resolve_ip", lambda host: "1.2.3.4")
    targets = discover_assets(["example.com", "example.org"], use_cache=False)
    domains = [t["domain"] for t in targets]
    # A host discovered under both roots appears exactly once (de-duplicated),
    # alongside each root's apex.
    assert domains.count("shared.example.com") == 1
    assert set(domains) == {"example.com", "example.org", "shared.example.com"}


def test_load_targets_merges_discovery(tmp_path, monkeypatch):
    import core.audit as audit
    cfg = tmp_path / "targets.yaml"
    cfg.write_text(
        "sites:\n"
        "  - name: Static\n"
        "    url: https://static.example.com\n"
        "discover:\n"
        "  enabled: true\n"
        "  domains: [example.com]\n"
    )
    monkeypatch.setattr(
        "scanners.discovery.discover_assets",
        lambda domains, resolve=True, expand=False, bruteforce=False: [
            {"name": "www.example.com", "url": "https://www.example.com",
             "domain": "www.example.com"},
            # Duplicate of the static site -> must not be added twice.
            {"name": "Static", "url": "https://static.example.com",
             "domain": "static.example.com"},
        ],
    )
    sites = audit.load_targets(str(cfg))
    urls = [s["url"] for s in sites]
    assert urls == ["https://static.example.com", "https://www.example.com"]


def test_load_targets_discovery_disabled_by_flag(tmp_path):
    import core.audit as audit
    cfg = tmp_path / "targets.yaml"
    cfg.write_text(
        "sites:\n  - {name: Static, url: https://static.example.com}\n"
        "discover:\n  enabled: true\n  domains: [example.com]\n"
    )
    # discover=False must skip discovery entirely (no network).
    sites = audit.load_targets(str(cfg), discover=False)
    assert [s["url"] for s in sites] == ["https://static.example.com"]


# --- WHOIS/ASN attribution -------------------------------------------------

def test_ip_to_asn_parses_team_cymru(monkeypatch):
    def fake_txt(name):
        if name.endswith("origin.asn.cymru.com"):
            assert name == "1.1.1.1.origin.asn.cymru.com"  # reversed octets
            return "13335 | 1.1.1.0/24 | US | arin | 2010-07-14"
        return "13335 | US | arin | 2010-07-14 | CLOUDFLARENET, US"
    monkeypatch.setattr(discovery, "_txt", fake_txt)
    info = discovery.ip_to_asn("1.1.1.1")
    assert info == {"asn": "AS13335", "prefix": "1.1.1.0/24",
                    "owner": "CLOUDFLARENET, US"}


def test_ip_to_asn_ignores_ipv6_and_failsafe(monkeypatch):
    monkeypatch.setattr(discovery, "_txt", lambda name: None)
    assert discovery.ip_to_asn("2606:4700::1") is None   # IPv6 unsupported
    assert discovery.ip_to_asn("8.8.8.8") is None          # no TXT -> None


def test_attribute_host_combines_ip_and_asn(monkeypatch):
    monkeypatch.setattr(discovery, "resolve_ip", lambda h: "1.1.1.1")
    monkeypatch.setattr(discovery, "ip_to_asn",
                        lambda ip: {"asn": "AS13335", "owner": "CLOUDFLARENET"})
    assert discovery.attribute_host("x.example.com") == {
        "ip": "1.1.1.1", "asn": "AS13335", "asn_owner": "CLOUDFLARENET"}


def test_rdap_domain_extracts_registration(monkeypatch):
    payload = {
        "events": [
            {"eventAction": "registration", "eventDate": "1997-09-15T04:00:00Z"},
            {"eventAction": "expiration", "eventDate": "2028-09-14T04:00:00Z"},
        ],
        "entities": [{"roles": ["registrar"], "handle": "REG-123"}],
        "status": ["client transfer prohibited"],
        "nameservers": [{"ldhName": "ns1.example.com"}],
    }
    monkeypatch.setattr(discovery.requests, "get",
                        lambda *a, **k: _FakeResp(payload))
    info = discovery.rdap_domain("example.com")
    assert info["registrar"] == "REG-123"
    assert info["created"] == "1997-09-15T04:00:00Z"
    assert info["expires"] == "2028-09-14T04:00:00Z"
    assert info["nameservers"] == ["ns1.example.com"]


def test_rdap_domain_extracts_registrant_org(monkeypatch):
    payload = {
        "events": [],
        "entities": [
            {"roles": ["registrar"], "handle": "REG-123"},
            {"roles": ["registrant"],
             "vcardArray": ["vcard", [
                 ["version", {}, "text", "4.0"],
                 ["fn", {}, "text", "Redacted for Privacy"],
                 ["org", {}, "text", ["Example Holdings", "IT dept"]],
             ]]},
        ],
        "status": [],
        "nameservers": [],
    }
    monkeypatch.setattr(discovery.requests, "get",
                        lambda *a, **k: _FakeResp(payload))
    info = discovery.rdap_domain("example.com")
    assert info["registrar"] == "REG-123"
    assert info["registrant"] == "Example Holdings"


def test_rdap_domain_failsafe(monkeypatch):
    def boom(*a, **k):
        raise discovery.requests.RequestException("nope")
    monkeypatch.setattr(discovery.requests, "get", boom)
    assert discovery.rdap_domain("example.com") is None


# --- surface change tracking ----------------------------------------------

def test_diff_inventory_reports_added_and_removed():
    # Legacy string values must upgrade transparently to records.
    previous = {"a.example.com": "2020-01-01T00:00:00", "b.example.com": "2020-01-01T00:00:00"}
    out = discovery.diff_inventory(previous, ["a.example.com", "c.example.com"],
                                   now="2024-01-01T00:00:00")
    assert out["added"] == ["c.example.com"]
    assert out["removed"] == ["b.example.com"]
    # first_seen preserved for known host, set to now for the new one; last_seen refreshed.
    assert out["inventory"]["a.example.com"]["first_seen"] == "2020-01-01T00:00:00"
    assert out["inventory"]["a.example.com"]["last_seen"] == "2024-01-01T00:00:00"
    assert out["inventory"]["c.example.com"]["first_seen"] == "2024-01-01T00:00:00"
    assert "b.example.com" not in out["inventory"]


def test_diff_inventory_records_ips_and_asn_metadata():
    previous = {"a.example.com": {"first_seen": "2020-01-01T00:00:00",
                                  "last_seen": "2020-01-01T00:00:00",
                                  "ips": ["9.9.9.9"], "asn": "AS1"}}
    current = {"a.example.com": {"ips": ["1.1.1.1"], "asn": "AS13335"}}
    out = discovery.diff_inventory(previous, current, now="2024-01-01T00:00:00")
    rec = out["inventory"]["a.example.com"]
    assert rec == {"first_seen": "2020-01-01T00:00:00",
                   "last_seen": "2024-01-01T00:00:00",
                   "ips": ["1.1.1.1"], "asn": "AS13335"}


def test_diff_inventory_falls_back_to_previous_metadata():
    previous = {"a.example.com": {"first_seen": "2020-01-01T00:00:00",
                                  "ips": ["1.1.1.1"], "asn": "AS13335"}}
    out = discovery.diff_inventory(previous, ["a.example.com"],
                                   now="2024-01-01T00:00:00")
    rec = out["inventory"]["a.example.com"]
    assert rec["ips"] == ["1.1.1.1"] and rec["asn"] == "AS13335"
