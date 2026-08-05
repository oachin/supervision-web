"""Tests for alert selection logic (no SMTP; pure functions / dry-run)."""

from alerts.mailer import build_alert_body, find_alertable


def _site(url, score, findings, new_keys=None):
    s = {"name": url, "url": url, "grade": "F", "score": score, "findings": findings}
    if new_keys is not None:
        s["new_finding_keys"] = new_keys
    return s


def test_low_score_triggers_alert():
    sites = [_site("https://a", 40, [])]
    alertable = find_alertable(sites, threshold=60)
    assert len(alertable) == 1
    assert any("below threshold" in r for r in alertable[0]["reasons"])


def test_critical_finding_triggers_alert():
    crit = {"code": "tls.cert_expired", "message": "expired", "severity": "critical"}
    sites = [_site("https://a", 100, [crit])]
    alertable = find_alertable(sites, threshold=60)
    assert len(alertable) == 1
    assert any(r.startswith("CRITICAL") for r in alertable[0]["reasons"])


def test_new_critical_is_tagged_new():
    crit = {"code": "tls.cert_expired", "message": "expired", "severity": "critical"}
    sites = [_site("https://a", 100, [crit],
                   new_keys=[["tls.cert_expired", "expired"]])]
    alertable = find_alertable(sites, threshold=60)
    reasons = alertable[0]["reasons"]
    assert any("[NEW]" in r for r in reasons)


def test_known_critical_is_not_tagged_new():
    crit = {"code": "tls.cert_expired", "message": "expired", "severity": "critical"}
    sites = [_site("https://a", 100, [crit], new_keys=[])]
    alertable = find_alertable(sites, threshold=60)
    assert not any("[NEW]" in r for r in alertable[0]["reasons"])


def test_clean_site_does_not_alert():
    sites = [_site("https://a", 100, [])]
    assert find_alertable(sites, threshold=60) == []


def test_alert_body_lists_site():
    crit = {"code": "tls.cert_expired", "message": "expired", "severity": "critical"}
    sites = [_site("https://a", 30, [crit], new_keys=[["tls.cert_expired", "expired"]])]
    body = build_alert_body(find_alertable(sites, threshold=60))
    assert "https://a" in body
    assert "[NEW]" in body
