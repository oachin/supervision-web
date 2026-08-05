"""
scoring/engine.py
Turns the raw scanner output (scan_results.json) into a per-site security
score, a letter grade, and a flat, de-duplicated list of findings.

Design philosophy
-----------------
* Every site starts at 100 and loses points per finding (penalty model).
  This is transparent and easy to defend: each deduction maps to one concrete,
  named weakness with a severity.
* Weights live in one place (RUBRIC below) and are VERSIONED. When you tune a
  weight, bump RUBRIC_VERSION so old reports remain interpretable.
* We score from the STRUCTURED fields, not by parsing the scanners' human
  `issues` strings — that avoids double-counting (e.g. tls.py emits one
  "chain validation failed" line per trust store; we collapse that to a single
  "certificate not trusted" finding).
* DKIM is treated as informational only (no penalty): our selector probing is
  best-effort and a miss does not prove DKIM is absent.
* An inconclusive result (DNS timeout, TLS scan error) is NEVER penalized as if
  it were a confirmed weakness — it is surfaced as an `info` finding instead.
* The same rule covers a scan blocked by an anti-bot/WAF interstitial: what was
  measured is the mitigation page, not the site, so the checks that depend on
  reaching the application score nothing and are reported inconclusive. Without
  this a correctly-configured site behind such a challenge grades F/0 purely
  because the scanner could not get in.

A finding is a dict: {category, severity, penalty, message, code, and the
remediation fields recommendation_en/recommendation_fr/references}.
Severity is one of: critical, high, medium, low, info  (info => penalty 0).
"""

from collections import defaultdict

from scoring.compliance import assess_compliance
from scoring.remediation import enrich_findings

RUBRIC_VERSION = "1.8.0"

# Grade buckets (score >= threshold => grade)
GRADE_BUCKETS = [
    (90, "A"),
    (80, "B"),
    (70, "C"),
    (60, "D"),
    (50, "E"),
    (0, "F"),
]

# Penalty weights, grouped by category. Documented so the rubric is defensible.
RUBRIC = {
    "availability": {
        "site_down": 50,            # server does not respond at all
    },
    "tls": {
        "cert_expired": 40,         # actively serving an expired certificate
        "cert_expiring_14d": 15,    # expires within 14 days
        "cert_expiring_30d": 8,     # expires within 30 days
        "cert_untrusted": 25,       # self-signed / chain does not validate
        "protocol_ssl": 20,         # SSLv2 / SSLv3 supported (per protocol)
        "protocol_tls_legacy": 10,  # TLS 1.0 / 1.1 supported (per protocol)
    },
    "headers": {
        "missing_high": 10,
        "missing_medium": 5,
        "missing_low": 2,
        "cookie_flag": 3,           # per missing cookie flag, capped below
        "cookie_cap": 9,            # max total cookie-flag penalty per site
        "hsts_short": 2,            # HSTS present but max-age is too short
    },
    "dns_auth": {
        "spf_missing": 10,
        "spf_permissive_all": 20,   # +all — anyone may send as this domain
        "spf_neutral_all": 8,       # ?all
        "dmarc_missing": 10,
        "dmarc_policy_none": 8,     # p=none — monitoring only, no enforcement
    },
    "misconfig": {
        "exposed_file_high": 25,    # per exposed high-severity path (e.g. .git, .env)
        "exposed_file_medium": 12,  # per exposed medium-severity path (e.g. phpinfo)
        "exposed_file_low": 4,      # per exposed low-severity path (e.g. .DS_Store)
        "directory_listing": 8,     # directory listing enabled at root
        "dangerous_method": 6,      # TRACE / TRACK enabled (per method)
        "tech_disclosure": 3,       # software/version banner leakage (capped)
        "tech_disclosure_cap": 6,   # max total banner-disclosure penalty per site
    },
    "takeover": {
        "vulnerable": 45,           # confirmed unclaimed third-party resource
        "dangling": 30,            # CNAME target is NXDOMAIN (claimable)
    },
    "cve": {
        # Penalty for running software with publicly known CVEs, by the CVSS
        # severity of the WORST CVE found for that product/version.
        "critical": 30,
        "high": 18,
        "medium": 8,
        "low": 3,
        "cap": 60,                  # max total CVE penalty per site
    },
    # --- external engine scanners (per finding, capped per engine) ---
    "testssl": {                    # deep TLS issues (testssl.sh)
        "critical": 25, "high": 15, "medium": 7, "low": 2, "cap": 45,
    },
    "nuclei": {                     # templated CVE/misconfig detections (nuclei)
        "critical": 30, "high": 18, "medium": 8, "low": 3, "cap": 60,
    },
    "zap": {                        # web-app passive findings (OWASP ZAP baseline)
        "critical": 20, "high": 15, "medium": 7, "low": 2, "cap": 40,
    },
}

# Protocols we treat as legacy/weak, and which weight bucket they map to.
_SSL_PROTOCOLS = {"ssl_2_0_cipher_suites", "ssl_3_0_cipher_suites"}
_LEGACY_TLS_PROTOCOLS = {"tls_1_0_cipher_suites", "tls_1_1_cipher_suites"}

# HSTS max-age below this (180 days, in seconds) is considered too short to be
# effective — a browser forgets the HTTPS-only policy well before the next scan.
_HSTS_MIN_MAX_AGE = 15_552_000


def _hsts_max_age(value: str) -> int | None:
    """Extracts the max-age (seconds) from a Strict-Transport-Security header."""
    for part in value.split(";"):
        part = part.strip().lower()
        if part.startswith("max-age"):
            _, _, raw = part.partition("=")
            try:
                return int(raw.strip().strip('"'))
            except ValueError:
                return None
    return None


def _finding(category: str, severity: str, penalty: int, message: str,
             code: str | None = None, confidence: str | None = None) -> dict:
    """Builds a normalised finding.

    ``confidence`` (``"confirmed"`` / ``"potential"`` / ``"low"`` / ``None``)
    lets a consumer distinguish an actively-verified detection from a
    version/banner-based indicator that may be a false positive.
    """
    return {"category": category, "severity": severity, "penalty": penalty,
            "message": message, "code": code, "confidence": confidence}


# Banner/version-based CVEs are only *potential*: the advertised version may be a
# distro-backported build that is already patched. A fuzzy (keyword) match is
# weaker still, so its penalty is discounted to avoid tanking a score on a guess.
_LOW_CONFIDENCE_PENALTY_FACTOR = 0.5

# Confidence ordering used for automatic noise reduction. A finding with no
# explicit confidence is a *directly observed fact* (an expired certificate, a
# missing header, a directory listing) — not a guess — so it ranks as the
# strongest tier alongside actively-verified engine detections.
_CONFIDENCE_RANK = {"low": 1, "potential": 2, "confirmed": 3}
_DIRECT_OBSERVATION_RANK = 3


def _confidence_rank(confidence: str | None) -> int:
    if confidence is None:
        return _DIRECT_OBSERVATION_RANK
    return _CONFIDENCE_RANK.get(confidence, _DIRECT_OBSERVATION_RANK)


def _is_exposed(finding: dict) -> bool:
    """Whether a finding reflects something exposed on the live external surface.

    A finding is "exposed" when it is directly observed (missing header, expired
    certificate — ``confidence`` None) or actively confirmed by an engine
    (``"confirmed"``). Version/banner-derived CVEs (``"potential"``/``"low"``)
    are *present* but not confirmed reachable/exploitable, so they are treated as
    not (yet) exposed: lower remediation priority, and no alert until they become
    exposed (i.e. actively confirmed).
    """
    return finding.get("confidence") in (None, "confirmed")


def _min_confidence_rank(min_confidence: str | None) -> int:
    """Rank threshold for a requested minimum confidence (0 = keep everything)."""
    if not min_confidence:
        return 0
    return _CONFIDENCE_RANK.get(min_confidence.lower(), 0)


def _filter_by_confidence(findings: list[dict], min_rank: int) -> list[dict]:
    """Drops penalising findings below ``min_rank`` confidence, automatically.

    This is the "confirmed-only"/noise-reduction gate: it removes low-confidence
    (fuzzy/version-based) findings so operators aren't buried in probable false
    positives — no human triage required. Informational (0-penalty) findings are
    always kept so coverage/inconclusive notices are never hidden.
    """
    if min_rank <= 0:
        return findings
    return [f for f in findings
            if f.get("penalty", 0) == 0
            or _confidence_rank(f.get("confidence")) >= min_rank]


def _score_availability(availability: dict) -> list[dict]:
    findings: list[dict] = []
    if not availability:
        return findings

    # Genuinely down: not reachable AND we have a connection-level error.
    # (A reachable site with only a bad cert is handled under TLS, not here.)
    if not availability.get("reachable") and availability.get("error"):
        findings.append(
            _finding(
                "availability", "critical",
                RUBRIC["availability"]["site_down"],
                f"Site is unreachable: {availability.get('error')}",
                code="availability.site_down",
            )
        )
    return findings


def _score_tls(tls: dict) -> list[dict]:
    findings: list[dict] = []
    if not tls:
        return findings

    if tls.get("error"):
        findings.append(_finding("tls", "info", 0, f"TLS scan inconclusive: {tls['error']}",
                                 code="tls.scan_error"))
        return findings

    days = tls.get("days_until_expiry")
    if days is not None:
        if days < 0:
            findings.append(_finding("tls", "critical", RUBRIC["tls"]["cert_expired"],
                                     f"Certificate expired {abs(days)} days ago",
                                     code="tls.cert_expired"))
        elif days < 14:
            findings.append(_finding("tls", "high", RUBRIC["tls"]["cert_expiring_14d"],
                                     f"Certificate expires in {days} days",
                                     code="tls.cert_expiring"))
        elif days < 30:
            findings.append(_finding("tls", "medium", RUBRIC["tls"]["cert_expiring_30d"],
                                     f"Certificate expires in {days} days",
                                     code="tls.cert_expiring"))

    # Collapse the per-trust-store chain-validation lines into ONE finding.
    if any("chain validation failed" in i.lower() for i in tls.get("issues", [])):
        findings.append(_finding("tls", "high", RUBRIC["tls"]["cert_untrusted"],
                                 "Certificate is not trusted (self-signed or broken chain)",
                                 code="tls.cert_untrusted"))

    for proto in tls.get("weak_protocols_supported", []):
        if proto in _SSL_PROTOCOLS:
            findings.append(_finding("tls", "high", RUBRIC["tls"]["protocol_ssl"],
                                     f"Obsolete protocol supported: {proto}",
                                     code="tls.protocol_ssl"))
        elif proto in _LEGACY_TLS_PROTOCOLS:
            findings.append(_finding("tls", "medium", RUBRIC["tls"]["protocol_tls_legacy"],
                                     f"Legacy protocol supported: {proto}",
                                     code="tls.protocol_tls_legacy"))
    return findings


def _blocked_finding(category: str, data: dict) -> dict:
    """Informational finding for a check that never reached the application."""
    kind = data.get("challenge_kind") or "unknown"
    return _finding(category, "info", 0,
                    f"{category} scan inconclusive: blocked by an anti-bot/WAF "
                    f"challenge ({kind}) — the application was never reached, so "
                    "this is NOT evidence of a weakness",
                    code=f"{category}.blocked_by_challenge")


def _score_headers(headers: dict) -> list[dict]:
    findings: list[dict] = []
    if not headers:
        return findings

    # Blocked by an interstitial: those are the challenge page's headers, not
    # the site's. Declaring them "missing" is the single biggest false-positive
    # source this scanner had.
    if headers.get("blocked_by_challenge"):
        return [_blocked_finding("headers", headers)]

    if headers.get("error") and not headers.get("present") and not headers.get("missing"):
        findings.append(_finding("headers", "info", 0,
                                 f"Header scan inconclusive: {headers['error']}",
                                 code="headers.scan_error"))
        return findings

    severity_weight = {
        "high": RUBRIC["headers"]["missing_high"],
        "medium": RUBRIC["headers"]["missing_medium"],
        "low": RUBRIC["headers"]["missing_low"],
    }
    for missing in headers.get("missing", []):
        sev = missing.get("severity", "low")
        header = missing.get("header", "")
        findings.append(_finding("headers", sev, severity_weight.get(sev, 2),
                                 f"Missing security header: {header}",
                                 code=f"headers.missing.{header.lower()}"))

    # HSTS present but with a weak (short) max-age: the policy expires between scans.
    hsts_value = headers.get("present", {}).get("Strict-Transport-Security")
    if hsts_value:
        max_age = _hsts_max_age(hsts_value)
        if max_age is not None and max_age < _HSTS_MIN_MAX_AGE:
            findings.append(_finding("headers", "low", RUBRIC["headers"]["hsts_short"],
                                     f"HSTS max-age is only {max_age}s (< 180 days) — "
                                     "too short to be effective", code="headers.hsts_short"))

    # Cookie-flag penalties are capped so one cookie-heavy site can't tank the score.
    cookie_issues = headers.get("cookie_issues", [])
    if cookie_issues:
        raw = len(cookie_issues) * RUBRIC["headers"]["cookie_flag"]
        capped = min(raw, RUBRIC["headers"]["cookie_cap"])
        findings.append(_finding("headers", "low", capped,
                                 f"{len(cookie_issues)} insecure cookie flag(s): "
                                 + "; ".join(cookie_issues), code="headers.cookie_flags"))
    return findings


def _score_dns_auth(dns_auth: dict) -> list[dict]:
    findings: list[dict] = []
    if not dns_auth:
        return findings

    spf = dns_auth.get("spf", {})
    if spf.get("error"):
        findings.append(_finding("dns_auth", "info", 0, f"SPF inconclusive: {spf['error']}",
                                 code="dns.scan_error"))
    elif not spf.get("present"):
        findings.append(_finding("dns_auth", "medium", RUBRIC["dns_auth"]["spf_missing"],
                                 "No SPF record — domain can be spoofed in email",
                                 code="dns.spf_missing"))
    else:
        record = (spf.get("record") or "").strip().lower()
        if record.endswith("+all"):
            findings.append(_finding("dns_auth", "high", RUBRIC["dns_auth"]["spf_permissive_all"],
                                     "SPF ends in '+all' — any server may send as this domain",
                                     code="dns.spf_permissive"))
        elif "?all" in record:
            findings.append(_finding("dns_auth", "low", RUBRIC["dns_auth"]["spf_neutral_all"],
                                     "SPF uses '?all' (neutral) — weak enforcement",
                                     code="dns.spf_neutral"))

    dmarc = dns_auth.get("dmarc", {})
    if dmarc.get("error"):
        findings.append(_finding("dns_auth", "info", 0, f"DMARC inconclusive: {dmarc['error']}",
                                 code="dns.scan_error"))
    elif not dmarc.get("present"):
        findings.append(_finding("dns_auth", "medium", RUBRIC["dns_auth"]["dmarc_missing"],
                                 "No DMARC record — no policy against spoofed mail",
                                 code="dns.dmarc_missing"))
    elif dmarc.get("policy") == "none":
        findings.append(_finding("dns_auth", "low", RUBRIC["dns_auth"]["dmarc_policy_none"],
                                 "DMARC policy is 'none' — monitoring only, no enforcement",
                                 code="dns.dmarc_policy_none"))

    # DKIM: informational only (see module docstring).
    dkim = dns_auth.get("dkim", {})
    if not dkim.get("present") and not dkim.get("errors"):
        findings.append(_finding("dns_auth", "info", 0,
                                 "DKIM not found on common selectors (verify selector with mail provider)",
                                 code="dns.dkim_missing"))

    # CAA: informational only — absence is common and low-risk, but worth noting
    # (only evaluated when the CAA check actually ran and was conclusive).
    caa = dns_auth.get("caa")
    if caa and not caa.get("error") and not caa.get("present"):
        findings.append(_finding("dns_auth", "info", 0,
                                 "No CAA record — any CA may issue certificates for this domain",
                                 code="dns.caa_missing"))
    return findings


def _score_takeover(takeover: dict) -> list[dict]:
    findings: list[dict] = []
    if not takeover:
        return findings

    # A DNS/HTTP error is inconclusive, not a confirmed "not vulnerable".
    if takeover.get("error"):
        findings.append(_finding("takeover", "info", 0,
                                 f"Subdomain-takeover check inconclusive: {takeover['error']}",
                                 code="takeover.scan_error"))
        return findings

    weight = RUBRIC["takeover"]
    service = takeover.get("service") or "third-party service"
    if takeover.get("vulnerable"):
        evidence = takeover.get("evidence")
        note = f" (fingerprint: {evidence})" if evidence else ""
        findings.append(_finding("takeover", "critical", weight["vulnerable"],
                                 f"Subdomain takeover possible: unclaimed {service} resource{note}",
                                 code="takeover.vulnerable", confidence="confirmed"))
    elif takeover.get("dangling"):
        chain = takeover.get("cname_chain") or []
        target = chain[-1] if chain else "its CNAME target"
        findings.append(_finding("takeover", "high", weight["dangling"],
                                 f"Dangling DNS: CNAME points to non-existent '{target}' "
                                 "(NXDOMAIN) — subdomain-takeover risk",
                                 code="takeover.dangling", confidence="confirmed"))
    elif takeover.get("service"):
        # Points at a takeover-prone service but the resource looks claimed:
        # worth surfacing for review, not a penalty.
        findings.append(_finding("takeover", "info", 0,
                                 f"Points to third-party service {service} — "
                                 "verify the backing resource is claimed",
                                 code="takeover.third_party", confidence="potential"))
    return findings


def _score_misconfig(misconfig: dict) -> list[dict]:
    findings: list[dict] = []
    if not misconfig:
        return findings

    if misconfig.get("blocked_by_challenge"):
        return [_blocked_finding("misconfig", misconfig)]

    # A base-request failure is inconclusive, not a confirmed weakness.
    if misconfig.get("error"):
        findings.append(_finding("misconfig", "info", 0,
                                 f"Misconfiguration scan inconclusive: {misconfig['error']}",
                                 code="misconfig.scan_error"))
        return findings

    weight = RUBRIC["misconfig"]
    exposed_weight = {
        "high": weight["exposed_file_high"],
        "medium": weight["exposed_file_medium"],
        "low": weight["exposed_file_low"],
    }
    for exposed in misconfig.get("exposed_paths", []):
        sev = exposed.get("severity", "medium")
        findings.append(_finding("misconfig", sev, exposed_weight.get(sev, 12),
                                 f"Exposed sensitive path {exposed.get('path')}: "
                                 f"{exposed.get('description')}", code="misconfig.exposed_path"))

    if misconfig.get("directory_listing"):
        findings.append(_finding("misconfig", "medium", weight["directory_listing"],
                                 "Directory listing enabled at the site root",
                                 code="misconfig.directory_listing"))

    for method in misconfig.get("dangerous_methods", []):
        findings.append(_finding("misconfig", "medium", weight["dangerous_method"],
                                 f"Dangerous HTTP method enabled: {method}",
                                 code="misconfig.dangerous_method"))

    # Banner disclosure is low-risk on its own; penalise it lightly and cap it.
    disclosures = misconfig.get("tech_disclosure", [])
    if disclosures:
        raw = len(disclosures) * weight["tech_disclosure"]
        capped = min(raw, weight["tech_disclosure_cap"])
        findings.append(_finding("misconfig", "low", capped,
                                 f"Software/version disclosure ({len(disclosures)}): "
                                 + "; ".join(disclosures), code="misconfig.tech_disclosure"))

    # A server that answers 200 to paths that cannot exist gives no signal on
    # content discovery; say so rather than letting silence read as "clean".
    if misconfig.get("soft_404"):
        findings.append(_finding("misconfig", "info", 0,
                                 "Server answers 200 to non-existent paths (soft-404 / "
                                 "catch-all) — sensitive-path probing is inconclusive here",
                                 code="misconfig.soft_404"))

    # security.txt is a best-practice nicety, not a vulnerability -> informational.
    if not misconfig.get("security_txt"):
        findings.append(_finding("misconfig", "info", 0,
                                 "No security.txt (RFC 9116) — no documented security contact",
                                 code="misconfig.security_txt"))
    return findings


def _score_cve(cve: dict) -> list[dict]:
    findings: list[dict] = []
    if not cve:
        return findings

    if cve.get("blocked_by_challenge"):
        return [_blocked_finding("cve", cve)]

    # A failed lookup is inconclusive, not a confirmed weakness.
    if cve.get("error"):
        findings.append(_finding("cve", "info", 0,
                                 f"CVE lookup inconclusive: {cve['error']}",
                                 code="cve.scan_error"))
        return findings

    weight = RUBRIC["cve"]
    running_total = 0
    # One finding per vulnerable product/version, weighted by its worst CVE.
    for label, vulns in (cve.get("vulnerabilities") or {}).items():
        if not vulns:
            continue
        worst = vulns[0]  # sorted worst-first (KEV/EPSS-aware when enriched)
        sev = worst.get("severity", "medium")
        # Threat-intel prioritisation (free KEV/EPSS enrichment, when present):
        # a CVE CISA lists as actively exploited (KEV) is escalated to critical
        # regardless of CVSS band — it is the strongest "fix first" signal.
        kev = any(v.get("kev") for v in vulns)
        worst_epss = max((v.get("epss") or 0.0) for v in vulns)
        eff_sev = "critical" if kev else sev
        penalty = weight.get(eff_sev, weight["medium"])
        # Confidence: a precise CPE version match is "potential"; a fuzzy keyword
        # match is "low" and gets a discounted penalty (it may not even apply).
        # Missing match info is treated as a precise (potential) match.
        is_low = worst.get("confidence") == "low" or worst.get("match") == "keyword"
        confidence = "low" if is_low else "potential"
        if is_low:
            penalty = int(round(penalty * _LOW_CONFIDENCE_PENALTY_FACTOR))
        penalty = max(0, min(penalty, weight["cap"] - running_total))
        running_total += penalty
        top_ids = ", ".join(v["id"] for v in vulns[:5])
        # Always frame banner-derived CVEs as potential (version may be patched);
        # a keyword (fuzzy) match is flagged more strongly as needing verification.
        note = (" [keyword match — verify applicability]" if is_low
                else " [version-based — verify the build is not already patched]")
        intel = ""
        if kev:
            intel += " [KEV: actively exploited]"
        if worst_epss > 0:
            intel += f" [EPSS {worst_epss:.0%}]"
        finding = _finding(
            "cve", eff_sev if eff_sev in ("critical", "high", "medium", "low") else "medium",
            penalty,
            f"Potentially outdated {label}: {len(vulns)} known CVE(s), worst "
            f"{worst['id']} (CVSS {worst['cvss']}, {sev}). Top: {top_ids}{note}{intel}",
            code="cve.known_vulnerable", confidence=confidence)
        # Carry the concrete CVE ids so each becomes a clickable NVD link.
        finding["cve_ids"] = [v["id"] for v in vulns[:5]]
        if kev:
            finding["kev"] = True
        if worst_epss > 0:
            finding["epss"] = worst_epss
        findings.append(finding)
        if running_total >= weight["cap"]:
            break
    return findings


def _score_engine(result: dict, category: str) -> list[dict]:
    """Scores the normalised output of an external-engine scanner (testssl /
    nuclei / zap). Findings are aggregated per severity band (one finding each)
    so a noisy engine can't flood the report, and the total is capped per engine.

    A missing binary or engine error with no findings is surfaced as an
    informational (0-penalty) result — never penalised like a confirmed weakness.
    """
    findings: list[dict] = []
    if not result:
        return findings

    engine = result.get("engine", category)
    items = result.get("findings") or []
    if not items:
        if result.get("error"):
            findings.append(_finding(category, "info", 0,
                                     f"{engine} scan inconclusive: {result['error']}",
                                     code=f"{category}.scan_error"))
        return findings

    weight = RUBRIC[category]
    buckets: dict[str, list] = defaultdict(list)
    for item in items:
        sev = item.get("severity")
        if sev in ("critical", "high", "medium", "low"):
            buckets[sev].append(item)

    running_total = 0
    for sev in ("critical", "high", "medium", "low"):
        group = buckets.get(sev)
        if not group:
            continue
        per = weight.get(sev, weight.get("medium", 5))
        penalty = max(0, min(per * len(group), weight["cap"] - running_total))
        running_total += penalty
        names = ", ".join(dict.fromkeys(g.get("name", "") for g in group[:5] if g.get("name")))
        more = " …" if len(group) > 5 else ""
        findings.append(_finding(category, sev, penalty,
                                 f"{engine}: {len(group)} {sev} finding(s) — {names}{more}",
                                 code=f"{category}.finding", confidence="confirmed"))
        if running_total >= weight["cap"]:
            break
    return findings


# Every check the tool can run, in report order. Used to build the coverage map
# so a check that did not run (or was inconclusive) is never read as "clean".
_SCANNER_KEYS = ["availability", "tls", "headers", "dns_auth", "takeover",
                 "misconfig", "cve", "testssl", "nuclei", "zap", "ports"]
_ENGINE_KEYS = {"testssl", "nuclei", "zap"}


def _scanner_status(key: str, data: dict) -> str:
    """Classifies one scanner's result as 'ran', 'inconclusive' or 'not_run'.

    'not_run'      -> the scanner was not part of this scan (key absent/empty).
    'inconclusive' -> it was attempted but produced no usable result (engine not
                      installed, timeout, network/scan error) — NOT a clean bill.
    'ran'          -> it completed and its findings (if any) are authoritative.
    """
    if not data:
        return "not_run"
    if key in _ENGINE_KEYS:
        if data.get("installed") is False or (data.get("error") and not data.get("findings")):
            return "inconclusive"
        return "ran"
    # A check that only saw an anti-bot interstitial measured the mitigation
    # layer, not the target: inconclusive, never a clean bill.
    if data.get("blocked_by_challenge") and key != "availability":
        return "inconclusive"
    if key in ("tls", "takeover", "misconfig", "cve", "ports") and data.get("error"):
        return "inconclusive"
    # availability / headers / dns_auth complete even when they carry sub-errors.
    return "ran"


def _coverage(site: dict) -> dict[str, str]:
    """Per-scanner coverage map for a site (see _scanner_status)."""
    return {key: _scanner_status(key, site.get(key) or {}) for key in _SCANNER_KEYS}


def _grade_for(score: int) -> str:
    for threshold, grade in GRADE_BUCKETS:
        if score >= threshold:
            return grade
    return "F"


def score_site(site: dict, min_confidence: str | None = None) -> dict:
    """Scores a single site's combined scanner result.

    ``min_confidence`` (``"low"`` / ``"potential"`` / ``"confirmed"``) enables
    automatic noise reduction: penalising findings below that confidence tier are
    dropped before scoring, so probable false positives never reach the score,
    report or alert without any manual triage. ``None`` keeps every finding
    (default). ``"confirmed"`` yields the strictest "confirmed-only" view.
    """
    findings: list[dict] = []
    findings += _score_availability(site.get("availability", {}))
    findings += _score_tls(site.get("tls", {}))
    findings += _score_headers(site.get("headers", {}))
    findings += _score_dns_auth(site.get("dns_auth", {}))
    findings += _score_takeover(site.get("takeover", {}))
    findings += _score_misconfig(site.get("misconfig", {}))
    findings += _score_cve(site.get("cve", {}))
    findings += _score_engine(site.get("testssl", {}), "testssl")
    findings += _score_engine(site.get("nuclei", {}), "nuclei")
    findings += _score_engine(site.get("zap", {}), "zap")

    min_rank = _min_confidence_rank(min_confidence)
    if min_rank > 0:
        findings = _filter_by_confidence(findings, min_rank)

    total_penalty = sum(f["penalty"] for f in findings)
    score = max(0, 100 - total_penalty)

    for f in findings:
        f["exposed"] = _is_exposed(f)

    severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
    findings.sort(key=lambda f: (severity_order.get(f["severity"], 99), -f["penalty"]))
    enrich_findings(findings)

    coverage = _coverage(site)
    return {
        "name": site.get("name"),
        "url": site.get("url"),
        "domain": site.get("domain"),
        "score": score,
        "grade": _grade_for(score),
        "total_penalty": total_penalty,
        "findings": findings,
        "coverage": coverage,
        "compliance": assess_compliance(findings, coverage),
        "rubric_version": RUBRIC_VERSION,
    }


def score_all(results: list[dict], min_confidence: str | None = None) -> list[dict]:
    """Scores every site in a scan_results list.

    ``min_confidence`` propagates to :func:`score_site` to enable automatic
    low-confidence noise reduction fleet-wide (see :func:`score_site`).
    """
    return [score_site(site, min_confidence=min_confidence) for site in results]


if __name__ == "__main__":
    import json
    from pathlib import Path

    raw = json.loads(Path("scan_results.json").read_text())
    scored = score_all(raw)

    print(f"Rubric version: {RUBRIC_VERSION}\n")
    for s in scored:
        print(f"{s['grade']}  {s['score']:>3}/100  {s['name']} ({s['url']})")
        for f in s["findings"]:
            tag = f"[{f['severity']}]"
            pts = f"-{f['penalty']}" if f["penalty"] else "  "
            print(f"        {tag:<10} {pts:>4}  {f['message']}")
        cov = s.get("coverage", {})
        inconclusive = [k for k, v in cov.items() if v == "inconclusive"]
        if inconclusive:
            print(f"        (!) inconclusive (NOT verified as clean): {', '.join(inconclusive)}")
        print()

    out = Path("scored_results.json")
    out.write_text(json.dumps(scored, indent=2))
    print(f"Scored results saved to {out.resolve()}")
