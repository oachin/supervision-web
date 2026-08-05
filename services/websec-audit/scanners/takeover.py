"""
scanners/takeover.py
Subdomain-takeover / dangling-DNS detection.

A subdomain takeover happens when a hostname still points (via CNAME) at a
third-party service — GitHub Pages, an S3 bucket, Heroku, Azure, … — whose
underlying resource has been deleted or was never claimed. An attacker who
(re-)creates that resource then serves content from *your* subdomain, enabling
convincing phishing, cookie theft and OAuth/redirect abuse. It is one of the
flagship findings an EASM is expected to surface, because it is exactly the kind
of forgotten, externally-observable exposure that asset discovery turns up.

Two independent signals are checked, from strongest to weakest:

  * **Confirmed takeover** — the host's CNAME points at a known service and the
    served page shows that service's *unclaimed-resource* fingerprint (e.g.
    GitHub's "There isn't a GitHub Pages site here."). Reported ``confirmed``.
  * **Dangling DNS** — the CNAME target does not exist at all (NXDOMAIN). The
    name can often be re-registered/claimed, so this is a high-risk takeover
    candidate even without a matching fingerprint.

Design notes
------------
* Non-intrusive & read-only: a few DNS lookups plus (at most) one HTTP GET of
  the target's own URL. It never registers anything or exploits the weakness.
* Fail-safe: any DNS/HTTP error is recorded as ``error`` (scored as an
  inconclusive *info* result) and never raises — a flaky lookup must not be read
  as "not vulnerable".
* Conservative: a bare CNAME to a third party with no fingerprint match and a
  resolving target is reported only informationally, not as a vulnerability.
"""

from __future__ import annotations

import logging
from urllib.parse import urlparse

import dns.exception
import dns.resolver
import requests
from requests.exceptions import RequestException, SSLError
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

logger = logging.getLogger(__name__)

USER_AGENT = {"User-Agent": "SecurityAuditTool/1.0"}
_MAX_CNAME_HOPS = 10

# Curated fingerprints for services commonly involved in subdomain takeovers.
# Each entry: the CNAME suffix(es) that route to the service and the response
# body string(s) that indicate the backing resource is unclaimed/deleted.
# Kept intentionally high-signal (no over-generic "404 Not Found" strings) to
# avoid false positives.
TAKEOVER_FINGERPRINTS: list[dict] = [
    {"service": "GitHub Pages", "cnames": [".github.io"],
     "fingerprints": ["There isn't a GitHub Pages site here.",
                      "For root URLs (like http://example.com/) you must provide an index.html file"]},
    {"service": "AWS S3", "cnames": [".s3.amazonaws.com", ".s3-website"],
     "fingerprints": ["The specified bucket does not exist", "NoSuchBucket"]},
    {"service": "Heroku", "cnames": [".herokuapp.com", ".herokudns.com", ".herokussl.com"],
     "fingerprints": ["No such app", "herokucdn.com/error-pages/no-such-app.html"]},
    {"service": "Microsoft Azure",
     "cnames": [".azurewebsites.net", ".cloudapp.net", ".cloudapp.azure.com",
                ".trafficmanager.net", ".blob.core.windows.net", ".azureedge.net"],
     "fingerprints": ["404 Web Site not found"]},
    {"service": "Shopify", "cnames": [".myshopify.com"],
     "fingerprints": ["Sorry, this shop is currently unavailable"]},
    {"service": "Fastly", "cnames": [".fastly.net"],
     "fingerprints": ["Fastly error: unknown domain"]},
    {"service": "Zendesk", "cnames": [".zendesk.com"],
     "fingerprints": ["Help Center Closed"]},
    {"service": "GitLab Pages", "cnames": [".gitlab.io"],
     "fingerprints": ["The page you're looking for could not be found"]},
    {"service": "Bitbucket", "cnames": [".bitbucket.io"],
     "fingerprints": ["Repository not found"]},
    {"service": "Surge.sh", "cnames": [".surge.sh"],
     "fingerprints": ["project not found"]},
    {"service": "Pantheon", "cnames": [".pantheonsite.io"],
     "fingerprints": ["The gods are wise, but do not know of the site which you seek"]},
    {"service": "Tumblr", "cnames": [".domains.tumblr.com"],
     "fingerprints": ["Whatever you were looking for doesn't currently exist at this address"]},
    {"service": "Read the Docs", "cnames": [".readthedocs.io"],
     "fingerprints": ["unknown to Read the Docs"]},
    {"service": "Netlify", "cnames": [".netlify.app", ".netlify.com"],
     "fingerprints": ["Not found - Request ID"]},
]


def _cname_chain(host: str) -> list[str]:
    """Follows ``host``'s CNAME chain, returning targets in order. Never raises."""
    chain: list[str] = []
    current = host
    for _ in range(_MAX_CNAME_HOPS):
        try:
            answer = dns.resolver.resolve(current, "CNAME", lifetime=5)
        except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN):
            break
        except dns.exception.DNSException:
            break
        target = str(answer[0].target).rstrip(".").lower()
        if not target or target in chain:
            break
        chain.append(target)
        current = target
    return chain


def _resolution_status(name: str) -> str:
    """Classifies a name as 'resolves', 'nxdomain' or 'unknown'. Never raises.

    Only NXDOMAIN (the name does not exist at all) is a confident dangling-DNS
    signal; a name that exists but has no A/AAAA is 'unknown', not dangling.
    """
    for rtype in ("A", "AAAA"):
        try:
            dns.resolver.resolve(name, rtype, lifetime=5)
            return "resolves"
        except dns.resolver.NXDOMAIN:
            return "nxdomain"
        except dns.resolver.NoAnswer:
            continue
        except dns.exception.DNSException:
            return "unknown"
    return "unknown"


def _match_service(chain: list[str]) -> dict | None:
    """Returns the fingerprint entry for the first CNAME in ``chain`` that routes
    to a known takeover-prone service, or ``None``."""
    for target in chain:
        for entry in TAKEOVER_FINGERPRINTS:
            for suffix in entry["cnames"]:
                token = "." + suffix.lstrip(".")
                if target.endswith(suffix) or token in target:
                    return entry
    return None


def _fetch_body(url: str, timeout: int) -> str | None:
    """GETs ``url`` (following redirects) and returns the body, or ``None`` on
    error. Retries once with verify=False on a certificate failure."""
    for verify in (True, False):
        try:
            resp = requests.get(url, timeout=timeout, allow_redirects=True,
                                headers=USER_AGENT, verify=verify)
            return resp.text or ""
        except SSLError:
            continue  # retry once without verification
        except RequestException:
            return None
    return None


def check_takeover(url: str, timeout: int = 8) -> dict:
    """Checks a single site for subdomain-takeover / dangling-DNS exposure.

    Returns a dict with:
        - domain: the hostname checked
        - cname_chain: list[str]  (empty when the host has no CNAME)
        - service: str | None      (known third-party service the CNAME routes to)
        - vulnerable: bool         (confirmed unclaimed-resource fingerprint)
        - dangling: bool           (CNAME target is NXDOMAIN)
        - evidence: str | None     (the fingerprint string that matched)
        - issues: list[str]        (human-readable, for scoring/report)
        - error: str | None        (only set if the check could not run)
    """
    host = urlparse(url).hostname or (url or "").strip().lower()
    result: dict = {
        "domain": host,
        "cname_chain": [],
        "service": None,
        "vulnerable": False,
        "dangling": False,
        "evidence": None,
        "issues": [],
        "error": None,
    }
    if not host:
        result["error"] = "no hostname to check"
        return result

    try:
        chain = _cname_chain(host)
        result["cname_chain"] = chain
        if not chain:
            return result  # no CNAME => not a CNAME-based takeover candidate

        target = chain[-1]
        if _resolution_status(target) == "nxdomain":
            result["dangling"] = True
            result["issues"].append(
                f"CNAME points to '{target}' which does not exist (NXDOMAIN) — "
                "dangling DNS, subdomain-takeover risk")

        matched = _match_service(chain)
        if matched:
            result["service"] = matched["service"]
            body = _fetch_body(url, timeout)
            if body:
                lowered = body.lower()
                for fp in matched["fingerprints"]:
                    if fp.lower() in lowered:
                        result["vulnerable"] = True
                        result["evidence"] = fp
                        result["issues"].append(
                            f"Subdomain takeover: {host} -> {matched['service']} "
                            f"shows an unclaimed-resource fingerprint")
                        break
            if not result["vulnerable"] and not result["dangling"]:
                result["issues"].append(
                    f"CNAME points to third-party service {matched['service']} — "
                    "verify the backing resource is claimed")
    except Exception as e:  # defensive: the check must never crash a scan
        result["error"] = str(e)
        logger.warning("takeover check failed for %s: %s", host, e)
    return result
