"""
main.py
Orchestrator for the Web Audit Tool.

Reads config/targets.yaml, runs the scanners against every site, scores the
results, persists the run, generates HTML/PDF reports, and (optionally) emails
alerts for critical findings.

Examples:
    python main.py                         # full pipeline, no port scan
    python main.py --authorized            # also run the (authorized) port scan
    python main.py --no-report --no-db     # just scan + score, print JSON
    python main.py --alert                 # send email alerts (needs SMTP env vars)
    python main.py --scan tls headers      # only run selected scanners

Port scanning is OFF unless --authorized is passed (see scanners/ports.py).
"""

import argparse
import json
import os
from pathlib import Path

# Load SMTP / DB settings from a local .env if python-dotenv is available.
# Optional: the tool runs fine without it (env vars can be set another way).
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from core.audit import (
    ALL_SCANNERS,
    AUTO_WORKERS,
    DEFAULT_SCANNERS,
    ENGINE_SCANNERS,
    MAX_WORKERS_CAP,
    _env_min_confidence,
    _merge_targets,
    load_targets,
    resolve_workers,
    run_scans,
)
from scoring.engine import score_all


def _workers_arg(value: str) -> int:
    """Parse --workers: an integer, or 'auto'/'max' meaning one worker per site."""
    if value.strip().lower() in ("auto", "max"):
        return AUTO_WORKERS
    try:
        return int(value)
    except ValueError:
        raise argparse.ArgumentTypeError(
            f"--workers must be an integer or 'auto'/'max', not {value!r}"
        )


def _env_int(name: str) -> int | None:
    """Reads an optional positive integer setting; ignores blank/invalid values."""
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        print(f"[!] Ignoring invalid {name}={raw!r} (expected an integer).")
        return None


def _trend_marker(scored_site: dict) -> str:
    """Returns a short 'trend vs. previous run' marker for the CLI, e.g. '(+5)'.

    `history` is oldest-first and includes the current run as its last item, so
    the previous run is the second-to-last entry. Returns '' when there is no
    prior run to compare against.
    """
    history = scored_site.get("history") or []
    if len(history) < 2:
        return "(new)" if history else ""
    delta = history[-1]["score"] - history[-2]["score"]
    if delta > 0:
        return f"(▲ +{delta})"
    if delta < 0:
        return f"(▼ {delta})"
    return "(= 0)"


def show_history(domain: str) -> None:
    """Prints the recorded score history for a single domain and exits."""
    from db.models import score_history

    history = score_history(domain, limit=50)
    if not history:
        print(f"No history recorded for {domain}. Run a scan first.")
        return

    print(f"=== Score history for {domain} ===")
    prev = None
    for entry in history:
        when = (entry["started_at"] or "")[:19].replace("T", " ")
        delta = "" if prev is None else f"  ({entry['score'] - prev:+d})"
        print(f"  {when}  run #{entry['run_id']:<4}  {entry['grade']}  {entry['score']:>3}/100{delta}")
        prev = entry["score"]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Web security audit tool")
    p.add_argument("--config", default="config/targets.yaml", help="Path to targets.yaml")
    p.add_argument("--scan", nargs="+", choices=ALL_SCANNERS, default=None,
                   help="Which scanners to run (default: the fast core set — "
                        "everything except ports and the deep engine scanners).")
    p.add_argument("--deep", action="store_true",
                   help="Also run the external-engine scanners "
                        f"({', '.join(ENGINE_SCANNERS)}); requires their binaries "
                        "installed. Slower but far deeper.")
    p.add_argument("--authorized", action="store_true",
                   help="Confirm WRITTEN authorization exists; enables port scanning "
                        "and nuclei's intrusive templates.")
    p.add_argument("--alert", action="store_true", help="Send email alerts for critical findings.")
    p.add_argument("--no-report", action="store_true", help="Skip HTML/PDF report generation.")
    p.add_argument("--no-db", action="store_true", help="Skip persisting the run to the database.")
    p.add_argument("--raw-out", default="scan_results.json", help="Where to write raw scan JSON.")
    p.add_argument("--scored-out", default="scored_results.json", help="Where to write scored JSON.")
    p.add_argument("--history", metavar="DOMAIN",
                   help="Print the recorded score history for a domain and exit (no scan).")
    p.add_argument("--workers", type=_workers_arg, default=AUTO_WORKERS,
                   help="Max concurrent site scans: an integer, or 'auto'/'max' "
                        f"(default) to scan every site in parallel, capped at {MAX_WORKERS_CAP}.")
    p.add_argument("--per-site-reports", action="store_true",
                   help="Also generate an individual HTML/PDF report per site.")
    p.add_argument("--min-confidence", choices=["low", "potential", "confirmed"], default=None,
                   help="Automatic false-positive reduction: drop findings below this "
                        "confidence tier from the score/report/alerts (no manual triage). "
                        "Overrides the AUDIT_MIN_CONFIDENCE env var.")
    p.add_argument("--confirmed-only", action="store_true",
                   help="Shortcut for --min-confidence confirmed: keep only "
                        "actively-verified detections and directly-observed facts.")
    p.add_argument("--verify-backports", action="store_true", default=None,
                   help="Cross-verify CVEs against OSV and automatically drop any "
                        "reported as not affecting the detected version (false "
                        "positives). Overrides AUDIT_VERIFY_BACKPORTS. Needs network.")
    p.add_argument("--discover", nargs="+", metavar="DOMAIN", default=None,
                   help="EASM asset discovery: enumerate subdomains of the given "
                        "root domain(s) via Certificate Transparency + DNS and scan "
                        "them (merged with any config sites). Needs network. Only "
                        "use on domains you are authorised to audit.")
    p.add_argument("--attribute", action="store_true",
                   help="With --discover: attribute each asset to its owner "
                        "(resolved IP + origin ASN/owner via Team Cymru).")
    p.add_argument("--expand", action="store_true",
                   help="With --discover: reverse-DNS (PTR) expansion — sweep the "
                        "resolved IPs for additional in-scope hostnames. Needs network.")
    p.add_argument("--bruteforce", action="store_true",
                   help="With --discover: also DNS-brute-force common subdomain "
                        "labels (keyless; finds hosts with no cert/passive-DNS record).")
    p.add_argument("--buckets", action="store_true",
                   help="With --discover: enumerate likely public cloud storage "
                        "buckets (S3/GCS/Azure) for the discovered domains. Needs network.")
    p.add_argument("--scope", action="store_true",
                   help="With --discover: score each asset's ownership confidence "
                        "(registrant org + owner ASN/prefixes + cert org) so "
                        "unrelated tenants on shared infra are flagged, not scanned "
                        "blindly. Needs network.")
    p.add_argument("--prune-keep-runs", type=int, metavar="N", default=None,
                   help="After saving, keep only the N most recent runs in the "
                        "database. Bounds history growth on continuous fleet "
                        "monitoring. Defaults to AUDIT_PRUNE_KEEP_RUNS.")
    p.add_argument("--prune-days", type=int, metavar="D", default=None,
                   help="After saving, delete runs older than D days. "
                        "Defaults to AUDIT_PRUNE_DAYS.")
    return p.parse_args()


def main() -> None:
    args = parse_args()

    # History view is a read-only shortcut: print the trend and exit.
    if args.history:
        show_history(args.history)
        return

    # Default scanner set: the fast core set (ports + engines are opt-in).
    enabled = args.scan if args.scan is not None else list(DEFAULT_SCANNERS)
    if args.deep:
        enabled += [s for s in ENGINE_SCANNERS if s not in enabled]
    if "ports" in enabled and not args.authorized:
        print("[!] 'ports' requested without --authorized; the port scan will be skipped per policy.")

    sites = load_targets(args.config)
    if args.discover:
        from scanners.discovery import discover_assets
        print(f"[+] EASM discovery on: {', '.join(args.discover)} ...")
        found = discover_assets(args.discover, attribute=args.attribute,
                                expand=args.expand, bruteforce=args.bruteforce)
        if args.scope:
            from scanners.scoping import scope_assets
            print("[+] Scoring asset ownership confidence ...")
            scope_assets(found, root_domains=args.discover)
            for a in sorted(found, key=lambda x: -(x.get("ownership") or {})
                            .get("confidence", 0)):
                own = a.get("ownership") or {}
                print(f"      {a['domain']:<40} {own.get('label', '-'):<10} "
                      f"{own.get('confidence', 0):>4} "
                      f"[{', '.join(own.get('signals') or [])}]")
        before = len(sites)
        sites = _merge_targets(sites, found)
        print(f"[+] Discovered {len(found)} live asset(s); "
              f"{len(sites) - before} new after de-duplication.")
        if args.attribute:
            for a in found:
                attr = a.get("attribution") or {}
                print(f"      {a['domain']:<40} {attr.get('ip') or '-':<16} "
                      f"{attr.get('asn') or '-'} {attr.get('asn_owner') or ''}")
        # Surface-change tracking: report newly-exposed / disappeared assets.
        if not args.no_db:
            try:
                from db.models import track_discovery
                inv_meta = {}
                for a in found:
                    attr = a.get("attribution") or {}
                    rec = {}
                    if attr.get("ip"):
                        rec["ips"] = [attr["ip"]]
                    if attr.get("asn"):
                        rec["asn"] = attr["asn"]
                    inv_meta[a["domain"]] = rec
                change = track_discovery(inv_meta)
                if change["added"]:
                    print(f"[surface] NEW assets since last discovery: "
                          f"{', '.join(change['added'])}")
                if change["removed"]:
                    print(f"[surface] assets GONE since last discovery: "
                          f"{', '.join(change['removed'])}")
                # Alert on newly-exposed assets (the core continuous-EASM signal).
                if args.alert and change["added"]:
                    from alerts.mailer import send_surface_change_alert
                    sc = send_surface_change_alert(change["added"], change["removed"])
                    if sc["sent"]:
                        print(f"[alert] Surface-change alert sent to "
                              f"{', '.join(sc['recipients'])}")
                    elif sc["error"]:
                        print(f"[alert] Surface-change alert not sent: {sc['error']}")
            except Exception as e:
                print(f"[!] Surface-change tracking skipped: {e}")
        if args.buckets:
            from scanners.discovery import discover_buckets
            print("[+] Enumerating cloud storage buckets (S3/GCS/Azure) ...")
            buckets = discover_buckets(args.discover)
            if buckets:
                for b in buckets:
                    flag = "PUBLIC" if b["exposure"] == "public" else "exists"
                    print(f"      [{flag}] {b['provider']}: {b['url']}")
            else:
                print("      No candidate buckets found.")
    effective_workers = resolve_workers(args.workers, len(sites))
    mode = "auto" if args.workers <= AUTO_WORKERS else "manual"
    print(f"[+] Scanning {len(sites)} site(s) with up to {effective_workers} "
          f"parallel workers ({mode}) ...")
    raw_results = run_scans(sites, enabled, args.authorized, max_workers=args.workers,
                            on_progress=lambda msg: print(f"  {msg}"),
                            verify_backports=args.verify_backports)
    Path(args.raw_out).write_text(json.dumps(raw_results, indent=2, default=str))

    min_confidence = ("confirmed" if args.confirmed_only
                      else args.min_confidence or _env_min_confidence())
    if min_confidence:
        print(f"[+] Auto false-positive reduction: keeping findings >= '{min_confidence}' confidence.")
    scored = score_all(raw_results, min_confidence=min_confidence)
    Path(args.scored_out).write_text(json.dumps(scored, indent=2, default=str))

    if not args.no_db:
        try:
            from core.diff import diff_findings
            from db.models import previous_findings, save_run, score_history
            run_id = save_run(scored)
            print(f"\n[db] Saved as run #{run_id}")
            # Attach per-site history so the CLI/report can show the trend
            # over time ("suivre l'évolution de la sécurité dans le temps").
            # Also flag which findings are new since the previous run so email
            # alerts can mark fresh criticals as [NEW].
            for s in scored:
                s["history"] = score_history(s.get("url"), limit=10)
                delta = diff_findings(s.get("findings", []), previous_findings(s.get("url")))
                s["new_finding_keys"] = [[f.get("code"), f.get("message")] for f in delta["new"]]
                # save_run auto-verified any finding that disappeared since the
                # previous run as "fixed" — surface that so a re-scan visibly
                # confirms remediation instead of silently dropping it.
                if delta["resolved"]:
                    print(f"[fixed] {s.get('name') or s.get('url')}: "
                          f"{len(delta['resolved'])} finding(s) verified fixed "
                          "(no longer detected)")
        except Exception as e:
            print(f"[!] DB save skipped: {e}")

        keep_runs = args.prune_keep_runs or _env_int("AUDIT_PRUNE_KEEP_RUNS")
        prune_days = args.prune_days or _env_int("AUDIT_PRUNE_DAYS")
        if keep_runs or prune_days:
            try:
                from db.models import prune_history
                deleted = prune_history(keep_runs=keep_runs, older_than_days=prune_days)
                print(f"[db] Pruned {deleted} old run(s) from history")
            except Exception as e:
                print(f"[!] History pruning skipped: {e}")

    print("\n=== SCORES ===")
    for s in scored:
        print(f"  {s['grade']}  {s['score']:>3}/100  {s['name']}  {_trend_marker(s)}")

    if not args.no_report:
        try:
            from reports.generator import generate_report, generate_site_report
            try:
                from db.models import attach_finding_statuses
                for s in scored:
                    attach_finding_statuses(s)
            except Exception:
                pass
            paths = generate_report(scored)
            print(f"[report] HTML: {paths['html']}")
            print(f"[report] PDF:  {paths['pdf'] or 'not generated'}")
            if args.per_site_reports:
                for s in scored:
                    sp = generate_site_report(s)
                    print(f"[report] {s['name']}: {sp['html']}")
        except Exception as e:
            print(f"[!] Report generation skipped: {e}")

    if args.alert:
        try:
            from alerts.mailer import send_alerts
            outcome = send_alerts(scored)
            if not outcome["triggered"]:
                print("[alert] No sites met alert conditions.")
            elif outcome["sent"]:
                print(f"[alert] Sent to {', '.join(outcome['recipients'])}")
            else:
                print(f"[alert] Triggered but not sent: {outcome['error']}")
        except Exception as e:
            print(f"[!] Alerting skipped: {e}")


if __name__ == "__main__":
    main()
