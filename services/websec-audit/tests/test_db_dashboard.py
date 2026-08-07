"""Tests for the dashboard-oriented DB query helpers."""

import pytest

from db.models import (
    fleet_trend, get_site_state, init_db, get_engine, latest_site_states,
    latest_site_summaries, save_run,
)


@pytest.fixture
def engine(tmp_path):
    eng = get_engine(f"sqlite:///{tmp_path / 'dash.db'}")
    init_db(eng)
    return eng


def _scored(url, score, grade, findings=None):
    return {
        "name": url, "url": url, "domain": url.split("//")[-1],
        "score": score, "grade": grade,
        "findings": findings or [], "rubric_version": "1.2.0",
    }


def test_latest_site_states_one_per_url_sorted_by_score(engine):
    save_run([_scored("https://a.example", 80, "B")], engine=engine)
    save_run([
        _scored("https://a.example", 90, "A"),
        _scored("https://b.example", 40, "F"),
    ], engine=engine)
    states = latest_site_states(engine=engine)
    by_url = {s["url"]: s for s in states}
    assert len(states) == 2
    assert by_url["https://a.example"]["score"] == 90        # latest, not 80
    assert states[0]["url"] == "https://b.example"           # worst first
    assert [h["score"] for h in by_url["https://a.example"]["history"]] == [80, 90]


def test_get_site_state_returns_findings_and_history(engine):
    findings = [{"category": "tls", "severity": "critical", "penalty": 40, "message": "x"}]
    save_run([_scored("https://a.example", 60, "D", findings)], engine=engine)
    state = get_site_state("https://a.example", engine=engine)
    assert state["findings"][0]["severity"] == "critical"
    assert state["history"][-1]["score"] == 60


def test_get_site_state_unknown_returns_none(engine):
    assert get_site_state("https://nope.example", engine=engine) is None


def test_fleet_trend_average_per_run_oldest_first(engine):
    save_run([_scored("https://a.example", 80, "B"),
              _scored("https://b.example", 60, "D")], engine=engine)
    save_run([_scored("https://a.example", 100, "A"),
              _scored("https://b.example", 80, "B")], engine=engine)
    trend = fleet_trend(engine=engine)
    assert [t["avg_score"] for t in trend] == [70.0, 90.0]
    assert trend[0]["site_count"] == 2


def test_latest_site_summaries_extreme_risk_count(engine):
    findings = [
        {"code": "misconfig.exposed_path", "severity": "high", "message": ".env"},
        {"code": "misconfig.exposed_path", "severity": "medium", "message": "readme"},
        {"code": "tls.expired", "severity": "critical", "message": "cert"},
        {"code": "takeover.vulnerable", "severity": "high", "message": "cname"},
    ]
    save_run([_scored("https://a.example", 40, "F", findings)], engine=engine)
    save_run([_scored("https://b.example", 90, "A")], engine=engine)
    by_url = {s["url"]: s for s in latest_site_summaries(engine=engine)}
    assert by_url["https://a.example"]["extreme_risk_count"] == 2
    assert by_url["https://a.example"]["findings_count"] == 4
    assert len(by_url["https://a.example"]["finding_signals"]) == 4
    assert by_url["https://b.example"]["extreme_risk_count"] == 0
    assert by_url["https://b.example"]["finding_signals"] == []
