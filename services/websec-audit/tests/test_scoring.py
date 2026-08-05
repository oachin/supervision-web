"""Tests for the scoring engine (pure functions, no network)."""

from scoring.engine import score_site, score_all, _grade_for, RUBRIC, _coverage


def test_coverage_marks_run_inconclusive_and_not_run():
    site = {
        "availability": {"reachable": True},        # ran
        "cve": {"error": "NVD timeout"},             # attempted, failed -> inconclusive
        "testssl": {"installed": False},             # engine missing -> inconclusive
        "nuclei": {"installed": True, "findings": []},  # ran, no findings
        # zap / ports / tls / headers / dns_auth / misconfig absent -> not_run
    }
    cov = _coverage(site)
    assert cov["availability"] == "ran"
    assert cov["cve"] == "inconclusive"
    assert cov["testssl"] == "inconclusive"
    assert cov["nuclei"] == "ran"
    assert cov["zap"] == "not_run"
    assert cov["tls"] == "not_run"


def test_score_site_includes_coverage():
    scored = score_site({"name": "x", "url": "https://x", "domain": "x",
                         "availability": {"reachable": True}})
    assert "coverage" in scored
    assert scored["coverage"]["ports"] == "not_run"


def test_clean_site_scores_100_and_grade_a():
    site = {
        "name": "Clean",
        "url": "https://clean.example",
        "domain": "clean.example",
        "availability": {"reachable": True, "error": None},
        "tls": {"days_until_expiry": 400, "weak_protocols_supported": [], "issues": []},
        "headers": {
            "present": {"Strict-Transport-Security": "max-age=63072000"},
            "missing": [],
            "cookie_issues": [],
        },
        "dns_auth": {
            "spf": {"present": True, "record": "v=spf1 -all"},
            "dmarc": {"present": True, "policy": "reject"},
            "dkim": {"present": True, "errors": []},
        },
        "misconfig": {
            "exposed_paths": [], "directory_listing": False,
            "dangerous_methods": [], "tech_disclosure": [], "security_txt": True,
        },
    }
    scored = score_site(site)
    assert scored["score"] == 100
    assert scored["grade"] == "A"
    assert scored["total_penalty"] == 0


def test_unreachable_site_is_penalised():
    site = {
        "name": "Down", "url": "http://down.example", "domain": "down.example",
        "availability": {"reachable": False, "error": "Connection refused"},
    }
    scored = score_site(site)
    assert scored["total_penalty"] == RUBRIC["availability"]["site_down"]
    assert any(f["severity"] == "critical" for f in scored["findings"])


def test_expired_cert_is_critical():
    site = {"name": "X", "url": "https://x", "domain": "x",
            "tls": {"days_until_expiry": -3, "weak_protocols_supported": [], "issues": []}}
    scored = score_site(site)
    findings = scored["findings"]
    assert any("expired" in f["message"].lower() and f["severity"] == "critical" for f in findings)
    assert scored["total_penalty"] == RUBRIC["tls"]["cert_expired"]


def test_exposed_git_repo_scored_high():
    site = {
        "name": "Leaky", "url": "https://leaky", "domain": "leaky",
        "misconfig": {
            "exposed_paths": [{"path": "/.git/HEAD", "status": 200,
                               "severity": "high", "description": "Exposed .git"}],
            "directory_listing": False, "dangerous_methods": [],
            "tech_disclosure": [], "security_txt": True,
        },
    }
    scored = score_site(site)
    assert any(f["category"] == "misconfig" and f["severity"] == "high" for f in scored["findings"])
    assert scored["total_penalty"] == RUBRIC["misconfig"]["exposed_file_high"]


def test_tech_disclosure_penalty_is_capped():
    site = {
        "name": "Chatty", "url": "https://chatty", "domain": "chatty",
        "misconfig": {
            "exposed_paths": [], "directory_listing": False, "dangerous_methods": [],
            "tech_disclosure": ["Server: a", "X-Powered-By: b", "X-Runtime: c", "X-Generator: d"],
            "security_txt": True,
        },
    }
    scored = score_site(site)
    misconfig_penalty = sum(f["penalty"] for f in scored["findings"] if f["category"] == "misconfig")
    assert misconfig_penalty == RUBRIC["misconfig"]["tech_disclosure_cap"]


def test_info_findings_carry_no_penalty():
    site = {"name": "I", "url": "https://i", "domain": "i",
            "tls": {"error": "scan timed out"}}
    scored = score_site(site)
    assert scored["total_penalty"] == 0
    assert all(f["penalty"] == 0 for f in scored["findings"])


def test_score_is_floored_at_zero():
    site = {
        "name": "Terrible", "url": "https://bad", "domain": "bad",
        "availability": {"reachable": False, "error": "down"},
        "tls": {"days_until_expiry": -10,
                "weak_protocols_supported": ["ssl_2_0_cipher_suites", "ssl_3_0_cipher_suites"],
                "issues": ["chain validation failed against Mozilla"]},
        "misconfig": {
            "exposed_paths": [{"path": "/.env", "status": 200, "severity": "high", "description": "x"},
                              {"path": "/.git/HEAD", "status": 200, "severity": "high", "description": "y"}],
            "directory_listing": True, "dangerous_methods": ["TRACE"],
            "tech_disclosure": ["Server: nginx"], "security_txt": False,
        },
    }
    scored = score_site(site)
    assert scored["score"] == 0
    assert scored["grade"] == "F"


def test_short_hsts_max_age_is_penalised():
    site = {
        "name": "ShortHSTS", "url": "https://h", "domain": "h",
        "headers": {
            "present": {"Strict-Transport-Security": "max-age=3600"},
            "missing": [], "cookie_issues": [],
        },
    }
    scored = score_site(site)
    assert any(f["code"] == "headers.hsts_short" for f in scored["findings"])
    assert scored["total_penalty"] == RUBRIC["headers"]["hsts_short"]


def test_long_hsts_max_age_is_clean():
    site = {
        "name": "LongHSTS", "url": "https://h", "domain": "h",
        "headers": {
            "present": {"Strict-Transport-Security": "max-age=63072000; includeSubDomains"},
            "missing": [], "cookie_issues": [],
        },
    }
    scored = score_site(site)
    assert not any(f["code"] == "headers.hsts_short" for f in scored["findings"])


def test_missing_caa_is_informational():
    site = {
        "name": "NoCAA", "url": "https://c", "domain": "c",
        "dns_auth": {
            "spf": {"present": True, "record": "v=spf1 -all"},
            "dmarc": {"present": True, "policy": "reject"},
            "dkim": {"present": True, "errors": []},
            "caa": {"present": False, "records": [], "error": None},
        },
    }
    scored = score_site(site)
    caa_findings = [f for f in scored["findings"] if f["code"] == "dns.caa_missing"]
    assert caa_findings and caa_findings[0]["severity"] == "info"
    assert scored["total_penalty"] == 0


def test_grade_buckets():
    assert _grade_for(95) == "A"
    assert _grade_for(85) == "B"
    assert _grade_for(75) == "C"
    assert _grade_for(65) == "D"
    assert _grade_for(55) == "E"
    assert _grade_for(10) == "F"


def test_score_all_returns_one_entry_per_site():
    results = [
        {"name": "a", "url": "https://a", "domain": "a"},
        {"name": "b", "url": "https://b", "domain": "b"},
    ]
    assert len(score_all(results)) == 2


# --- automatic false-positive reduction (min_confidence gate) ---

def _mixed_confidence_site() -> dict:
    """A site with one confirmed (nuclei), one potential (CPE CVE), one low
    (keyword CVE) and one direct-observation (missing header) finding."""
    return {
        "name": "Mixed", "url": "https://mixed", "domain": "mixed",
        "headers": {  # direct observation -> confidence None
            "present": {}, "cookie_issues": [],
            "missing": [{"header": "Content-Security-Policy", "severity": "high"}],
        },
        "cve": {
            "vulnerabilities": {
                "nginx 1.18.0": [{"id": "CVE-2021-AAA", "cvss": 9.8, "severity": "critical",
                                  "match": "cpe", "confidence": "potential"}],
                "acme 1.0": [{"id": "CVE-2021-BBB", "cvss": 7.5, "severity": "high",
                              "match": "keyword", "confidence": "low"}],
            },
        },
        "nuclei": {"engine": "nuclei",
                   "findings": [{"severity": "high", "name": "exposed-panel"}]},
    }


def _codes(scored: dict) -> set[str]:
    return {f["code"] for f in scored["findings"]}


def test_min_confidence_none_keeps_all_findings():
    scored = score_site(_mixed_confidence_site())
    confidences = {f.get("confidence") for f in scored["findings"] if f["penalty"]}
    # confirmed (nuclei), potential (cpe cve), low (keyword cve), and the
    # direct-observation missing header (None) are all present.
    assert {"confirmed", "potential", "low"} <= confidences


def test_min_confidence_potential_drops_low_keyword_cve():
    scored = score_site(_mixed_confidence_site(), min_confidence="potential")
    penalising = [f for f in scored["findings"] if f["penalty"]]
    assert all(f.get("confidence") != "low" for f in penalising)
    # the potential CPE CVE and confirmed nuclei finding survive
    assert "cve.known_vulnerable" in _codes(scored)
    assert "nuclei.finding" in _codes(scored)


def test_min_confidence_confirmed_only_keeps_confirmed_and_direct_observations():
    scored = score_site(_mixed_confidence_site(), min_confidence="confirmed")
    penalising = [f for f in scored["findings"] if f["penalty"]]
    # potential + low CVEs are gone; confirmed engine finding and the directly
    # observed missing header (confidence None) remain.
    assert "cve.known_vulnerable" not in _codes(scored)
    assert "nuclei.finding" in _codes(scored)
    assert any(f["code"] == "headers.missing.content-security-policy" for f in penalising)


def test_min_confidence_confirmed_raises_score_by_dropping_false_positives():
    site = _mixed_confidence_site()
    full = score_site(site)
    confirmed = score_site(site, min_confidence="confirmed")
    # Dropping low/potential findings can only remove penalties -> score >= full.
    assert confirmed["score"] >= full["score"]


def test_score_all_propagates_min_confidence():
    results = [_mixed_confidence_site()]
    scored = score_all(results, min_confidence="confirmed")[0]
    assert "cve.known_vulnerable" not in {f["code"] for f in scored["findings"]}


def test_min_confidence_never_hides_informational_coverage_notes():
    site = {"name": "I", "url": "https://i", "domain": "i",
            "tls": {"error": "scan timed out"}}  # -> info finding, confidence None
    scored = score_site(site, min_confidence="confirmed")
    assert any(f["code"] == "tls.scan_error" for f in scored["findings"])


def test_confirmed_subdomain_takeover_is_critical_and_penalised():
    site = {"name": "T", "url": "https://t.example", "domain": "t.example",
            "takeover": {"vulnerable": True, "service": "GitHub Pages",
                         "evidence": "There isn't a GitHub Pages site here.",
                         "cname_chain": ["victim.github.io"], "error": None}}
    scored = score_site(site)
    f = next(f for f in scored["findings"] if f["code"] == "takeover.vulnerable")
    assert f["severity"] == "critical"
    assert f["penalty"] == RUBRIC["takeover"]["vulnerable"]
    assert f["confidence"] == "confirmed"
    assert scored["score"] == 100 - RUBRIC["takeover"]["vulnerable"]


def test_dangling_dns_is_high_severity():
    site = {"name": "D", "url": "https://d.example", "domain": "d.example",
            "takeover": {"dangling": True, "cname_chain": ["gone.herokudns.com"],
                         "error": None}}
    scored = score_site(site)
    f = next(f for f in scored["findings"] if f["code"] == "takeover.dangling")
    assert f["severity"] == "high"
    assert f["penalty"] == RUBRIC["takeover"]["dangling"]


def test_third_party_takeover_hint_is_informational():
    site = {"name": "I", "url": "https://i.example", "domain": "i.example",
            "takeover": {"service": "Shopify", "cname_chain": ["s.myshopify.com"],
                         "error": None}}
    scored = score_site(site)
    f = next(f for f in scored["findings"] if f["code"] == "takeover.third_party")
    assert f["penalty"] == 0
    assert scored["score"] == 100


def test_takeover_error_is_inconclusive_not_clean():
    site = {"name": "E", "url": "https://e.example", "domain": "e.example",
            "takeover": {"error": "DNS timeout"}}
    scored = score_site(site)
    assert scored["coverage"]["takeover"] == "inconclusive"
    assert any(f["code"] == "takeover.scan_error" for f in scored["findings"])
