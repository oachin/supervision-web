"""
dashboard/i18n.py
Lightweight bilingual (English / French) UI strings for the dashboard.

The dashboard shows a single language at a time (the user toggles EN/FR in the
header). The chosen language is remembered in a `lang` cookie. Findings already
carry `recommendation_en` / `recommendation_fr`; templates pick the right one
from `lang`.
"""

from __future__ import annotations

SUPPORTED = ("en", "fr")
DEFAULT = "en"

# Severity keys are shared; only their labels differ per language.
SEVERITY_ORDER = ("critical", "high", "medium", "low", "info")

TRANSLATIONS: dict[str, dict[str, object]] = {
    "en": {
        "lang_name": "English",
        "app_title": "Web Security Audit",
        "app_subtitle": "Audit & monitoring dashboard",
        "nav_dashboard": "Dashboard",
        "nav_global_report": "Global report",
        "logout": "Log out",
        "login_title": "Sign in",
        "login_subtitle": "This dashboard is protected. Please sign in.",
        "login_username": "Username",
        "login_password": "Password",
        "login_submit": "Sign in",
        "login_error": "Invalid username or password.",
        # Global page
        "fleet_overview": "Fleet overview",
        "run_audit": "Run audit now",
        "scanning": "Scanning…",
        "working": "Working",
        "last_run": "Last run",
        # Live per-site scan progress
        "scan_progress_title": "Scan progress",
        "scan_sites_done": "sites done",
        "scan_status": {
            "queued": "Queued", "scanning": "Scanning",
            "done": "Done", "error": "Error",
        },
        "scan_checking": "Checking",
        "scan_checks": {
            "availability": "Availability", "tls": "TLS/SSL",
            "headers": "Security headers", "dns_auth": "DNS & email auth",
            "takeover": "Subdomain takeover",
            "misconfig": "Misconfiguration", "cve": "Known CVEs",
            "testssl": "Deep TLS (testssl)", "nuclei": "Nuclei",
            "zap": "ZAP baseline", "ports": "Port scan",
        },
        "scan_failed": "Last scan failed",
        "auto_scans": "every {n} min",
        "auto_scans_at": "automatic scans daily at {times}",
        "auto_scans_at_prefix": "automatic scans daily at",
        "schedule_none": "No automatic scans scheduled.",
        "schedule_edit": "Edit schedule",
        "schedule_saved": "Schedule saved.",
        "schedule_times_label": "Daily scan time(s)",
        "schedule_times_hint": "Pick a time and click \u201cAdd\u201d — you can add several. Switch between 12h and 24h with the toggle above.",
        "schedule_hour_label": "Hour",
        "schedule_minute_label": "Minute",
        "schedule_second_label": "Second",
        "schedule_ampm_label": "AM/PM",
        "schedule_add_time": "Add",
        "schedule_interval_label": "Or every N minutes",
        "schedule_interval_hint": "0 = off. Combine with fixed times if you like.",
        "schedule_save": "Save schedule",
        "schedule_type_interval": "Repeating",
        "schedule_type_daily": "Daily",
        "schedule_type_interval_hint": "Runs automatically on a fixed interval",
        "schedule_type_daily_hint": "Runs automatically at specific times each day",
        "next_scan_interval": "Next scan in",
        "next_scan_at": "Next scan at",
        "theme_toggle": "Toggle dark mode",
        "no_data_title": "No audit data yet",
        "no_data_body": "Configure config/targets.yaml and run an audit to populate the dashboard.",
        # KPI cards
        "kpi_sites": "Sites monitored",
        "kpi_avg": "Average score",
        "kpi_critical": "Critical sites",
        "kpi_atrisk": "At risk (<60)",
        "kpi_findings": "Open findings",
        "kpi_clean": "Clean sites",
        # Charts
        "chart_grades": "Grade distribution",
        "chart_trend": "Fleet score trend",
        "chart_severity": "Findings by severity",
        "chart_categories": "Findings by category",
        "need_two": "Run at least two audits to see a trend.",
        "no_findings_fleet": "No findings across the fleet — everything is clean.",
        # Top issues
        "top_issues": "Most common issues",
        "top_issues_hint": "Across all monitored sites",
        "sites_affected": "sites",
        # Changes since last scan
        "changes_title": "Changes since last scan",
        "changes_new_critical": "new critical",
        "changes_new_high": "new high",
        "changes_resolved": "resolved",
        "changes_none": "No change since the previous scan.",
        "badge_new": "NEW",
        "resolved_title": "Resolved since last scan",
        # Live status
        "live_title": "Live status",
        "live_badge": "LIVE",
        "live_hint": "Availability & certificate expiry, refreshed automatically",
        "live_up": "Up",
        "live_down": "Down",
        "live_response": "response",
        "live_cert": "cert",
        "live_cert_expired": "expired",
        "live_updated": "updated",
        "live_waiting": "Waiting for the first live check…",
        "days_short": "d",
        "ago": "ago",
        # Table
        "th_grade": "Grade",
        "th_score": "Score",
        "th_trend": "Trend",
        "th_site": "Site",
        "th_history": "History",
        "th_findings": "Findings",
        "th_lastscan": "Last scan",
        "search_placeholder": "Search sites…",
        "filter_all_grades": "All grades",
        "no_match": "No sites match your filters.",
        "label_new": "new",
        "showing": "Showing",
        "of": "of",
        "sites_word": "sites",
        # Site page
        "back": "Back to dashboard",
        "site_no_data": "No data for this site. Run an audit first.",
        "html_report": "HTML report",
        "pdf_report": "PDF report",
        "posture_over_time": "Security posture over time",
        "not_enough_history": "Not enough history yet — run more audits to see the trend.",
        "severity_breakdown": "Severity breakdown",
        "findings_reco": "Findings & recommendations",
        "no_findings_site": "No findings — all checks passed.",
        # Regulatory compliance (France & Morocco)
        "compliance_title": "Regulatory compliance (France & Morocco)",
        "compliance_intro": "Externally-observable technical controls mapped to "
            "France (ANSSI, RGS, GDPR/CNIL) and Morocco (DGSSI, Law 09-08/CNDP, "
            "Law 05-20). Technical mapping only — not a legal certification.",
        "compliance_status": {
            "compliant": "Compliant", "non_compliant": "Non-compliant",
            "partial": "Partial", "not_assessed": "Not assessed"},
        "th_control": "Control",
        "th_frameworks": "Frameworks",
        "run_history": "Run history",
        "th_date": "Date (UTC)",
        "th_run": "Run #",
        "th_category": "Category",
        "th_severity": "Severity",
        "th_finding": "Finding, recommendation & references",
        "th_points": "Points",
        "fix": "Fix:",
        "filter_by_severity": "Filter:",
        "filter_all": "All",
        # Remediation status (user-maintained, separate from scanner findings)
        "th_status": "Remediation",
        "status_hint": "You set these — they record what your team has done, "
                       "separately from what the scanner observed.",
        "status_labels": {
            "open": "Open", "in_progress": "In progress", "fixed": "Fixed",
        },
        # Verified-fix ledger (persistent record of what's already remediated)
        "fixed_ledger_title": "Fixed & verified",
        "fixed_ledger_hint": "Findings confirmed remediated — a re-scan (or an "
                             "automated agent) can skip these instead of "
                             "repeating the fix.",
        "verified_auto": "auto-verified",
        "verified_manual": "operator",
        # Severities
        "sev": {
            "critical": "Critical", "high": "High", "medium": "Medium",
            "low": "Low", "info": "Info",
        },
        "footer": "External black-box checks only · Penalty-based scoring · EN/FR reports",
    },
    "fr": {
        "lang_name": "Français",
        "app_title": "Audit de sécurité web",
        "app_subtitle": "Tableau de bord d'audit et de surveillance",
        "nav_dashboard": "Tableau de bord",
        "nav_global_report": "Rapport global",
        "logout": "Se déconnecter",
        "login_title": "Connexion",
        "login_subtitle": "Ce tableau de bord est protégé. Veuillez vous connecter.",
        "login_username": "Nom d'utilisateur",
        "login_password": "Mot de passe",
        "login_submit": "Se connecter",
        "login_error": "Nom d'utilisateur ou mot de passe invalide.",
        # Global page
        "fleet_overview": "Vue d'ensemble",
        "run_audit": "Lancer un audit",
        "scanning": "Analyse en cours…",
        "working": "Traitement",
        "last_run": "Dernière exécution",
        # Progression de l'analyse par site
        "scan_progress_title": "Progression de l'analyse",
        "scan_sites_done": "sites terminés",
        "scan_status": {
            "queued": "En attente", "scanning": "Analyse",
            "done": "Terminé", "error": "Erreur",
        },
        "scan_checking": "Contrôle",
        "scan_checks": {
            "availability": "Disponibilité", "tls": "TLS/SSL",
            "headers": "En-têtes de sécurité", "dns_auth": "DNS & auth. e-mail",
            "takeover": "Prise de contrôle de sous-domaine",
            "misconfig": "Mauvaise configuration", "cve": "CVE connues",
            "testssl": "TLS approfondi (testssl)", "nuclei": "Nuclei",
            "zap": "ZAP baseline", "ports": "Scan de ports",
        },
        "scan_failed": "Échec de la dernière analyse",
        "auto_scans": "toutes les {n} min",
        "auto_scans_at": "analyses automatiques chaque jour à {times}",
        "auto_scans_at_prefix": "analyses automatiques chaque jour à",
        "schedule_none": "Aucune analyse automatique programmée.",
        "schedule_edit": "Modifier la programmation",
        "schedule_saved": "Programmation enregistrée.",
        "schedule_times_label": "Heure(s) d'analyse quotidienne",
        "schedule_times_hint": "Choisissez une heure et cliquez sur « Ajouter » — vous pouvez en ajouter plusieurs. Basculez entre 12h et 24h avec le bouton ci-dessus.",
        "schedule_hour_label": "Heure",
        "schedule_minute_label": "Minute",
        "schedule_second_label": "Seconde",
        "schedule_ampm_label": "AM/PM",
        "schedule_add_time": "Ajouter",
        "schedule_interval_label": "Ou toutes les N minutes",
        "schedule_interval_hint": "0 = désactivé. Combinable avec des heures fixes.",
        "schedule_save": "Enregistrer",
        "schedule_type_interval": "Répétitive",
        "schedule_type_daily": "Quotidienne",
        "schedule_type_interval_hint": "S'exécute automatiquement à intervalle fixe",
        "schedule_type_daily_hint": "S'exécute automatiquement à des heures précises chaque jour",
        "next_scan_interval": "Prochaine analyse dans",
        "next_scan_at": "Prochaine analyse à",
        "theme_toggle": "Basculer le mode sombre",
        "no_data_title": "Aucune donnée d'audit",
        "no_data_body": "Configurez config/targets.yaml et lancez un audit pour alimenter le tableau de bord.",
        # KPI cards
        "kpi_sites": "Sites suivis",
        "kpi_avg": "Score moyen",
        "kpi_critical": "Sites critiques",
        "kpi_atrisk": "À risque (<60)",
        "kpi_findings": "Constats ouverts",
        "kpi_clean": "Sites sains",
        # Charts
        "chart_grades": "Répartition des notes",
        "chart_trend": "Tendance du score",
        "chart_severity": "Constats par gravité",
        "chart_categories": "Constats par catégorie",
        "need_two": "Lancez au moins deux audits pour voir une tendance.",
        "no_findings_fleet": "Aucun constat sur le parc — tout est conforme.",
        # Top issues
        "top_issues": "Problèmes les plus fréquents",
        "top_issues_hint": "Sur l'ensemble des sites suivis",
        "sites_affected": "sites",
        # Changes since last scan
        "changes_title": "Changements depuis le dernier scan",
        "changes_new_critical": "nouveaux critiques",
        "changes_new_high": "nouveaux élevés",
        "changes_resolved": "résolus",
        "changes_none": "Aucun changement depuis le scan précédent.",
        "badge_new": "NOUVEAU",
        "resolved_title": "Résolus depuis le dernier scan",
        # Live status
        "live_title": "État en direct",
        "live_badge": "EN DIRECT",
        "live_hint": "Disponibilité et expiration des certificats, actualisées automatiquement",
        "live_up": "En ligne",
        "live_down": "Hors ligne",
        "live_response": "réponse",
        "live_cert": "certif.",
        "live_cert_expired": "expiré",
        "live_updated": "mis à jour",
        "live_waiting": "En attente du premier contrôle en direct…",
        "days_short": "j",
        "ago": "il y a",
        # Table
        "th_grade": "Note",
        "th_score": "Score",
        "th_trend": "Tendance",
        "th_site": "Site",
        "th_history": "Historique",
        "th_findings": "Constats",
        "th_lastscan": "Dernier scan",
        "search_placeholder": "Rechercher un site…",
        "filter_all_grades": "Toutes les notes",
        "no_match": "Aucun site ne correspond aux filtres.",
        "label_new": "nouveau",
        "showing": "Affichage de",
        "of": "sur",
        "sites_word": "sites",
        # Site page
        "back": "Retour au tableau de bord",
        "site_no_data": "Aucune donnée pour ce site. Lancez d'abord un audit.",
        "html_report": "Rapport HTML",
        "pdf_report": "Rapport PDF",
        "posture_over_time": "Évolution du score",
        "not_enough_history": "Pas assez d'historique — lancez d'autres audits pour voir la tendance.",
        "severity_breakdown": "Répartition par gravité",
        "findings_reco": "Constats & recommandations",
        "no_findings_site": "Aucun constat — tous les contrôles sont conformes.",
        # Conformité réglementaire (France & Maroc)
        "compliance_title": "Conformité réglementaire (France & Maroc)",
        "compliance_intro": "Contrôles techniques observables de l'extérieur, reliés "
            "à la France (ANSSI, RGS, RGPD/CNIL) et au Maroc (DGSSI, Loi 09-08/CNDP, "
            "Loi 05-20). Mapping technique uniquement — pas une certification légale.",
        "compliance_status": {
            "compliant": "Conforme", "non_compliant": "Non conforme",
            "partial": "Partiel", "not_assessed": "Non évalué"},
        "th_control": "Contrôle",
        "th_frameworks": "Référentiels",
        "run_history": "Historique des exécutions",
        "th_date": "Date (UTC)",
        "th_run": "Exéc. #",
        "th_category": "Catégorie",
        "th_severity": "Gravité",
        "th_finding": "Constat, recommandation & références",
        "th_points": "Points",
        "fix": "Correctif :",
        "filter_by_severity": "Filtrer :",
        "filter_all": "Tous",
        # Remediation status (user-maintained, separate from scanner findings)
        "th_status": "Remédiation",
        "status_hint": "Vous les renseignez — ils indiquent ce que votre équipe a "
                       "fait, séparément de ce que le scanner a observé.",
        "status_labels": {
            "open": "Ouvert", "in_progress": "En cours", "fixed": "Corrigé",
        },
        # Registre des corrections vérifiées (déjà remédiées)
        "fixed_ledger_title": "Corrigés & vérifiés",
        "fixed_ledger_hint": "Constats confirmés corrigés — un nouveau scan (ou "
                             "un agent automatisé) peut les ignorer au lieu de "
                             "refaire la correction.",
        "verified_auto": "vérifié auto",
        "verified_manual": "opérateur",
        # Severities
        "sev": {
            "critical": "Critique", "high": "Élevé", "medium": "Moyen",
            "low": "Faible", "info": "Info",
        },
        "footer": "Contrôles externes en boîte noire · Notation par pénalités · Rapports EN/FR",
    },
}


def resolve_lang(query_lang: str | None, cookie_lang: str | None) -> str:
    """Pick the active language: explicit query param wins, then cookie, then default."""
    if query_lang in SUPPORTED:
        return query_lang
    if cookie_lang in SUPPORTED:
        return cookie_lang
    return DEFAULT


def strings(lang: str) -> dict[str, object]:
    return TRANSLATIONS.get(lang, TRANSLATIONS[DEFAULT])
