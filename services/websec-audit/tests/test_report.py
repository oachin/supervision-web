"""Tests for HTML report rendering (no PDF / native deps required)."""

from reports.generator import _prioritized, render_html, render_site_html


def _scored(**over):
    base = {
        "name": "Example", "url": "https://example.com", "domain": "example.com",
        "score": 72, "grade": "C", "rubric_version": "1.1.0",
        "findings": [
            {"category": "tls", "severity": "high", "penalty": 25,
             "message": "Certificate is not trusted",
             "recommendation_en": "Serve a trusted certificate.",
             "recommendation_fr": "Servez un certificat de confiance.",
             "references": ["OWASP A02:2021"]},
            {"category": "headers", "severity": "medium", "penalty": 5,
             "message": "Missing security header: X-Frame-Options"},
        ],
    }
    base.update(over)
    return base


def test_render_html_contains_site_and_grade():
    html = render_html([_scored()])
    assert "Example" in html
    assert "72" in html
    assert "Certificate is not trusted" in html


def test_render_html_renders_selected_language_only():
    en = render_html([_scored()], lang="en")
    fr = render_html([_scored()], lang="fr")
    assert "Executive summary" in en
    assert "Synthèse" not in en
    assert "Synthèse" in fr
    assert "Executive summary" not in fr


def test_render_html_shows_before_after_when_history_present():
    site = _scored(history=[
        {"run_id": 1, "started_at": "2026-01-01T00:00:00", "score": 60, "grade": "D"},
        {"run_id": 2, "started_at": "2026-02-01T00:00:00", "score": 72, "grade": "C"},
    ])
    html = render_html([site])
    assert "+12" in html  # before/after improvement delta rendered


def test_render_html_handles_no_findings():
    html = render_html([_scored(findings=[])])
    assert "all checks passed" in html.lower()


def test_render_html_is_confidential_and_honest():
    html = render_html([_scored()])
    assert "CONFIDENTIAL" in html
    # It must not imply fixes were applied — external black-box framing only.
    assert "external" in html.lower()


def test_site_report_shows_remediation_status():
    site = _scored()
    site["findings"][0]["status"] = "fixed"
    html = render_site_html(site, lang="en")
    assert "Fixed" in html
    assert "maintained by your team" in html


def test_site_residual_excludes_fixed_findings():
    site = _scored()
    site["findings"][0]["status"] = "fixed"  # the only high-severity finding
    residual = _prioritized(site["findings"])
    residual_msgs = {
        f["message"] for bucket in residual for f in bucket["findings"]
    }
    assert "Certificate is not trusted" not in residual_msgs
    assert "Missing security header: X-Frame-Options" in residual_msgs
