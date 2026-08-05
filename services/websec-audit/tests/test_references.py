"""Tests for clickable reference links attached to findings."""

from scoring.engine import score_site
from scoring.remediation import enrich_findings, reference_url


def test_reference_url_resolves_known_tag_families():
    assert reference_url("OWASP A02:2021") == \
        "https://owasp.org/Top10/A02_2021-Cryptographic_Failures/"
    assert reference_url("CWE-319") == \
        "https://cwe.mitre.org/data/definitions/319.html"
    assert reference_url("MITRE T1557") == \
        "https://attack.mitre.org/techniques/T1557/"
    assert reference_url("MITRE T1566.002") == \
        "https://attack.mitre.org/techniques/T1566/002/"
    assert reference_url("RFC 7208") == "https://www.rfc-editor.org/rfc/rfc7208"
    assert reference_url("CVE-2021-44228") == \
        "https://nvd.nist.gov/vuln/detail/CVE-2021-44228"
    assert reference_url("OWASP Secure Headers") == \
        "https://owasp.org/www-project-secure-headers/"


def test_reference_url_unknown_tag_returns_none():
    assert reference_url("Some Internal Policy") is None
    assert reference_url("") is None


def test_enrich_adds_clickable_reference_links():
    findings = [{"category": "tls", "severity": "critical", "penalty": 40,
                 "message": "expired", "code": "tls.cert_expired"}]
    enrich_findings(findings)
    links = findings[0]["reference_links"]
    # Every framework tag becomes a {label, url} object.
    labels = {link["label"] for link in links}
    assert "OWASP A02:2021" in labels
    for link in links:
        assert link["url"] and link["url"].startswith("https://")


def test_cve_finding_links_each_cve_to_nvd():
    site = {
        "name": "x", "url": "https://x", "domain": "x",
        "cve": {"vulnerabilities": {"nginx 1.0": [
            {"id": "CVE-2019-0001", "cvss": 9.8, "severity": "critical",
             "match": "cpe"},
            {"id": "CVE-2019-0002", "cvss": 7.5, "severity": "high",
             "match": "cpe"},
        ]}},
    }
    scored = score_site(site)
    cve_finding = next(f for f in scored["findings"] if f["code"] == "cve.known_vulnerable")
    urls = {link["label"]: link["url"] for link in cve_finding["reference_links"]}
    assert urls["CVE-2019-0001"] == "https://nvd.nist.gov/vuln/detail/CVE-2019-0001"
    assert urls["CVE-2019-0002"] == "https://nvd.nist.gov/vuln/detail/CVE-2019-0002"
