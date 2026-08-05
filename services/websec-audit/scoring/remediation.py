"""
scoring/remediation.py
Maps each finding (by its stable `code`) to a concrete, bilingual remediation
recommendation and to the security frameworks it relates to
(OWASP Top 10, OWASP Secure Headers, CWE, MITRE ATT&CK, relevant RFC/NIST).

Why this exists
---------------
A security audit report is only actionable if every finding says *what to do
about it* and *why it matters*. The framework references also let a SOC map
findings to the language management and auditors already use (OWASP / MITRE).

`enrich_findings()` is called by the scoring engine so recommendations travel
with each finding into the CLI, the dashboard, and the HTML/PDF reports.
"""

from __future__ import annotations

import re

# code -> {"en": recommendation, "fr": recommandation, "refs": [framework tags]}
REMEDIATION: dict[str, dict] = {
    # --- availability ---
    "availability.site_down": {
        "en": "Confirm the host and web service are running and reachable; check DNS, firewall and the HTTP server process.",
        "fr": "Vérifiez que l'hôte et le service web fonctionnent et sont joignables ; contrôlez le DNS, le pare-feu et le processus du serveur HTTP.",
        "refs": ["OWASP A05:2021", "MITRE T1499"],
    },
    # --- tls ---
    "tls.cert_expired": {
        "en": "Renew and deploy a valid certificate immediately, and automate renewal (e.g. ACME/Let's Encrypt) so it never lapses again.",
        "fr": "Renouvelez et déployez immédiatement un certificat valide, puis automatisez le renouvellement (ex. ACME/Let's Encrypt) pour éviter toute expiration.",
        "refs": ["OWASP A02:2021", "NIST SP 800-52r2", "MITRE T1557"],
    },
    "tls.cert_expiring": {
        "en": "Renew the certificate before it expires and set up expiry monitoring/auto-renewal to avoid an outage.",
        "fr": "Renouvelez le certificat avant son expiration et mettez en place une surveillance/renouvellement automatique pour éviter une interruption.",
        "refs": ["OWASP A02:2021", "NIST SP 800-52r2"],
    },
    "tls.cert_untrusted": {
        "en": "Serve a certificate issued by a publicly trusted CA and include the full intermediate chain.",
        "fr": "Servez un certificat émis par une AC publiquement reconnue et incluez toute la chaîne intermédiaire.",
        "refs": ["OWASP A02:2021", "MITRE T1557"],
    },
    "tls.protocol_ssl": {
        "en": "Disable SSLv2/SSLv3 entirely; they are broken (POODLE/DROWN). Serve TLS 1.2+ only.",
        "fr": "Désactivez complètement SSLv2/SSLv3 (vulnérables à POODLE/DROWN). N'autorisez que TLS 1.2+.",
        "refs": ["OWASP A02:2021", "NIST SP 800-52r2", "MITRE T1557"],
    },
    "tls.protocol_tls_legacy": {
        "en": "Disable TLS 1.0/1.1 and require TLS 1.2 or 1.3 with modern cipher suites.",
        "fr": "Désactivez TLS 1.0/1.1 et exigez TLS 1.2 ou 1.3 avec des suites de chiffrement modernes.",
        "refs": ["OWASP A02:2021", "NIST SP 800-52r2", "PCI DSS 4.0"],
    },
    # --- headers (per-header) ---
    "headers.missing.strict-transport-security": {
        "en": "Add 'Strict-Transport-Security: max-age=31536000; includeSubDomains' to force HTTPS and block downgrade attacks.",
        "fr": "Ajoutez « Strict-Transport-Security: max-age=31536000; includeSubDomains » pour forcer HTTPS et bloquer les attaques de rétrogradation.",
        "refs": ["OWASP A05:2021", "OWASP Secure Headers", "CWE-319", "MITRE T1557"],
    },
    "headers.missing.content-security-policy": {
        "en": "Define a Content-Security-Policy that restricts script/style/object sources to trusted origins to mitigate XSS.",
        "fr": "Définissez une Content-Security-Policy limitant les sources de scripts/styles/objets aux origines de confiance pour atténuer le XSS.",
        "refs": ["OWASP A03:2021", "OWASP Secure Headers", "CWE-79"],
    },
    "headers.missing.x-frame-options": {
        "en": "Set 'X-Frame-Options: DENY' (or a CSP frame-ancestors directive) to prevent clickjacking.",
        "fr": "Définissez « X-Frame-Options: DENY » (ou la directive CSP frame-ancestors) pour empêcher le clickjacking.",
        "refs": ["OWASP A05:2021", "OWASP Secure Headers", "CWE-1021"],
    },
    "headers.missing.x-content-type-options": {
        "en": "Set 'X-Content-Type-Options: nosniff' to stop MIME-type sniffing.",
        "fr": "Définissez « X-Content-Type-Options: nosniff » pour empêcher le MIME-sniffing.",
        "refs": ["OWASP A05:2021", "OWASP Secure Headers", "CWE-430"],
    },
    "headers.missing.referrer-policy": {
        "en": "Set a Referrer-Policy such as 'strict-origin-when-cross-origin' to limit referrer leakage.",
        "fr": "Définissez une Referrer-Policy telle que « strict-origin-when-cross-origin » pour limiter la fuite du référent.",
        "refs": ["OWASP A05:2021", "OWASP Secure Headers"],
    },
    "headers.missing.permissions-policy": {
        "en": "Add a Permissions-Policy to disable browser features (camera, geolocation, etc.) the site does not use.",
        "fr": "Ajoutez une Permissions-Policy pour désactiver les fonctionnalités navigateur (caméra, géolocalisation…) non utilisées.",
        "refs": ["OWASP A05:2021", "OWASP Secure Headers"],
    },
    "headers.cookie_flags": {
        "en": "Set Secure, HttpOnly and SameSite on all cookies to protect session tokens from theft and CSRF.",
        "fr": "Activez Secure, HttpOnly et SameSite sur tous les cookies pour protéger les jetons de session du vol et du CSRF.",
        "refs": ["OWASP A05:2021", "CWE-614", "CWE-1004"],
    },
    "headers.hsts_short": {
        "en": "Increase the HSTS max-age to at least 31536000 (1 year) and add includeSubDomains so the HTTPS-only policy is durable.",
        "fr": "Augmentez le max-age de HSTS à au moins 31536000 (1 an) et ajoutez includeSubDomains pour que la politique HTTPS soit durable.",
        "refs": ["OWASP A05:2021", "OWASP Secure Headers", "CWE-319"],
    },
    # --- dns_auth ---
    "dns.spf_missing": {
        "en": "Publish an SPF TXT record listing authorised mail servers and ending in '-all' (hardfail).",
        "fr": "Publiez un enregistrement SPF (TXT) listant les serveurs de messagerie autorisés et se terminant par « -all ».",
        "refs": ["RFC 7208", "MITRE T1566", "M3AAWG"],
    },
    "dns.spf_permissive": {
        "en": "Replace the trailing '+all' with '-all' so unlisted servers cannot send mail as your domain.",
        "fr": "Remplacez le « +all » final par « -all » afin qu'aucun serveur non listé ne puisse envoyer au nom de votre domaine.",
        "refs": ["RFC 7208", "MITRE T1566"],
    },
    "dns.spf_neutral": {
        "en": "Tighten the SPF from '?all' (neutral) to '-all' (hardfail) once senders are confirmed.",
        "fr": "Renforcez le SPF de « ?all » (neutre) vers « -all » une fois les expéditeurs confirmés.",
        "refs": ["RFC 7208"],
    },
    "dns.dmarc_missing": {
        "en": "Publish a DMARC record (start at p=none with rua reporting, then move to quarantine/reject).",
        "fr": "Publiez un enregistrement DMARC (commencez par p=none avec rapports rua, puis passez à quarantine/reject).",
        "refs": ["RFC 7489", "MITRE T1566", "M3AAWG"],
    },
    "dns.dmarc_policy_none": {
        "en": "Advance the DMARC policy from p=none to p=quarantine then p=reject to actively block spoofed mail.",
        "fr": "Faites évoluer la politique DMARC de p=none vers p=quarantine puis p=reject pour bloquer activement les usurpations.",
        "refs": ["RFC 7489", "MITRE T1566"],
    },
    # --- misconfig ---
    "misconfig.exposed_path": {
        "en": "Remove the exposed file/directory from the web root and block access to sensitive paths; rotate any leaked secrets.",
        "fr": "Retirez le fichier/répertoire exposé de la racine web et bloquez l'accès aux chemins sensibles ; renouvelez tout secret divulgué.",
        "refs": ["OWASP A05:2021", "OWASP A01:2021", "CWE-538", "MITRE T1213"],
    },
    "misconfig.directory_listing": {
        "en": "Disable automatic directory indexing in the web server configuration (e.g. 'Options -Indexes').",
        "fr": "Désactivez l'indexation automatique des répertoires dans la configuration du serveur web (ex. « Options -Indexes »).",
        "refs": ["OWASP A05:2021", "CWE-548"],
    },
    "misconfig.dangerous_method": {
        "en": "Disable TRACE/TRACK (and other unused HTTP methods) to prevent Cross-Site Tracing.",
        "fr": "Désactivez TRACE/TRACK (et les autres méthodes HTTP inutilisées) pour empêcher le Cross-Site Tracing.",
        "refs": ["OWASP A05:2021", "CWE-693"],
    },
    "misconfig.tech_disclosure": {
        "en": "Suppress or genericise version banners (Server, X-Powered-By, …) to reduce reconnaissance value.",
        "fr": "Masquez ou banalisez les bannières de version (Server, X-Powered-By…) pour réduire la valeur de reconnaissance.",
        "refs": ["OWASP A05:2021", "CWE-200"],
    },
    # --- subdomain takeover / dangling DNS ---
    "takeover.vulnerable": {
        "en": "Reclaim or delete the dangling DNS record immediately: either re-create the third-party resource the CNAME points to, or remove the CNAME so an attacker cannot claim it and serve content from your subdomain.",
        "fr": "Récupérez ou supprimez immédiatement l'enregistrement DNS orphelin : recréez la ressource tierce visée par le CNAME, ou supprimez le CNAME afin qu'un attaquant ne puisse pas la revendiquer et servir du contenu depuis votre sous-domaine.",
        "refs": ["OWASP A05:2021", "CWE-350", "MITRE T1584.001"],
    },
    "takeover.dangling": {
        "en": "Remove the CNAME pointing to a non-existent target, or re-provision that target under your control, so the subdomain cannot be claimed by an attacker.",
        "fr": "Supprimez le CNAME pointant vers une cible inexistante, ou reprovisionnez cette cible sous votre contrôle, afin que le sous-domaine ne puisse pas être revendiqué par un attaquant.",
        "refs": ["OWASP A05:2021", "CWE-350", "MITRE T1584.001"],
    },
    # --- cve ---
    "cve.known_vulnerable": {
        "en": "Upgrade the affected software to a patched, currently-supported version, and subscribe to its security advisories so future CVEs are patched promptly.",
        "fr": "Mettez à jour le logiciel concerné vers une version corrigée et encore maintenue, et abonnez-vous à ses bulletins de sécurité pour appliquer rapidement les futurs correctifs.",
        "refs": ["OWASP A06:2021", "CWE-1035", "CWE-937"],
    },
    # --- external engines ---
    "testssl.finding": {
        "en": "Review the reported TLS weaknesses in testssl.sh and reconfigure the server: disable weak ciphers/protocols, prefer forward-secrecy suites, and patch any flagged TLS CVE.",
        "fr": "Examinez les faiblesses TLS signalées par testssl.sh et reconfigurez le serveur : désactivez les chiffrements/protocoles faibles, privilégiez la confidentialité persistante et corrigez toute CVE TLS signalée.",
        "refs": ["OWASP A02:2021", "NIST SP 800-52r2"],
    },
    "nuclei.finding": {
        "en": "Triage each nuclei detection: confirm it, then patch the vulnerable component, remove the exposed resource, or fix the misconfiguration it identifies.",
        "fr": "Analysez chaque détection nuclei : confirmez-la, puis corrigez le composant vulnérable, supprimez la ressource exposée ou corrigez la mauvaise configuration identifiée.",
        "refs": ["OWASP A05:2021", "OWASP A06:2021"],
    },
    "zap.finding": {
        "en": "Address the OWASP ZAP web-application findings — e.g. add anti-CSRF tokens, fix cookie flags/CSP, and remove information leakage — then re-scan to confirm.",
        "fr": "Corrigez les constats applicatifs d'OWASP ZAP — p. ex. ajoutez des jetons anti-CSRF, corrigez les attributs de cookies/la CSP et supprimez les fuites d'information — puis relancez l'analyse.",
        "refs": ["OWASP A01:2021", "OWASP A05:2021"],
    },
}

# Informational codes have no penalty and only advisory guidance.
_INFO_DEFAULT = {
    "en": "Informational — no action strictly required; review as part of hardening.",
    "fr": "Informatif — aucune action strictement requise ; à examiner lors du durcissement.",
    "refs": [],
}
_GENERIC_DEFAULT = {
    "en": "Review this finding and apply the relevant vendor/framework hardening guidance.",
    "fr": "Examinez ce constat et appliquez les recommandations de durcissement du fournisseur/framework concerné.",
    "refs": ["OWASP A05:2021"],
}

_SPECIAL_INFO = {
    "takeover.third_party": {
        "en": "This subdomain points to a third-party service known to be takeover-prone. Confirm the backing resource is claimed and owned by you, and remove the CNAME if the service is no longer used.",
        "fr": "Ce sous-domaine pointe vers un service tiers connu pour être sujet aux prises de contrôle. Vérifiez que la ressource sous-jacente est bien revendiquée et vous appartient, et supprimez le CNAME si le service n'est plus utilisé.",
        "refs": ["OWASP A05:2021", "MITRE T1584.001"],
    },
    "misconfig.security_txt": {
        "en": "Optionally publish a /.well-known/security.txt (RFC 9116) with a security contact.",
        "fr": "Publiez éventuellement un /.well-known/security.txt (RFC 9116) avec un contact sécurité.",
        "refs": ["RFC 9116"],
    },
    "dns.caa_missing": {
        "en": "Optionally publish CAA records (RFC 8659) naming the CAs allowed to issue certificates for the domain.",
        "fr": "Publiez éventuellement des enregistrements CAA (RFC 8659) désignant les AC autorisées à émettre des certificats pour le domaine.",
        "refs": ["RFC 8659"],
    },
    "misconfig.soft_404": {
        "en": "The server returns 200 for paths that do not exist, so content-discovery results cannot be trusted here. Return a real 404 for unknown paths, then re-scan to get a conclusive result.",
        "fr": "Le serveur renvoie 200 pour des chemins inexistants : les résultats de découverte de contenu ne sont donc pas fiables ici. Renvoyez un vrai 404 pour les chemins inconnus, puis relancez le scan pour obtenir un résultat concluant.",
        "refs": ["RFC 9110"],
    },
}

# Being blocked is a coverage gap, not a weakness: the guidance is about how to
# obtain a real measurement, never about "fixing" the site.
_BLOCKED_REMEDIATION = {
    "en": "This check never reached the application — an anti-bot/WAF interstitial answered instead, so its result proves nothing about the site. Allowlist the scanner's source IP or User-Agent at the WAF/host (or scan from inside the perimeter) and re-run to get a real measurement.",
    "fr": "Ce contrôle n'a jamais atteint l'application — une page de challenge anti-bot/WAF a répondu à la place, son résultat ne prouve donc rien sur le site. Autorisez l'IP source ou le User-Agent du scanner au niveau du WAF/hébergeur (ou scannez depuis l'intérieur du périmètre) et relancez pour obtenir une vraie mesure.",
    "refs": [],
}
for _category in ("headers", "misconfig", "cve"):
    _SPECIAL_INFO[f"{_category}.blocked_by_challenge"] = _BLOCKED_REMEDIATION


# --- Reference tag -> canonical documentation URL --------------------------
# So every framework tag (and CVE id) shown next to a finding is a clickable
# link the reader can follow to learn what the weakness is and how to fix it.
_OWASP_TOP10_2021 = {
    "A01": "https://owasp.org/Top10/A01_2021-Broken_Access_Control/",
    "A02": "https://owasp.org/Top10/A02_2021-Cryptographic_Failures/",
    "A03": "https://owasp.org/Top10/A03_2021-Injection/",
    "A04": "https://owasp.org/Top10/A04_2021-Insecure_Design/",
    "A05": "https://owasp.org/Top10/A05_2021-Security_Misconfiguration/",
    "A06": "https://owasp.org/Top10/A06_2021-Vulnerable_and_Outdated_Components/",
    "A07": "https://owasp.org/Top10/A07_2021-Identification_and_Authentication_Failures/",
    "A08": "https://owasp.org/Top10/A08_2021-Software_and_Data_Integrity_Failures/",
    "A09": "https://owasp.org/Top10/A09_2021-Security_Logging_and_Monitoring_Failures/",
    "A10": "https://owasp.org/Top10/A10_2021-Server-Side_Request_Forgery_%28SSRF%29/",
}

# Exact-match tags (no embedded identifier to parse).
_STATIC_REF_URLS = {
    "OWASP Secure Headers": "https://owasp.org/www-project-secure-headers/",
    "PCI DSS 4.0": "https://www.pcisecuritystandards.org/document_library/",
    "M3AAWG": "https://www.m3aawg.org/published-documents",
    "NIST SP 800-52r2": "https://csrc.nist.gov/pubs/sp/800/52/r2/final",
}


def reference_url(tag: str) -> str | None:
    """Resolves a reference tag (e.g. 'CWE-319', 'OWASP A02:2021', 'CVE-2024-1')
    to the canonical documentation URL, or ``None`` if it isn't recognised."""
    if not tag:
        return None
    tag = tag.strip()
    if tag in _STATIC_REF_URLS:
        return _STATIC_REF_URLS[tag]
    m = re.fullmatch(r"OWASP (A\d\d):2021", tag)
    if m:
        return _OWASP_TOP10_2021.get(m.group(1))
    m = re.fullmatch(r"CWE-(\d+)", tag)
    if m:
        return f"https://cwe.mitre.org/data/definitions/{m.group(1)}.html"
    m = re.fullmatch(r"MITRE (T\d+(?:\.\d+)?)", tag)
    if m:
        return f"https://attack.mitre.org/techniques/{m.group(1).replace('.', '/')}/"
    m = re.fullmatch(r"RFC (\d+)", tag)
    if m:
        return f"https://www.rfc-editor.org/rfc/rfc{m.group(1)}"
    if re.fullmatch(r"CVE-\d{4}-\d+", tag):
        return f"https://nvd.nist.gov/vuln/detail/{tag}"
    return None


def _reference_links(refs: list[str], cve_ids: list[str]) -> list[dict]:
    """Builds [{label, url}] link objects for a finding's framework tags and any
    CVE ids, so templates can render them as clickable links."""
    links = [{"label": r, "url": reference_url(r)} for r in refs]
    for cid in cve_ids:
        links.append({"label": cid, "url": reference_url(cid)})
    return links


def remediation_for(code: str | None, severity: str) -> dict:
    """Returns {recommendation_en, recommendation_fr, references} for a finding."""
    entry = None
    if code:
        entry = REMEDIATION.get(code) or _SPECIAL_INFO.get(code)
    if entry is None:
        entry = _INFO_DEFAULT if severity == "info" else _GENERIC_DEFAULT
    return {
        "recommendation_en": entry["en"],
        "recommendation_fr": entry["fr"],
        "references": list(entry["refs"]),
    }


def enrich_findings(findings: list[dict]) -> list[dict]:
    """Attaches recommendation + framework references to each finding in place.

    Adds ``reference_links`` ([{label, url}]) alongside the plain ``references``
    tags so every framework reference and CVE id is a clickable link to its
    canonical documentation (OWASP/CWE/MITRE/RFC/NIST/NVD).
    """
    for f in findings:
        info = remediation_for(f.get("code"), f.get("severity", "info"))
        f.update(info)
        f["reference_links"] = _reference_links(info["references"],
                                                f.get("cve_ids") or [])
    return findings


def backfill_reference_links(findings: list[dict]) -> list[dict]:
    """Non-destructively ensures each finding has clickable ``reference_links``.

    Unlike :func:`enrich_findings`, this never overwrites a finding's stored
    recommendation text; it only fills in ``reference_links`` (deriving
    ``references`` from the finding's code when entirely absent). Used when
    rendering findings persisted before ``reference_links`` existed, so old
    scans still show clickable reference tags.
    """
    for f in findings:
        if f.get("reference_links"):
            continue
        refs = f.get("references")
        if refs is None:
            refs = remediation_for(f.get("code"), f.get("severity", "info"))["references"]
            f["references"] = list(refs)
        f["reference_links"] = _reference_links(refs, f.get("cve_ids") or [])
    return findings
