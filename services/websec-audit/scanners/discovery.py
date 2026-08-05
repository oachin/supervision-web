"""
scanners/discovery.py
External-attack-surface (EASM) asset discovery.

Turns one or more *root domains* into a concrete list of scan targets, so the
audit no longer depends on a hand-maintained `sites:` list. This is the piece
that moves the tool from "scan what I give it" towards EASM ("find what the
organisation exposes, then scan it").

Sources, in order of value:
  * Certificate Transparency — the single most effective way to enumerate
    subdomains: every publicly-trusted certificate is logged, so hostnames
    appear here even when they aren't linked anywhere. We query **two**
    independent CT aggregators (crt.sh and Cert Spotter) and merge them, so a
    single provider being down or rate-limited never blinds discovery.
  * Passive DNS (HackerTarget) — a *non-CT* source, so it finds hosts that have
    no public certificate (the classic CT blind spot). Keyless and best-effort.
  * Reverse DNS (PTR) expansion — optional: resolve discovered hosts to IPs,
    then PTR-sweep those IPs to surface in-scope hostnames named differently
    from anything CT/passive-DNS knew about (a light form of the ASN/IP-range
    reverse expansion EASM uses to find shadow IT).
  * DNS resolution — we keep only names that actually resolve (A/AAAA), so dead
    entries don't become noisy "site is unreachable" findings.

Design notes:
  * Fail-safe: any network/parse error degrades gracefully to whatever was
    already discovered (never raises), so a scan is never blocked by discovery.
  * Results are cached per root domain (TTL) so repeated calls — e.g. the
    dashboard reloading the target list — don't hammer the CT sources.
  * Discovery only *proposes* targets; active scanning stays authorization-gated
    exactly as before. Only enumerate domains you are authorised to audit.
"""

from __future__ import annotations

import ipaddress
import logging
import os
import socket
import time

import dns.exception
import dns.resolver
import requests

logger = logging.getLogger(__name__)

CRTSH_URL = "https://crt.sh/"
CERTSPOTTER_URL = "https://api.certspotter.com/v1/issuances"
HACKERTARGET_URL = "https://api.hackertarget.com/hostsearch/"
RDAP_URL = "https://rdap.org/"      # bootstrap redirector -> the right RIR/registry
BGPVIEW_ASN_URL = "https://api.bgpview.io/asn/{asn}/prefixes"  # free, keyless
_DEFAULT_TIMEOUT = 20
_CACHE_TTL = 3600  # seconds; CT/DNS change slowly relative to a scan cadence

# Common subdomain labels for a keyless, source-independent DNS brute-force.
# Deliberately high-signal (real infrastructure names), not an exhaustive
# wordlist — it complements the passive sources without a heavy DNS flood.
COMMON_SUBDOMAINS = [
    "www", "mail", "webmail", "smtp", "imap", "pop", "ns1", "ns2", "mx",
    "remote", "vpn", "portal", "admin", "api", "api2", "dev", "staging",
    "stage", "test", "testing", "qa", "uat", "demo", "beta", "app", "apps",
    "mobile", "m", "cdn", "static", "assets", "img", "images", "media",
    "download", "downloads", "files", "ftp", "sftp", "git", "gitlab",
    "jenkins", "ci", "build", "docker", "registry", "db", "database", "sql",
    "mysql", "postgres", "redis", "mongo", "grafana", "kibana", "prometheus",
    "monitor", "monitoring", "status", "metrics", "log", "logs", "elk",
    "dashboard", "internal", "intranet", "extranet", "corp", "sso", "auth",
    "login", "account", "accounts", "id", "identity", "ldap", "ad", "dc",
    "proxy", "gateway", "gw", "router", "firewall", "vpn2", "owa", "exchange",
    "autodiscover", "lyncdiscover", "sip", "voip", "pbx", "support", "help",
    "helpdesk", "docs", "wiki", "confluence", "jira", "crm", "erp", "hr",
    "shop", "store", "cart", "checkout", "pay", "payment", "payments",
    "billing", "invoice", "secure", "vault", "backup", "backups", "old",
    "new", "legacy", "archive", "cloud", "s3", "storage", "blob", "bucket",
]


def _env_delay(name: str) -> float:
    """Reads a politeness delay in milliseconds from ``name`` -> seconds.

    Lets an operator throttle the keyless brute-force / bucket probes (be a good
    net citizen, avoid tripping rate limits). Invalid/negative values disable it."""
    try:
        ms = float(os.getenv(name, "0"))
    except ValueError:
        return 0.0
    return ms / 1000.0 if ms > 0 else 0.0


def discover_subdomains_bruteforce(domain: str, wordlist: list[str] | None = None,
                                   timeout: int = _DEFAULT_TIMEOUT,
                                   session: requests.Session | None = None,
                                   delay: float | None = None) -> list[str]:
    """Enumerates subdomains by resolving common labels under ``domain`` (DNS
    brute-force). Keyless and source-independent, so it finds live hosts that
    have neither a public certificate nor a passive-DNS record. Only names that
    actually resolve are kept. ``delay`` seconds are slept between lookups for
    politeness (defaults to the ``EASM_DNS_DELAY_MS`` env var). ``timeout``/
    ``session`` are accepted for a uniform source signature (unused here). Never
    raises."""
    domain = (domain or "").strip().lower().strip(".")
    if not domain:
        return []
    if delay is None:
        delay = _env_delay("EASM_DNS_DELAY_MS")
    labels = wordlist if wordlist is not None else COMMON_SUBDOMAINS
    found: set[str] = set()
    for i, label in enumerate(labels):
        if delay and i:
            time.sleep(delay)
        host = f"{label}.{domain}"
        if resolves(host):
            found.add(host)
    return sorted(found)


# root domain -> (expires_at, [hostnames])
_cache: dict[str, tuple[float, list[str]]] = {}


def _clean_ct_name(name: str) -> list[str]:
    """Normalises one crt.sh name_value cell into candidate hostnames.

    A cell can hold several newline-separated names and wildcard entries
    (``*.example.com``); we drop the wildcard prefix and lower-case everything.
    """
    out: list[str] = []
    for raw in (name or "").split("\n"):
        host = raw.strip().lower().lstrip("*.").strip(".")
        if host and " " not in host:
            out.append(host)
    return out


def discover_subdomains_crtsh(domain: str, timeout: int = _DEFAULT_TIMEOUT,
                              session: requests.Session | None = None) -> list[str]:
    """Enumerates subdomains of ``domain`` via Certificate Transparency (crt.sh).

    Returns a sorted, de-duplicated list of hostnames under ``domain`` (always
    including the apex). Never raises: on any error it returns just the apex.
    """
    domain = (domain or "").strip().lower().strip(".")
    if not domain:
        return []
    found: set[str] = {domain}
    getter = session.get if session is not None else requests.get
    try:
        resp = getter(CRTSH_URL, params={"q": f"%.{domain}", "output": "json"},
                      timeout=timeout)
        resp.raise_for_status()
        for entry in resp.json():
            for host in _clean_ct_name(entry.get("name_value", "")):
                # Keep only names within the requested domain.
                if host == domain or host.endswith("." + domain):
                    found.add(host)
    except (requests.RequestException, ValueError) as e:
        logger.warning("crt.sh discovery failed for %s: %s", domain, e)
    return sorted(found)


def discover_subdomains_certspotter(domain: str, timeout: int = _DEFAULT_TIMEOUT,
                                    session: requests.Session | None = None) -> list[str]:
    """Enumerates subdomains of ``domain`` via Cert Spotter's issuance API.

    A second, independent Certificate Transparency source so discovery does not
    depend on any single provider. Returns a sorted, de-duplicated list of
    hostnames under ``domain``. Never raises: on any error it returns ``[]`` so
    the caller can still fall back to the other source(s).
    """
    domain = (domain or "").strip().lower().strip(".")
    if not domain:
        return []
    found: set[str] = set()
    getter = session.get if session is not None else requests.get
    try:
        resp = getter(CERTSPOTTER_URL,
                      params={"domain": domain, "include_subdomains": "true",
                              "expand": "dns_names"},
                      timeout=timeout)
        resp.raise_for_status()
        for entry in resp.json():
            for raw in entry.get("dns_names", []) or []:
                for host in _clean_ct_name(raw):
                    if host == domain or host.endswith("." + domain):
                        found.add(host)
    except (requests.RequestException, ValueError) as e:
        logger.warning("Cert Spotter discovery failed for %s: %s", domain, e)
    return sorted(found)


def discover_subdomains_hackertarget(domain: str, timeout: int = _DEFAULT_TIMEOUT,
                                     session: requests.Session | None = None) -> list[str]:
    """Enumerates subdomains of ``domain`` via HackerTarget's passive-DNS API.

    A **non-CT** source (keyless), so it can surface hosts that have never been
    issued a public certificate — the main blind spot of Certificate
    Transparency. The endpoint returns ``host,ip`` lines as plain text; error
    responses (rate limits, bad input) don't contain in-scope ``host,ip`` rows
    and are naturally ignored. Never raises: on any error it returns ``[]``.
    """
    domain = (domain or "").strip().lower().strip(".")
    if not domain:
        return []
    found: set[str] = set()
    getter = session.get if session is not None else requests.get
    try:
        resp = getter(HACKERTARGET_URL, params={"q": domain}, timeout=timeout)
        resp.raise_for_status()
        for line in (resp.text or "").splitlines():
            host = line.split(",", 1)[0].strip().lower().strip(".")
            if not host or " " in host:
                continue
            if host == domain or host.endswith("." + domain):
                found.add(host)
    except requests.RequestException as e:
        logger.warning("HackerTarget discovery failed for %s: %s", domain, e)
    return sorted(found)


# Every subdomain source, by name, each independently fail-safe (returns [] on
# error). Resolved from the module at call time so tests can monkeypatch them.
_SUBDOMAIN_SOURCES = (
    "discover_subdomains_crtsh",
    "discover_subdomains_certspotter",
    "discover_subdomains_hackertarget",
)


def discover_subdomains(domain: str, timeout: int = _DEFAULT_TIMEOUT,
                        session: requests.Session | None = None,
                        bruteforce: bool = False) -> list[str]:
    """Enumerates subdomains of ``domain`` by merging every source.

    Unions two independent Certificate Transparency aggregators with a non-CT
    passive-DNS source (always including the apex), so one provider being
    unavailable — or a whole source type having a blind spot — only degrades
    coverage instead of blinding discovery. When ``bruteforce`` is set, a keyless
    DNS brute-force of common labels is added (finds hosts with no cert and no
    passive-DNS record). Never raises.
    """
    domain = (domain or "").strip().lower().strip(".")
    if not domain:
        return []
    found: set[str] = {domain}
    for name in _SUBDOMAIN_SOURCES:
        source = globals()[name]
        found.update(source(domain, timeout=timeout, session=session))
    if bruteforce:
        found.update(discover_subdomains_bruteforce(domain, timeout=timeout,
                                                     session=session))
    return sorted(found)


def resolve_ip(host: str) -> str | None:
    """First IP ``host`` resolves to (A/AAAA), or ``None``. Never raises."""
    try:
        return socket.getaddrinfo(host, None)[0][4][0]
    except (socket.gaierror, UnicodeError, OSError, IndexError):
        return None


def resolves(host: str) -> bool:
    """True if ``host`` resolves to an A/AAAA record (best-effort, no raise)."""
    return resolve_ip(host) is not None


def reverse_dns(ip: str) -> str | None:
    """PTR (reverse-DNS) hostname for ``ip``, or ``None``. Never raises."""
    if not ip:
        return None
    try:
        return socket.gethostbyaddr(ip)[0].strip(".").lower() or None
    except (socket.herror, socket.gaierror, OSError):
        return None


def reverse_expand(ips: set[str], root_domains: list[str]) -> list[str]:
    """Reverse-DNS expansion: PTR each IP and keep hostnames *in scope*.

    Given the IPs the known assets resolve to, look up each IP's PTR record and
    return any hostname that falls under one of ``root_domains`` — i.e. an
    in-scope host named differently from anything the forward sources found
    (a light, DNS-only form of ASN/IP-range reverse expansion). In-scope
    filtering keeps this from importing unrelated tenants on shared IPs. Sorted,
    de-duplicated; never raises.
    """
    roots = [(r or "").strip().lower().strip(".") for r in root_domains]
    roots = [r for r in roots if r]
    found: set[str] = set()
    for ip in ips:
        ptr = reverse_dns(ip)
        if ptr and any(ptr == r or ptr.endswith("." + r) for r in roots):
            found.add(ptr)
    return sorted(found)


def _txt(name: str) -> str | None:
    """First TXT record for ``name`` as plain text, or ``None``. Never raises."""
    try:
        answer = dns.resolver.resolve(name, "TXT")
        for rec in answer:
            return b"".join(rec.strings).decode("utf-8", "replace")
    except (dns.exception.DNSException, OSError):
        return None
    return None


def ip_to_asn(ip: str) -> dict | None:
    """Maps an IPv4 address to its origin ASN via Team Cymru's DNS service.

    Returns ``{"asn", "prefix", "owner"}`` (owner best-effort) or ``None``.
    Uses only DNS TXT lookups (no extra dependency) and never raises.
    """
    parts = ip.split(".")
    if len(parts) != 4 or not all(p.isdigit() for p in parts):
        return None  # IPv6 / malformed: not supported by this lookup
    origin = _txt(f"{'.'.join(reversed(parts))}.origin.asn.cymru.com")
    if not origin:
        return None
    # Format: "ASN | BGP prefix | CC | registry | allocated"
    fields = [f.strip() for f in origin.split("|")]
    asn = fields[0].split()[0] if fields and fields[0] else None
    if not asn:
        return None
    prefix = fields[1] if len(fields) > 1 else None
    owner = None
    name = _txt(f"AS{asn}.asn.cymru.com")
    if name:
        # Format: "ASN | CC | registry | allocated | AS name"
        nfields = [f.strip() for f in name.split("|")]
        owner = nfields[-1] if nfields else None
    return {"asn": f"AS{asn}", "prefix": prefix, "owner": owner}


def rdap_domain(domain: str, timeout: int = _DEFAULT_TIMEOUT,
                session: requests.Session | None = None) -> dict | None:
    """WHOIS-style registration data for ``domain`` via RDAP (JSON WHOIS).

    Returns ``{"registrar", "created", "expires", "statuses", "nameservers"}``
    (fields best-effort) or ``None`` on any error. Never raises.
    """
    getter = session.get if session is not None else requests.get
    try:
        resp = getter(f"{RDAP_URL}domain/{domain}", timeout=timeout,
                      headers={"Accept": "application/rdap+json"})
        resp.raise_for_status()
        data = resp.json()
    except (requests.RequestException, ValueError) as e:
        logger.warning("RDAP domain lookup failed for %s: %s", domain, e)
        return None
    events = {e.get("eventAction"): e.get("eventDate")
              for e in data.get("events", []) if isinstance(e, dict)}
    registrar = None
    registrant = None
    for ent in data.get("entities", []):
        roles = ent.get("roles") or []
        if "registrar" in roles and not registrar:
            registrar = ent.get("handle") or _vcard_name(ent)
        if "registrant" in roles and not registrant:
            registrant = _vcard_org(ent) or _vcard_name(ent)
    return {
        "registrar": registrar,
        "registrant": registrant,
        "created": events.get("registration"),
        "expires": events.get("expiration"),
        "statuses": data.get("status") or [],
        "nameservers": [ns.get("ldhName") for ns in data.get("nameservers", [])
                        if isinstance(ns, dict) and ns.get("ldhName")],
    }


def _vcard_name(entity: dict) -> str | None:
    """Extracts the display name from an RDAP entity's jCard, if present."""
    return _vcard_field(entity, "fn")


def _vcard_org(entity: dict) -> str | None:
    """Extracts the organisation name from an RDAP entity's jCard, if present."""
    return _vcard_field(entity, "org")


def _vcard_field(entity: dict, field: str) -> str | None:
    """Returns the value of a jCard ``field`` (e.g. ``fn``/``org``), or ``None``.

    A jCard ``org`` value can itself be a list (structured name parts); we take
    the first non-empty component so the caller always gets a plain string.
    """
    vcard = entity.get("vcardArray")
    if not (isinstance(vcard, list) and len(vcard) == 2):
        return None
    for item in vcard[1]:
        if isinstance(item, list) and item and item[0] == field:
            value = item[-1]
            if isinstance(value, list):
                value = next((v for v in value if v), None)
            return value or None
    return None


def attribute_host(host: str) -> dict:
    """Ownership attribution for one host: resolved IP + origin ASN/owner.

    Returns ``{"ip", "asn", "asn_owner"}`` (any field may be ``None``). This is
    what lets an EASM say *which network/organisation* an asset belongs to.
    """
    ip = resolve_ip(host)
    asn_info = ip_to_asn(ip) if ip else None
    return {
        "ip": ip,
        "asn": (asn_info or {}).get("asn"),
        "asn_owner": (asn_info or {}).get("owner"),
    }


def _to_target(host: str, attribute: bool = False) -> dict:
    target = {"name": host, "url": f"https://{host}", "domain": host}
    if attribute:
        target["attribution"] = attribute_host(host)
    return target


def discover_assets(root_domains: list[str], resolve: bool = True,
                    attribute: bool = False, expand: bool = False,
                    use_cache: bool = True, bruteforce: bool = False,
                    session: requests.Session | None = None) -> list[dict]:
    """Discovers scan targets for one or more root domains.

    For each root domain we enumerate subdomains from every source (CT +
    passive DNS, plus a keyless DNS brute-force when ``bruteforce`` is set) and
    (when ``resolve`` is set) keep only hostnames that currently resolve in DNS.
    When ``expand`` is set, the resolved IPs are reverse-DNS (PTR) swept for
    additional in-scope hostnames. When ``attribute`` is set, each target also
    carries an ``attribution`` block (resolved IP + origin ASN/owner) so assets
    can be tied to a network.
    Returns a de-duplicated list of ``{"name", "url", "domain"[, "attribution"]}``
    targets (``https://`` scheme), sorted by hostname. Never raises.
    """
    roots = [(r or "").strip().lower().strip(".") for r in root_domains]
    roots = [r for r in roots if r]
    seen: set[str] = set()
    targets: list[dict] = []
    ips: set[str] = set()

    def _add(host: str) -> None:
        if host in seen:
            return
        ip = resolve_ip(host) if (resolve or expand) else None
        if resolve and ip is None:
            return
        seen.add(host)
        if ip:
            ips.add(ip)
        targets.append(_to_target(host, attribute=attribute))

    for root in roots:
        for host in _cached_subdomains(root, use_cache=use_cache,
                                       session=session, bruteforce=bruteforce):
            _add(host)

    if expand:
        for host in reverse_expand(ips, roots):
            _add(host)

    targets.sort(key=lambda t: t["domain"])
    return targets


def _as_record(value, now: str) -> dict:
    """Normalises a stored inventory value into a record dict.

    Accepts the legacy format (a bare ``first_seen`` ISO string) as well as the
    richer per-asset record, so old stored inventories upgrade transparently.
    """
    if isinstance(value, dict):
        return dict(value)
    return {"first_seen": value or now}


def diff_inventory(previous: dict, current, now: str) -> dict:
    """Diffs a stored asset inventory against a fresh discovery — the core of
    *continuous* EASM (alert when the external surface changes).

    ``previous`` maps ``host -> record`` (or the legacy ``host -> first_seen``
    string). ``current`` is either a list of hostnames or a
    ``host -> {"ips": [...], "asn": ...}`` metadata mapping. Returns::

        {"added": [...],       # hosts seen now but not before (newly exposed)
         "removed": [...],     # hosts previously known but gone now
         "inventory": {...}}   # host -> {first_seen, last_seen[, ips, asn]}

    Each record keeps its original ``first_seen``, refreshes ``last_seen`` to
    ``now``, and carries the latest ``ips``/``asn`` when known (falling back to
    the previously-stored values). Pure function (no I/O), trivially testable.
    """
    meta = current if isinstance(current, dict) else {h: {} for h in current}
    current_set = set(meta)
    added = sorted(h for h in current_set if h not in previous)
    removed = sorted(h for h in previous if h not in current_set)
    inventory: dict[str, dict] = {}
    for host in sorted(current_set):
        prev = _as_record(previous[host], now) if host in previous else {}
        info = meta.get(host) or {}
        rec = {"first_seen": prev.get("first_seen") or now, "last_seen": now}
        ips = info.get("ips") or prev.get("ips")
        asn = info.get("asn") or prev.get("asn")
        if ips:
            rec["ips"] = ips
        if asn:
            rec["asn"] = asn
        inventory[host] = rec
    return {"added": added, "removed": removed, "inventory": inventory}


# --- ASN / IP-range expansion --------------------------------------------

def asn_prefixes(asn: str, timeout: int = _DEFAULT_TIMEOUT,
                 session: requests.Session | None = None) -> list[str]:
    """Announced BGP prefixes (CIDRs) for an ``ASxxxx`` via BGPView (free, keyless).

    Lets an EASM turn an owner ASN into the concrete IP ranges the organisation
    announces — the basis for IP-range / shadow-IT expansion. Returns a sorted
    list of ``ip/prefix`` strings (IPv4 + IPv6). Never raises."""
    digits = "".join(ch for ch in (asn or "") if ch.isdigit())
    if not digits:
        return []
    getter = session.get if session is not None else requests.get
    prefixes: set[str] = set()
    try:
        resp = getter(BGPVIEW_ASN_URL.format(asn=digits),
                      headers={"User-Agent": "SecurityAuditTool/1.0"},
                      timeout=timeout)
        resp.raise_for_status()
        data = (resp.json() or {}).get("data") or {}
        for key in ("ipv4_prefixes", "ipv6_prefixes"):
            for row in data.get(key, []) or []:
                cidr = row.get("prefix")
                if cidr:
                    prefixes.add(cidr)
    except (requests.RequestException, ValueError) as e:
        logger.warning("ASN prefix lookup failed for %s: %s", asn, e)
    return sorted(prefixes)


def ip_in_any_prefix(ip: str, prefixes: list[str]) -> bool:
    """True if ``ip`` falls inside any of the ``prefixes`` (CIDR strings).

    Handles IPv4 and IPv6 and tolerates malformed inputs (a bad IP or CIDR is
    simply skipped). Never raises."""
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    for cidr in prefixes:
        try:
            if addr in ipaddress.ip_network(cidr, strict=False):
                return True
        except ValueError:
            continue
    return False


def reverse_sweep_prefix(cidr: str, root_domains: list[str],
                         limit: int = 256) -> list[str]:
    """PTR-sweeps the hosts of an IPv4 ``cidr`` and keeps in-scope hostnames.

    Bounded by ``limit`` addresses (default 256 = a /24) so a large range can't
    turn into an unbounded sweep, and in-scope filtering keeps unrelated tenants
    on shared ranges out. IPv6 and prefixes larger than ``limit`` hosts are
    skipped. Sorted, de-duplicated; never raises."""
    roots = [(r or "").strip().lower().strip(".") for r in root_domains]
    roots = [r for r in roots if r]
    try:
        network = ipaddress.ip_network(cidr, strict=False)
    except ValueError:
        return []
    if network.version != 4 or network.num_addresses > limit:
        return []
    found: set[str] = set()
    for addr in network.hosts():
        ptr = reverse_dns(str(addr))
        if ptr and any(ptr == r or ptr.endswith("." + r) for r in roots):
            found.add(ptr)
    return sorted(found)


# --- Cloud storage bucket enumeration -------------------------------------

# Suffixes appended to a candidate base name; these are the naming conventions
# most commonly used for public storage buckets.
_BUCKET_SUFFIXES = [
    "", "assets", "static", "media", "images", "img", "files", "uploads",
    "downloads", "data", "public", "private", "backup", "backups", "dev",
    "staging", "prod", "production", "logs", "cdn", "www", "web", "docs",
]
S3_HOST = "{name}.s3.amazonaws.com"
GCS_URL = "https://storage.googleapis.com/{name}"
AZURE_HOST = "{name}.blob.core.windows.net"


def bucket_candidates(domains: list[str], extra: list[str] | None = None) -> list[str]:
    """Builds candidate bucket names from root domains (+ optional keywords).

    For each domain we derive the bare label (``example`` from ``example.com``)
    and a dotless form (``example-com``), then apply the common storage
    suffixes. De-duplicated, order-preserving, lower-cased."""
    bases: list[str] = []
    for d in domains:
        d = (d or "").strip().lower().strip(".")
        if not d:
            continue
        label = d.split(".")[0]
        bases += [label, d.replace(".", "-"), d.replace(".", "")]
    bases += [k.strip().lower() for k in (extra or []) if k.strip()]
    seen: set[str] = set()
    names: list[str] = []
    for base in bases:
        for suffix in _BUCKET_SUFFIXES:
            name = base if not suffix else f"{base}-{suffix}"
            # S3 bucket names are 3..63 chars; skip anything out of range.
            if 3 <= len(name) <= 63 and name not in seen:
                seen.add(name)
                names.append(name)
    return names


def _classify(status: int) -> str | None:
    """Maps an HTTP status from a bucket probe to existence/exposure, or None
    when the response means the bucket does not exist."""
    if status in (200, 300):
        return "public"      # listable / readable without auth
    if status in (401, 403):
        return "private"     # exists, but access controlled
    return None              # 404 / NoSuchBucket / unrelated


def check_bucket(name: str, session: requests.Session | None = None,
                 timeout: int = 10) -> list[dict]:
    """Probes S3, GCS and Azure for a bucket/container named ``name``.

    Read-only: a single unauthenticated GET per provider. Returns one dict per
    provider where the bucket appears to exist:
    ``{provider, name, url, exposure}`` with ``exposure`` in
    ``{"public", "private"}``. Never raises."""
    getter = session.get if session is not None else requests.get
    headers = {"User-Agent": "SecurityAuditTool/1.0"}
    probes = [
        ("s3", f"https://{S3_HOST.format(name=name)}/"),
        ("gcs", GCS_URL.format(name=name)),
        ("azure", f"https://{AZURE_HOST.format(name=name)}/?comp=list"),
    ]
    out: list[dict] = []
    for provider, url in probes:
        try:
            resp = getter(url, headers=headers, timeout=timeout,
                          allow_redirects=True)
        except requests.RequestException:
            continue
        exposure = _classify(getattr(resp, "status_code", 0))
        if exposure:
            out.append({"provider": provider, "name": name, "url": url,
                        "exposure": exposure})
    return out


def discover_buckets(domains: list[str], extra_keywords: list[str] | None = None,
                     session: requests.Session | None = None,
                     timeout: int = 10, delay: float | None = None) -> list[dict]:
    """Enumerates likely public cloud storage buckets for ``domains``.

    Derives candidate names from the domains (+ optional keywords) and probes
    S3/GCS/Azure for each. ``delay`` seconds are slept between candidates for
    politeness (defaults to the ``EASM_BUCKET_DELAY_MS`` env var). Returns the
    list of buckets that appear to exist (public or private), sorted with public
    exposures first. Keyless and fail-safe; only enumerate names for
    organisations you are authorised to audit."""
    if delay is None:
        delay = _env_delay("EASM_BUCKET_DELAY_MS")
    found: list[dict] = []
    for i, name in enumerate(bucket_candidates(domains, extra=extra_keywords)):
        if delay and i:
            time.sleep(delay)
        found += check_bucket(name, session=session, timeout=timeout)
    found.sort(key=lambda b: (b["exposure"] != "public", b["provider"], b["name"]))
    return found


def _cached_subdomains(root: str, use_cache: bool,
                       session: requests.Session | None,
                       bruteforce: bool = False) -> list[str]:
    now = time.monotonic()
    key = f"{root}|bf" if bruteforce else root
    if use_cache:
        cached = _cache.get(key)
        if cached and cached[0] > now:
            return cached[1]
    hosts = discover_subdomains(root, session=session, bruteforce=bruteforce)
    if use_cache:
        _cache[key] = (now + _CACHE_TTL, hosts)
    return hosts


def clear_cache() -> None:
    """Drops the discovery cache (mainly for tests / forced re-discovery)."""
    _cache.clear()
