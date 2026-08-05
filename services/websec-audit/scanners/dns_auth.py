"""
dns_auth.py
Checks SPF, DKIM, and DMARC DNS records for email-spoofing protection.
"""

import dns.resolver
import dns.exception


# Common DKIM selectors to try, since DKIM has no fixed discovery record.
# In a real engagement, ask IT which selector(s) their mail provider uses
# and extend this list (e.g. add the company's actual selector).
COMMON_DKIM_SELECTORS = [
    "default",
    "google",
    "selector1",  # Microsoft 365 default
    "selector2",  # Microsoft 365 default
    "k1",         # Mailchimp/Mandrill
    "dkim",
]


def _query_txt(name: str) -> tuple[list[str], str | None]:
    """
    Returns (list_of_txt_records, error).
    error is None on success (even if the list is empty because no records exist).
    error is a string if the query itself failed (timeout, no resolver, etc.) —
    callers must NOT treat that the same as "record confirmed absent".
    """
    try:
        answers = dns.resolver.resolve(name, "TXT", lifetime=5)
        records = []
        for rdata in answers:
            txt = b"".join(rdata.strings).decode("utf-8", errors="ignore")
            records.append(txt)
        return records, None
    except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
        # Domain/subdomain genuinely doesn't have this record — confirmed absence
        return [], None
    except dns.exception.Timeout:
        return [], "DNS query timed out — result inconclusive, not a confirmed absence"
    except Exception as e:
        return [], f"DNS query failed: {e}"


def check_spf(domain: str) -> dict:
    result = {"present": False, "record": None, "issues": [], "error": None}
    records, error = _query_txt(domain)

    if error:
        result["error"] = error
        result["issues"].append(f"Could not verify SPF: {error}")
        return result

    spf_records = [r for r in records if r.strip().startswith("v=spf1")]

    if not spf_records:
        result["issues"].append("No SPF record found")
        return result

    if len(spf_records) > 1:
        result["issues"].append("Multiple SPF records found (invalid per RFC 7208 — only one allowed)")

    record = spf_records[0]
    result["present"] = True
    result["record"] = record

    if record.strip().endswith("+all"):
        result["issues"].append("SPF record ends in '+all' — allows ANY server to send mail as this domain (critical misconfiguration)")
    elif "?all" in record:
        result["issues"].append("SPF record uses '?all' (neutral) — provides little real protection")
    elif not (record.strip().endswith("-all") or record.strip().endswith("~all")):
        result["issues"].append("SPF record has no clear 'all' mechanism — enforcement unclear")

    return result


def check_dmarc(domain: str) -> dict:
    result = {"present": False, "record": None, "policy": None, "issues": [], "error": None}
    records, error = _query_txt(f"_dmarc.{domain}")

    if error:
        result["error"] = error
        result["issues"].append(f"Could not verify DMARC: {error}")
        return result

    dmarc_records = [r for r in records if r.strip().startswith("v=DMARC1")]

    if not dmarc_records:
        result["issues"].append("No DMARC record found")
        return result

    record = dmarc_records[0]
    result["present"] = True
    result["record"] = record

    # Extract policy (p=none / p=quarantine / p=reject)
    policy = None
    for part in record.split(";"):
        part = part.strip()
        if part.lower().startswith("p="):
            policy = part.split("=", 1)[1].lower()
            break

    result["policy"] = policy

    if policy == "none":
        result["issues"].append("DMARC policy is 'none' — monitoring only, no real enforcement against spoofing")
    elif policy is None:
        result["issues"].append("DMARC record found but no policy (p=) tag detected — malformed record")

    return result


def _query_caa(name: str) -> tuple[list[str], str | None]:
    """
    Returns (list_of_caa_records, error), mirroring _query_txt semantics:
    error is None on a successful lookup (even when no records exist);
    error is a string only when the query itself failed (timeout/resolver).
    """
    try:
        answers = dns.resolver.resolve(name, "CAA", lifetime=5)
        return [rdata.to_text() for rdata in answers], None
    except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
        return [], None
    except dns.exception.Timeout:
        return [], "DNS query timed out — result inconclusive, not a confirmed absence"
    except Exception as e:
        return [], f"DNS query failed: {e}"


def check_caa(domain: str) -> dict:
    """
    Checks for CAA records (RFC 8659). CAA restricts which Certificate
    Authorities may issue certificates for the domain, limiting the blast
    radius of a rogue/mis-issued certificate. Absence is common and low-risk,
    so it is reported informationally rather than penalised.
    """
    result = {"present": False, "records": [], "issues": [], "error": None}
    records, error = _query_caa(domain)

    if error:
        result["error"] = error
        result["issues"].append(f"Could not verify CAA: {error}")
        return result

    if not records:
        result["issues"].append("No CAA record found — any CA may issue certificates for this domain")
        return result

    result["present"] = True
    result["records"] = records
    return result


def check_dkim(domain: str, selectors: list[str] = None) -> dict:
    """
    DKIM has no single discoverable record — we probe common selectors.
    A negative result here does NOT prove DKIM is absent; it may just use
    a selector not in our list. Always note this caveat in the report.
    """
    if selectors is None:
        selectors = COMMON_DKIM_SELECTORS

    result = {"present": False, "found_selectors": [], "checked_selectors": selectors, "issues": [], "errors": []}

    for selector in selectors:
        name = f"{selector}._domainkey.{domain}"
        records, error = _query_txt(name)
        if error:
            result["errors"].append(f"{selector}: {error}")
            continue
        dkim_records = [r for r in records if "v=DKIM1" in r or "p=" in r]
        if dkim_records:
            result["present"] = True
            result["found_selectors"].append(selector)

    if not result["present"]:
        result["issues"].append(
            f"No DKIM record found on common selectors ({', '.join(selectors)}) — "
            f"may use a custom selector not checked here; verify manually with the mail provider"
        )

    return result


def check_dns_auth(domain: str) -> dict:
    """Runs SPF, DMARC, DKIM, and CAA checks together for a domain."""
    return {
        "domain": domain,
        "spf": check_spf(domain),
        "dmarc": check_dmarc(domain),
        "dkim": check_dkim(domain),
        "caa": check_caa(domain),
    }

