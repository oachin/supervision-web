"""
websec_audit — stable public API for embedding the scanner in another platform.

This package is the one import surface a host application should depend on. It
re-exports the orchestration/scoring entry points and adds :class:`AuditConfig`,
an explicit, per-call configuration object so a host never has to rely on
import-time environment variables or the current working directory.

Typical embedded use::

    from websec_audit import AuditConfig

    outcome = AuditConfig(
        sites=[{"name": "acme", "url": "https://acme.example"}],
        enabled=["availability", "tls", "headers", "cve"],
        engine_workers=4,          # cap heavy subprocesses fleet-wide
        batch_timeout=1800,        # hard wall-clock budget per sweep
        db_url="postgresql+psycopg://…",  # per-tenant database
        generate_reports=False,    # host renders its own UI
    ).run()

    outcome["run_uuid"]   # correlation id for the host's logs
    outcome["stats"]      # {sites, errors, avg_score}
    outcome["scored"]     # per-site score + findings + coverage

Every finding carries a ``confidence`` (``confirmed`` / ``potential`` / ``low``)
and every site a ``coverage`` map (``ran`` / ``inconclusive`` / ``not_run``), so
the host can distinguish a verified detection from a version-based indicator and
never read a check that did not run as "clean".
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.engine import Engine

from core.audit import (
    ALL_SCANNERS,
    CORE_SCANNERS,
    DEFAULT_SCANNERS,
    ENGINE_SCANNERS,
    run_audit,
    run_scans,
)
from db.models import get_engine, prune_history
from scoring.engine import RUBRIC_VERSION, score_all, score_site

__version__ = "2.0.0"

__all__ = [
    "AuditConfig",
    "run_audit",
    "run_scans",
    "score_all",
    "score_site",
    "prune_history",
    "get_engine",
    "ALL_SCANNERS",
    "CORE_SCANNERS",
    "ENGINE_SCANNERS",
    "DEFAULT_SCANNERS",
    "RUBRIC_VERSION",
    "__version__",
]


@dataclass
class AuditConfig:
    """Explicit configuration for a single audit sweep.

    All behaviour a host cares about is set here rather than through global env
    vars, so two tenants can run with different targets, databases, concurrency
    and report settings in the same process.

    Attributes
    ----------
    sites:
        Target list (``[{"name", "url", "domain"?}]``). When ``None`` the
        targets are loaded from ``config_path``.
    discover_domains:
        Root domains to auto-discover assets from (EASM), instead of — or in
        addition to — an explicit ``sites`` list.
    enabled:
        Scanners to run; defaults to the fast, always-safe core set.
    authorized:
        Gates intrusive checks (port scan, nuclei intrusive templates). Only set
        this when the operator has written authorization for the targets.
    max_workers:
        Site-level IO concurrency (0 = one worker per site, capped internally).
    engine_workers:
        Separate, much smaller cap on concurrent heavy engine subprocesses
        (testssl/nuclei/zap) across the whole fleet. ``None`` uses the default.
    batch_timeout:
        Wall-clock budget (seconds) for the whole sweep; sites still running when
        it elapses are recorded as errors instead of hanging the batch.
    db_url:
        SQLAlchemy URL for a host/tenant-supplied database (e.g.
        ``postgresql+psycopg://user:pass@host/db``). ``None`` uses the process
        default (``AUDIT_DB_URL`` or local SQLite).
    engine:
        An already-configured SQLAlchemy ``Engine`` to persist through, for a
        host that owns its own connection pool. Takes precedence over
        ``db_url``.
    """

    sites: list[dict] | None = None
    config_path: str = "config/targets.yaml"
    enabled: list[str] | None = None
    authorized: bool = False
    persist: bool = True
    generate_reports: bool = True
    per_site_reports: bool = False
    send_alert: bool = False
    max_workers: int = 0
    engine_workers: int | None = None
    batch_timeout: float | None = None
    db_url: str | None = None
    engine: Engine | None = None
    # None => fall back to the CVE_SUPPRESS env var; an explicit list overrides it.
    suppressed_cve_ids: list[str] | None = None
    # Automatic OSV cross-verification of CVEs: drop any CVE OSV reports as not
    # affecting the detected version (false positive). None => AUDIT_VERIFY_BACKPORTS.
    verify_backports: bool | None = None
    # Automatic false-positive reduction. "low"/"potential"/"confirmed": findings
    # below this confidence tier are dropped from the score, reports and alerts
    # with no manual triage. "confirmed" = strictest (only actively-verified
    # detections + directly-observed facts). None => fall back to the
    # AUDIT_MIN_CONFIDENCE env var (unset = keep every finding).
    min_confidence: str | None = None
    # EASM asset discovery driven from code: root domains whose live assets are
    # discovered (Certificate Transparency + passive DNS) and scanned, merged
    # with `sites`. Lets a host skip config/targets.yaml entirely.
    discover_domains: list[str] | None = None

    def run(self, on_progress=None, on_site_event=None, run_uuid: str | None = None) -> dict:
        """Executes the sweep and returns the :func:`run_audit` outcome dict."""
        engine = self.engine or (get_engine(self.db_url) if self.db_url else None)
        return run_audit(
            config_path=self.config_path,
            sites=self.sites,
            enabled=self.enabled,
            authorized=self.authorized,
            persist=self.persist,
            generate_reports=self.generate_reports,
            per_site_reports=self.per_site_reports,
            send_alert=self.send_alert,
            max_workers=self.max_workers,
            engine_workers=self.engine_workers,
            batch_timeout=self.batch_timeout,
            suppressed_cve_ids=self.suppressed_cve_ids,
            verify_backports=self.verify_backports,
            min_confidence=self.min_confidence,
            discover_domains=self.discover_domains,
            on_progress=on_progress,
            on_site_event=on_site_event,
            run_uuid=run_uuid,
            engine=engine,
        )
