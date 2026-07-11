import type { Alert, AlertSummary } from '@/lib/api';

const OPEN_ALERT_STATUSES = new Set(['ACTIVE', 'ACKNOWLEDGED', 'PENDING_CLOSE']);

export function flattenOpenAlerts(summary: AlertSummary): Alert[] {
  return [...summary.active, ...summary.acknowledged, ...summary.pendingClose];
}

export function openAlertsForServer(
  serverId: string,
  monitoredWebsiteIds: Set<string>,
  alerts: Alert[],
): Alert[] {
  return alerts.filter(
    (a) =>
      OPEN_ALERT_STATUSES.has(a.status) &&
      (a.serverId === serverId || (a.websiteId != null && monitoredWebsiteIds.has(a.websiteId))),
  );
}

export interface AlertSiteGroup {
  key: string;
  label: string;
  subtitle?: string;
  alerts: Alert[];
}

export function groupServerAlertsBySite(
  alerts: Alert[],
  serverName: string,
): AlertSiteGroup[] {
  const groups = new Map<string, AlertSiteGroup>();

  for (const alert of alerts) {
    const websiteId = alert.websiteId ?? alert.website?.id;
    const key = websiteId ?? '__server__';
    const label = websiteId
      ? (alert.website?.name ?? 'Site inconnu')
      : serverName;
    const subtitle = websiteId ? alert.website?.url : 'Alerte serveur';

    if (!groups.has(key)) {
      groups.set(key, { key, label, subtitle, alerts: [] });
    }
    groups.get(key)!.alerts.push(alert);
  }

  return [...groups.values()].sort((a, b) => {
    if (a.key === '__server__') return -1;
    if (b.key === '__server__') return 1;
    return a.label.localeCompare(b.label, 'fr');
  });
}
