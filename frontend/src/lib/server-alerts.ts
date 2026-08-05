import type { Alert, AlertSummary } from '@/lib/api';
import { isMaintenanceStatus } from '@/lib/utils';

export interface ServerWebsiteAlertContext {
  id: string;
  status: string;
  lastStatusCode?: number | null;
  monitoringEnabled: boolean;
}

/** Alertes en cours. */
export function flattenActiveAlerts(summary: AlertSummary): Alert[] {
  return [...summary.active];
}

/** Alertes non clôturées. */
export function flattenOpenAlerts(summary: AlertSummary): Alert[] {
  return [...summary.active];
}

function isFalseOfflineAlert(alert: Alert, websites: ServerWebsiteAlertContext[]): boolean {
  if (!alert.websiteId || !alert.title.toLowerCase().includes('hors ligne')) return false;
  const site = websites.find((w) => w.id === alert.websiteId);
  if (!site?.monitoringEnabled) return false;
  // Maintenance 503 or site already back up — not an open outage
  if (isMaintenanceStatus(site.status, site.lastStatusCode)) return true;
  return site.status !== 'DOWN';
}

export function openAlertsForServer(
  serverId: string,
  websites: ServerWebsiteAlertContext[],
  alerts: Alert[],
): Alert[] {
  const monitoredWebsiteIds = new Set(
    websites.filter((w) => w.monitoringEnabled).map((w) => w.id),
  );

  return alerts.filter((a) => {
    if (a.status !== 'ACTIVE') return false;
    if (isFalseOfflineAlert(a, websites)) return false;

    if (a.websiteId) {
      // Ne pas remonter via serverId les alertes de sites non supervisés
      return monitoredWebsiteIds.has(a.websiteId);
    }

    return a.serverId === serverId;
  });
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
