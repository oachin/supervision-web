import type { Alert } from '@/lib/api';

/** DB severities. */
export type SeverityKey = Alert['severity'];

/** UI buckets: SSL cert alerts are shown as EXPIRATION_SSL, not CRITICAL/WARNING. */
export type DisplaySeverityKey = SeverityKey | 'EXPIRATION_SSL';

export type SeverityCounts = Record<DisplaySeverityKey, number>;

export const DISPLAY_SEVERITY_LABELS: Record<DisplaySeverityKey, string> = {
  CRITICAL: 'CRITICAL',
  WARNING: 'WARNING',
  EXPIRATION_SSL: 'EXPIRATION SSL',
  INFO: 'INFO',
};

export function emptySeverityCounts(): SeverityCounts {
  return { CRITICAL: 0, WARNING: 0, EXPIRATION_SSL: 0, INFO: 0 };
}

/** SSL / certificate alerts (expiry, chain, invalid) — past and new titles. */
export function isSslExpirationAlert(alert: { title: string }): boolean {
  const t = alert.title.toLowerCase();
  return (
    t.includes('expiration ssl') ||
    t.includes('certificat ssl') ||
    t.includes('chaîne ssl') ||
    t.includes('chaine ssl')
  );
}

export function displaySeverityOf(alert: {
  title: string;
  severity: SeverityKey;
}): DisplaySeverityKey {
  if (isSslExpirationAlert(alert)) return 'EXPIRATION_SSL';
  return alert.severity;
}

export function countAlertsBySeverity(alerts: Alert[]): SeverityCounts {
  const counts = emptySeverityCounts();
  for (const a of alerts) {
    counts[displaySeverityOf(a)] += 1;
  }
  return counts;
}

export function alertMatchesDisplaySeverity(
  alert: { title: string; severity: SeverityKey },
  filter: DisplaySeverityKey,
): boolean {
  return displaySeverityOf(alert) === filter;
}
