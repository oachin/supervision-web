# Integration guide

How to deploy this scanner on your own server and integrate it into your
platform. Two supported paths:

| Path | Use it when | Effort |
|---|---|---|
| **A. Docker** | You want the product as-is (dashboard + scheduler + reports) | ~15 min, nothing to install |
| **B. Python module** | Your platform drives the scans and renders its own UI | ~1 h |

Both paths share the same configuration (section 1) and the same
[prerequisites](#prerequisites).

---

## 1. Configure what gets scanned

Everything starts in **`config/targets.yaml`**.

You do **not** need to list every site. Give the tool your **root domains** and
it discovers the assets itself (Certificate Transparency + passive DNS +
reverse-DNS), then scans the ones that resolve:

```yaml
# Automatic asset discovery (EASM) — the recommended setup.
discover:
  enabled: true
  domains:
    - yourcompany.com
    - yourcompany.ma

# Optional: assets discovery cannot see (bare IPs, third-party portals…).
sites:
  - name: Customer portal
    url: https://portal.yourcompany.com
    domain: yourcompany.com
```

> Replace the demo entries shipped in the repo (github.com, badssl.com, …) —
> they exist only so a fresh clone produces a meaningful first report.
>
> **Only list domains you are authorised to test.** Discovery never guesses
> which domains belong to you.

---

## 2. Path A — Docker (recommended)

Everything the scanner needs is inside the image: `nuclei`, `testssl.sh`,
`nmap`, the WeasyPrint PDF libraries and — optionally — OWASP ZAP.

```bash
git clone <repo-url> && cd test-web-audit

# 1. Your targets
$EDITOR config/targets.yaml

# 2. Your settings (database, schedule, dashboard password, alerts…)
cp .env.example .env
$EDITOR .env

# 3. Start
docker compose up -d --build
```

The dashboard is on <http://localhost:8000>. A one-off CLI audit:

```bash
docker compose run --rm audit
```

### Include OWASP ZAP

ZAP adds web-application passive findings (anti-CSRF tokens, cookie/CSP issues,
information leakage). It needs a JRE, so it is opt-in — set it once in `.env`:

```ini
WITH_ZAP=true
AUDIT_DEEP=true
```

then `docker compose up -d --build`. Nothing else to install: `zap-baseline` is
built into the image and picked up automatically. Without it, the `zap` scanner
reports `inconclusive` and every other check is unaffected.

### Production hardening

- **Set `DASHBOARD_PASSWORD` and `DASHBOARD_SECRET_KEY`** in `.env`
  (`openssl rand -hex 32`). With no password the dashboard stays open.
- **Put it behind a TLS reverse proxy** (nginx/Caddy/Traefik). Do not expose
  port 8000 over plain HTTP on the internet.
- **Use PostgreSQL for 200+ sites** (see below).
- **Schedule** continuous monitoring with `AUDIT_SCHEDULE_AT=02:00,14:00`
  (fixed times) or `AUDIT_SCHEDULE_MINUTES=360` (interval).

### Switching to PostgreSQL

SQLite is the default and is fine for a few dozen sites; PostgreSQL is the right
choice for a fleet scanned continuously (concurrent writers, no file locking).
The `psycopg` driver ships with the image, and **the schema is created
automatically on first run** — there is no migration step.

Use your own server:

```ini
# .env
AUDIT_DB_URL=postgresql+psycopg://user:password@db-host:5432/websec_audit
```

Or start the bundled one:

```bash
# .env: AUDIT_DB_URL=postgresql+psycopg://audit:change-me@db:5432/websec_audit
docker compose --profile postgres up -d
```

Outside Docker, install the driver alongside the package:
`pip install ".[postgres]"`.

> Switching database does **not** migrate existing history: a new database
> starts empty and rebuilds history from the next scan. Point at PostgreSQL
> before going live if you want an unbroken trend line.

---

## 3. Path B — Embed as a Python module

Install the package and drive it from your own code. No CLI, no bundled
dashboard, no reliance on import-time environment variables.

```bash
pip install .                # SQLite
pip install ".[postgres]"    # + PostgreSQL driver
```

```python
from websec_audit import AuditConfig

outcome = AuditConfig(
    # Either an explicit list…
    sites=[{"name": "Portal", "url": "https://portal.yourcompany.com"}],
    # …or let the tool discover the surface from your root domains:
    # discover_domains=["yourcompany.com"],
    enabled=["availability", "tls", "headers", "dns_auth", "misconfig", "cve"],
    engine_workers=4,            # cap heavy subprocesses fleet-wide
    batch_timeout=1800,          # hard wall-clock budget per sweep
    db_url="postgresql+psycopg://user:pass@host/db",
    min_confidence="confirmed",  # automatic false-positive reduction
    verify_backports=True,       # cross-check CVEs against OSV
    generate_reports=False,      # your platform renders its own UI
).run()

outcome["run_uuid"]   # correlation id for your logs
outcome["stats"]      # {"sites": …, "errors": …, "avg_score": …}
outcome["scored"]     # per-site score, grade, findings, coverage, compliance
```

### Using PostgreSQL from the host platform

Point the module at PostgreSQL and it creates its own tables on the first run —
there is no migration command and no Alembic step.

**1. Install the driver**

```bash
pip install ".[postgres]"
```

**2. Create the database and a dedicated user** (once, as a Postgres superuser)

```sql
CREATE USER websec_audit WITH PASSWORD 'a-strong-password';
CREATE DATABASE websec_audit OWNER websec_audit;
```

The user needs no superuser rights — only ownership of (or `CREATE` on) its own
schema, since the tool issues `CREATE TABLE` on first use.

**3. Point the module at it**

```python
from websec_audit import AuditConfig

AuditConfig(
    discover_domains=["yourcompany.com"],
    db_url="postgresql+psycopg://websec_audit:a-strong-password@db-host:5432/websec_audit",
).run()
```

**Or reuse the host's own engine** — if your platform already manages a
SQLAlchemy connection pool, hand it over instead of a URL and the scanner will
persist through it (no second pool, and the audit tables live in your database):

```python
from sqlalchemy import create_engine
from websec_audit import AuditConfig

engine = create_engine("postgresql+psycopg://…", pool_size=10)   # your existing engine
AuditConfig(sites=[…], engine=engine).run()
```

`engine` takes precedence over `db_url`. Outside `AuditConfig`, the same engine
can be passed to every persistence helper (`save_run`, `score_history`,
`latest_site_states`, `prune_history`, …).

**Tables created.** `scan_runs`, `site_results`, `finding_status`, `settings` —
all prefixed-free and self-contained, so they can coexist in your application's
database. If you prefer isolation, give the user a dedicated schema and set
`search_path` on the URL:
`postgresql+psycopg://user:pass@host/db?options=-csearch_path%3Dwebsec`.

**Migrating from an existing SQLite deployment.** Switching `db_url` does *not*
copy history: the PostgreSQL database starts empty and rebuilds the trend line
from the next scan. If the existing history matters, migrate before going live —
the schema is identical, so a generic table-by-table copy works:

```bash
sudo apt install pgloader
pgloader sqlite:///path/to/audit.db \
         postgresql://websec_audit:a-strong-password@db-host/websec_audit
```

Then verify: `SELECT count(*) FROM scan_runs;` should match the SQLite row count.

### Reading a result

Each site in `outcome["scored"]` carries:

| Field | Meaning |
|---|---|
| `score` / `grade` | 0–100 and A–F |
| `findings[]` | one entry per weakness |
| `coverage` | per-scanner `ran` / `inconclusive` / `not_run` — a check that did not run is never "clean" |
| `compliance` | France (ANSSI/RGS/RGPD) and Morocco (DGSSI/09-08/05-20) technical mapping |

Each finding carries:

| Field | Meaning |
|---|---|
| `severity` | `critical` … `info` — how bad it is |
| `confidence` | `confirmed` (actively verified) / `potential` (precise version match) / `low` (fuzzy) / `null` (directly observed fact) |
| `exposed` | `false` = present but not confirmed reachable/exploitable → lower fix priority, no alert until it becomes exposed |
| `recommendation_en` / `recommendation_fr` | what to do about it |
| `reference_links[]` | `{label, url}` to OWASP / CWE / MITRE / RFC / NVD |

`severity` and `confidence` are independent on purpose: a critical weakness may
still be a low-confidence indicator, and your UI should show both.

---

## Prerequisites

- **Written authorisation** to test the target domains. `AUDIT_AUTHORIZED=true`
  is what unlocks the port scan and nuclei's intrusive templates — do not set it
  otherwise.
- **Outbound network access** from the server to: NVD (`services.nvd.nist.gov`),
  OSV (`api.osv.dev`), `crt.sh`, Cert Spotter, HackerTarget, and the scanned
  sites themselves.
- **Resources**: see [Sizing for a fleet](#sizing-for-a-fleet) below.
- **Python 3.11–3.13** for path B (path A needs only Docker).

## Sizing for a fleet

A single server comfortably covers a typical corporate web estate. What drives
the cost is **deep mode**, not the number of sites.

| Sites | Mode | Sweep duration | Server |
|---|---|---|---|
| 200 | core only | a few minutes | 2 vCPU / 4 GB |
| 200 | `AUDIT_DEEP=true` | ~1.5–3 h | 4–8 vCPU / 8–16 GB |
| 500 | `AUDIT_DEEP=true` | ~4–8 h | 8 vCPU / 16 GB |

The core checks (availability, TLS, headers, DNS/email, misconfig, CVE) are
network-bound and take seconds per site. `testssl.sh` + `nuclei` take **1–4
minutes per site** and are CPU-bound, which is what sets the sweep duration.

**Two independent concurrency knobs.** `AUDIT_WORKERS` (`auto` = one worker per
site, capped at 500) controls the cheap IO-bound checks; `AUDIT_ENGINE_WORKERS`
separately caps how many heavy subprocess engines run at once fleet-wide. That
separation is what keeps 200 simultaneous sites from spawning 200 `nuclei`
processes. Start at `AUDIT_ENGINE_WORKERS=6` on 8 vCPU.

**Recommended cadence** — frequent core sweeps plus one deep sweep at night,
rather than deep scanning continuously:

```ini
AUDIT_SCHEDULE_AT=02:00       # deep sweep out of office hours
AUDIT_ENGINE_WORKERS=6
AUDIT_LIVE_INTERVAL=60        # continuous availability/cert-expiry monitoring
```

The dashboard's "Live status" panel keeps availability and certificate expiry
near real-time between sweeps, so a 24/7 wall display stays useful without
running deep scans around the clock.

**Get an NVD API key.** Above ~50 sites the keyless NVD rate limit becomes the
bottleneck for CVE lookups (the client backs off and honours `Retry-After`, so
scans slow down rather than fail). The key is free:
<https://nvd.nist.gov/developers/request-an-api-key>.

**Bound retention.** History grows with sites x runs, so cap it — otherwise a
24/7 deployment keeps every run forever:

```ini
AUDIT_PRUNE_KEEP_RUNS=180     # keep the 180 most recent runs
AUDIT_PRUNE_DAYS=365          # and/or drop anything older than a year
```

Pruning then runs automatically after each scan (scheduled or manual, dashboard
or CLI). It is off unless configured, and a pruning error never fails the scan.
The CLI equivalents are `--prune-keep-runs N` / `--prune-days D`; from the module
API, call `prune_history(keep_runs=…, older_than_days=…)` on your own schedule.
Latest-state queries are indexed and scale with the number of *sites*, not the
number of *runs*, so read performance does not degrade as history accumulates.

### Where the ceiling is

- **Single node.** There is no work distribution across machines. Beyond ~500
  sites in deep mode, split the estate across several instances (one per
  business unit or root domain), each with its own database. The architecture
  supports it — nothing is shared — but it is a manual split.
- **The CVE cache is per process** (`NVD_CACHE_TTL` / `NVD_CACHE_MAX`, in
  memory). Multiple instances do not share it, so each pays its own NVD lookups.
- **Free EASM sources throttle.** crt.sh, Cert Spotter and HackerTarget rate
  limit at volume. Discovery is fail-safe (it degrades to what it found and
  never blocks a scan), but coverage can vary between runs; `EASM_DNS_DELAY_MS`
  and `EASM_BUCKET_DELAY_MS` tune the politeness delays.

## Known limits (be honest with stakeholders)

- False positives are reduced automatically (active confirmation, precise CPE
  matching, OSV backport verification) — substantially, not to zero. Uncertain
  findings are kept on purpose rather than risking a false negative.
- The France/Morocco compliance output is a **technical mapping of externally
  observable controls**, not a legal certification: it does not cover
  organisational obligations (risk analysis, governance, incident response).
- This is an **external, black-box** scanner. It does not replace authenticated
  testing or periodic manual penetration testing.
