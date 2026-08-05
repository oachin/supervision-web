"""
scoring/compliance.py
Maps the tool's externally-observable technical findings to the official
information-security governance frameworks of **France** and **Morocco**, and
produces a per-site, per-country compliance view.

Scope & honesty
---------------
This is a **technical, external** compliance mapping: it evaluates only what a
black-box external scan can observe (TLS posture, HTTP security headers, cookie
flags, e-mail anti-spoofing DNS records, information exposure, known CVEs,
availability). It is a strong, defensible indicator of alignment with the
technical recommendations of each framework — **not** a legal certification and
**not** a substitute for the organisational/documentary requirements those
frameworks also impose (risk analysis, governance, incident response, audits…).

Frameworks referenced
---------------------
France (FR):
* **ANSSI** — Guide d'hygiène informatique + "Recommandations de sécurité
  relatives à TLS".
* **RGS** — Référentiel Général de Sécurité.
* **RGPD / CNIL** — sécurité des données personnelles (chiffrement des flux,
  cookies, minimisation de l'exposition).

Morocco (MA):
* **DGSSI** — Directive Nationale de la Sécurité des Systèmes d'Information
  (DNSSI).
* **Loi 09-08 / CNDP** — protection des données à caractère personnel.
* **Loi 05-20** — relative à la cybersécurité.

Each control declares which countries it supports; a country's compliance score
is computed only from the controls assessed for it. A control whose underlying
scanner did not run is ``not_assessed`` (never silently counted as compliant).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

# Human-readable framework labels, per country.
FRAMEWORKS = {
    "FR": {
        "country": "France",
        "references": ["ANSSI (Guide d'hygiène, reco TLS)", "RGS", "RGPD / CNIL"],
    },
    "MA": {
        "country": "Maroc",
        "references": ["DGSSI (DNSSI)", "Loi 09-08 / CNDP", "Loi 05-20 cybersécurité"],
    },
}

# Control status values.
PASS = "compliant"
FAIL = "non_compliant"
NOT_ASSESSED = "not_assessed"


@dataclass(frozen=True)
class Control:
    """One externally-verifiable compliance control.

    ``coverage_key`` is the scanner whose ``coverage`` must be ``"ran"`` for the
    control to be assessable. ``violated`` returns True (non-compliant) when the
    relevant finding codes are present. ``countries`` lists the frameworks the
    control maps to, with a short per-country reference note.
    """

    id: str
    title_fr: str
    title_en: str
    category: str
    severity: str  # relative weight of the control: high / medium / low
    coverage_key: str
    violated: Callable[[set[str]], bool]
    countries: dict[str, str] = field(default_factory=dict)


def _has(codes: set[str], *needles: str) -> bool:
    """True if any finding code equals or is prefixed by one of ``needles``."""
    return any(c == n or c.startswith(n) for c in codes for n in needles)


def _missing_non_hsts_header(codes: set[str]) -> bool:
    """A required security header (other than HSTS, handled separately) is missing."""
    return any(c.startswith("headers.missing.")
               and c != "headers.missing.strict-transport-security" for c in codes)


# Both countries' technical baselines overlap heavily, so most controls map to
# both FR and MA with the country-specific reference noted.
CONTROLS: list[Control] = [
    Control(
        id="tls_strong_protocols",
        title_fr="Chiffrement des flux : pas de protocole SSL/TLS obsolète",
        title_en="Strong transport encryption: no obsolete SSL/TLS protocol",
        category="tls", severity="high", coverage_key="tls",
        violated=lambda c: _has(c, "tls.protocol_ssl", "tls.protocol_tls_legacy"),
        countries={"FR": "ANSSI reco TLS / RGS", "MA": "DGSSI DNSSI"},
    ),
    Control(
        id="tls_valid_certificate",
        title_fr="Certificat serveur valide et de confiance",
        title_en="Valid, trusted server certificate",
        category="tls", severity="high", coverage_key="tls",
        violated=lambda c: _has(c, "tls.cert_expired", "tls.cert_untrusted"),
        countries={"FR": "ANSSI reco TLS / RGS", "MA": "DGSSI DNSSI"},
    ),
    Control(
        id="hsts_enforced",
        title_fr="Transport sécurisé forcé (HSTS)",
        title_en="Enforced secure transport (HSTS)",
        category="headers", severity="medium", coverage_key="headers",
        violated=lambda c: _has(c, "headers.missing.strict-transport-security",
                                "headers.hsts_short"),
        countries={"FR": "ANSSI / RGPD (flux chiffrés)", "MA": "DGSSI DNSSI"},
    ),
    Control(
        id="security_headers",
        title_fr="En-têtes de sécurité HTTP présents (CSP, X-Frame-Options, …)",
        title_en="HTTP security headers present (CSP, X-Frame-Options, …)",
        category="headers", severity="medium", coverage_key="headers",
        violated=_missing_non_hsts_header,
        countries={"FR": "ANSSI (hygiène)", "MA": "DGSSI DNSSI"},
    ),
    Control(
        id="secure_cookies",
        title_fr="Cookies sécurisés (Secure / HttpOnly / SameSite)",
        title_en="Secure cookies (Secure / HttpOnly / SameSite)",
        category="headers", severity="medium", coverage_key="headers",
        violated=lambda c: _has(c, "headers.cookie_flags"),
        countries={"FR": "RGPD / CNIL (données personnelles)",
                   "MA": "Loi 09-08 / CNDP"},
    ),
    Control(
        id="email_anti_spoofing",
        title_fr="Anti-usurpation e-mail (SPF / DMARC)",
        title_en="E-mail anti-spoofing (SPF / DMARC)",
        category="dns_auth", severity="medium", coverage_key="dns_auth",
        violated=lambda c: _has(c, "dns.spf_missing", "dns.spf_permissive",
                                "dns.dmarc_missing", "dns.dmarc_policy_none"),
        countries={"FR": "ANSSI (messagerie)", "MA": "DGSSI DNSSI"},
    ),
    Control(
        id="no_sensitive_exposure",
        title_fr="Pas d'exposition de fichiers/services sensibles",
        title_en="No exposure of sensitive files/services",
        category="misconfig", severity="high", coverage_key="misconfig",
        violated=lambda c: _has(c, "misconfig.exposed_path",
                                "misconfig.directory_listing",
                                "misconfig.dangerous_method"),
        countries={"FR": "ANSSI (hygiène) / RGPD", "MA": "Loi 09-08 / DGSSI"},
    ),
    Control(
        id="limit_tech_disclosure",
        title_fr="Réduction de la divulgation d'informations techniques",
        title_en="Reduced technical information disclosure",
        category="misconfig", severity="low", coverage_key="misconfig",
        violated=lambda c: _has(c, "misconfig.tech_disclosure"),
        countries={"FR": "ANSSI (hygiène)", "MA": "DGSSI DNSSI"},
    ),
    Control(
        id="no_subdomain_takeover",
        title_fr="Pas de prise de contrôle de sous-domaine (DNS orphelin)",
        title_en="No subdomain takeover / dangling DNS",
        category="takeover", severity="high", coverage_key="takeover",
        violated=lambda c: _has(c, "takeover.vulnerable", "takeover.dangling"),
        countries={"FR": "ANSSI (hygiène) / RGS", "MA": "Loi 05-20 cybersécurité"},
    ),
    Control(
        id="no_known_cves",
        title_fr="Absence de vulnérabilités connues (CVE)",
        title_en="No known vulnerabilities (CVE)",
        category="cve", severity="high", coverage_key="cve",
        violated=lambda c: _has(c, "cve.known_vulnerable"),
        countries={"FR": "ANSSI / RGS", "MA": "Loi 05-20 cybersécurité"},
    ),
    Control(
        id="service_availability",
        title_fr="Disponibilité du service",
        title_en="Service availability",
        category="availability", severity="medium", coverage_key="availability",
        violated=lambda c: _has(c, "availability.site_down"),
        countries={"FR": "RGS (disponibilité)", "MA": "Loi 05-20 cybersécurité"},
    ),
    Control(
        id="security_contact",
        title_fr="Contact de sécurité publié (security.txt, RFC 9116)",
        title_en="Published security contact (security.txt, RFC 9116)",
        category="misconfig", severity="low", coverage_key="misconfig",
        violated=lambda c: _has(c, "misconfig.security_txt"),
        countries={"FR": "ANSSI (gouvernance)", "MA": "DGSSI DNSSI"},
    ),
]


def _control_status(control: Control, codes: set[str], coverage: dict) -> str:
    if coverage.get(control.coverage_key) != "ran":
        return NOT_ASSESSED
    return FAIL if control.violated(codes) else PASS


def _framework_verdict(statuses: list[str]) -> tuple[int | None, str]:
    """(score %, overall status) from a list of per-control statuses for a country."""
    assessed = [s for s in statuses if s != NOT_ASSESSED]
    if not assessed:
        return None, NOT_ASSESSED
    passed = sum(1 for s in assessed if s == PASS)
    score = round(passed / len(assessed) * 100)
    if passed == len(assessed):
        status = PASS
    elif passed == 0:
        status = FAIL
    else:
        status = "partial"
    return score, status


def assess_compliance(findings: list[dict], coverage: dict) -> dict:
    """Builds the compliance view for one site from its findings + coverage.

    Returns::

        {
          "controls": [
             {id, title_fr, category, severity, status, countries:{FR:ref, MA:ref}}
          ],
          "frameworks": {
             "FR": {"country", "references", "score": int|None, "status"},
             "MA": {...},
          },
          "disclaimer": str,
        }
    """
    codes = {f.get("code") for f in (findings or []) if f.get("code")}
    coverage = coverage or {}

    controls_out: list[dict] = []
    per_country: dict[str, list[str]] = {k: [] for k in FRAMEWORKS}
    for control in CONTROLS:
        status = _control_status(control, codes, coverage)
        controls_out.append({
            "id": control.id,
            "title_fr": control.title_fr,
            "title_en": control.title_en,
            "category": control.category,
            "severity": control.severity,
            "status": status,
            "countries": dict(control.countries),
        })
        for country in control.countries:
            if country in per_country:
                per_country[country].append(status)

    frameworks_out: dict[str, dict] = {}
    for country, meta in FRAMEWORKS.items():
        score, status = _framework_verdict(per_country.get(country, []))
        frameworks_out[country] = {
            "country": meta["country"],
            "references": list(meta["references"]),
            "score": score,
            "status": status,
        }

    return {
        "controls": controls_out,
        "frameworks": frameworks_out,
        "disclaimer": (
            "Conformité technique externe (contrôles observables à distance) — "
            "indicateur d'alignement aux recommandations ANSSI/RGS/RGPD (FR) et "
            "DGSSI/Loi 09-08/Loi 05-20 (MA). Ne constitue pas une certification "
            "légale ni une évaluation des exigences organisationnelles."
        ),
    }
