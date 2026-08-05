"""Tests for the live availability monitor (network + TLS calls are mocked)."""

import dashboard.live_monitor as lm


def _fake_avail(mapping):
    def _inner(url, timeout=6):
        return mapping.get(url, {"reachable": False, "status_code": None,
                                 "response_time_ms": None, "tls_verify_failed": False,
                                 "error": "unreachable"})
    return _inner


def test_check_once_records_up_and_down(monkeypatch):
    sites = [
        {"name": "Up", "url": "https://up.example", "domain": "up.example"},
        {"name": "Down", "url": "https://down.example", "domain": "down.example"},
    ]
    monkeypatch.setattr(lm, "check_availability", _fake_avail({
        "https://up.example": {"reachable": True, "status_code": 200,
                               "response_time_ms": 42.0, "tls_verify_failed": False,
                               "error": None},
        "https://down.example": {"reachable": False, "status_code": None,
                                 "response_time_ms": None, "tls_verify_failed": False,
                                 "error": "Connection refused"},
    }))
    monkeypatch.setattr(lm, "_cert_days_left", lambda host, **k: 90)

    monitor = lm.LiveMonitor()
    snapshot = monitor.check_once(sites=sites)

    by_url = {s["url"]: s for s in snapshot}
    assert by_url["https://up.example"]["up"] is True
    assert by_url["https://up.example"]["status_code"] == 200
    assert by_url["https://up.example"]["cert_days"] == 90
    assert by_url["https://down.example"]["up"] is False


def test_snapshot_lists_down_sites_first(monkeypatch):
    sites = [
        {"name": "Alpha", "url": "https://alpha.example", "domain": "alpha.example"},
        {"name": "Beta", "url": "https://beta.example", "domain": "beta.example"},
    ]
    monkeypatch.setattr(lm, "check_availability", _fake_avail({
        "https://alpha.example": {"reachable": True, "status_code": 200,
                                  "response_time_ms": 10.0, "tls_verify_failed": False,
                                  "error": None},
        "https://beta.example": {"reachable": False, "status_code": None,
                                 "response_time_ms": None, "tls_verify_failed": False,
                                 "error": "down"},
    }))
    monkeypatch.setattr(lm, "_cert_days_left", lambda host, **k: None)

    monitor = lm.LiveMonitor()
    monitor.check_once(sites=sites)
    ordered = monitor.snapshot()
    assert ordered[0]["name"] == "Beta"  # the down site sorts first


def test_http_site_skips_cert_check(monkeypatch):
    sites = [{"name": "Plain", "url": "http://plain.example", "domain": "plain.example"}]
    monkeypatch.setattr(lm, "check_availability", _fake_avail({
        "http://plain.example": {"reachable": True, "status_code": 200,
                                 "response_time_ms": 5.0, "tls_verify_failed": False,
                                 "error": None},
    }))

    def _boom(host, **k):
        raise AssertionError("cert check must not run for http:// sites")

    monkeypatch.setattr(lm, "_cert_days_left", _boom)

    monitor = lm.LiveMonitor()
    snapshot = monitor.check_once(sites=sites)
    assert snapshot[0]["cert_days"] is None
