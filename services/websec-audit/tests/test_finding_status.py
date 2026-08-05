"""Tests for the user-maintained remediation status (DB layer + dashboard endpoint)."""

import pytest
from fastapi.testclient import TestClient

from dashboard import app as app_module
from db.models import (
    attach_finding_statuses, finding_statuses, save_run, set_finding_status,
)

URL = "https://status.example"
FINDING = {
    "category": "headers", "severity": "high", "penalty": 10,
    "message": "Missing security header: Strict-Transport-Security",
    "code": "headers.missing.strict-transport-security",
}


def test_set_and_get_status_roundtrip():
    set_finding_status(URL, FINDING["code"], FINDING["message"], "in_progress")
    statuses = finding_statuses(URL)
    key = f"{FINDING['code']}\x1f{FINDING['message']}"
    assert statuses[key]["status"] == "in_progress"


def test_set_status_is_upsert():
    set_finding_status(URL, "c1", "m1", "open")
    set_finding_status(URL, "c1", "m1", "fixed")
    statuses = finding_statuses(URL)
    assert statuses["c1\x1fm1"]["status"] == "fixed"
    # Only one row for the same (url, code, message).
    assert sum(1 for k in statuses if k == "c1\x1fm1") == 1


def test_invalid_status_rejected():
    with pytest.raises(ValueError):
        set_finding_status(URL, "c", "m", "done")


def test_attach_defaults_open_and_skips_info():
    state = {
        "url": URL,
        "findings": [
            dict(FINDING),
            {"category": "dns_auth", "severity": "info", "code": "dns.dkim_missing",
             "message": "DKIM not found"},
        ],
    }
    set_finding_status(URL, FINDING["code"], FINDING["message"], "fixed")
    attach_finding_statuses(state)
    assert state["findings"][0]["status"] == "fixed"
    # Info findings are not given a remediation status.
    assert "status" not in state["findings"][1]


def test_endpoint_updates_status_and_returns_control():
    findings = [dict(FINDING)]
    base = {"name": "S", "url": URL, "domain": "status.example", "rubric_version": "1.3.0"}
    save_run([{**base, "score": 90, "grade": "A", "findings": findings}])
    client = TestClient(app_module.app)
    r = client.post("/finding/status", data={
        "url": URL, "code": FINDING["code"], "message": FINDING["message"],
        "status": "fixed",
    })
    assert r.status_code == 200
    assert 'selected' in r.text.lower()
    assert finding_statuses(URL)[f"{FINDING['code']}\x1f{FINDING['message']}"]["status"] == "fixed"


def test_endpoint_rejects_bad_status():
    client = TestClient(app_module.app)
    r = client.post("/finding/status", data={
        "url": URL, "code": "x", "message": "y", "status": "bogus",
    })
    assert r.status_code == 400
