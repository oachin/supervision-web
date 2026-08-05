"""Tests for the persistence + history layer, using a temp SQLite DB."""

import pytest

from db.models import (
    fixed_findings, get_engine, get_inventory, get_site_state, init_db,
    latest_site_states, previous_findings, prune_history, save_run,
    score_history, set_finding_status, track_discovery,
)


def _scored_with(url, findings):
    return {
        "name": url, "url": url, "domain": url.split("//")[-1],
        "score": 80, "grade": "B", "findings": findings, "rubric_version": "1.1.0",
    }


_F_HSTS = {"category": "headers", "severity": "high", "penalty": 10,
           "code": "headers.hsts", "message": "Missing HSTS"}
_F_CSP = {"category": "headers", "severity": "high", "penalty": 10,
          "code": "headers.csp", "message": "Missing CSP"}


@pytest.fixture
def engine(tmp_path):
    eng = get_engine(f"sqlite:///{tmp_path / 'test_audit.db'}")
    init_db(eng)
    return eng


def _scored(url, score, grade):
    return {
        "name": url, "url": url, "domain": url.split("//")[-1],
        "score": score, "grade": grade,
        "findings": [{"category": "tls", "severity": "high", "penalty": 10, "message": "x"}],
        "rubric_version": "1.1.0",
    }


def test_save_run_returns_id_and_persists(engine):
    run_id = save_run([_scored("https://a.example", 90, "A")], engine=engine)
    assert isinstance(run_id, int) and run_id > 0


def test_score_history_is_oldest_first(engine):
    save_run([_scored("https://a.example", 80, "B")], engine=engine)
    save_run([_scored("https://a.example", 90, "A")], engine=engine)
    hist = score_history("https://a.example", engine=engine)
    assert [h["score"] for h in hist] == [80, 90]


def test_history_keyed_by_url_not_domain(engine):
    # Two sites sharing a domain must not be conflated.
    save_run([
        _scored("https://a.badssl.com", 40, "F"),
        _scored("https://b.badssl.com", 95, "A"),
    ], engine=engine)
    hist_a = score_history("https://a.badssl.com", engine=engine)
    assert [h["score"] for h in hist_a] == [40]


def test_findings_roundtrip(engine):
    save_run([_scored("https://a.example", 90, "A")], engine=engine)
    hist = score_history("https://a.example", engine=engine)
    assert hist[0]["grade"] == "A"


def test_previous_findings_none_on_first_run(engine):
    save_run([_scored("https://a.example", 90, "A")], engine=engine)
    assert previous_findings("https://a.example", engine=engine) is None


def test_previous_findings_returns_prior_run(engine):
    save_run([_scored("https://a.example", 80, "B")], engine=engine)
    second = _scored("https://a.example", 90, "A")
    second["findings"] = [{"category": "tls", "severity": "high",
                           "penalty": 10, "message": "different"}]
    save_run([second], engine=engine)
    prev = previous_findings("https://a.example", engine=engine)
    assert prev is not None
    assert prev[0]["message"] == "x"  # the older run's finding


def test_coverage_is_persisted_and_reloaded(engine):
    scored = _scored("https://a.example", 90, "A")
    scored["coverage"] = {"tls": "ran", "nuclei": "not_run", "cve": "inconclusive"}
    save_run([scored], engine=engine)
    states = latest_site_states(engine=engine)
    assert states[0]["coverage"] == {"tls": "ran", "nuclei": "not_run",
                                     "cve": "inconclusive"}


def test_latest_site_states_returns_one_row_per_url_at_newest_run(engine):
    save_run([_scored("https://a.example", 40, "F")], engine=engine)
    save_run([_scored("https://a.example", 95, "A")], engine=engine)
    states = latest_site_states(engine=engine)
    assert len(states) == 1
    assert states[0]["score"] == 95  # newest run wins


def test_latest_site_states_paginates(engine):
    save_run([_scored(f"https://s{i}.example", 50 + i, "C") for i in range(5)],
             engine=engine)
    page = latest_site_states(engine=engine, limit=2)
    assert len(page) == 2
    # Worst score first (deterministic ordering).
    assert page[0]["score"] <= page[1]["score"]


def test_prune_history_keeps_only_recent_runs(engine):
    for score in (10, 20, 30, 40):
        save_run([_scored("https://a.example", score, "F")], engine=engine)
    deleted = prune_history(keep_runs=2, engine=engine)
    assert deleted == 2
    hist = score_history("https://a.example", engine=engine)
    assert [h["score"] for h in hist] == [30, 40]  # oldest two pruned


def test_prune_history_noop_without_rules(engine):
    save_run([_scored("https://a.example", 90, "A")], engine=engine)
    assert prune_history(engine=engine) == 0

def test_site_state_reenriches_findings_with_clickable_refs(engine):
    # Simulate a finding persisted before reference_links existed (old data):
    # only category/severity/message/code, no references / reference_links.
    scored = {
        "name": "https://a.example", "url": "https://a.example",
        "domain": "a.example", "score": 80, "grade": "B",
        "findings": [{"category": "headers", "severity": "high", "penalty": 10,
                      "message": "Missing HSTS", "code": "headers.hsts"}],
        "rubric_version": "1.1.0",
    }
    save_run([scored], engine=engine)
    state = get_site_state("https://a.example", engine=engine)
    links = state["findings"][0]["reference_links"]
    # On load the reference is turned into a clickable link.
    assert any(link["url"] and "owasp.org" in link["url"] for link in links)


def test_auto_verify_marks_disappeared_finding_fixed(engine):
    u = "https://a.example"
    save_run([_scored_with(u, [_F_HSTS, _F_CSP])], engine=engine)
    save_run([_scored_with(u, [_F_HSTS])], engine=engine)  # CSP fixed
    fixed = fixed_findings(u, engine=engine)
    assert [f["message"] for f in fixed] == ["Missing CSP"]
    assert fixed[0]["verified_by"] == "auto"
    assert fixed[0]["resolved_at"]
    assert "run #" in (fixed[0]["detail"] or "")


def test_auto_verify_first_run_records_nothing(engine):
    u = "https://a.example"
    save_run([_scored_with(u, [_F_HSTS])], engine=engine)
    assert fixed_findings(u, engine=engine) == []


def test_auto_verify_reopens_regressed_finding(engine):
    u = "https://a.example"
    save_run([_scored_with(u, [_F_HSTS, _F_CSP])], engine=engine)
    save_run([_scored_with(u, [_F_HSTS])], engine=engine)          # CSP fixed
    assert fixed_findings(u, engine=engine)
    save_run([_scored_with(u, [_F_HSTS, _F_CSP])], engine=engine)  # CSP is back
    assert fixed_findings(u, engine=engine) == []  # auto-fix reopened


def test_auto_verify_never_overrides_manual_status(engine):
    u = "https://a.example"
    save_run([_scored_with(u, [_F_HSTS, _F_CSP])], engine=engine)
    # Operator marks CSP as in_progress; it then disappears from the next scan.
    set_finding_status(u, "headers.csp", "Missing CSP", "in_progress", engine=engine)
    save_run([_scored_with(u, [_F_HSTS])], engine=engine)
    # The auto-verifier must not flip a human's decision to "fixed".
    assert fixed_findings(u, engine=engine) == []


def test_set_finding_status_records_manual_verifier_and_resolved_at(engine):
    u = "https://a.example"
    rec = set_finding_status(u, "headers.csp", "Missing CSP", "fixed", engine=engine)
    assert rec["verified_by"] == "manual"
    assert rec["resolved_at"]
    rec2 = set_finding_status(u, "headers.csp", "Missing CSP", "open", engine=engine)
    assert rec2["resolved_at"] is None


def test_track_discovery_reports_surface_changes(engine):
    # First discovery: everything is "added", nothing removed.
    first = track_discovery(["a.example.com", "b.example.com"], engine=engine)
    assert first == {"added": ["a.example.com", "b.example.com"], "removed": []}

    # Second discovery: one new host, one gone.
    second = track_discovery(["a.example.com", "c.example.com"], engine=engine)
    assert second == {"added": ["c.example.com"], "removed": ["b.example.com"]}

    # Third discovery unchanged: no churn reported.
    third = track_discovery(["a.example.com", "c.example.com"], engine=engine)
    assert third == {"added": [], "removed": []}


def test_track_discovery_persists_rich_inventory(engine):
    track_discovery({"a.example.com": {"ips": ["1.1.1.1"], "asn": "AS13335"}},
                    engine=engine)
    inv = get_inventory(engine=engine)
    rec = inv["a.example.com"]
    assert rec["ips"] == ["1.1.1.1"] and rec["asn"] == "AS13335"
    assert rec["first_seen"] and rec["last_seen"]

    # first_seen is preserved across runs; last_seen advances.
    track_discovery({"a.example.com": {"ips": ["2.2.2.2"]}}, engine=engine)
    rec2 = get_inventory(engine=engine)["a.example.com"]
    assert rec2["first_seen"] == rec["first_seen"]
    assert rec2["ips"] == ["2.2.2.2"]
    assert rec2["asn"] == "AS13335"  # falls back to previously-stored value


def test_ensure_schema_emits_portable_timestamp_ddl(monkeypatch):
    # PostgreSQL has no DATETIME type: the in-place column migration must use
    # TIMESTAMP on any non-SQLite dialect or upgrading a Postgres DB blows up.
    import db.models as models

    executed: list[str] = []

    class _Insp:
        def get_table_names(self):
            return ["finding_status"]

        def get_columns(self, _table):
            return [{"name": "id"}]

    class _Conn:
        def __enter__(self):
            return self

        def __exit__(self, *_exc):
            return False

        def execute(self, stmt):
            executed.append(str(stmt))

    class _Engine:
        dialect = type("_D", (), {"name": "postgresql"})()

        def begin(self):
            return _Conn()

    monkeypatch.setattr(models, "inspect", lambda _engine: _Insp())
    models._ensure_schema(_Engine())

    assert any("resolved_at TIMESTAMP" in s for s in executed)
    assert not any("DATETIME" in s for s in executed)
