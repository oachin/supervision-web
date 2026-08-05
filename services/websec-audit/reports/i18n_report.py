"""
reports/i18n_report.py
Single-language (EN/FR) labels for the formal HTML/PDF reports.

Reports are rendered in ONE language, chosen via `lang`, to read as a
professional document rather than a bilingual side-by-side. Finding messages
themselves still come from the scanners (mostly English); the bilingual
*recommendations* travel with each finding (recommendation_en / _fr).
"""

from __future__ import annotations

SUPPORTED = ("en", "fr")
DEFAULT = "en"


def resolve_report_lang(lang: str | None) -> str:
    return lang if lang in SUPPORTED else DEFAULT


# Severity / status / priority labels shared by both report templates.
SEV_LABELS = {
    "en": {"critical": "Critical", "high": "High", "medium": "Medium",
           "low": "Low", "info": "Info"},
    "fr": {"critical": "Critique", "high": "Élevé", "medium": "Moyen",
           "low": "Faible", "info": "Info"},
}
CAT_LABELS = {
    "en": {"availability": "Availability", "tls": "TLS/SSL", "headers": "HTTP headers",
           "dns_auth": "DNS/email", "takeover": "Subdomain takeover",
           "misconfig": "Misconfiguration", "ports": "Ports"},
    "fr": {"availability": "Disponibilité", "tls": "TLS/SSL", "headers": "En-têtes HTTP",
           "dns_auth": "DNS/e-mail", "takeover": "Prise de contrôle de sous-domaine",
           "misconfig": "Configuration", "ports": "Ports"},
}
STATUS_LABELS = {
    "en": {"open": "Open", "in_progress": "In progress", "fixed": "Fixed"},
    "fr": {"open": "Ouvert", "in_progress": "En cours", "fixed": "Corrigé"},
}
POSTURE_LABELS = {
    "en": {"strong": "Strong", "good": "Good", "fair": "Fair",
           "weak": "Weak", "critical": "Critical"},
    "fr": {"strong": "Solide", "good": "Bonne", "fair": "Moyenne",
           "weak": "Faible", "critical": "Critique"},
}
PRIORITY_LABELS = {
    "en": {"P0": "P0 — Immediate", "P1": "P1 — High priority", "P2": "P2 — Planned"},
    "fr": {"P0": "P0 — Immédiat", "P1": "P1 — Priorité haute", "P2": "P2 — Planifié"},
}

REPORT_STRINGS: dict[str, dict] = {
    "en": {
        "sev": SEV_LABELS["en"],
        "cat": CAT_LABELS["en"],
        "status_labels": STATUS_LABELS["en"],
        "posture_labels": POSTURE_LABELS["en"],
        "priority_labels": PRIORITY_LABELS["en"],
        # Cover
        "confidential": "CONFIDENTIAL",
        "doc_title_global": "Web Security Audit Report",
        "doc_title_site": "Web Security Audit Report",
        "doc_subtitle_global": "Fleet security posture",
        "doc_subtitle_site": "Single-site assessment",
        "prepared_by": "Prepared by",
        "tool_name": "Web Security Audit Tool — automated external scan",
        "date": "Date",
        "scope": "Scope",
        "scope_global": "{n} monitored website(s)",
        "target": "Target",
        "domain": "Domain",
        "rubric": "Scoring rubric",
        "overall_grade": "Overall grade",
        "score": "Score",
        # Contents
        "contents": "Contents",
        # Section titles
        "sec_exec": "Executive summary",
        "sec_scores": "Scores & security posture",
        "sec_sites": "Per-site summary",
        "sec_findings": "Detailed findings & recommendations",
        "sec_method": "Methodology & scoring rubric",
        "sec_residual": "Residual risk & recommended actions",
        "sec_history": "Security posture over time",
        "sec_annex": "Annex & limitations",
        # Executive summary
        "exec_posture": "Overall posture",
        "exec_intro_global": "This external, black-box audit assessed {n} website(s) "
            "and produced an average security score of {avg}/100.",
        "exec_intro_site": "This external, black-box audit assessed {name} and assigned "
            "a security score of {score}/100 (grade {grade}).",
        "exec_findings_line": "It surfaced {actionable} actionable finding(s): "
            "{critical} critical, {high} high, {medium} medium and {low} low severity.",
        "exec_clean": "No actionable issues were found — the target meets all checks in this audit.",
        "exec_status_line": "Your team has marked {fixed} of {total} finding(s) as fixed "
            "and {in_progress} as in progress.",
        # Scores / posture
        "before_after": "Before / after (from recorded history)",
        "before": "Before",
        "after": "After",
        "delta": "Change",
        "no_history": "Not enough recorded history yet for a before/after comparison — "
            "run at least two audits.",
        "grade_dist": "Grade distribution",
        "severity_counts": "Findings by severity",
        "kpi_critical_sites": "Sites with a critical finding",
        "kpi_atrisk": "At-risk sites (score < 60)",
        "kpi_clean": "Clean sites",
        "common_issues": "Most common issues across the fleet",
        "affects": "affects",
        "sites_word": "site(s)",
        # Per-site summary table
        "th_site": "Site",
        "th_grade": "Grade",
        "th_score": "Score",
        "th_findings": "Findings (C/H/M/L)",
        "th_trend": "Trend",
        # Findings table
        "th_severity": "Severity",
        "th_category": "Category",
        "th_finding": "Finding, recommendation & references",
        "th_status": "Status",
        "th_points": "Points",
        "fix": "Recommendation:",
        "no_findings": "No findings — all checks passed.",
        "status_note": "Remediation status is maintained by your team and is separate "
            "from what the scanner observed.",
        # Verified-fix ledger
        "fixed_ledger_title": "Fixed & verified",
        "fixed_ledger_hint": "Findings confirmed remediated — a re-scan or an "
            "automated agent can skip these instead of repeating the fix.",
        "th_verified_by": "Verified by",
        "th_resolved_at": "Resolved",
        "verified_auto": "auto-verified",
        "verified_manual": "operator",
        # Regulatory compliance
        "sec_compliance": "Regulatory compliance mapping (France & Morocco)",
        "compliance_intro": "Externally-observable technical controls mapped to the "
            "official information-security governance frameworks of France (ANSSI, RGS, "
            "GDPR/CNIL) and Morocco (DGSSI, Law 09-08/CNDP, Law 05-20).",
        "compliance_status": {
            "compliant": "Compliant", "non_compliant": "Non-compliant",
            "partial": "Partial", "not_assessed": "Not assessed"},
        "th_control": "Control",
        "th_frameworks": "Frameworks",
        "compliance_overall": "Compliance by country",
        "compliance_disclaimer": "Technical, external mapping only. It indicates "
            "alignment with the technical recommendations of each framework — it is NOT "
            "a legal certification and does not cover organisational/documentary "
            "obligations (risk analysis, governance, incident response, audits). "
            "Applicability of each law/framework must be confirmed by the organisation.",
        # Methodology
        "method_intro": "Non-intrusive external checks over HTTP(S) and DNS only — "
            "no exploitation, no authenticated or destructive testing. Checks performed:",
        "method_availability": "Availability — reachability of the site",
        "method_tls": "TLS/SSL — protocol versions, certificate validity & expiry",
        "method_headers": "HTTP security headers (OWASP Secure Headers)",
        "method_dns": "DNS email authentication — SPF, DKIM, DMARC, CAA",
        "method_takeover": "Subdomain takeover / dangling DNS — CNAMEs to unclaimed "
            "third-party services and non-existent (NXDOMAIN) targets",
        "method_misconfig": "Common misconfigurations — exposed files, directory listing, "
            "dangerous methods, banner disclosure",
        "method_ports": "Open ports (authorized scan)",
        "rubric_intro": "Transparent penalty model: every target starts at 100 and loses "
            "points per weighted finding. Informational items carry no penalty.",
        "rubric_grades": "Grades: A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, E ≥ 50, F < 50.",
        # Residual
        "residual_intro": "Open findings prioritised for remediation. Items your team has "
            "marked 'Fixed' are excluded from this backlog.",
        "residual_none": "No open actionable findings remain.",
        "priority": "Priority",
        # Run history
        "run_history": "Run history",
        "th_date": "Date (UTC)",
        "th_run": "Run #",
        # Annex / limitations
        "annex_limitations": "Limitations",
        "annex_text": "This report reflects external, black-box observations only. A high "
            "score indicates the checks in this audit passed; it is not equivalent to a "
            "penetration test, a source-code review, or a security certification. DKIM "
            "detection is best-effort (common selectors only). Framework tags map findings "
            "to OWASP Top 10, CWE, MITRE ATT&CK and relevant RFC/NIST guidance.",
        "annex_confidential": "This document contains security-sensitive information. "
            "Handle as CONFIDENTIAL and share only with authorised recipients.",
        "page": "page",
    },
    "fr": {
        "sev": SEV_LABELS["fr"],
        "cat": CAT_LABELS["fr"],
        "status_labels": STATUS_LABELS["fr"],
        "posture_labels": POSTURE_LABELS["fr"],
        "priority_labels": PRIORITY_LABELS["fr"],
        # Cover
        "confidential": "CONFIDENTIEL",
        "doc_title_global": "Rapport d'audit de sécurité web",
        "doc_title_site": "Rapport d'audit de sécurité web",
        "doc_subtitle_global": "Posture de sécurité du parc",
        "doc_subtitle_site": "Évaluation d'un site",
        "prepared_by": "Établi par",
        "tool_name": "Web Security Audit Tool — analyse externe automatisée",
        "date": "Date",
        "scope": "Périmètre",
        "scope_global": "{n} site(s) web surveillé(s)",
        "target": "Cible",
        "domain": "Domaine",
        "rubric": "Barème",
        "overall_grade": "Note globale",
        "score": "Score",
        # Contents
        "contents": "Sommaire",
        # Section titles
        "sec_exec": "Synthèse",
        "sec_scores": "Scores & posture de sécurité",
        "sec_sites": "Synthèse par site",
        "sec_findings": "Constats détaillés & recommandations",
        "sec_method": "Méthodologie & barème",
        "sec_residual": "Risques résiduels & actions recommandées",
        "sec_history": "Évolution de la posture dans le temps",
        "sec_annex": "Annexe & limites",
        # Executive summary
        "exec_posture": "Posture globale",
        "exec_intro_global": "Cet audit externe (boîte noire) a évalué {n} site(s) web "
            "et produit un score de sécurité moyen de {avg}/100.",
        "exec_intro_site": "Cet audit externe (boîte noire) a évalué {name} et attribué "
            "un score de sécurité de {score}/100 (note {grade}).",
        "exec_findings_line": "Il a relevé {actionable} constat(s) exploitable(s) : "
            "{critical} critique(s), {high} élevé(s), {medium} moyen(s) et {low} faible(s).",
        "exec_clean": "Aucun constat exploitable — la cible satisfait à tous les contrôles de cet audit.",
        "exec_status_line": "Votre équipe a marqué {fixed} constat(s) sur {total} comme corrigés "
            "et {in_progress} en cours.",
        # Scores / posture
        "before_after": "Avant / après (d'après l'historique enregistré)",
        "before": "Avant",
        "after": "Après",
        "delta": "Évolution",
        "no_history": "Historique insuffisant pour une comparaison avant/après — "
            "lancez au moins deux audits.",
        "grade_dist": "Répartition des notes",
        "severity_counts": "Constats par gravité",
        "kpi_critical_sites": "Sites avec un constat critique",
        "kpi_atrisk": "Sites à risque (score < 60)",
        "kpi_clean": "Sites sains",
        "common_issues": "Problèmes les plus fréquents sur le parc",
        "affects": "touche",
        "sites_word": "site(s)",
        # Per-site summary table
        "th_site": "Site",
        "th_grade": "Note",
        "th_score": "Score",
        "th_findings": "Constats (C/É/M/F)",
        "th_trend": "Tendance",
        # Findings table
        "th_severity": "Gravité",
        "th_category": "Catégorie",
        "th_finding": "Constat, recommandation & références",
        "th_status": "Statut",
        "th_points": "Points",
        "fix": "Recommandation :",
        "no_findings": "Aucun constat — tous les contrôles sont conformes.",
        "status_note": "Le statut de remédiation est renseigné par votre équipe et distinct "
            "de ce que le scanner a observé.",
        # Registre des corrections vérifiées
        "fixed_ledger_title": "Corrigés & vérifiés",
        "fixed_ledger_hint": "Constats confirmés corrigés — un nouveau scan ou un "
            "agent automatisé peut les ignorer au lieu de refaire la correction.",
        "th_verified_by": "Vérifié par",
        "th_resolved_at": "Résolu",
        "verified_auto": "vérifié auto",
        "verified_manual": "opérateur",
        # Conformité réglementaire
        "sec_compliance": "Conformité réglementaire (France & Maroc)",
        "compliance_intro": "Contrôles techniques observables de l'extérieur, reliés aux "
            "référentiels officiels de gouvernance de la sécurité de l'information de la "
            "France (ANSSI, RGS, RGPD/CNIL) et du Maroc (DGSSI, Loi 09-08/CNDP, Loi 05-20).",
        "compliance_status": {
            "compliant": "Conforme", "non_compliant": "Non conforme",
            "partial": "Partiel", "not_assessed": "Non évalué"},
        "th_control": "Contrôle",
        "th_frameworks": "Référentiels",
        "compliance_overall": "Conformité par pays",
        "compliance_disclaimer": "Mapping technique externe uniquement. Il indique un "
            "alignement aux recommandations techniques de chaque référentiel — ce n'est "
            "PAS une certification légale et ne couvre pas les obligations "
            "organisationnelles/documentaires (analyse de risque, gouvernance, réponse "
            "aux incidents, audits). L'applicabilité de chaque loi/référentiel doit être "
            "confirmée par l'organisation.",
        # Methodology
        "method_intro": "Contrôles externes non intrusifs via HTTP(S) et DNS uniquement — "
            "sans exploitation, ni test authentifié ou destructif. Contrôles effectués :",
        "method_availability": "Disponibilité — joignabilité du site",
        "method_tls": "TLS/SSL — versions de protocole, validité & expiration du certificat",
        "method_headers": "En-têtes HTTP de sécurité (OWASP Secure Headers)",
        "method_dns": "Authentification e-mail DNS — SPF, DKIM, DMARC, CAA",
        "method_takeover": "Prise de contrôle de sous-domaine / DNS orphelin — CNAME vers "
            "des services tiers non revendiqués et des cibles inexistantes (NXDOMAIN)",
        "method_misconfig": "Mauvaises configurations courantes — fichiers exposés, indexation "
            "de répertoire, méthodes dangereuses, divulgation de bannières",
        "method_ports": "Ports ouverts (analyse autorisée)",
        "rubric_intro": "Modèle de pénalités transparent : chaque cible part de 100 et perd "
            "des points par constat pondéré. Les éléments informatifs sont sans pénalité.",
        "rubric_grades": "Notes : A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, E ≥ 50, F < 50.",
        # Residual
        "residual_intro": "Constats ouverts priorisés pour la remédiation. Les éléments "
            "marqués « Corrigé » par votre équipe sont exclus de ce reliquat.",
        "residual_none": "Aucun constat exploitable ouvert ne subsiste.",
        "priority": "Priorité",
        # Run history
        "run_history": "Historique des exécutions",
        "th_date": "Date (UTC)",
        "th_run": "Exéc. #",
        # Annex / limitations
        "annex_limitations": "Limites",
        "annex_text": "Ce rapport reflète uniquement des observations externes (boîte noire). "
            "Un score élevé indique que les contrôles de cet audit sont conformes ; il n'équivaut "
            "pas à un test d'intrusion, à une revue de code source, ni à une certification de "
            "sécurité. La détection DKIM est au mieux (sélecteurs courants uniquement). Les "
            "étiquettes de framework relient les constats à OWASP Top 10, CWE, MITRE ATT&CK et "
            "aux référentiels RFC/NIST.",
        "annex_confidential": "Ce document contient des informations sensibles de sécurité. "
            "À traiter comme CONFIDENTIEL et à ne partager qu'avec les destinataires autorisés.",
        "page": "page",
    },
}
