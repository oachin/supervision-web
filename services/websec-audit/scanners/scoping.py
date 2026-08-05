"""
scanners/scoping.py
Ownership attribution & confidence scoring for discovered assets.

Discovery (``scanners/discovery.py``) answers *"what hostnames exist under this
domain?"*. Scoping answers the harder EASM question: *"which of these assets
actually belong to the organisation — and how sure are we?"*. Enumerating from
Certificate Transparency, passive DNS, reverse DNS and ASN sweeps inevitably
pulls in neighbours on shared infrastructure (a CDN edge, a SaaS tenant, a
co-hosted site). Attaching each asset to the organisation with a *confidence*
score is what lets an operator trust an auto-discovered surface instead of
hand-curating it — and is precisely what keeps unrelated tenants out.

How it works
------------
First we build an *organisation identity* from the seed root domains by fusing
several independent, keyless signals:

  * **Registrant org** — RDAP/WHOIS registrant organisation of each seed domain.
  * **Owner ASN(s)** — the origin ASN each seed resolves into (Team Cymru).
  * **Announced prefixes** — the BGP prefixes those ASNs announce (the concrete
    IP ranges the org controls).
  * **Certificate org** — the ``O=`` (organizationName) in each seed's TLS leaf
    certificate.

Then each asset is scored by how many *independent* signals corroborate that it
belongs to that identity (in-scope DNS name, IP inside an owned prefix, matching
owner ASN, matching certificate org). More corroboration ⇒ higher confidence.

Design notes
------------
* **Free & keyless.** Reuses the discovery module's RDAP/ASN/DNS helpers plus a
  stdlib TLS peek — no API keys, no paid feeds.
* **Fail-safe.** Every signal degrades to "unknown" on any network/parse error;
  scoring never raises, so a slow feed only lowers confidence, it can't crash a
  scan.
* **Conservative.** Signals only ever *add* confidence; an asset with no
  corroboration lands at ``unrelated`` rather than being assumed in-scope.
"""

from __future__ import annotations

import logging
import re
import socket
import ssl

import requests
from cryptography import x509
from cryptography.x509.oid import NameOID

from scanners.discovery import (
    asn_prefixes,
    attribute_host,
    ip_in_any_prefix,
    ip_to_asn,
    rdap_domain,
    resolve_ip,
)

logger = logging.getLogger(__name__)

# Corporate suffixes / boilerplate stripped before comparing organisation names,
# so "Example, Inc." and "Example LLC" match on the meaningful token "example".
_ORG_STOPWORDS = {
    "inc", "incorporated", "llc", "ltd", "limited", "corp", "corporation",
    "co", "company", "gmbh", "sa", "sas", "ag", "plc", "llp", "lp", "bv",
    "pvt", "private", "group", "holdings", "holding", "technologies",
    "technology", "tech", "systems", "solutions", "services", "the", "and",
}

# How much each independent signal contributes to an asset's confidence.
_WEIGHTS = {
    "dns-in-scope": 0.55,
    "ip-in-owned-prefix": 0.30,
    "asn-match": 0.25,
    "cert-org-match": 0.40,
}

# Confidence -> label thresholds (checked high to low).
_LABELS = (
    (0.80, "confirmed"),
    (0.50, "probable"),
    (0.25, "possible"),
    (0.0, "unrelated"),
)


def _org_tokens(name: str | None) -> frozenset[str]:
    """Normalises an org name into a set of significant lower-case tokens.

    Punctuation is dropped, everything is lower-cased, and corporate
    boilerplate (``inc``, ``llc``, ``the`` …) is removed so only distinctive
    words remain for comparison. Returns an empty set for missing/blank names.
    """
    words = re.findall(r"[a-z0-9]+", (name or "").lower())
    return frozenset(w for w in words if w and w not in _ORG_STOPWORDS)


def _orgs_match(a: str | None, b: str | None) -> bool:
    """True if two org names share at least one distinctive token."""
    ta, tb = _org_tokens(a), _org_tokens(b)
    return bool(ta and tb and (ta & tb))


def cert_org(host: str, timeout: int = 10, port: int = 443) -> str | None:
    """Organisation (``O=``) in ``host``'s TLS leaf certificate, or ``None``.

    Opens a single TLS connection and reads the presented certificate *without*
    verifying it (a self-signed / mismatched cert still carries a usable subject
    org, and we only want the identity signal, not trust). Keyless and
    fail-safe: any connection/parse error returns ``None``.
    """
    host = (host or "").strip().lower().strip(".")
    if not host:
        return None
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        with socket.create_connection((host, port), timeout=timeout) as sock:
            with ctx.wrap_socket(sock, server_hostname=host) as ssock:
                der = ssock.getpeercert(binary_form=True)
        if not der:
            return None
        cert = x509.load_der_x509_certificate(der)
        attrs = cert.subject.get_attributes_for_oid(NameOID.ORGANIZATION_NAME)
        return attrs[0].value if attrs else None
    except Exception as e:  # noqa: BLE001 - identity signal is best-effort
        logger.debug("cert_org failed for %s: %s", host, e)
        return None


def build_identity(root_domains: list[str], with_cert: bool = True,
                   with_prefixes: bool = True,
                   session: requests.Session | None = None) -> dict:
    """Builds the organisation identity used to score assets.

    Fuses keyless signals from the seed ``root_domains``: RDAP registrant org,
    owner ASN(s) and their announced BGP prefixes, and (when ``with_cert``) the
    TLS certificate org of each apex. ``with_prefixes`` controls the (heavier)
    ASN->prefix expansion. Returns::

        {"root_domains": [...], "orgs": {...}, "asns": {...}, "prefixes": [...]}

    Never raises: each signal is best-effort and simply absent on error.
    """
    roots = [(r or "").strip().lower().strip(".") for r in root_domains]
    roots = [r for r in roots if r]
    orgs: set[str] = set()
    asns: set[str] = set()

    for root in roots:
        rd = rdap_domain(root, session=session)
        if rd and rd.get("registrant"):
            orgs.add(rd["registrant"])
        attr = attribute_host(root)
        if attr.get("asn"):
            asns.add(attr["asn"])
        if attr.get("asn_owner"):
            orgs.add(attr["asn_owner"])
        if with_cert:
            co = cert_org(root)
            if co:
                orgs.add(co)

    prefixes: list[str] = []
    if with_prefixes:
        seen: set[str] = set()
        for asn in sorted(asns):
            for cidr in asn_prefixes(asn, session=session):
                if cidr not in seen:
                    seen.add(cidr)
                    prefixes.append(cidr)

    return {"root_domains": roots, "orgs": orgs, "asns": asns,
            "prefixes": prefixes}


def _label(confidence: float) -> str:
    for threshold, label in _LABELS:
        if confidence >= threshold:
            return label
    return "unrelated"


def score_asset(asset: dict, identity: dict, with_cert: bool = True,
                session: requests.Session | None = None) -> dict:
    """Scores one asset's ownership confidence against an ``identity``.

    ``asset`` is a discovery target (``{"domain"/"name", ..., "attribution"?}``).
    Sums the weights of every corroborating signal (in-scope DNS name, resolved
    IP inside an owned prefix, matching owner ASN, matching certificate org),
    clamped to ``1.0``. Returns::

        {"confidence": 0.0..1.0, "label": "confirmed|probable|possible|unrelated",
         "signals": [<reasons>]}

    Never raises.
    """
    host = (asset.get("domain") or asset.get("name") or "").strip().lower().strip(".")
    roots = identity.get("root_domains") or []
    orgs = identity.get("orgs") or set()
    asns = identity.get("asns") or set()
    prefixes = identity.get("prefixes") or []

    signals: list[str] = []
    score = 0.0

    if host and any(host == r or host.endswith("." + r) for r in roots):
        signals.append("dns-in-scope")
        score += _WEIGHTS["dns-in-scope"]

    attr = asset.get("attribution") or {}
    ip = attr.get("ip") or (resolve_ip(host) if host else None)
    asn = attr.get("asn")
    if asn is None and ip:
        # Only pay for an ASN lookup if we don't already have one from discovery.
        info = ip_to_asn(ip) or {}
        asn = info.get("asn")

    if ip and prefixes and ip_in_any_prefix(ip, prefixes):
        signals.append("ip-in-owned-prefix")
        score += _WEIGHTS["ip-in-owned-prefix"]
    if asn and asn in asns:
        signals.append("asn-match")
        score += _WEIGHTS["asn-match"]
    if with_cert and host and orgs:
        co = cert_org(host)
        if co and any(_orgs_match(co, o) for o in orgs):
            signals.append("cert-org-match")
            score += _WEIGHTS["cert-org-match"]

    score = round(min(score, 1.0), 2)
    return {"confidence": score, "label": _label(score), "signals": signals}


def scope_assets(assets: list[dict], root_domains: list[str] | None = None,
                 identity: dict | None = None, with_cert: bool = True,
                 session: requests.Session | None = None) -> list[dict]:
    """Annotates each asset with an ``ownership`` confidence block.

    Builds the organisation ``identity`` from ``root_domains`` when one is not
    supplied, then scores every asset. Each asset gains
    ``asset["ownership"] = {"confidence", "label", "signals"}``. The input list
    is mutated in place and also returned. Never raises.
    """
    if identity is None:
        identity = build_identity(root_domains or [], with_cert=with_cert,
                                  session=session)
    for asset in assets:
        asset["ownership"] = score_asset(asset, identity, with_cert=with_cert,
                                         session=session)
    return assets
