"""Tests for finding-diff logic (new/resolved findings vs the previous scan)."""

from core.diff import diff_findings


def _f(code, message, severity="high"):
    return {"code": code, "message": message, "severity": severity}


def test_first_scan_has_no_diff():
    current = [_f("tls.cert_expired", "expired")]
    delta = diff_findings(current, None)
    assert delta == {"new": [], "resolved": []}


def test_new_finding_detected():
    previous = [_f("headers.missing.csp", "missing CSP")]
    current = [_f("headers.missing.csp", "missing CSP"),
               _f("tls.cert_expired", "expired")]
    delta = diff_findings(current, previous)
    assert [f["code"] for f in delta["new"]] == ["tls.cert_expired"]
    assert delta["resolved"] == []


def test_resolved_finding_detected():
    previous = [_f("tls.cert_expired", "expired"),
                _f("headers.missing.csp", "missing CSP")]
    current = [_f("headers.missing.csp", "missing CSP")]
    delta = diff_findings(current, previous)
    assert delta["new"] == []
    assert [f["code"] for f in delta["resolved"]] == ["tls.cert_expired"]


def test_info_findings_are_ignored():
    previous = [_f("dns.dkim_missing", "no dkim", severity="info")]
    current = [_f("dns.caa_missing", "no caa", severity="info")]
    delta = diff_findings(current, previous)
    assert delta["new"] == []
    assert delta["resolved"] == []


def test_same_findings_no_change():
    findings = [_f("tls.cert_expired", "expired")]
    delta = diff_findings(list(findings), list(findings))
    assert delta["new"] == []
    assert delta["resolved"] == []
