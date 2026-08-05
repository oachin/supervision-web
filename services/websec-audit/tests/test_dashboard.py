"""Smoke tests for the FastAPI dashboard (uses the throwaway default DB)."""

import pytest
from fastapi.testclient import TestClient

from dashboard import app as app_module
from db.models import save_run


@pytest.fixture(scope="module")
def client():
    # Seed the default (temp) DB with two runs so trends have data.
    findings = [{
        "category": "misconfig", "severity": "high", "penalty": 25,
        "message": "Exposed .git", "code": "misconfig.exposed_path",
        "recommendation_en": "Remove it", "recommendation_fr": "Supprimez-le",
        "references": ["OWASP A05:2021"],
    }]
    base = {"name": "Demo", "url": "https://demo.example", "domain": "demo.example",
            "rubric_version": "1.2.0"}
    save_run([{**base, "score": 60, "grade": "D", "findings": findings}])
    save_run([{**base, "score": 72, "grade": "C", "findings": findings}])
    return TestClient(app_module.app)


def test_index_ok(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "Fleet overview" in r.text
    assert "Demo" in r.text


def test_site_page_ok(client):
    r = client.get("/site", params={"url": "https://demo.example"})
    assert r.status_code == 200
    assert "Findings" in r.text
    assert "OWASP A05:2021" in r.text        # framework reference rendered


def test_site_page_unknown(client):
    r = client.get("/site", params={"url": "https://missing.example"})
    assert r.status_code == 200
    assert "No data" in r.text


def test_scan_status_idle(client):
    r = client.get("/scan/status")
    assert r.status_code == 200
    assert "scan-status" in r.text


def test_scan_status_finished_triggers_full_refresh_once(client, monkeypatch):
    # A completed (polled) scan should tell HTMX to do a full page reload so the
    # Chart.js charts re-render — but only once. Subsequent polls must render
    # the card normally, so the page doesn't keep reloading and wiping any
    # in-progress input / scroll position.
    monkeypatch.setattr(app_module.manager, "_state", {
        "running": False, "started_at": "2020-01-01T00:00:00",
        "finished_at": "2020-01-01T00:01:00", "progress": "Completed",
        "last_run_id": 1, "error": None, "reload_pending": True,
        "sites": [], "done": 0, "total": 0,
    })
    r = client.get("/scan/status", params={"poll": 1})
    assert r.status_code == 204
    assert r.headers.get("HX-Refresh") == "true"

    # Second poll: reload already consumed, so no more full reloads.
    r2 = client.get("/scan/status", params={"poll": 1})
    assert r2.status_code == 200
    assert r2.headers.get("HX-Refresh") is None
    assert "scan-status" in r2.text


def test_scan_status_shows_per_site_progress(client, monkeypatch):
    # While a scan runs, the status card lists every site with its own live
    # status (queued / scanning + current check / done with score / error).
    monkeypatch.setattr(app_module.manager, "_state", {
        "running": True, "started_at": "2020-01-01T00:00:00", "finished_at": None,
        "progress": None, "last_run_id": None, "error": None, "trigger": "manual",
        "done": 1, "total": 3,
        "sites": [
            {"name": "Alpha", "url": "https://alpha.example", "status": "done",
             "check": None, "score": 82, "grade": "B", "findings": 3, "error": None,
             "checks_done": 6, "checks_total": 6, "percent": 100},
            {"name": "Bravo", "url": "https://bravo.example", "status": "scanning",
             "check": "tls", "score": None, "grade": None, "findings": None, "error": None,
             "checks_done": 1, "checks_total": 6, "percent": 16},
            {"name": "Charlie", "url": "https://charlie.example", "status": "queued",
             "check": None, "score": None, "grade": None, "findings": None, "error": None,
             "checks_done": 0, "checks_total": 0, "percent": 0},
        ],
    })
    r = client.get("/scan/status", params={"poll": 1})
    assert r.status_code == 200
    # Every site row is present.
    assert "Alpha" in r.text and "Bravo" in r.text and "Charlie" in r.text
    # Done site shows its grade + score; scanning site shows the current check.
    assert "82/100" in r.text
    assert "TLS/SSL" in r.text          # human label for the 'tls' check
    assert "1/3" in r.text              # done/total counter
    # Each site has its own progress bar (parallel), incl. the in-progress %.
    assert "width: 16%" in r.text
    assert "width: 100%" in r.text


def test_on_site_event_folds_progress_state():
    # The manager folds structured events into the per-site rows correctly.
    from dashboard.scan_manager import ScanManager
    mgr = ScanManager()
    mgr._state["sites"] = [
        {"name": "A", "url": "https://a.example", "status": "queued", "check": None,
         "score": None, "grade": None, "findings": None, "error": None,
         "checks_done": 0, "checks_total": 0, "percent": 0},
    ]
    mgr._state["total"] = 1
    mgr._on_site_event({"type": "site_start", "url": "https://a.example", "total": 4})
    assert mgr._state["sites"][0]["status"] == "scanning"
    assert mgr._state["sites"][0]["checks_total"] == 4
    mgr._on_site_event({"type": "check", "url": "https://a.example",
                        "check": "headers", "index": 3, "total": 4})
    assert mgr._state["sites"][0]["check"] == "headers"
    assert mgr._state["sites"][0]["percent"] == 50  # 2 of 4 checks finished
    mgr._on_site_event({"type": "site_done", "url": "https://a.example",
                        "score": 90, "grade": "A", "findings": 1})
    assert mgr._state["sites"][0]["status"] == "done"
    assert mgr._state["sites"][0]["score"] == 90
    assert mgr._state["sites"][0]["percent"] == 100
    assert mgr._state["done"] == 1


def test_trigger_scan_does_not_block(client, monkeypatch):
    # Don't launch a real network scan in tests.
    monkeypatch.setattr(app_module.manager, "start", lambda *a, **k: True)
    r = client.post("/scan")
    assert r.status_code == 200
    assert "scan-status" in r.text


def test_language_switch_french_via_query(client):
    # ?lang=fr renders the French UI and sets the lang cookie.
    c = TestClient(app_module.app)  # fresh cookie jar
    r = c.get("/?lang=fr")
    assert r.status_code == 200
    assert "Score moyen" in r.text              # French KPI label
    assert "Fleet overview" not in r.text       # English heading absent (one language only)
    assert r.cookies.get("lang") == "fr"


def test_language_defaults_to_english(client):
    c = TestClient(app_module.app)
    r = c.get("/")
    assert r.status_code == 200
    assert "Fleet overview" in r.text


def test_language_cookie_persists(client):
    c = TestClient(app_module.app)
    c.cookies.set("lang", "fr")
    r = c.get("/")
    assert "Score moyen" in r.text


def test_site_page_french_recommendation(client):
    c = TestClient(app_module.app)
    r = c.get("/site", params={"url": "https://demo.example", "lang": "fr"})
    assert r.status_code == 200
    assert "Supprimez-le" in r.text             # French recommendation shown
    assert "Remove it" not in r.text            # English recommendation hidden


def test_live_panel_present_on_index(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "Live status" in r.text
    assert "/live/status" in r.text          # auto-refresh target wired in


def test_live_status_endpoint_ok(client, monkeypatch):
    # Feed a known live snapshot so the partial renders deterministically.
    monkeypatch.setattr(app_module.live_monitor, "snapshot", lambda: [
        {"name": "LiveDemo", "url": "https://demo.example", "up": True,
         "status_code": 200, "response_time_ms": 12.0, "tls_verify_failed": False,
         "cert_days": 88, "error": None, "checked_at": "2020-01-01T00:00:00+00:00"},
    ])
    r = client.get("/live/status")
    assert r.status_code == 200
    assert "LiveDemo" in r.text
    assert "LIVE" in r.text


def test_live_status_french(client, monkeypatch):
    monkeypatch.setattr(app_module.live_monitor, "snapshot", lambda: [])
    c = TestClient(app_module.app)
    r = c.get("/live/status", params={"lang": "fr"})
    assert r.status_code == 200
    assert "EN DIRECT" in r.text


def test_site_rows_navigate_without_inline_onclick(client):
    # Row navigation must use data-href + a nonce'd listener, not an inline
    # onclick (which the strict CSP would block, breaking the click).
    r = client.get("/")
    assert r.status_code == 200
    assert 'class="site-row' in r.text
    assert "data-href=\"/site?url=" in r.text
    assert "onclick=" not in r.text
    # A nonce'd listener must actually wire the data-href, or clicks do nothing.
    assert "querySelectorAll('.site-row')" in r.text
    assert "dataset.href" in r.text


def test_global_report_pdf_link_present(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "/report/global?fmt=pdf" in r.text


def test_global_report_download(client):
    r = client.get("/report/global", params={"fmt": "html"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/html")


def test_global_report_pdf_download(client):
    r = client.get("/report/global", params={"fmt": "pdf"})
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"


def test_site_report_download(client):
    r = client.get("/report/site", params={"url": "https://demo.example", "fmt": "html"})
    assert r.status_code == 200


def test_dark_mode_toggle_present(client):
    r = client.get("/")
    assert r.status_code == 200
    assert 'id="themeToggle"' in r.text                 # toggle button rendered
    # In-place toggle logic now lives in the self-hosted app.js (CSP-friendly).
    assert "/static/js/app.js" in r.text
    assert "window.renderCharts()" in r.text            # chart init still on the page


def test_frontend_assets_self_hosted(client):
    # No runtime CDN dependency: Tailwind/htmx/Chart.js are served locally.
    r = client.get("/")
    assert r.status_code == 200
    assert "/static/css/app.css" in r.text
    assert "/static/vendor/htmx.min.js" in r.text
    assert "/static/vendor/chart.umd.min.js" in r.text
    assert "cdn.tailwindcss.com" not in r.text
    assert "unpkg.com" not in r.text
    assert "jsdelivr" not in r.text
    # The built stylesheet is actually served.
    css = client.get("/static/css/app.css")
    assert css.status_code == 200
    assert css.headers["content-type"].startswith("text/css")


@pytest.mark.parametrize("raw,expected", [
    ("", []),
    ("02:00", [(2, 0, 0)]),
    ("02:00,14:30", [(2, 0, 0), (14, 30, 0)]),
    (" 14:30 , 02:00 ", [(2, 0, 0), (14, 30, 0)]),     # trimmed + sorted
    ("02:00,02:00", [(2, 0, 0)]),                      # de-duplicated
    ("22:30:15", [(22, 30, 15)]),                      # optional seconds
    ("25:00,02:61,noon,02:00", [(2, 0, 0)]),           # invalid entries ignored
])
def test_parse_schedule_at(raw, expected):
    assert app_module._parse_schedule_at(raw) == expected


@pytest.mark.parametrize("raw,expected", [
    ("auto", 0), ("MAX", 0), ("  auto ", 0),
    ("25", 25), ("0", 0), ("garbage", 0),
])
def test_parse_workers(raw, expected):
    assert app_module._parse_workers(raw) == expected


def test_prune_after_run_is_off_by_default(monkeypatch):
    from dashboard import scan_manager

    monkeypatch.delenv("AUDIT_PRUNE_KEEP_RUNS", raising=False)
    monkeypatch.delenv("AUDIT_PRUNE_DAYS", raising=False)
    monkeypatch.setattr(scan_manager, "prune_history",
                        lambda **kw: pytest.fail("must not prune unless configured"))
    scan_manager._prune_after_run()


def test_prune_after_run_uses_env_and_never_raises(monkeypatch):
    from dashboard import scan_manager

    calls = []
    monkeypatch.setenv("AUDIT_PRUNE_KEEP_RUNS", "30")
    monkeypatch.setenv("AUDIT_PRUNE_DAYS", "90")
    monkeypatch.setattr(scan_manager, "prune_history",
                        lambda **kw: calls.append(kw) or 3)
    scan_manager._prune_after_run()
    assert calls == [{"keep_runs": 30, "older_than_days": 90}]

    # A pruning failure must never fail the scan that just succeeded.
    def _boom(**_kw):
        raise RuntimeError("db gone")

    monkeypatch.setattr(scan_manager, "prune_history", _boom)
    scan_manager._prune_after_run()
