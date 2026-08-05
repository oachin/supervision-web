"""Tests for the public embedding API (websec_audit package + AuditConfig)."""

import pytest

import core.audit as audit
import websec_audit
from websec_audit import AuditConfig


def test_public_exports_present():
    for name in ("run_audit", "run_scans", "score_all", "AuditConfig",
                 "prune_history", "RUBRIC_VERSION", "__version__"):
        assert hasattr(websec_audit, name), name


def test_audit_config_runs_and_returns_outcome(monkeypatch):
    monkeypatch.setattr(audit, "check_availability", lambda url, *a, **k: {"reachable": True})
    outcome = AuditConfig(
        sites=[{"name": "a", "url": "https://a.example", "domain": "a.example"}],
        enabled=["availability"], persist=False, generate_reports=False,
    ).run()
    assert outcome["stats"]["sites"] == 1
    assert outcome["run_uuid"]
    assert outcome["scored"][0]["name"] == "a"


def test_audit_config_passes_cve_suppressions(monkeypatch):
    captured = {}

    def fake_check_cve(url, *a, suppressed_cve_ids=None, **k):
        captured["suppressed"] = suppressed_cve_ids
        return {"url": url, "products": [], "vulnerabilities": {}, "error": None}

    monkeypatch.setattr(audit, "check_availability", lambda url, *a, **k: {"reachable": True})
    monkeypatch.setattr(audit, "check_cve", fake_check_cve)
    AuditConfig(
        sites=[{"name": "a", "url": "https://a.example", "domain": "a.example"}],
        enabled=["availability", "cve"], persist=False, generate_reports=False,
        suppressed_cve_ids=["CVE-2021-0001"],
    ).run()
    assert captured["suppressed"] == ["CVE-2021-0001"]


def test_discover_domains_scans_discovered_assets(monkeypatch):
    # A host can drive EASM discovery from code, with no targets.yaml at all.
    import scanners.discovery as discovery
    monkeypatch.setattr(discovery, "discover_assets",
                        lambda domains, **kw: [{"name": "found",
                                                "url": "https://found.example",
                                                "domain": "found.example"}])
    monkeypatch.setattr(audit, "check_availability", lambda url, *a, **k: {"reachable": True})

    def _fail(*a, **k):
        raise AssertionError("config file must not be read when discovering")

    monkeypatch.setattr(audit, "load_targets", _fail)
    outcome = AuditConfig(
        discover_domains=["example.com"], enabled=["availability"],
        persist=False, generate_reports=False,
    ).run()
    assert [s["url"] for s in outcome["scored"]] == ["https://found.example"]


def test_engine_takes_precedence_over_db_url(monkeypatch):
    # A host that owns its SQLAlchemy pool hands the engine over directly.
    sentinel = object()
    captured = {}
    monkeypatch.setattr(audit, "check_availability", lambda url, *a, **k: {"reachable": True})
    monkeypatch.setattr(websec_audit, "get_engine",
                        lambda url: pytest.fail("db_url must not open a second pool"))

    def _capture(**kwargs):
        captured.update(kwargs)
        return {"stats": {}, "scored": []}

    monkeypatch.setattr(websec_audit, "run_audit", _capture)
    AuditConfig(sites=[], engine=sentinel, db_url="postgresql+psycopg://x/y").run()
    assert captured["engine"] is sentinel
