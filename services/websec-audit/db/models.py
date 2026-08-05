"""
db/models.py
Persistence layer (SQLAlchemy + SQLite by default).

Stores each scan run and its per-site scored results so you can:
  * regenerate a report from a past run without re-scanning, and
  * track how a site's score evolves over time ("suivre l'évolution").

Switching to PostgreSQL later is just a change of DB_URL — no model changes.

Schema
------
ScanRun            one row per `python main.py` execution
  └─ SiteResult    one row per site in that run (score, grade, findings JSON)

Findings are stored as a JSON blob rather than a separate table: for this
project we always read them back per-site, and JSON keeps the schema simple.
"""

import json
import os
from datetime import datetime, timedelta, timezone

from sqlalchemy import (
    create_engine, event, inspect, text, Column, Integer, String, DateTime, Text,
    ForeignKey, Index, UniqueConstraint, func,
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

Base = declarative_base()

DB_URL = os.getenv("AUDIT_DB_URL", "sqlite:///audit.db")

# User-maintained remediation status for a finding. This is deliberately kept
# separate from the scanner's observations: the scanner only reports what it
# *sees*, while the status records what a human says has been *done* about it.
# A report therefore never turns an observation into a "fixed" claim on its own.
REMEDIATION_STATUSES = ("open", "in_progress", "fixed")
DEFAULT_STATUS = "open"


class ScanRun(Base):
    __tablename__ = "scan_runs"

    id = Column(Integer, primary_key=True)
    # Indexed: every "latest state" / history / trend query orders by started_at,
    # so at fleet scale this index is what keeps those queries off a full scan.
    started_at = Column(DateTime(timezone=True),
                        default=lambda: datetime.now(timezone.utc), index=True)
    rubric_version = Column(String(20))

    results = relationship("SiteResult", back_populates="run", cascade="all, delete-orphan")


class SiteResult(Base):
    __tablename__ = "site_results"

    id = Column(Integer, primary_key=True)
    run_id = Column(Integer, ForeignKey("scan_runs.id"), nullable=False)

    name = Column(String(255))
    url = Column(String(512))
    domain = Column(String(255), index=True)
    score = Column(Integer)
    grade = Column(String(2))
    findings_json = Column(Text)  # JSON-encoded list of finding dicts
    # Per-scanner coverage map ({scanner: ran|inconclusive|not_run}), so a check
    # that never ran is not silently read as "clean" when reloaded from the DB.
    coverage_json = Column(Text)

    run = relationship("ScanRun", back_populates="results")

    # Composite index for the "latest result per URL" lookup used by the fleet
    # view: filter/group by url, pick the greatest run_id.
    __table_args__ = (
        Index("ix_site_results_url_run", "url", "run_id"),
    )

    @property
    def findings(self) -> list[dict]:
        return json.loads(self.findings_json) if self.findings_json else []

    @property
    def coverage(self) -> dict:
        return json.loads(self.coverage_json) if self.coverage_json else {}


class FindingStatus(Base):
    """User-maintained remediation status for a single finding on a site.

    Keyed by (url, finding code, finding message) so the status follows the same
    finding across re-scans. Distinct from `SiteResult.findings`, which is the
    scanner's read-only observation.
    """

    __tablename__ = "finding_status"

    id = Column(Integer, primary_key=True)
    url = Column(String(512), index=True)
    code = Column(String(128))
    message = Column(Text)
    status = Column(String(20), default=DEFAULT_STATUS)
    updated_at = Column(DateTime(timezone=True),
                        default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))
    # Who set the status: "auto" (the scanner verified it on a re-scan) or
    # "manual" (an operator). Auto rows are the only ones the auto-verifier
    # manages, so a human's decision is never overwritten by a scan.
    verified_by = Column(String(20))
    # When the finding was confirmed fixed (only set while status == "fixed").
    resolved_at = Column(DateTime(timezone=True))
    # How it was verified, e.g. "Not detected in run #42" — this is what lets an
    # embedded agent see a procedure is already done and skip repeating it.
    detail = Column(Text)

    __table_args__ = (
        UniqueConstraint("url", "code", "message", name="uq_finding_status"),
    )


class Setting(Base):
    """Small key-value store for admin-editable settings (e.g. the scan
    schedule the admin sets from the dashboard). Values are stored as text
    (JSON-encoded by the caller when structured)."""

    __tablename__ = "settings"

    key = Column(String(64), primary_key=True)
    value = Column(Text)
    updated_at = Column(DateTime(timezone=True),
                        default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))


def get_setting(key: str, default: str | None = None, engine=None) -> str | None:
    """Returns the stored string value for `key`, or `default` if unset."""
    engine = init_db(engine)
    Session = sessionmaker(bind=engine, future=True)
    with Session() as session:
        row = session.get(Setting, key)
        return row.value if row is not None else default


def set_setting(key: str, value: str, engine=None) -> None:
    """Creates or updates a setting."""
    engine = init_db(engine)
    Session = sessionmaker(bind=engine, future=True)
    with Session() as session:
        row = session.get(Setting, key)
        if row is None:
            session.add(Setting(key=key, value=value))
        else:
            row.value = value
            row.updated_at = datetime.now(timezone.utc)
        session.commit()


_DISCOVERY_INVENTORY_KEY = "discovery_inventory"


def get_inventory(engine=None) -> dict:
    """Returns the persisted asset inventory (``host -> record``), or ``{}``.

    Records are ``{first_seen, last_seen[, ips, asn]}``; legacy string values
    are left as-is for callers that also normalise. Never raises.
    """
    raw = get_setting(_DISCOVERY_INVENTORY_KEY, engine=engine)
    try:
        data = json.loads(raw) if raw else {}
        return data if isinstance(data, dict) else {}
    except (ValueError, TypeError):
        return {}


def track_discovery(current, engine=None) -> dict:
    """Records the current discovered assets and reports how the external
    surface changed since the previous discovery (continuous-EASM signal).

    ``current`` is either a list of hostnames or a ``host -> {"ips", "asn"}``
    metadata mapping. Persists a per-asset inventory
    (``host -> {first_seen, last_seen[, ips, asn]}``) in the Setting store and
    returns ``{"added": [...], "removed": [...]}`` — newly-exposed and
    disappeared assets. Never raises on a corrupt stored value (starts fresh).
    """
    from scanners.discovery import diff_inventory

    previous = get_inventory(engine=engine)
    now = datetime.now(timezone.utc).isoformat()
    result = diff_inventory(previous, current, now)
    set_setting(_DISCOVERY_INVENTORY_KEY, json.dumps(result["inventory"]),
                engine=engine)
    return {"added": result["added"], "removed": result["removed"]}


def get_engine(db_url: str = DB_URL):
    engine = create_engine(db_url, future=True)
    # For SQLite, enable WAL so the dashboard can read while a scan writes,
    # and wait briefly instead of failing on a locked DB.
    if db_url.startswith("sqlite"):
        @event.listens_for(engine, "connect")
        def _sqlite_pragmas(dbapi_conn, _record):
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA busy_timeout=5000")
            cur.close()

    return engine


def _ensure_schema(engine) -> None:
    """Lightweight, idempotent migration for columns added after a DB was first
    created (``create_all`` never ALTERs existing tables). Adds any missing
    columns so upgrading in place doesn't require a manual migration."""
    insp = inspect(engine)
    tables = set(insp.get_table_names())
    # SQLite spells it DATETIME, PostgreSQL only knows TIMESTAMP.
    timestamp = "DATETIME" if engine.dialect.name == "sqlite" else "TIMESTAMP"
    if "site_results" in tables:
        existing = {c["name"] for c in insp.get_columns("site_results")}
        if "coverage_json" not in existing:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE site_results ADD COLUMN coverage_json TEXT"))
    if "finding_status" in tables:
        existing = {c["name"] for c in insp.get_columns("finding_status")}
        for col, ddl in (("verified_by", "VARCHAR(20)"),
                         ("resolved_at", timestamp),
                         ("detail", "TEXT")):
            if col not in existing:
                with engine.begin() as conn:
                    conn.execute(text(
                        f"ALTER TABLE finding_status ADD COLUMN {col} {ddl}"))


def init_db(engine=None):
    """Creates tables if they don't exist. Safe to call every run."""
    engine = engine or get_engine()
    Base.metadata.create_all(engine)
    _ensure_schema(engine)
    return engine


def save_run(scored_results: list[dict], engine=None) -> int:
    """
    Persists one scan run + its site results. Returns the new run id.
    `scored_results` is the output of scoring.engine.score_all().
    """
    engine = init_db(engine)
    Session = sessionmaker(bind=engine, future=True)

    rubric_version = scored_results[0].get("rubric_version") if scored_results else None

    with Session() as session:
        run = ScanRun(rubric_version=rubric_version)
        for s in scored_results:
            run.results.append(SiteResult(
                name=s.get("name"),
                url=s.get("url"),
                domain=s.get("domain"),
                score=s.get("score"),
                grade=s.get("grade"),
                findings_json=json.dumps(s.get("findings", [])),
                coverage_json=json.dumps(s.get("coverage", {})),
            ))
        session.add(run)
        session.commit()
        run_id = run.id
        try:
            _auto_verify_fixes(session, scored_results, run_id)
        except Exception:
            # Fix-verification is best-effort bookkeeping; never fail a save.
            session.rollback()
        return run_id


def _auto_verify_fixes(session, scored_results: list[dict], run_id: int) -> None:
    """Marks findings that disappeared since a site's previous run as ``fixed``.

    Automatic remediation verification: a finding present in the previous scan
    but absent from the just-saved run has evidently been fixed, so we record an
    *auto* ``FindingStatus`` (``verified_by="auto"``) with ``resolved_at`` and a
    ``detail`` note. Conversely, an auto-fixed finding that reappears is
    re-opened (a regression). Operator-set (manual) statuses are never touched,
    so a human decision always wins. This is what lets a re-scan — or an embedded
    remediation agent — see "already fixed" and skip repeating the work.
    """
    from core.diff import diff_findings

    now = datetime.now(timezone.utc)
    for s in scored_results:
        url = s.get("url") or s.get("domain")
        if not url:
            continue
        prev = (
            session.query(SiteResult)
            .filter(SiteResult.url == url, SiteResult.run_id < run_id)
            .order_by(SiteResult.run_id.desc())
            .first()
        )
        if prev is None:
            continue  # first run for this site: nothing to compare against
        delta = diff_findings(s.get("findings", []), prev.findings)

        for f in delta["resolved"]:
            row = _find_status_row(session, url, f.get("code"), f.get("message"))
            note = f"Not detected in run #{run_id}"
            if row is None:
                session.add(FindingStatus(
                    url=url, code=f.get("code") or "", message=f.get("message") or "",
                    status="fixed", verified_by="auto", resolved_at=now, detail=note))
            elif row.verified_by == "auto":
                row.status = "fixed"
                row.resolved_at = now
                row.detail = note
                row.updated_at = now
        for f in delta["new"]:
            row = _find_status_row(session, url, f.get("code"), f.get("message"))
            if row is not None and row.verified_by == "auto" and row.status == "fixed":
                row.status = "open"
                row.resolved_at = None
                row.detail = f"Regressed: re-detected in run #{run_id}"
                row.updated_at = now
    session.commit()


def score_history(identifier: str, limit: int = 10, engine=None) -> list[dict]:
    """
    Returns the most recent scores for a monitored site, oldest-first, for trend
    views. `identifier` is matched against the site URL first (the unique unit we
    monitor) and, failing that, the domain — so callers may pass either.
    Each item: {run_id, started_at, score, grade}.
    """
    engine = init_db(engine)
    Session = sessionmaker(bind=engine, future=True)

    with Session() as session:
        rows = (
            session.query(SiteResult, ScanRun)
            .join(ScanRun, SiteResult.run_id == ScanRun.id)
            .filter((SiteResult.url == identifier) | (SiteResult.domain == identifier))
            .order_by(ScanRun.started_at.desc())
            .limit(limit)
            .all()
        )
        history = [
            {
                "run_id": run.id,
                "started_at": run.started_at.isoformat() if run.started_at else None,
                "score": site.score,
                "grade": site.grade,
            }
            for site, run in rows
        ]
        return list(reversed(history))


def _site_state(site: "SiteResult", run: "ScanRun") -> dict:
    from scoring.compliance import assess_compliance
    from scoring.remediation import backfill_reference_links

    # Backfill clickable reference links on load (non-destructive) so findings
    # persisted before reference_links existed still render as links.
    findings = backfill_reference_links(site.findings)
    coverage = site.coverage
    return {
        "name": site.name,
        "url": site.url,
        "domain": site.domain,
        "score": site.score,
        "grade": site.grade,
        "findings": findings,
        "coverage": coverage,
        "compliance": assess_compliance(findings, coverage),
        "run_id": run.id,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "rubric_version": run.rubric_version,
    }


def latest_site_states(engine=None, limit: int | None = None,
                       offset: int = 0) -> list[dict]:
    """
    Returns the most recent scored state for every distinct monitored URL,
    each with its `history` (oldest-first) attached. This is the data the
    global dashboard renders — a site appears once, at its latest result,
    even if it was scanned across different runs.

    Rather than loading every historical row and de-duplicating in Python, this
    resolves the latest ``run_id`` per URL in the database (``run_id`` is
    monotonic, so the greatest one is the newest run) and only materialises those
    rows — so cost scales with the number of *sites*, not the number of runs.
    ``limit``/``offset`` paginate the worst-scoring sites first.
    """
    engine = init_db(engine)
    Session = sessionmaker(bind=engine, future=True)

    with Session() as session:
        latest_run = (
            session.query(
                SiteResult.url.label("url"),
                func.max(SiteResult.run_id).label("run_id"),
            )
            .group_by(SiteResult.url)
            .subquery()
        )
        rows = (
            session.query(SiteResult, ScanRun)
            .join(ScanRun, SiteResult.run_id == ScanRun.id)
            .join(
                latest_run,
                (SiteResult.url == latest_run.c.url)
                & (SiteResult.run_id == latest_run.c.run_id),
            )
            .all()
        )
        states = [_site_state(site, run) for site, run in rows]

    states.sort(key=lambda s: (s["score"] if s["score"] is not None else 999, s["name"] or ""))
    if limit is not None:
        states = states[offset:offset + limit]
    elif offset:
        states = states[offset:]
    for st in states:
        st["history"] = score_history(st["url"] or st["domain"], limit=30, engine=engine)
    return states


def get_site_state(identifier: str, engine=None) -> dict | None:
    """Latest scored state for a single site (by URL, then domain), with history."""
    engine = init_db(engine)
    Session = sessionmaker(bind=engine, future=True)

    with Session() as session:
        row = (
            session.query(SiteResult, ScanRun)
            .join(ScanRun, SiteResult.run_id == ScanRun.id)
            .filter((SiteResult.url == identifier) | (SiteResult.domain == identifier))
            .order_by(ScanRun.started_at.desc())
            .first()
        )
        if not row:
            return None
        state = _site_state(*row)

    state["history"] = score_history(identifier, limit=30, engine=engine)
    return state


def previous_findings(identifier: str, engine=None) -> list[dict] | None:
    """Findings from the second-most-recent run for a site (by URL, then domain).

    Returns None when the site has fewer than two runs (nothing to compare
    against yet), so callers can distinguish "no change" from "first scan".
    """
    engine = init_db(engine)
    Session = sessionmaker(bind=engine, future=True)

    with Session() as session:
        rows = (
            session.query(SiteResult)
            .join(ScanRun, SiteResult.run_id == ScanRun.id)
            .filter((SiteResult.url == identifier) | (SiteResult.domain == identifier))
            .order_by(ScanRun.started_at.desc(), ScanRun.id.desc())
            .limit(2)
            .all()
        )
        if len(rows) < 2:
            return None
        return rows[1].findings


def _status_key(code: str | None, message: str | None) -> str:
    """Stable key identifying a finding within a site (code + message)."""
    return f"{code or ''}\x1f{message or ''}"


def _find_status_row(session, url: str, code: str | None, message: str | None):
    """Returns the FindingStatus row for (url, code, message), or None."""
    return (
        session.query(FindingStatus)
        .filter(FindingStatus.url == url,
                FindingStatus.code == (code or ""),
                FindingStatus.message == (message or ""))
        .first()
    )


def finding_statuses(url: str, engine=None) -> dict[str, dict]:
    """Returns {status_key: {status, updated_at, verified_by, resolved_at, detail}}
    for every stored status on a site."""
    engine = init_db(engine)
    Session = sessionmaker(bind=engine, future=True)

    with Session() as session:
        rows = session.query(FindingStatus).filter(FindingStatus.url == url).all()
        return {
            _status_key(r.code, r.message): {
                "status": r.status,
                "updated_at": r.updated_at.isoformat() if r.updated_at else None,
                "verified_by": r.verified_by,
                "resolved_at": r.resolved_at.isoformat() if r.resolved_at else None,
                "detail": r.detail,
            }
            for r in rows
        }


def fixed_findings(url: str, engine=None) -> list[dict]:
    """Returns the findings recorded as ``fixed`` for a site, newest-first.

    Each item is ``{code, message, verified_by, resolved_at, detail}``. This is
    the "already remediated" ledger a re-scan or an embedded remediation agent
    reads to avoid repeating a fix that is already done. Never raises.
    """
    engine = init_db(engine)
    Session = sessionmaker(bind=engine, future=True)

    with Session() as session:
        rows = (
            session.query(FindingStatus)
            .filter(FindingStatus.url == url, FindingStatus.status == "fixed")
            .order_by(FindingStatus.resolved_at.desc().nullslast(),
                      FindingStatus.updated_at.desc())
            .all()
        )
        return [
            {
                "code": r.code,
                "message": r.message,
                "verified_by": r.verified_by,
                "resolved_at": r.resolved_at.isoformat() if r.resolved_at else None,
                "detail": r.detail,
            }
            for r in rows
        ]


def set_finding_status(url: str, code: str | None, message: str | None,
                       status: str, engine=None) -> dict:
    """Creates/updates the operator-set remediation status for a finding.

    Marked ``verified_by="manual"`` so the auto-verifier never overrides a human
    decision; sets ``resolved_at`` when moved to ``fixed`` and clears it
    otherwise. Returns the stored record. Raises ValueError for an unknown status.
    """
    if status not in REMEDIATION_STATUSES:
        raise ValueError(f"Invalid status: {status!r}")

    engine = init_db(engine)
    Session = sessionmaker(bind=engine, future=True)
    now = datetime.now(timezone.utc)

    with Session() as session:
        row = _find_status_row(session, url, code, message)
        if row is None:
            row = FindingStatus(url=url, code=code or "", message=message or "",
                                status=status)
            session.add(row)
        else:
            row.status = status
            row.updated_at = now
        row.verified_by = "manual"
        if status == "fixed":
            row.resolved_at = now
            row.detail = "Marked fixed by operator"
        else:
            row.resolved_at = None
        session.commit()
        return {"status": row.status,
                "updated_at": row.updated_at.isoformat() if row.updated_at else None,
                "verified_by": row.verified_by,
                "resolved_at": row.resolved_at.isoformat() if row.resolved_at else None,
                "detail": row.detail}


def attach_finding_statuses(state: dict | None, engine=None) -> dict | None:
    """Annotates each actionable finding of a site state with its stored
    remediation status (defaulting to 'open') and, when known, who verified it
    and when it was resolved. Also attaches ``state["fixed"]`` — the ledger of
    already-remediated findings — so the UI/report/agent can show what's done
    without re-running it. Informational findings are left untouched. Mutates and
    returns the state.
    """
    if not state:
        return state
    url = state.get("url") or state.get("domain") or ""
    statuses = finding_statuses(url, engine=engine)
    for f in state.get("findings", []):
        if f.get("severity") == "info":
            continue
        entry = statuses.get(_status_key(f.get("code"), f.get("message")))
        f["status"] = entry["status"] if entry else DEFAULT_STATUS
        f["status_updated_at"] = entry["updated_at"] if entry else None
        f["verified_by"] = entry["verified_by"] if entry else None
        f["resolved_at"] = entry["resolved_at"] if entry else None
        f["remediation_detail"] = entry["detail"] if entry else None
    state["fixed"] = fixed_findings(url, engine=engine)
    return state


def fleet_trend(limit: int = 30, engine=None) -> list[dict]:
    """Average score per run over time (oldest-first) for the fleet trend chart."""
    engine = init_db(engine)
    Session = sessionmaker(bind=engine, future=True)

    with Session() as session:
        runs = (
            session.query(ScanRun)
            .order_by(ScanRun.started_at.desc())
            .limit(limit)
            .all()
        )
        trend = []
        for run in runs:
            scores = [r.score for r in run.results if r.score is not None]
            if not scores:
                continue
            trend.append({
                "run_id": run.id,
                "started_at": run.started_at.isoformat() if run.started_at else None,
                "avg_score": round(sum(scores) / len(scores), 1),
                "site_count": len(scores),
            })
    return list(reversed(trend))


def prune_history(keep_runs: int | None = None, older_than_days: int | None = None,
                  engine=None) -> int:
    """Deletes old scan runs (and their site results, via cascade) to bound the
    history a 24/7 fleet accumulates. Returns the number of runs deleted.

    * ``keep_runs`` \u2014 keep only the N most recent runs.
    * ``older_than_days`` \u2014 delete runs whose ``started_at`` is older than this.

    The two can be combined (a run is pruned if it fails *either* rule); calling
    with neither is a no-op. Retention is opt-in so nothing is deleted unless the
    caller (or a host scheduler) asks for it.
    """
    if keep_runs is None and older_than_days is None:
        return 0

    engine = init_db(engine)
    Session = sessionmaker(bind=engine, future=True)

    with Session() as session:
        doomed: set[int] = set()
        if keep_runs is not None:
            keep_ids = [
                r.id for r in session.query(ScanRun.id)
                .order_by(ScanRun.started_at.desc(), ScanRun.id.desc())
                .limit(max(0, keep_runs))
                .all()
            ]
            older = (
                session.query(ScanRun)
                .filter(~ScanRun.id.in_(keep_ids))
                .all() if keep_ids else session.query(ScanRun).all()
            )
            doomed.update(r.id for r in older)
        if older_than_days is not None:
            cutoff = datetime.now(timezone.utc) - timedelta(days=older_than_days)
            aged = session.query(ScanRun).filter(ScanRun.started_at < cutoff).all()
            doomed.update(r.id for r in aged)

        if not doomed:
            return 0
        # Delete via ORM objects so the cascade removes the child SiteResults.
        for run in session.query(ScanRun).filter(ScanRun.id.in_(doomed)).all():
            session.delete(run)
        session.commit()
        return len(doomed)
