import type { Alert } from '@/lib/api';
import { getAlertHostingServer } from '@/lib/alert-hosting';

const STATUS_LABELS: Record<Alert['status'], string[]> = {
  ACTIVE: ['active', 'en cours'],
  ACKNOWLEDGED: ['acquittée', 'acquitté', 'acknowledged'],
  PENDING_CLOSE: ['clôture', 'cloture', 'pending', 'attente'],
  CLOSED: ['clôturée', 'cloturee', 'closed', 'résolue', 'resolue'],
};

const SEVERITY_LABELS: Record<Alert['severity'], string[]> = {
  INFO: ['info', 'information'],
  WARNING: ['warning', 'avertissement'],
  CRITICAL: ['critical', 'critique', 'urgent'],
};

function alertSearchHaystack(alert: Alert): string {
  const hosting = getAlertHostingServer(alert);
  return [
    alert.title,
    alert.message,
    alert.severity,
    alert.status,
    ...STATUS_LABELS[alert.status],
    ...SEVERITY_LABELS[alert.severity],
    hosting?.name,
    hosting?.hostname,
    alert.server?.name,
    alert.server?.hostname,
    alert.website?.name,
    alert.website?.url,
    alert.website?.server?.name,
    alert.website?.server?.hostname,
    alert.acknowledgedBy?.name,
    alert.acknowledgedBy?.email,
    alert.closedBy?.name,
    alert.origin,
    alert.resolutionMethod,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function filterAlerts(
  alerts: Alert[],
  query: string,
  severity?: Alert['severity'] | '',
): Alert[] {
  let list = alerts;
  if (severity) {
    list = list.filter((alert) => alert.severity === severity);
  }

  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return list;

  return list.filter((alert) => {
    const haystack = alertSearchHaystack(alert);
    return tokens.every((token) => haystack.includes(token));
  });
}
