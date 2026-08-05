# Technical Documentation / Documentation technique

*Bilingual document — English first, French below each section.*
*Document bilingue — anglais d'abord, français ensuite dans chaque section.*

---

## 1. Architecture overview / Vue d'ensemble

**EN.** The tool is a small, modular pipeline. The orchestration lives in
`core/audit.py` and is shared by **both** front-ends (the `main.py` CLI and the
`dashboard/` web app), so they can never disagree:

```
targets.yaml ─► core.audit.run_scans (ThreadPoolExecutor, bounded)
                     │  scanners/* (per site, in parallel)
                     ▼
               scoring/engine (+ scoring/remediation) ─► db/models (persist + history)
                     │
                     ├─► reports/generator ─► HTML + PDF (global & per-site)
                     └─► alerts/mailer ─► email (SMTP)

CLI (main.py)  ─┐
                ├─► core.audit  ─► same DB (SQLite/WAL)
dashboard/app  ─┘         ▲
                          └── reads for the 3 dashboard screens
```

Each scanner is independent and returns a plain `dict` (no shared state), which
makes them easy to test and to run selectively (`--scan`). Sites are scanned
**concurrently** by a bounded thread pool (`run_scans`). By default it auto-sizes
to one worker per site (capped at `MAX_WORKERS_CAP` = 500), so the whole fleet is
scanned at once: the work is network-I/O bound, so a sweep takes about as long as
the slowest single site, and one site's failure never aborts the sweep. Pass a
positive `--workers`/`max_workers` to cap concurrency. The scoring engine is the only component that
interprets scanner output, so scoring rules live in one place. Persistence,
reporting and alerting all consume the *scored* results.

**FR.** L'outil est un pipeline modulaire. L'orchestration réside dans
`core/audit.py`, partagée par les **deux** interfaces (la CLI `main.py` et le
tableau de bord `dashboard/`) afin qu'elles ne puissent jamais diverger : cibles
→ scanners (en parallèle) → moteur de notation (+ remédiation) → persistance
(historique) → rapports et alertes. Les sites sont analysés **en parallèle** par
un pool de threads borné (`run_scans`). Par défaut, il s'adapte à un worker par
site (plafonné à `MAX_WORKERS_CAP` = 500), donc tout le parc est analysé en même
temps : le travail est limité par le réseau, un balayage prend le temps du site le
plus lent, et l'échec d'un site n'interrompt jamais la campagne. Passez un
`--workers`/`max_workers` positif pour limiter la concurrence. Chaque scanner renvoie un simple
`dict`. Le moteur de notation est le seul à interpréter la sortie des scanners.

---

## 2. Modules / Modules

| Module | Responsibility (EN) | Responsabilité (FR) |
|--------|--------------------|---------------------|
| `main.py` | CLI, orchestration, wiring | CLI, orchestration, câblage |
| `scanners/availability.py` | Reachability, response time, HTTP→HTTPS | Disponibilité, temps de réponse, redirection |
| `scanners/tls.py` | TLS protocols, cert validity/expiry, trust chain (sslyze) | Protocoles TLS, validité/expiration du certificat, chaîne de confiance |
| `scanners/headers.py` | Security headers + cookie flags | En-têtes de sécurité + attributs de cookies |
| `scanners/dns_auth.py` | SPF / DKIM / DMARC records | Enregistrements SPF / DKIM / DMARC |
| `scanners/takeover.py` | Subdomain takeover / dangling DNS: CNAME → unclaimed third-party service (fingerprinted) or NXDOMAIN target | Prise de contrôle de sous-domaine / DNS orphelin : CNAME → service tiers non revendiqué (empreinte) ou cible NXDOMAIN |
| `scanners/discovery.py` | EASM asset discovery: CT (crt.sh + Cert Spotter) + passive DNS (HackerTarget) + reverse-DNS (PTR) expansion, DNS resolution, ASN/WHOIS attribution, per-asset inventory & surface diff | Découverte d'actifs EASM : CT (crt.sh + Cert Spotter) + DNS passif (HackerTarget) + expansion DNS inverse (PTR), résolution DNS, attribution ASN/WHOIS, inventaire par actif & diff de surface |
| `scanners/scoping.py` | Ownership attribution & confidence scoring: fuses registrant org (RDAP) + owner ASN/announced prefixes + TLS cert org to score how confidently each asset belongs to the organisation (confirmed/probable/possible/unrelated), keeping unrelated tenants on shared infra out | Attribution de propriété & score de confiance : combine l'organisation déclarante (RDAP) + l'ASN propriétaire/préfixes annoncés + l'organisation du certificat TLS pour évaluer la confiance qu'un actif appartient à l'organisation (confirmé/probable/possible/non lié), évitant d'inclure des tiers sur infra partagée |
| `scanners/misconfig.py` | Banner disclosure, dir listing, exposed files, TRACE, security.txt | Divulgation de bannières, listing, fichiers exposés, TRACE, security.txt |
| `scanners/cve.py` | Software-banner → known CVE lookup via the NVD API (cached, best-effort) | Bannière logicielle → recherche de CVE connues via l'API NVD (en cache, best-effort) |
| `scanners/testssl.py` | Deep TLS audit wrapping `testssl.sh` (--deep) | Audit TLS approfondi via `testssl.sh` (--deep) |
| `scanners/nuclei.py` | Templated CVE/misconfig/exposure scan wrapping `nuclei` (--deep) | Analyse par modèles CVE/misconfig via `nuclei` (--deep) |
| `scanners/zap.py` | OWASP ZAP baseline (passive) web-app scan (--deep) | Analyse applicative OWASP ZAP baseline (passive) (--deep) |
| `scanners/ports.py` | Port scan via nmap (authorized only) | Scan de ports via nmap (autorisé uniquement) |
| `core/audit.py` | Shared orchestration + concurrent `run_scans` / `run_audit` | Orchestration partagée + `run_scans` / `run_audit` concurrents |
| `scoring/engine.py` | Penalty model → score, grade, findings (with `code`) | Modèle de pénalités → score, note, constats (avec `code`) |
| `scoring/remediation.py` | Maps finding `code` → bilingual fix + framework refs | Relie le `code` d'un constat → correctif bilingue + référentiels |
| `db/models.py` | SQLAlchemy models, `save_run`, `score_history`, dashboard queries | Modèles SQLAlchemy, `save_run`, `score_history`, requêtes du dashboard |
| `reports/generator.py` | Jinja2 HTML + WeasyPrint PDF (global & per-site) | HTML Jinja2 + PDF WeasyPrint (global & par site) |
| `reports/charts.py` | Dependency-free inline-SVG charts (PDF-safe) | Graphiques SVG intégrés sans dépendance (compatibles PDF) |
| `dashboard/app.py` | FastAPI + HTMX dashboard, background scans, scheduler | Tableau de bord FastAPI + HTMX, scans en arrière-plan, planificateur |
| `alerts/mailer.py` | Alert conditions + SMTP send | Conditions d'alerte + envoi SMTP |

**External-engine scanners (`--deep`).** `testssl.py`, `nuclei.py` and `zap.py`
wrap best-in-class open-source engines instead of re-implementing their checks.
They share the contract in `scanners/_external.py`: each spawns the engine as a
subprocess under a hard timeout, accepts an injectable `runner` (so tests exercise
the parsing without the real binary), and **degrades gracefully** — a missing
binary or engine error becomes an *inconclusive* (0-penalty) finding rather than a
crash. Output is normalised to `{findings:[{id,name,severity,detail}], counts, …}`
and scored per-severity with a per-engine cap (`_score_engine` in `scoring/engine.py`).
They are opt-in because they are heavier (subprocess, spidering, many requests);
nuclei's intrusive templates are gated behind `--authorized`.

---

## 3. Scoring model / Modèle de notation

**EN.** Each site starts at **100** and loses points per finding (a transparent
*penalty model*). A finding is
`{category, severity, penalty, message, code, recommendation_en, recommendation_fr, references}`
where severity ∈ {critical, high, medium, low, info}. The `code` (e.g.
`tls.cert_expired`) is a stable key that `scoring/remediation.py` uses to attach
the bilingual recommendation and framework references (OWASP/CWE/MITRE/RFC/NIST)
via `enrich_findings()`. `info` findings carry **0**
penalty (used for inconclusive results — a DNS timeout is never scored as a
confirmed weakness). The final score is floored at 0 and mapped to a grade:

| Score | Grade |
|-------|-------|
| ≥ 90 | A |
| ≥ 80 | B |
| ≥ 70 | C |
| ≥ 60 | D |
| ≥ 50 | E |
| < 50 | F |

The full weight table lives in `RUBRIC` in `scoring/engine.py`. It is
**versioned** (`RUBRIC_VERSION`, currently `1.2.0` — added finding `code`s +
remediation/framework mapping): bump it when you tune weights so historical
reports remain interpretable. Some categories are **capped** (cookie flags,
banner disclosure) so a single noisy site cannot dominate the score.

**FR.** Chaque site part de **100** et perd des points par constat (modèle de
pénalités transparent). Un constat est `{category, severity, penalty, message}`.
Les constats `info` n'entraînent **aucune** pénalité (résultats non concluants :
un timeout DNS n'est jamais compté comme une faiblesse avérée). Le score final
est plancher à 0 puis converti en note (voir le tableau ci-dessus). La table des
poids se trouve dans `RUBRIC` (`scoring/engine.py`) et est **versionnée**
(`RUBRIC_VERSION`). Certaines catégories sont **plafonnées** (cookies, bannières).

### Design choices worth defending / Choix de conception à défendre

- **Structured scoring, not string parsing.** The engine scores from typed
  scanner fields, not from human-readable `issues` strings, avoiding double
  counting (e.g. one "chain validation failed" line per trust store collapses to
  a single "certificate not trusted" finding).
- **DKIM is informational.** Selector probing is best-effort; a miss does not
  prove absence, so DKIM never reduces the score.
- **"Up but bad certificate" ≠ "down".** availability/headers retry once with
  TLS verification disabled so a misconfigured-cert site is still audited, and it
  is penalised under TLS, not availability.

*FR : notation à partir de champs typés (pas de parsing de chaînes) pour éviter
les doubles comptages ; DKIM informatif uniquement ; « accessible mais mauvais
certificat » n'est pas « hors ligne » — la pénalité relève du TLS.*

---

## 4. Data model & trends / Modèle de données & tendances

**EN.** Two tables (SQLite by default, any SQLAlchemy URL via `AUDIT_DB_URL`):

```
scan_runs(id, started_at, rubric_version)
   └─ site_results(id, run_id → scan_runs.id, name, url, domain, score, grade, findings_json)
```

One `scan_run` per `python main.py` execution; one `site_result` per site.
`score_history(identifier)` returns a site's scores oldest-first for trend views;
it matches on **URL first** (the unique monitored unit) then domain, so two sites
sharing a domain are not conflated. Trends are surfaced in the CLI (`▲/▼` vs. the
previous run), in the report (Trend column + per-site history line), and via
`python main.py --history <url|domain>`.

**FR.** Deux tables (SQLite par défaut, toute URL SQLAlchemy via `AUDIT_DB_URL`) :
un `scan_run` par exécution, un `site_result` par site. `score_history` renvoie
les scores d'un site du plus ancien au plus récent ; la correspondance se fait
d'abord sur l'**URL** puis sur le domaine, afin de ne pas confondre deux sites
partageant un domaine. Les tendances apparaissent dans la CLI, dans le rapport et
via `python main.py --history <url|domaine>`.

**Dashboard queries / Requêtes du dashboard.** `latest_site_states()` (dernier
état par site + historique), `get_site_state(url)` et `fleet_trend()` (score
moyen par run) alimentent les écrans. En SQLite, le mode **WAL** est activé
(`get_engine`) pour permettre au dashboard de lire pendant qu'un scan écrit.

---

## 5. Reports / Rapports

**EN.** `reports/generator.py` renders `reports/templates/report.html.j2` with
Jinja2 (HTML always) and converts it to PDF with WeasyPrint when its native libs
are present; if not, HTML is still produced and PDF fails gracefully. Output goes
to `reports/output/audit_report_<timestamp>.{html,pdf}`. The template is
bilingual and print-optimised (A4, page numbers, block/table layout for stable
PDF rendering).

**FR.** `reports/generator.py` rend le gabarit Jinja2 (HTML toujours) et le
convertit en PDF via WeasyPrint si les bibliothèques natives sont présentes ;
sinon le HTML est tout de même produit et le PDF échoue proprement. Le gabarit
est bilingue et optimisé pour l'impression (A4, numéros de page).

**Per-site & charts / Par site & graphiques.** `generate_site_report(site)` rend
`report_site.html.j2`, un rapport détaillé par site (synthèse, périmètre &
méthodologie, constats + recommandations + référentiels, historique). Les
graphiques d'évolution sont générés en **SVG intégré** par `reports/charts.py`
(`history_svg`, `sparkline_svg`) : aucune dépendance JavaScript, donc ils
s'affichent aussi dans le PDF (WeasyPrint n'exécute pas de JS). Le dashboard, lui,
utilise Chart.js pour l'interactivité.

---

## 6. Alerting / Alertes

**EN.** `alerts/mailer.py` sends **one** summary email when any site scores below
`ALERT_SCORE_THRESHOLD` **or** has a `critical` finding. All configuration comes
from environment variables (see `.env.example`) — credentials are never
hardcoded. `send_alerts(..., dry_run=True)` builds the message without sending
(used in tests / previews).

**FR.** `alerts/mailer.py` envoie **un** e-mail de synthèse lorsqu'un site passe
sous `ALERT_SCORE_THRESHOLD` **ou** présente un constat `critical`. Toute la
configuration provient de variables d'environnement (voir `.env.example`).

---

## 7. Extending / Extension

**EN.** To add a new check:

1. Create `scanners/mycheck.py` exposing `check_mycheck(url_or_domain) -> dict`.
2. Wire it into `ALL_SCANNERS` and `scan_site()` in `core/audit.py`.
3. Add its weights under a new key in `RUBRIC` and a `_score_mycheck()` in
   `scoring/engine.py` (give each finding a stable `code`), then call it from
   `score_site()`.
4. Add remediation entries for the new `code`s in `scoring/remediation.py`.
5. Add tests under `tests/` (mock all network I/O).

Keep scanners network-tolerant: a single timeout must degrade to an `info`
finding, never crash the run.

**FR.** Pour ajouter un contrôle : créez `scanners/mycheck.py`
(`check_mycheck(...) -> dict`), câblez-le dans `ALL_SCANNERS` et `scan_site()`,
ajoutez ses poids dans `RUBRIC` + une fonction `_score_mycheck()` appelée par
`score_site()`, puis écrivez des tests (en simulant tout le réseau). Un scanner
doit tolérer les erreurs réseau : un timeout devient un constat `info`, jamais un
crash.

---

## 8. Web dashboard, concurrency & scheduling / Dashboard, concurrence & planification

**EN.** The dashboard (`uvicorn dashboard.app:app`) is a thin FastAPI + HTMX
layer over the same engine/DB — it renders three screens (global overview,
per-site detail, downloadable reports) and never re-implements scanning logic.

- **Concurrency.** `core.audit.run_scans` uses a `ThreadPoolExecutor` sized by
  `resolve_workers`. By default (`--workers auto`, or `AUDIT_WORKERS=auto` for the
  dashboard) it runs one worker per site, capped at `MAX_WORKERS_CAP` = 500, so the
  whole fleet scans at once; a positive `--workers N` caps it instead. Threads are
  the right tool here: the work is blocking network I/O (sockets, TLS, DNS), so the
  GIL is released during waits and hundreds of mostly-idle threads cost little.
  Results are collected back in input order; a per-site exception is captured as
  an `error` on that site, never propagated.
- **Background scans.** The *Run audit now* button posts to `/scan`, which starts
  the audit in a background thread (`dashboard/scan_manager.py`, one at a time)
  and returns an HTMX status card that polls `/scan/status` every 2s, then
  refreshes the page on completion.
- **Scheduled scans (continuous monitoring).** Set `AUDIT_SCHEDULE_MINUTES>0`
  (a fixed interval) and/or `AUDIT_SCHEDULE_AT` (specific daily clock times, a
  comma-separated list of 24-hour `HH:MM`, e.g. `02:00,14:00`) and the app
  starts an APScheduler `BackgroundScheduler` (in the FastAPI `lifespan`) with an
  `interval` job and/or one `cron` job per time. For production, a **cron** or
  **systemd timer** calling `python main.py` is equally valid and survives app
  restarts:

  ```cron
  # every 6 hours
  0 */6 * * * cd /opt/web-security-audit-tool && .venv/bin/python main.py >> audit.log 2>&1
  ```
- **SQLite concurrency.** `get_engine` enables **WAL** + a busy timeout so the
  dashboard can read while a scan writes. At larger scale, switch `AUDIT_DB_URL`
  to PostgreSQL — no model changes.
- **Self-hosted frontend assets (no CDN).** The dashboard serves all of its
  frontend from `/static` (mounted in `dashboard/app.py`): a **built, purged
  Tailwind CSS** file plus vendored `htmx` and `Chart.js`. Nothing is fetched
  from a CDN at runtime, so the UI works offline / air-gapped and has no external
  supply-chain surface. The dark-mode toggle re-themes **in place** (no page
  reload) via a small chart registry in `base.html` that rebuilds every Chart.js
  instance against the active palette.
  - Source: `dashboard/assets/app.css` (Tailwind directives + custom badge/dark
    styles); config: `tailwind.config.js` (`darkMode: 'class'`, scans
    `dashboard/templates/**/*.html`).
  - Output (committed, shipped in the wheel as package data):
    `dashboard/static/css/app.css`.
  - Rebuild only when templates or `app.css` change:
    `npm install && npm run build:css` (or the standalone Tailwind CLI:
    `tailwindcss -c tailwind.config.js -i dashboard/assets/app.css -o dashboard/static/css/app.css --minify`).

**FR.** Le tableau de bord (`uvicorn dashboard.app:app`) est une fine couche
FastAPI + HTMX au-dessus du même moteur/BD (trois écrans, aucune logique de scan
dupliquée). **Concurrence** : `run_scans` utilise un `ThreadPoolExecutor` dimensionné
par `resolve_workers` — par défaut (`--workers auto`, ou `AUDIT_WORKERS=auto`) un
worker par site, plafonné à `MAX_WORKERS_CAP` = 500, donc tout le parc est analysé
simultanément ; un `--workers N` positif limite la concurrence. Adapté car le
travail est du réseau bloquant (le GIL est libéré pendant les attentes) ; l'ordre
d'entrée est préservé et l'erreur d'un site est capturée sans interrompre les autres. **Scans en arrière-plan** :
le bouton *Lancer un audit* poste sur `/scan` (un scan à la fois), et une carte
HTMX interroge `/scan/status` toutes les 2 s puis rafraîchit la page.
**Planification** : `AUDIT_SCHEDULE_MINUTES>0` active APScheduler ; en production,
un **cron**/**systemd timer** appelant `python main.py` convient aussi.
**SQLite** : le mode WAL permet la lecture pendant l'écriture ; à plus grande
échelle, basculez `AUDIT_DB_URL` vers PostgreSQL (aucun changement de modèle).

---

## 9. Testing / Tests

```bash
pip install -r requirements-dev.txt
pytest -q       # unit tests (no network — all I/O is mocked)
ruff check .    # linting
```

The suite covers the scoring engine, DNS/header/misconfig parsing, remediation
enrichment, the persistence + history + dashboard-query layer, concurrent
orchestration (`core.audit`), HTML report rendering, and the FastAPI dashboard
routes (via `fastapi.testclient`). Network I/O and background scans are mocked so
the suite is fast and deterministic.

*FR : la suite couvre le moteur de notation, l'analyse DNS/en-têtes/config,
l'enrichissement de remédiation, la persistance + historique + requêtes du
dashboard, l'orchestration concurrente, le rendu HTML et les routes FastAPI du
tableau de bord. Aucun accès réseau (tout est simulé).*
