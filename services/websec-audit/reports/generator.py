"""
reports/generator.py
Renders the scored audit results into a professional, management-ready HTML
report (always) and a PDF report (if a working WeasyPrint install is available).

The report is produced in a SINGLE language (English or French, selected via
`lang`) and mirrors the structure of a formal security report: a confidential
cover page, an executive summary, a scores/posture section (with a real
before/after comparison drawn only from recorded scan history), per-site
findings with recommendations and framework references, an optional
user-maintained remediation status per finding, a methodology & scoring rubric,
a prioritized residual-risk section, and an annex.

Honesty note
------------
This is an EXTERNAL, black-box audit. The report never claims a fix was applied,
a file was changed, or a deployment happened. "Remediation status" is a
user-maintained field (Open / In progress / Fixed) that is clearly labelled as
such and is separate from what the scanner observed.

Usage:
    from reports.generator import generate_report
    generate_report(scored_results, out_dir="reports/output", lang="en")

    python -m reports.generator          # reads scored_results.json
"""

import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

from reports.charts import history_svg, sparkline_svg
from reports.i18n_report import REPORT_STRINGS, resolve_report_lang

TEMPLATE_DIR = Path(__file__).parent / "templates"
TEMPLATE_NAME = "report.html.j2"
SITE_TEMPLATE_NAME = "report_site.html.j2"

SEV_ORDER = ("critical", "high", "medium", "low", "info")
ACTIONABLE = ("critical", "high", "medium", "low")
# Severity -> remediation priority bucket (P0 = most urgent).
PRIORITY = {"critical": "P0", "high": "P1", "medium": "P2", "low": "P2"}
# A finding that is present but not exposed (unconfirmed version-based CVE) is
# demoted one bucket: it should be fixed later than an exposed weakness.
_DEMOTE = {"P0": "P1", "P1": "P2", "P2": "P2"}


def _effective_priority(f: dict) -> str | None:
    prio = PRIORITY.get(f.get("severity"))
    if prio and f.get("exposed") is False:
        prio = _DEMOTE[prio]
    return prio


def _env() -> Environment:
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATE_DIR)),
        autoescape=select_autoescape(["html", "xml"]),
    )
    # Charts are trusted, pre-built SVG strings -> expose as filters, marked safe.
    env.filters["history_svg"] = history_svg
    env.filters["sparkline_svg"] = sparkline_svg
    return env


def slugify(value: str) -> str:
    """Filesystem-safe slug for per-site report filenames."""
    value = re.sub(r"^https?://", "", value or "site")
    return re.sub(r"[^a-zA-Z0-9._-]+", "_", value).strip("_") or "site"


def _severity_counts(findings: list[dict]) -> dict:
    counts = {s: 0 for s in SEV_ORDER}
    for f in findings:
        sev = f.get("severity", "info")
        counts[sev] = counts.get(sev, 0) + 1
    counts["actionable"] = sum(counts[s] for s in ACTIONABLE)
    return counts


def _status_summary(findings: list[dict]) -> dict:
    """Counts user-maintained remediation statuses across actionable findings."""
    summary = {"open": 0, "in_progress": 0, "fixed": 0, "total": 0}
    for f in findings:
        if f.get("severity") not in ACTIONABLE:
            continue
        summary["total"] += 1
        summary[f.get("status") or "open"] = summary.get(f.get("status") or "open", 0) + 1
    return summary


def _prioritized(findings: list[dict]) -> list[dict]:
    """Open actionable findings grouped into P0/P1/P2 buckets (in that order).

    Uses the user-maintained status when present: findings marked 'fixed' are
    excluded from the open backlog, matching the fleet residual behaviour.
    """
    buckets: dict[str, list[dict]] = {"P0": [], "P1": [], "P2": []}
    for f in findings:
        prio = _effective_priority(f)
        if prio and f.get("status") != "fixed":
            buckets[prio].append(f)
    return [{"priority": p, "findings": buckets[p]} for p in ("P0", "P1", "P2") if buckets[p]]


def _before_after(history: list[dict]) -> dict | None:
    """First recorded score vs the latest, drawn only from real history."""
    scores = [h for h in (history or []) if h.get("score") is not None]
    if len(scores) < 2:
        return None
    before, after = scores[0]["score"], scores[-1]["score"]
    return {
        "before": before,
        "after": after,
        "delta": after - before,
        "before_date": (scores[0].get("started_at") or "")[:10],
        "after_date": (scores[-1].get("started_at") or "")[:10],
    }


def _fleet_before_after(sites: list[dict]) -> dict | None:
    """Average first vs latest score across sites that have >= 2 recorded runs."""
    befores, afters = [], []
    for s in sites:
        ba = _before_after(s.get("history"))
        if ba:
            befores.append(ba["before"])
            afters.append(ba["after"])
    if not befores:
        return None
    before = round(sum(befores) / len(befores), 1)
    after = round(sum(afters) / len(afters), 1)
    return {"before": before, "after": after, "delta": round(after - before, 1),
            "sites": len(befores)}


def _common_issues(sites: list[dict], top: int = 8) -> list[dict]:
    """Most frequent actionable findings across the fleet, by message."""
    counter: Counter = Counter()
    severity_of: dict[str, str] = {}
    for s in sites:
        seen = set()
        for f in s.get("findings", []):
            if f.get("severity") not in ACTIONABLE:
                continue
            msg = f.get("message", "")
            if msg in seen:
                continue
            seen.add(msg)
            counter[msg] += 1
            severity_of[msg] = f.get("severity", "low")
    return [
        {"message": msg, "sites": n, "severity": severity_of.get(msg, "low")}
        for msg, n in counter.most_common(top)
    ]


def _fleet_residual(sites: list[dict]) -> list[dict]:
    """Fleet-wide open actionable findings grouped into P0/P1/P2 buckets, each
    item aggregating how many sites are affected. Uses the user-maintained status
    when present: findings marked 'fixed' are excluded from the open backlog.
    """
    buckets: dict[str, dict[tuple, dict]] = {"P0": {}, "P1": {}, "P2": {}}
    for s in sites:
        for f in s.get("findings", []):
            prio = _effective_priority(f)
            if not prio or (f.get("status") == "fixed"):
                continue
            key = (f.get("code"), f.get("message"))
            entry = buckets[prio].setdefault(key, {
                "message": f.get("message"),
                "severity": f.get("severity"),
                "recommendation_en": f.get("recommendation_en"),
                "recommendation_fr": f.get("recommendation_fr"),
                "references": f.get("references", []),
                "sites": 0,
            })
            entry["sites"] += 1
    out = []
    for p in ("P0", "P1", "P2"):
        entries = sorted(buckets[p].values(), key=lambda e: -e["sites"])
        if entries:
            out.append({"priority": p, "entries": entries})
    return out


def _grade_distribution(sites: list[dict]) -> list[dict]:
    counts = Counter(s.get("grade") for s in sites if s.get("grade"))
    return [{"grade": g, "count": counts.get(g, 0)}
            for g in ("A", "B", "C", "D", "E", "F") if counts.get(g)]


def _posture(avg: float) -> str:
    """Qualitative fleet/site posture key from an average score."""
    if avg >= 90:
        return "strong"
    if avg >= 75:
        return "good"
    if avg >= 60:
        return "fair"
    if avg >= 40:
        return "weak"
    return "critical"


def _fleet_context(sites: list[dict]) -> dict:
    scores = [s["score"] for s in sites if s.get("score") is not None]
    avg = round(sum(scores) / len(scores), 1) if scores else 0
    all_findings = [f for s in sites for f in s.get("findings", [])]
    critical_sites = sum(
        1 for s in sites
        if any(f.get("severity") == "critical" for f in s.get("findings", []))
    )
    return {
        "site_count": len(sites),
        "avg_score": avg,
        "posture": _posture(avg),
        "severity": _severity_counts(all_findings),
        "status": _status_summary(all_findings),
        "grade_dist": _grade_distribution(sites),
        "critical_sites": critical_sites,
        "at_risk": sum(1 for s in scores if s < 60),
        "clean": sum(1 for s in sites if not any(
            f.get("severity") in ACTIONABLE for f in s.get("findings", []))),
        "before_after": _fleet_before_after(sites),
        "common_issues": _common_issues(sites),
        "residual": _fleet_residual(sites),
    }


def _render_common() -> dict:
    return {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}


def render_html(scored_results: list[dict], rubric_version: str | None = None,
                lang: str = "en") -> str:
    """Renders the consolidated (all-sites) HTML report as a string."""
    lang = resolve_report_lang(lang)
    template = _env().get_template(TEMPLATE_NAME)

    if rubric_version is None and scored_results:
        rubric_version = scored_results[0].get("rubric_version", "n/a")

    # Sites shown worst-first so the reader sees the priorities immediately.
    sites = sorted(scored_results,
                   key=lambda s: (s.get("score") if s.get("score") is not None else 999,
                                  s.get("name") or ""))
    for s in sites:
        s["_severity"] = _severity_counts(s.get("findings", []))

    return template.render(
        sites=sites,
        fleet=_fleet_context(sites),
        t=REPORT_STRINGS[lang],
        lang=lang,
        rubric_version=rubric_version or "n/a",
        priority_order=("P0", "P1", "P2"),
        **_render_common(),
    )


def render_site_html(site: dict, lang: str = "en") -> str:
    """Renders a single-site HTML report as a string."""
    lang = resolve_report_lang(lang)
    template = _env().get_template(SITE_TEMPLATE_NAME)
    findings = site.get("findings", [])
    return template.render(
        site=site,
        severity=_severity_counts(findings),
        status_summary=_status_summary(findings),
        prioritized=_prioritized(findings),
        before_after=_before_after(site.get("history")),
        posture=_posture(site.get("score") or 0),
        t=REPORT_STRINGS[lang],
        lang=lang,
        rubric_version=site.get("rubric_version", "n/a"),
        **_render_common(),
    )


def html_to_pdf(html: str, pdf_path: Path) -> bool:
    """
    Converts HTML to PDF with WeasyPrint. Returns True on success, False if
    WeasyPrint (or its native deps) is unavailable — without raising.
    """
    try:
        from weasyprint import HTML
    except Exception as e:  # ImportError or native-lib load failure
        print(f"[!] PDF skipped — WeasyPrint unavailable: {e}")
        print("    Install native libs: sudo apt install libpango-1.0-0 "
              "libpangocairo-1.0-0 libgdk-pixbuf2.0-0 libcairo2")
        return False

    try:
        HTML(string=html, base_url=str(TEMPLATE_DIR)).write_pdf(str(pdf_path))
        return True
    except Exception as e:
        print(f"[!] PDF generation failed: {e}")
        return False


def generate_report(scored_results: list[dict], out_dir: str = "reports/output",
                    basename: str | None = None, lang: str = "en") -> dict:
    """
    Writes a timestamped HTML report (and PDF if possible) to out_dir.
    Returns {"html": path, "pdf": path|None}.
    """
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    if basename is None:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        basename = f"audit_report_{stamp}"

    html = render_html(scored_results, lang=lang)
    html_path = out / f"{basename}.html"
    html_path.write_text(html, encoding="utf-8")

    pdf_path = out / f"{basename}.pdf"
    pdf_ok = html_to_pdf(html, pdf_path)

    return {"html": html_path, "pdf": pdf_path if pdf_ok else None}


def generate_site_report(site: dict, out_dir: str = "reports/output",
                         basename: str | None = None, lang: str = "en") -> dict:
    """
    Writes a single-site HTML + PDF report.
    Returns {"html": path, "pdf": path|None}.
    """
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    if basename is None:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        basename = f"site_{slugify(site.get('url') or site.get('domain'))}_{stamp}"

    html = render_site_html(site, lang=lang)
    html_path = out / f"{basename}.html"
    html_path.write_text(html, encoding="utf-8")

    pdf_path = out / f"{basename}.pdf"
    pdf_ok = html_to_pdf(html, pdf_path)

    return {"html": html_path, "pdf": pdf_path if pdf_ok else None}


# Kept for symmetry with older callers/tests that grouped findings by category.
def group_by_category(findings: list[dict]) -> dict:
    grouped = defaultdict(list)
    for f in findings:
        grouped[f.get("category", "other")].append(f)
    return dict(grouped)


if __name__ == "__main__":
    import json

    scored = json.loads(Path("scored_results.json").read_text())
    paths = generate_report(scored)
    print(f"HTML report: {paths['html'].resolve()}")
    if paths["pdf"]:
        print(f"PDF report:  {paths['pdf'].resolve()}")
    else:
        print("PDF report:  not generated (see message above)")
