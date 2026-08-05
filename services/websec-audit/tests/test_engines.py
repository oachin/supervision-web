"""Tests for the external-engine scanners (testssl / nuclei / zap) and their
scoring. No real binaries or network calls: each scanner's subprocess runner is
replaced with an injected fake that returns captured engine output."""

from scanners import nuclei, testssl, zap
from scanners._external import find_binary
from scoring import engine


# --------------------------------------------------------------------------- #
# testssl.sh
# --------------------------------------------------------------------------- #
def test_testssl_maps_severities_and_drops_noise():
    raw = [
        {"id": "SSLv3", "severity": "CRITICAL", "finding": "SSLv3 offered"},
        {"id": "cipher_x", "severity": "HIGH", "finding": "weak cipher"},
        {"id": "hsts", "severity": "MEDIUM", "finding": "no HSTS"},
        {"id": "cert_ok", "severity": "OK", "finding": "cert fine"},
        {"id": "banner", "severity": "INFO", "finding": "server banner"},
    ]
    result = testssl.check_testssl("https://x.example", runner=lambda t, to: (raw, None))
    assert result["installed"] is True
    sevs = sorted(f["severity"] for f in result["findings"])
    assert sevs == ["critical", "high", "medium"]           # OK/INFO dropped
    assert result["counts"] == {"critical": 1, "high": 1, "medium": 1, "low": 0}


def test_testssl_not_installed_is_inconclusive():
    result = testssl.check_testssl(
        "https://x.example", runner=lambda t, to: ([], "testssl.sh not installed"))
    assert result["installed"] is False
    assert result["findings"] == []
    assert "not installed" in result["error"]


# --------------------------------------------------------------------------- #
# nuclei
# --------------------------------------------------------------------------- #
def test_nuclei_parses_jsonl_objects():
    raw = [
        {"template-id": "CVE-2021-41773", "info": {"name": "Apache path traversal",
                                                    "severity": "critical"},
         "matched-at": "https://x.example/cgi-bin"},
        {"template-id": "tech-detect", "info": {"name": "nginx", "severity": "info"}},
    ]
    result = nuclei.check_nuclei("https://x.example", runner=lambda u, to, auth: (raw, None))
    assert len(result["findings"]) == 1                     # info dropped
    f = result["findings"][0]
    assert f["severity"] == "critical"
    assert f["name"] == "Apache path traversal"


def test_nuclei_authorized_flag_reaches_runner():
    seen = {}

    def fake(url, timeout, authorized):
        seen["authorized"] = authorized
        return [], None

    nuclei.check_nuclei("https://x.example", authorized=True, runner=fake)
    assert seen["authorized"] is True


def test_nuclei_not_installed_is_inconclusive():
    result = nuclei.check_nuclei(
        "https://x.example", runner=lambda u, to, auth: ([], "nuclei not installed"))
    assert result["installed"] is False
    assert "not installed" in result["error"]


# --------------------------------------------------------------------------- #
# OWASP ZAP baseline
# --------------------------------------------------------------------------- #
def test_zap_flattens_alerts_and_maps_riskcodes():
    alerts = [
        {"pluginid": "40012", "alert": "XSS", "riskcode": "3",
         "instances": [{"uri": "https://x.example/q"}]},
        {"pluginid": "10202", "alert": "Missing anti-CSRF token", "riskcode": "2"},
        {"pluginid": "10096", "alert": "Timestamp disclosure", "riskcode": "0"},
    ]
    result = zap.check_zap("https://x.example", runner=lambda u, to: (alerts, None))
    sevs = sorted(f["severity"] for f in result["findings"])
    assert sevs == ["high", "medium"]                       # riskcode 0 dropped
    assert result["findings"][0]["detail"] == "https://x.example/q"


def test_zap_not_installed_is_inconclusive():
    result = zap.check_zap(
        "https://x.example",
        runner=lambda u, to: ([], "OWASP ZAP (zap-baseline.py) not installed"))
    assert result["installed"] is False
    assert "not installed" in result["error"]


# --------------------------------------------------------------------------- #
# scoring
# --------------------------------------------------------------------------- #
def test_score_engine_aggregates_per_severity():
    result = {
        "engine": "nuclei",
        "findings": [
            {"name": "a", "severity": "high"},
            {"name": "b", "severity": "high"},
            {"name": "c", "severity": "medium"},
        ],
        "error": None,
    }
    findings = engine._score_engine(result, "nuclei")
    by_sev = {f["severity"]: f for f in findings}
    assert set(by_sev) == {"high", "medium"}
    assert by_sev["high"]["penalty"] == 2 * engine.RUBRIC["nuclei"]["high"]
    assert by_sev["high"]["code"] == "nuclei.finding"


def test_score_engine_caps_total_penalty():
    result = {"engine": "nuclei",
              "findings": [{"name": f"n{i}", "severity": "critical"} for i in range(20)],
              "error": None}
    findings = engine._score_engine(result, "nuclei")
    assert sum(f["penalty"] for f in findings) <= engine.RUBRIC["nuclei"]["cap"]


def test_score_engine_inconclusive_is_info_only():
    findings = engine._score_engine(
        {"engine": "testssl", "findings": [], "error": "testssl.sh not installed"},
        "testssl")
    assert len(findings) == 1
    assert findings[0]["severity"] == "info"
    assert findings[0]["penalty"] == 0


def test_score_engine_no_result_is_empty():
    assert engine._score_engine({}, "zap") == []


def test_missing_binary_returns_none():
    assert find_binary("definitely-not-a-real-binary-xyz") is None
