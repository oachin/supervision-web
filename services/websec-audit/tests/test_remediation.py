"""Tests for remediation/framework enrichment of findings."""

from scoring.engine import score_site
from scoring.remediation import enrich_findings, remediation_for


def test_known_code_has_recommendation_and_refs():
    r = remediation_for("misconfig.exposed_path", "high")
    assert r["recommendation_en"]
    assert r["recommendation_fr"]
    assert "OWASP A05:2021" in r["references"]


def test_unknown_info_code_falls_back_without_refs():
    r = remediation_for("something.unknown", "info")
    assert r["references"] == []
    assert "Informational" in r["recommendation_en"]


def test_enrich_findings_mutates_in_place():
    findings = [{"category": "tls", "severity": "critical", "penalty": 40,
                 "message": "x", "code": "tls.cert_expired"}]
    enrich_findings(findings)
    assert findings[0]["recommendation_fr"]
    assert "OWASP A02:2021" in findings[0]["references"]


def test_score_site_attaches_remediation_to_every_finding():
    raw = {
        "name": "t", "url": "https://t.example", "domain": "t.example",
        "headers": {"present": {}, "missing": [
            {"header": "Content-Security-Policy", "severity": "high", "description": "x"}],
            "cookie_issues": []},
    }
    scored = score_site(raw)
    assert scored["findings"], "expected at least one finding"
    for f in scored["findings"]:
        assert "recommendation_en" in f
        assert "references" in f


def test_missing_header_code_maps_to_specific_recommendation():
    raw = {
        "name": "t", "url": "https://t.example", "domain": "t.example",
        "headers": {"present": {}, "missing": [
            {"header": "Strict-Transport-Security", "severity": "high", "description": "x"}],
            "cookie_issues": []},
    }
    f = score_site(raw)["findings"][0]
    assert f["code"] == "headers.missing.strict-transport-security"
    assert "Strict-Transport-Security" in f["recommendation_en"]
