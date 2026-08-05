# Web Security Audit Tool / Outil d'audit de sécurité web

> Automated security auditing & monitoring for the web sites hosted on the
> company's servers.
> Audit et surveillance automatisés de la sécurité des sites web hébergés sur
> les serveurs de l'entreprise.

[![Python](https://img.shields.io/badge/python-3.11%20%7C%203.12%20%7C%203.13-blue)](pyproject.toml)
[![tests](https://img.shields.io/badge/tests-pytest-blue)](tests/)

---

### Screenshots

| Global dashboard | Per-site drill-down |
|---|---|
| ![Global dashboard](docs/img/dashboard.png) | ![Per-site page](docs/img/site.png) |

---

## 🇬🇧 English

### What it does

The tool scans a configurable list of web sites and, for each one, evaluates its
security posture, detects anomalies, computes a global security score (0–100 +
letter grade), tracks how that score evolves over time, produces a detailed
**HTML and PDF** report with recommendations, and can **email an alert** when a
critical problem is detected. Sites are scanned **concurrently** — by default
every site is scanned in parallel (one worker per site, capped at 500), so a
sweep of dozens or hundreds of sites takes about as long as the single slowest
site instead of the sum of all of them. Use `--workers N` to cap concurrency.

It ships with two front-ends over the same engine and database:

- a **CLI** (`main.py`) for one-off or cron/systemd-scheduled audits, and
- an **interactive web dashboard** (FastAPI + HTMX + Chart.js) with a fleet
  overview, per-site drill-down (score-over-time chart, findings with
  recommendations, run history), downloadable per-site reports, a
  **"Run audit now"** button and optional scheduled scans.

Every finding is enriched with a bilingual **recommendation** and mapped to
security frameworks (**OWASP Top 10, CWE, MITRE ATT&CK, RFC, NIST**).

### Checks performed

| Area | What is verified |
|------|------------------|
| **Availability** | Site is up, response time, HTTP→HTTPS redirection |
| **TLS/SSL** | Protocol strength, certificate validity & expiry date, trust chain |
| **HTTP headers** | HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, secure cookie flags |
| **DNS / email auth** | SPF, DKIM, DMARC records and their policies |
| **Subdomain takeover** | Dangling DNS / CNAMEs pointing at unclaimed third-party services (GitHub Pages, S3, Heroku, Azure, Shopify, …) and non-existent (NXDOMAIN) targets |
| **Misconfigurations** | Version/banner disclosure, directory listing, exposed sensitive files (`.git`, `.env`, …), dangerous HTTP methods (TRACE), `security.txt` |
| **Known CVEs** | Detected software/version banners (Apache, nginx, PHP, …) matched against the NVD vulnerability database |
| **Open ports** | Top-100 TCP ports — **only with `--authorized`** |
| **Deep TLS** *(engine)* | Full `testssl.sh` audit: cipher strength, forward secrecy, ROBOT/BEAST/Heartbleed/POODLE, key size, OCSP — **`--deep`** |
| **Templated vulns/CVEs** *(engine)* | `nuclei`'s maintained template library: real CVE checks, exposed panels/configs, default creds, misconfigs — **`--deep`** |
| **Web-app findings** *(engine)* | OWASP ZAP baseline (passive): missing anti-CSRF tokens, cookie/CSP issues, information leakage — **`--deep`**, with `WITH_ZAP=true` in Docker |

> The last three are **deep external-engine** scanners. They are far more
> thorough but slower and need their binaries installed (the Docker image bundles
> `nuclei` + `testssl.sh`). Enable them with `--deep` (CLI) or `AUDIT_DEEP=true`
> (dashboard/Docker). If an engine binary is missing, its result is reported as
> *inconclusive* — the rest of the audit is unaffected.
>
> **No scanner detects everything.** This tool automates external posture +
> known-vulnerability checks; a complete assurance program still needs
> authenticated testing and periodic manual penetration testing.

### Asset discovery (EASM)

Instead of hand-maintaining the target list, point the tool at one or more
**root domains** and let it enumerate the attack surface itself. Subdomains are
discovered from **three independent sources** and merged, so one provider being
down — or a whole source type having a blind spot — only degrades coverage:

- **Certificate Transparency** — two aggregators, **crt.sh** and **Cert Spotter**.
- **Passive DNS** — **HackerTarget** (keyless), a *non-CT* source that finds
  hosts which have never been issued a public certificate (CT's blind spot).
- **Reverse DNS (PTR) expansion** *(opt-in)* — the resolved IPs are PTR-swept
  for additional **in-scope** hostnames named differently from anything the
  forward sources found (a light form of ASN/IP-range reverse expansion). Enable
  with `--expand` (CLI) or `expand: true` (config).

Results are then filtered by **DNS resolution** so only live hosts are scanned,
and merged with any static `sites:` (de-duplicated).

```bash
# CLI: discover + scan example.com's subdomains (merged with config sites)
python main.py --discover example.com
```

Or enable it in `config/targets.yaml` so the dashboard and scheduled scans pick
it up too:

```yaml
discover:
  enabled: true
  domains: [example.com]
  resolve: true      # keep only hostnames that currently resolve
  expand: false      # reverse-DNS (PTR) expansion of the resolved IPs
  bruteforce: false  # keyless DNS brute-force of common subdomain labels
```

**DNS brute-force (keyless).** Add `--bruteforce` (or `bruteforce: true`) to also
resolve a built-in list of common subdomain labels (`api`, `vpn`, `staging`,
`grafana`, …). This surfaces live hosts that have **no public certificate and no
passive-DNS record** — the blind spot of the CT/passive sources — using nothing
but DNS lookups.

**ASN / IP-range expansion.** `asn_prefixes("AS64500")` turns an owner ASN into
the concrete BGP prefixes it announces (via BGPView, free/keyless), and
`reverse_sweep_prefix(cidr, roots)` PTR-sweeps a **bounded** IPv4 range (≤ /24 by
default) keeping only in-scope hostnames — a light form of IP-range shadow-IT
discovery.

**Cloud storage bucket enumeration.** Add `--buckets` to probe **S3, GCS and
Azure Blob** for likely public buckets derived from the target domains
(`example`, `example-assets`, `example-backups`, …). Read-only (one
unauthenticated GET per provider); each hit is reported as `public` (listable) or
`private` (exists but access-controlled). Keyless and fail-safe.

Discovery is **fail-safe** (a network error degrades to whatever was found, it
never blocks a scan) and results are cached per root domain. Active scanning
stays authorization-gated — **only discover domains you are authorised to audit.**

**Ownership attribution (WHOIS / ASN).** Add `--attribute` to tie each
discovered asset to its network: resolved IP + origin **ASN and AS owner** (via
Team Cymru, DNS-only), so you can see *which organisation/network* an asset
belongs to. `rdap_domain()` also exposes WHOIS-style registration data
(registrar, created/expiry, nameservers) over RDAP.

```bash
python main.py --discover example.com --attribute
```

**Ownership scoping (confidence-scored attribution).** Discovery from CT,
passive DNS and reverse/ASN sweeps inevitably surfaces neighbours on shared
infrastructure (a CDN edge, a co-hosted site, a SaaS tenant). Add `--scope` to
score how confidently each asset **belongs to the organisation** instead of
scanning everything blindly. An *organisation identity* is fused from keyless
signals on the seed domains — RDAP **registrant org**, owner **ASN(s)** and their
announced **BGP prefixes**, and each apex's TLS **certificate org** — then every
asset is scored by how many *independent* signals corroborate it:

| Signal | Meaning |
| --- | --- |
| `dns-in-scope` | hostname is under a seed root domain |
| `ip-in-owned-prefix` | resolves into a BGP prefix the org's ASN announces |
| `asn-match` | resolved IP's origin ASN matches an owner ASN |
| `cert-org-match` | TLS certificate `O=` matches the org identity |

Each asset gets `ownership = {confidence: 0..1, label, signals}` with a label of
`confirmed` / `probable` / `possible` / `unrelated`. Signals only ever *add*
confidence, so an asset with no corroboration lands at `unrelated` rather than
being assumed in-scope — which is what keeps unrelated tenants out. Keyless and
fail-safe (a slow feed lowers confidence, it can't crash a scan).

```bash
python main.py --discover example.com --attribute --scope
```

**Subdomain-takeover detection.** The `takeover` scanner (part of the default
core sweep) follows each host's CNAME chain and flags two conditions: a CNAME to
a known takeover-prone service whose page shows an *unclaimed-resource*
fingerprint (reported *confirmed*), and a CNAME whose target no longer exists at
all (NXDOMAIN dangling DNS). It is **read-only and non-intrusive** — it never
registers or claims any resource — and any DNS/HTTP error is reported as
*inconclusive* rather than "not vulnerable". A bare CNAME to a third party with a
claimed resource is only surfaced informationally, to keep false positives low.

**Surface-change tracking (continuous EASM).** Each discovery run is compared to
the previous one and **newly-exposed** / **disappeared** assets are reported
(`[surface] NEW assets …`) — the signal you want on a 24/7 monitoring screen.
A per-asset inventory (`host -> {first_seen, last_seen, ips, asn}`) is persisted
in the database; legacy `host -> first_seen` inventories upgrade transparently.

### Automatic fix verification

Findings carry a remediation status (`open` / `in_progress` / `fixed`). On every
re-scan the tool **verifies fixes automatically**: a finding that was present in
the previous run but is no longer detected is recorded as `fixed` with a
timestamp and the reason (`Not detected in run #N`), and one that reappears is
re-opened as a regression. Operator-set statuses are always respected — the
auto-verifier only manages findings it verified itself, so a human decision is
never overwritten.

Each site keeps a **"Fixed & verified" ledger** (shown in the dashboard site view
and the HTML/PDF report, each entry tagged *auto-verified* or *operator*). This
is the durable record of *what has already been remediated* — so a re-scan, or an
**embedded remediation agent**, can read it and skip work that is already done
instead of repeating the same procedure every run. Programmatic access:
`db.models.fixed_findings(url)`.

### Clickable references

Every finding carries **clickable reference links**: framework tags (OWASP
Top 10, OWASP Secure Headers, CWE, MITRE ATT&CK, RFC, NIST) and each detected
**CVE id** link straight to their canonical documentation (owasp.org,
cwe.mitre.org, attack.mitre.org, rfc-editor.org, nvd.nist.gov). Click any tag in
the dashboard or the HTML/PDF report to read what the weakness is and how to fix
it.

### Quick start (Docker — recommended)

No Python setup, no native-library hassle; the image bundles `nuclei`,
`testssl.sh`, `nmap` and WeasyPrint's libs — nothing else to install:

```bash
# 1. Your targets (root domains are enough — assets are discovered)
$EDITOR config/targets.yaml
# 2. Your settings (database, schedule, dashboard password, alerts…)
cp .env.example .env && $EDITOR .env
# 3. Go
docker compose up -d --build       # dashboard → http://localhost:8000
docker compose run --rm audit      # one-off CLI audit (writes to the same DB)
```

Set `WITH_ZAP=true` in `.env` to also bake **OWASP ZAP** into the image (adds a
JRE, ~300 MB); `zap-baseline` is then detected automatically. The SQLite DB
persists in a named volume and reports appear in `reports/output/`.

➡ Deploying on a company server or embedding this in another platform? See the
**[Integration guide](docs/INTEGRATION.md)**.

### Quick start (local Python)

**Supported Python: 3.11 – 3.13.**

```bash
# 1. Install dependencies
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# For PDF reports you also need native libraries:
sudo apt install libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf2.0-0 libcairo2

# 2. Configure the sites to audit
$EDITOR config/targets.yaml

# 3. Run the full audit
python main.py

# 4. Read the report
open reports/output/audit_report_*.html   # or the .pdf
```

Common variants:

```bash
python main.py --scan tls headers        # only selected scanners
python main.py --deep                    # also run testssl/nuclei/zap (deeper, slower)
python main.py --deep --authorized       # deep + port scan + nuclei intrusive templates
python main.py --workers auto            # scan every site in parallel (default)
python main.py --workers 20              # cap parallelism at 20 sites at a time
python main.py --per-site-reports        # also write one report per site
python main.py --no-report --no-db       # scan + score, write JSON only
python main.py --alert                   # also send email alerts (needs SMTP env vars)
python main.py --authorized              # also run the port scan (authorization required!)
python main.py --history https://mysite.com   # print a site's score trend and exit
```

### Interactive dashboard

```bash
# Start the web dashboard (reuses the same DB the CLI writes to)
uvicorn dashboard.app:app --host 0.0.0.0 --port 8000
# then open http://localhost:8000
```

Three screens: a **global dashboard** (summary cards, grade distribution, fleet
score trend, sortable sites table, *Run audit now*), a **per-site page**
(score-over-time chart, findings + recommendations, run history, HTML/PDF
downloads), and **downloadable reports** (global + per-site).

For **continuous monitoring**, set `AUDIT_SCHEDULE_MINUTES` (a fixed interval)
and/or `AUDIT_SCHEDULE_AT` (specific daily times, e.g. `02:00,14:00`) for the
in-app APScheduler, or schedule `python main.py` with cron/systemd (see the
[User Manual](docs/USER_MANUAL.md)). The dashboard also has a **dark mode**
toggle in the header (remembered per browser).

#### Locking down the dashboard (production)

The dashboard triggers scans and edits remediation state, so protect it before
exposing it. Set a password to enable the built-in login gate:

```bash
export DASHBOARD_PASSWORD='choose-a-strong-secret'   # enables auth (required)
export DASHBOARD_USERNAME='admin'                    # optional, default: admin
export DASHBOARD_SECRET_KEY="$(openssl rand -hex 32)"  # stable cookie-signing key
export DASHBOARD_SESSION_HOURS=12                    # session lifetime (default 12)
```

- With no `DASHBOARD_PASSWORD`, the dashboard stays **open** (backwards
  compatible) and logs a warning — fine for a trusted localhost, not for a
  reachable deployment.
- Sessions use a signed, expiring, `HttpOnly`/`SameSite=Lax` cookie (no new
  dependency). It is marked `Secure` (TLS-only) unless you set
  `DASHBOARD_INSECURE_COOKIE=1` for plain-HTTP LAN use. **Run behind TLS.**
- Responses ship a strict **Content-Security-Policy** (`script-src 'self'` +
  per-request nonce, no CDN) plus `X-Content-Type-Options`, `X-Frame-Options`,
  and `Referrer-Policy`. All dashboard JS is self-hosted under `/static/js`.

Politeness / rate-limiting for the keyless network discovery (be a good net
citizen and avoid tripping resolver/cloud rate limits):

```bash
export EASM_DNS_DELAY_MS=50      # delay between DNS brute-force lookups
export EASM_BUCKET_DELAY_MS=100  # delay between cloud-bucket probes
```

### Embedding as a module

The tool is also a library. Install it (`pip install .`) and drive it from a host
platform through the stable `websec_audit` API — no CLI, no bundled dashboard, no
reliance on import-time environment variables:

```python
from websec_audit import AuditConfig

outcome = AuditConfig(
    sites=[{"name": "acme", "url": "https://acme.example"}],
    enabled=["availability", "tls", "headers", "cve"],
    engine_workers=4,           # cap heavy engine subprocesses fleet-wide
    batch_timeout=1800,         # hard wall-clock budget per sweep
    db_url="postgresql+psycopg://user:pass@host/db",  # per-tenant database
    generate_reports=False,     # the host renders its own UI
    suppressed_cve_ids=["CVE-2021-0001"],  # drop known false positives
).run()

outcome["run_uuid"]   # correlation id for the host's logs
outcome["duration_s"] # wall-clock scan+score time
outcome["stats"]      # {sites, errors, avg_score}
outcome["scored"]     # per-site: score, grade, findings, coverage
```

Designed for **200+ sites, 24/7**:

- **Trust semantics** — every finding carries a `confidence`
  (`confirmed` from an active engine detection, `potential` from a precise CPE
  version match, `low` from a fuzzy keyword match), and low-confidence CVEs are
  penalised less. Every site carries a `coverage` map
  (`ran` / `inconclusive` / `not_run`) so a check that never ran is never read
  as "clean". Suppress known false positives via `suppressed_cve_ids` (or the
  `CVE_SUPPRESS` env var).
- **Automatic false-positive reduction** — set `min_confidence`
  (`AuditConfig`/`run_audit`), the `--min-confidence`/`--confirmed-only` CLI
  flags, or the `AUDIT_MIN_CONFIDENCE` env var (dashboard/Docker) to drop
  findings below a confidence tier from the score, reports and alerts with **no
  manual triage**. `confirmed` keeps only actively-verified detections (nuclei/
  ZAP/testssl) plus directly-observed facts (expired cert, missing header, open
  listing); `potential` additionally keeps precise CPE version matches but drops
  fuzzy keyword guesses. Informational coverage notes are never hidden. This is
  the recommended way to cut version/backport false positives automatically —
  operators then only review the small residual of ambiguous cases.
- **OSV cross-verification** — enable `verify_backports` (`AuditConfig`/
  `run_audit`), `--verify-backports` (CLI) or `AUDIT_VERIFY_BACKPORTS=true`
  (dashboard/Docker) to check each detected CVE against the OSV database
  ([osv.dev](https://osv.dev)) and automatically **drop** any CVE OSV reports as
  *not affecting* the detected version — a second, independent, version-precise
  source removing false positives with no human triage. Fail-safe: a CVE is only
  dropped on a positive "not affected" signal; lookup errors or unknown records
  keep the CVE untouched (never a false negative from a flaky network).
- **Threat-intel prioritisation (free)** — banner-derived CVEs are enriched
  against **CISA KEV** (actively-exploited catalog) and **EPSS** (FIRST
  exploit-probability), both keyless. A KEV hit is escalated to *critical* and
  tagged `[KEV: actively exploited]`, EPSS is shown as `[EPSS 97%]`, and the
  CVE list is re-ordered so the most exploitable lead — turning detection into
  *fix-this-first* prioritisation. On by default; disable with `CVE_ENRICH=false`.
- **Scale controls** — a separate, small `engine_workers` cap keeps heavy
  testssl/nuclei/zap subprocesses bounded no matter how many sites scan in
  parallel, and `batch_timeout` guarantees a sweep finishes on cadence.
- **NVD at fleet scale** — CVE lookups honour `Retry-After` and back off on
  429/403 (set `NVD_API_KEY` for the higher limit), and results are cached with
  a TTL (`NVD_CACHE_TTL`) and a size bound (`NVD_CACHE_MAX`).
- **Persistence** — pass any SQLAlchemy `db_url` (SQLite or PostgreSQL — the
  `psycopg` driver is bundled in the image, or `pip install ".[postgres]"`; the
  schema is created on first run, no migration step). Coverage is persisted,
  latest-state queries are indexed and scale with the number of *sites* not
  *runs*, and retention is bounded by `prune_history(keep_runs=…,
  older_than_days=…)` — or automatically after every scan by setting
  `AUDIT_PRUNE_KEEP_RUNS` / `AUDIT_PRUNE_DAYS` (`--prune-keep-runs` /
  `--prune-days` on the CLI).

Lower-level entry points (`run_audit`, `run_scans`, `score_all`, `prune_history`)
are re-exported from `websec_audit` too.

### Regulatory compliance (France & Morocco)

Every scored site includes a **compliance** view that maps the tool's
externally-observable technical controls (TLS, security headers, cookie flags,
SPF/DMARC, information exposure, known CVEs, availability, security contact) to
the official information-security governance frameworks of:

- **France** — ANSSI (hygiene guide + TLS recommendations), RGS, GDPR/CNIL.
- **Morocco** — DGSSI (DNSSI), Law 09-08 (CNDP), Law 05-20 on cybersecurity.

Each control is reported as **compliant / non-compliant / partial / not
assessed** (a control whose scanner did not run is *never* silently counted as
compliant), with a per-country compliance score. It appears in the per-site
dashboard page and the single-site HTML/PDF report, and in the API on each
scored site under `site["compliance"]`.

> ⚠️ **Technical mapping only — not a legal certification.** It indicates
> alignment with the *technical* recommendations of each framework. It does not
> cover organisational/documentary obligations (risk analysis, governance,
> incident response, audits), and the applicability of each law/framework to a
> given organisation must be confirmed by that organisation / its legal team.

### Documentation

- **[Integration guide / Guide d'intégration](docs/INTEGRATION.md)** — deploy on your server, or embed as a module in another platform.
- **[User Manual / Manuel utilisateur](docs/USER_MANUAL.md)** — how to configure, run and read reports.
- **[Technical Documentation / Documentation technique](docs/TECHNICAL.md)** — architecture, scoring rubric, data model, extending.

### ⚠️ Authorization

Port scanning company infrastructure without **written** authorization can be a
policy violation or illegal. The port scanner refuses to run unless you pass
`--authorized`. Only audit systems you are permitted to test.

---

## 🇫🇷 Français

### Ce que fait l'outil

L'outil analyse une liste configurable de sites web et, pour chacun, évalue son
niveau de sécurité, détecte les anomalies, calcule un score global de sécurité
(0–100 + note en lettre), suit l'évolution de ce score dans le temps, produit un
rapport détaillé **HTML et PDF** avec des recommandations, et peut **envoyer une
alerte par e-mail** lorsqu'un problème critique est détecté. Les sites sont
analysés **en parallèle** : par défaut chaque site est analysé simultanément
(un worker par site, plafonné à 500), de sorte qu'un balayage de dizaines ou de
centaines de sites prend le temps du site le plus lent plutôt que la somme de
tous. Utilisez `--workers N` pour limiter la concurrence.

Deux interfaces partagent le même moteur et la même base de données :

- une **CLI** (`main.py`) pour des audits ponctuels ou planifiés (cron/systemd), et
- un **tableau de bord web interactif** (FastAPI + HTMX + Chart.js) avec une vue
  d'ensemble du parc, une page par site (courbe du score dans le temps, constats
  avec recommandations, historique), des rapports par site téléchargeables, un
  bouton **« Lancer un audit »** et des analyses planifiées optionnelles.

Chaque constat est enrichi d'une **recommandation** bilingue et relié aux
référentiels de sécurité (**OWASP Top 10, CWE, MITRE ATT&CK, RFC, NIST**).

### Contrôles effectués

| Domaine | Ce qui est vérifié |
|---------|--------------------|
| **Disponibilité** | Site accessible, temps de réponse, redirection HTTP→HTTPS |
| **TLS/SSL** | Robustesse des protocoles, validité et date d'expiration du certificat, chaîne de confiance |
| **En-têtes HTTP** | HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, attributs de cookies sécurisés |
| **DNS / auth e-mail** | Enregistrements SPF, DKIM, DMARC et leurs politiques |
| **Mauvaises configurations** | Divulgation de versions/bannières, listing de répertoire, fichiers sensibles exposés (`.git`, `.env`, …), méthodes HTTP dangereuses (TRACE), `security.txt` |
| **CVE connues** | Bannières logicielles détectées (Apache, nginx, PHP…) confrontées à la base de vulnérabilités NVD |
| **Ports ouverts** | Top-100 des ports TCP — **uniquement avec `--authorized`** |

### Démarrage rapide (Docker — recommandé)

Aucune installation Python ni bibliothèque native à gérer ; l'image embarque les
libs de WeasyPrint et `nmap` :

```bash
# Modifiez d'abord les sites : config/targets.yaml
docker compose up --build          # tableau de bord → http://localhost:8000
docker compose run --rm audit      # audit CLI ponctuel (même base de données)
```

La base SQLite persiste dans un volume nommé et les rapports arrivent dans
`reports/output/`.

### Démarrage rapide (Python local)

**Python pris en charge : 3.11 – 3.13.**

```bash
# 1. Installer les dépendances
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Pour les rapports PDF, il faut aussi des bibliothèques natives :
sudo apt install libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf2.0-0 libcairo2

# 2. Configurer les sites à auditer
$EDITOR config/targets.yaml

# 3. Lancer l'audit complet
python main.py

# 4. Consulter le rapport
open reports/output/audit_report_*.html   # ou le .pdf
```

### Tableau de bord interactif

```bash
# Démarrer le tableau de bord web (utilise la même base que la CLI)
uvicorn dashboard.app:app --host 0.0.0.0 --port 8000
# puis ouvrir http://localhost:8000
```

Trois écrans : un **tableau de bord global** (cartes de synthèse, répartition des
notes, tendance du score, tableau des sites triable, *Lancer un audit*), une
**page par site** (courbe du score, constats + recommandations, historique,
téléchargements HTML/PDF) et des **rapports téléchargeables** (global + par site).

Pour une **surveillance continue**, définissez `AUDIT_SCHEDULE_MINUTES` (un
intervalle fixe) et/ou `AUDIT_SCHEDULE_AT` (des heures précises, ex. `02:00,14:00`)
pour l'APScheduler intégré, ou planifiez `python main.py` avec cron/systemd (voir
le [Manuel utilisateur](docs/USER_MANUAL.md)). Le tableau de bord dispose aussi
d'un **mode sombre** (bouton dans l'en-tête, mémorisé par navigateur).

### Conformité réglementaire (France & Maroc)

Chaque site noté inclut une vue **conformité** qui relie les contrôles techniques
observables de l'extérieur (TLS, en-têtes de sécurité, cookies, SPF/DMARC,
exposition d'informations, CVE connues, disponibilité, contact de sécurité) aux
référentiels officiels de gouvernance de la sécurité de l'information :

- **France** — ANSSI (guide d'hygiène + recommandations TLS), RGS, RGPD/CNIL.
- **Maroc** — DGSSI (DNSSI), Loi 09-08 (CNDP), Loi 05-20 sur la cybersécurité.

Chaque contrôle est indiqué **conforme / non conforme / partiel / non évalué**
(un contrôle dont le scanner ne s'est pas exécuté n'est *jamais* compté comme
conforme par défaut), avec un score de conformité par pays. Cette vue apparaît
dans la page site du tableau de bord, dans le rapport HTML/PDF par site, et dans
l'API sous `site["compliance"]`.

> ⚠️ **Mapping technique uniquement — pas une certification légale.** Il indique
> un alignement aux recommandations *techniques* de chaque référentiel. Il ne
> couvre pas les obligations organisationnelles/documentaires (analyse de risque,
> gouvernance, réponse aux incidents, audits), et l'applicabilité de chaque
> loi/référentiel à une organisation donnée doit être confirmée par celle-ci /
> son service juridique.

### Documentation

- **[Guide d'intégration](docs/INTEGRATION.md)** — déploiement sur votre serveur ou intégration comme module dans une autre plateforme.
- **[Manuel utilisateur](docs/USER_MANUAL.md)** — configuration, exécution et lecture des rapports.
- **[Documentation technique](docs/TECHNICAL.md)** — architecture, barème de notation, modèle de données, extension.

### ⚠️ Autorisation

Scanner les ports d'une infrastructure sans autorisation **écrite** peut
constituer une violation de politique, voire une infraction. Le scanner de ports
refuse de s'exécuter sans l'option `--authorized`. N'auditez que les systèmes que
vous êtes autorisé à tester.

---

## Project layout / Structure du projet

```
Dockerfile             Container image (dashboard + CLI, all native libs)
docker-compose.yml     One-command run: dashboard + one-off CLI audit
.github/workflows/     CI: ruff + pytest on Python 3.11/3.12/3.13
main.py                Orchestrator / orchestrateur (CLI)
config/targets.yaml    List of sites to audit / liste des sites
scanners/              One module per check / un module par contrôle
  availability.py      Reachability, redirects
  tls.py               TLS/SSL & certificate analysis (sslyze)
  headers.py           HTTP security headers & cookies
  dns_auth.py          SPF / DKIM / DMARC
  misconfig.py         Common misconfigurations & exposed files
  cve.py               Software-banner -> known CVE lookup (NVD)
  threat_intel.py      Free KEV (CISA) + EPSS (FIRST) enrichment for CVE prioritisation
  testssl.py           Deep TLS audit via testssl.sh (--deep)
  nuclei.py            Templated CVE/misconfig scan via nuclei (--deep)
  zap.py               OWASP ZAP baseline web-app scan (--deep)
  ports.py             Port scan (authorization required)
  takeover.py          Subdomain-takeover / dangling-DNS detection
  discovery.py         EASM asset discovery (CT + passive DNS, DNS brute-force, reverse DNS, ASN prefixes, cloud buckets)
  scoping.py           Ownership attribution + confidence scoring (registrant org / owner ASN + prefixes / cert org)
core/audit.py          Reusable orchestration + concurrent scanning (CLI & dashboard)
scoring/engine.py      Penalty-based scoring & grading
scoring/remediation.py Bilingual recommendations + framework mapping (OWASP/CWE/MITRE)
db/models.py           SQLite persistence + score history + dashboard queries
reports/generator.py   HTML + PDF rendering (Jinja2 + WeasyPrint), global & per-site
reports/charts.py      Dependency-free inline-SVG charts (PDF-compatible)
reports/templates/     Report templates (bilingual): global + per-site (forensic)
dashboard/app.py       FastAPI + HTMX web dashboard
dashboard/templates/   Dashboard pages (global, per-site) + HTMX partials
alerts/mailer.py       Email alerting (SMTP)
tests/                 pytest test suite
docs/                  Technical documentation & user manual
```

## Tests

```bash
pip install -r requirements-dev.txt
pytest -q
```

## License

Internal tool developed as part of an internship project / Outil interne
développé dans le cadre d'un projet de stage.
