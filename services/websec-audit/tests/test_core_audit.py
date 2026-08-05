"""Tests for the concurrent scan orchestration in core.audit."""

import time

import core.audit as audit


def test_run_scans_preserves_input_order(monkeypatch):
    # Make later sites finish first, so order is only correct if preserved.
    def fake_avail(url, *a, **k):
        delay = 0.05 if "first" in url else 0.0
        time.sleep(delay)
        return {"reachable": True, "error": None}

    monkeypatch.setattr(audit, "check_availability", fake_avail)
    sites = [
        {"name": "first", "url": "https://first.example", "domain": "first.example"},
        {"name": "second", "url": "https://second.example", "domain": "second.example"},
    ]
    results = audit.run_scans(sites, ["availability"], authorized=False, max_workers=4)
    assert [r["name"] for r in results] == ["first", "second"]


def test_scan_site_only_runs_enabled_scanners(monkeypatch):
    called = []
    monkeypatch.setattr(audit, "check_availability",
                        lambda url, *a, **k: called.append("avail") or {"reachable": True})
    monkeypatch.setattr(audit, "check_tls",
                        lambda url, *a, **k: called.append("tls") or {})
    site = {"name": "x", "url": "https://x.example", "domain": "x.example"}
    out = audit.scan_site(site, ["availability"], authorized=False)
    assert "availability" in out and "tls" not in out
    assert called == ["avail"]


def test_scan_site_runs_takeover_when_enabled(monkeypatch):
    called = []
    monkeypatch.setattr(audit, "check_takeover",
                        lambda url, *a, **k: called.append(url) or {"domain": "x.example"})
    site = {"name": "x", "url": "https://x.example", "domain": "x.example"}
    out = audit.scan_site(site, ["takeover"], authorized=False)
    assert out["takeover"] == {"domain": "x.example"}
    assert called == ["https://x.example"]
    assert "takeover" in audit.CORE_SCANNERS
    assert "takeover" in audit.SITE_CHECK_ORDER


def test_run_scans_captures_per_site_error(monkeypatch):
    def boom(url, *a, **k):
        if "bad" in url:
            raise RuntimeError("scanner exploded")
        return {"reachable": True}

    monkeypatch.setattr(audit, "check_availability", boom)
    sites = [
        {"name": "ok", "url": "https://ok.example", "domain": "ok.example"},
        {"name": "bad", "url": "https://bad.example", "domain": "bad.example"},
    ]
    results = audit.run_scans(sites, ["availability"], authorized=False)
    by_name = {r["name"]: r for r in results}
    assert "error" in by_name["bad"]
    assert "availability" in by_name["ok"]


def test_progress_callback_invoked(monkeypatch):
    monkeypatch.setattr(audit, "check_availability", lambda url, *a, **k: {"reachable": True})
    seen = []
    sites = [{"name": "a", "url": "https://a.example", "domain": "a.example"}]
    audit.run_scans(sites, ["availability"], authorized=False,
                    on_progress=lambda msg: seen.append(msg))
    assert seen and "1/1" in seen[-1]


def test_resolve_workers_auto_is_one_per_site():
    # 0 / negative / None all mean "auto" = one worker per site.
    for requested in (0, -5, None):
        assert audit.resolve_workers(requested, 150) == 150


def test_resolve_workers_auto_respects_cap():
    assert audit.resolve_workers(0, audit.MAX_WORKERS_CAP + 500) == audit.MAX_WORKERS_CAP


def test_resolve_workers_explicit_is_clamped_to_sites_and_cap():
    # An explicit request is honored, but never exceeds the work available...
    assert audit.resolve_workers(50, 10) == 10
    # ...nor the absolute cap.
    assert audit.resolve_workers(10_000, 10_000) == audit.MAX_WORKERS_CAP
    # A modest explicit cap is used as-is.
    assert audit.resolve_workers(20, 150) == 20


def test_resolve_workers_no_sites():
    assert audit.resolve_workers(0, 0) == 1
    assert audit.resolve_workers(10, 0) == 1


def test_default_workers_is_auto():
    assert audit.DEFAULT_MAX_WORKERS == audit.AUTO_WORKERS <= 0


def test_run_scans_defaults_to_scanning_every_site_in_parallel(monkeypatch):
    # With more sites than the old default of 10, auto mode must give every site
    # its own worker (observed here as concurrent, not batched, execution).
    import threading

    n = 30
    barrier = threading.Barrier(n, timeout=5)

    def fake_avail(url, *a, **k):
        # Every worker must reach the barrier at once; if the pool were smaller
        # than n this would time out and raise BrokenBarrierError.
        barrier.wait()
        return {"reachable": True, "error": None}

    monkeypatch.setattr(audit, "check_availability", fake_avail)
    sites = [
        {"name": f"s{i}", "url": f"https://s{i}.example", "domain": f"s{i}.example"}
        for i in range(n)
    ]
    results = audit.run_scans(sites, ["availability"], authorized=False)
    assert len(results) == n


def test_engine_gate_bounds_concurrent_subprocesses(monkeypatch):
    """Core checks fan out per-site, but engine scanners must stay within the
    smaller engine-concurrency cap regardless of how many sites run at once."""
    import threading

    n = 20
    engine_cap = 3
    lock = threading.Lock()
    current = {"n": 0, "max": 0}

    monkeypatch.setattr(audit, "check_availability", lambda url, *a, **k: {"reachable": True})

    def fake_nuclei(url, *a, **k):
        with lock:
            current["n"] += 1
            current["max"] = max(current["max"], current["n"])
        time.sleep(0.02)
        with lock:
            current["n"] -= 1
        return {"engine": "nuclei", "findings": [], "installed": True, "error": None}

    monkeypatch.setattr(audit, "check_nuclei", fake_nuclei)
    sites = [
        {"name": f"s{i}", "url": f"https://s{i}.example", "domain": f"s{i}.example"}
        for i in range(n)
    ]
    audit.run_scans(sites, ["availability", "nuclei"], authorized=False,
                    engine_workers=engine_cap)
    assert current["max"] <= engine_cap


def test_engine_gate_disabled_when_none(monkeypatch):
    site = {"name": "x", "url": "https://x.example", "domain": "x.example"}
    monkeypatch.setattr(audit, "check_nuclei",
                        lambda url, *a, **k: {"engine": "nuclei", "findings": []})
    out = audit.scan_site(site, ["nuclei"], authorized=False, engine_gate=None)
    assert out["nuclei"]["engine"] == "nuclei"


def test_batch_timeout_marks_unfinished_sites(monkeypatch):
    def slow_or_fast(url, *a, **k):
        if "slow" in url:
            time.sleep(1.0)
        return {"reachable": True}

    monkeypatch.setattr(audit, "check_availability", slow_or_fast)
    sites = [
        {"name": "fast", "url": "https://fast.example", "domain": "fast.example"},
        {"name": "slow", "url": "https://slow.example", "domain": "slow.example"},
    ]
    results = audit.run_scans(sites, ["availability"], authorized=False,
                              max_workers=2, batch_timeout=0.2)
    by = {r["name"]: r for r in results}
    assert "timed out" in by["slow"].get("error", "")
    assert by["fast"].get("availability")  # fast site completed within budget


def test_run_audit_reports_uuid_duration_and_stats(monkeypatch):
    monkeypatch.setattr(audit, "check_availability", lambda url, *a, **k: {"reachable": True})
    out = audit.run_audit(
        sites=[{"name": "a", "url": "https://a.example", "domain": "a.example"}],
        enabled=["availability"], persist=False, generate_reports=False)
    assert isinstance(out["run_uuid"], str) and out["run_uuid"]
    assert out["duration_s"] >= 0
    assert out["stats"]["sites"] == 1
    assert out["stats"]["errors"] == 0


def _cve_site_scanner(url, *a, **k):
    # A single potential (version-based) CVE — a classic false-positive source.
    return {"url": url, "products": [{"product": "nginx", "version": "1.18.0"}],
            "vulnerabilities": {"nginx 1.18.0": [
                {"id": "CVE-2021-ZZZ", "cvss": 9.8, "severity": "critical",
                 "match": "cpe", "confidence": "potential"}]}, "error": None}


def test_run_audit_min_confidence_argument_drops_potential(monkeypatch):
    monkeypatch.setattr(audit, "check_cve", _cve_site_scanner)
    site = {"name": "a", "url": "https://a.example", "domain": "a.example"}
    out = audit.run_audit(sites=[site], enabled=["cve"], persist=False,
                          generate_reports=False, min_confidence="confirmed")
    codes = {f["code"] for f in out["scored"][0]["findings"]}
    assert "cve.known_vulnerable" not in codes
    assert out["min_confidence"] == "confirmed"


def test_run_audit_min_confidence_defaults_to_env(monkeypatch):
    monkeypatch.setattr(audit, "check_cve", _cve_site_scanner)
    monkeypatch.setenv("AUDIT_MIN_CONFIDENCE", "confirmed")
    site = {"name": "a", "url": "https://a.example", "domain": "a.example"}
    out = audit.run_audit(sites=[site], enabled=["cve"], persist=False,
                          generate_reports=False)
    assert out["min_confidence"] == "confirmed"
    assert "cve.known_vulnerable" not in {f["code"] for f in out["scored"][0]["findings"]}


def test_env_min_confidence_ignores_invalid(monkeypatch):
    monkeypatch.setenv("AUDIT_MIN_CONFIDENCE", "bogus")
    assert audit._env_min_confidence() is None
    monkeypatch.setenv("AUDIT_MIN_CONFIDENCE", "confirmed")
    assert audit._env_min_confidence() == "confirmed"
