import type { Alert, AlertSummary } from '@/lib/api';
import { countAlertsBySeverity, type SeverityCounts } from '@/lib/alert-severity';

export interface ServerWebsiteAlertContext {
  id: string;
  status: string;
  lastStatusCode?: number | null;
  monitoringEnabled: boolean;
}

/** Alertes en cours (même source que le bandeau). */
export function flattenActiveAlerts(summary: AlertSummary): Alert[] {
  return [...summary.active];
}

/** Alertes non clôturées. */
export function flattenOpenAlerts(summary: AlertSummary): Alert[] {
  return [...summary.active];
}

/**
 * Alertes ACTIVE rattachées à un serveur (directement ou via un site supervisé).
 * Aligné sur le bandeau / la page Alertes (pas de filtre « faux hors ligne »).
 */
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

    if (a.websiteId) {
      return monitoredWebsiteIds.has(a.websiteId);
    }

    return a.serverId === serverId;
  });
}

export function severityCountsForServer(
  serverId: string,
  websites: ServerWebsiteAlertContext[],
  alerts: Alert[],
): SeverityCounts {
  return countAlertsBySeverity(openAlertsForServer(serverId, websites, alerts));
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
