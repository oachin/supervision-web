"""Tests for scoring/compliance.py — France/Morocco compliance mapping."""

from scoring.compliance import (
    FAIL,
    NOT_ASSESSED,
    PASS,
    assess_compliance,
)
from scoring.engine import score_site

# Every scanner ran and observed nothing wrong.
_FULL_COVERAGE = {
    "availability": "ran", "tls": "ran", "headers": "ran",
    "dns_auth": "ran", "takeover": "ran", "misconfig": "ran", "cve": "ran",
    "testssl": "ran", "nuclei": "ran", "zap": "ran", "ports": "ran",
}


def _codes(result, control_id):
    return next(c for c in result["controls"] if c["id"] == control_id)


def test_clean_site_is_compliant_both_countries():
    result = assess_compliance(findings=[], coverage=_FULL_COVERAGE)
    for country in ("FR", "MA"):
        fw = result["frameworks"][country]
        assert fw["status"] == PASS
        assert fw["score"] == 100


def test_violation_marks_control_and_framework_partial():
    findings = [{"code": "tls.protocol_ssl", "penalty": 10}]
    result = assess_compliance(findings, _FULL_COVERAGE)
    assert _codes(result, "tls_strong_protocols")["status"] == FAIL
    # A single failing control among many passing => partial (not fully failed).
    assert result["frameworks"]["FR"]["status"] == "partial"
    assert result["frameworks"]["FR"]["score"] < 100


def test_scanner_not_run_is_not_assessed_and_excluded_from_score():
    coverage = dict(_FULL_COVERAGE, tls="not_run")
    result = assess_compliance(findings=[], coverage=coverage)
    assert _codes(result, "tls_strong_protocols")["status"] == NOT_ASSESSED
    assert _codes(result, "tls_valid_certificate")["status"] == NOT_ASSESSED
    # Score still computed from the other assessed controls; stays 100 (all pass).
    assert result["frameworks"]["FR"]["score"] == 100


def test_all_scanners_not_run_yields_not_assessed_framework():
    coverage = {k: "not_run" for k in _FULL_COVERAGE}
    result = assess_compliance(findings=[], coverage=coverage)
    for country in ("FR", "MA"):
        fw = result["frameworks"][country]
        assert fw["status"] == NOT_ASSESSED
        assert fw["score"] is None


def test_inconclusive_coverage_is_not_counted_as_compliant():
    coverage = dict(_FULL_COVERAGE, cve="inconclusive")
    result = assess_compliance(findings=[], coverage=coverage)
    assert _codes(result, "no_known_cves")["status"] == NOT_ASSESSED


def test_security_headers_control_ignores_hsts_only_gap():
    # Missing HSTS should hit the HSTS control, not the generic headers control.
    findings = [{"code": "headers.missing.strict-transport-security", "penalty": 5}]
    result = assess_compliance(findings, _FULL_COVERAGE)
    assert _codes(result, "hsts_enforced")["status"] == FAIL
    assert _codes(result, "security_headers")["status"] == PASS


def test_subdomain_takeover_marks_control_non_compliant():
    findings = [{"code": "takeover.vulnerable", "penalty": 45}]
    result = assess_compliance(findings, _FULL_COVERAGE)
    assert _codes(result, "no_subdomain_takeover")["status"] == FAIL


def test_frameworks_carry_official_references():
    result = assess_compliance(findings=[], coverage=_FULL_COVERAGE)
    assert any("ANSSI" in r for r in result["frameworks"]["FR"]["references"])
    assert any("09-08" in r for r in result["frameworks"]["MA"]["references"])
    assert "disclaimer" in result


def test_score_site_attaches_compliance():
    site = {
        "name": "acme", "url": "https://acme.example", "domain": "acme.example",
        "availability": {"reachable": True},
        "tls": {"days_until_expiry": 200, "weak_protocols_supported": []},
        "headers": {"present": {"strict-transport-security": "max-age=63072000"}},
        "dns_auth": {"spf": {"present": True}, "dmarc": {"present": True, "policy": "reject"}},
        "misconfig": {},
        "cve": {},
    }
    scored = score_site(site)
    assert "compliance" in scored
    assert "FR" in scored["compliance"]["frameworks"]
    assert "MA" in scored["compliance"]["frameworks"]
