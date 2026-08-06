'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';
import { api, type Alert, type User } from '@/lib/api';
import { SeverityBadge } from '@/components/ui';
import { SeverityCountTags } from '@/components/severity-count-tags';
import { AlertDetailModal } from '@/components/alert-detail-modal';
import { OpenExternalUrl } from '@/components/open-external-url';
import { useAlerts } from '@/components/alert-provider';
import { formatDate, cn } from '@/lib/utils';
import { groupServerAlertsBySite } from '@/lib/server-alerts';
import {
  alertMatchesDisplaySeverity,
  countAlertsBySeverity,
  DISPLAY_SEVERITY_LABELS,
  displaySeverityOf,
  serverAlertsHref,
  type DisplaySeverityKey,
} from '@/lib/alert-severity';

const statusLabels: Record<string, string> = {
  ACTIVE: 'En cours',
  ACKNOWLEDGED: 'En cours',
  PENDING_CLOSE: 'Clôturée',
  CLOSED: 'Clôturée',
};

export function ServerAlertsBySitePanel({
  alerts,
  serverName,
  serverId,
  initialSeverity = '',
}: {
  alerts: Alert[];
  serverName: string;
  serverId: string;
  initialSeverity?: DisplaySeverityKey | '';
}) {
  const router = useRouter();
  const { refresh } = useAlerts();
  const [severityFilter, setSeverityFilter] = useState<DisplaySeverityKey | ''>(
    initialSeverity,
  );
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [profile, setProfile] = useState<User | null>(null);

  useEffect(() => {
    setSeverityFilter(initialSeverity);
  }, [initialSeverity]);

  useEffect(() => {
    api.getProfile().then(setProfile).catch(() => {});
  }, []);

  const severityCounts = useMemo(() => countAlertsBySeverity(alerts), [alerts]);
  const canEdit = profile?.role === 'ADMIN' || profile?.role === 'OPERATOR';

  const filteredAlerts = useMemo(() => {
    if (!severityFilter) return alerts;
    return alerts.filter((a) => alertMatchesDisplaySeverity(a, severityFilter));
  }, [alerts, severityFilter]);

  const groups = groupServerAlertsBySite(filteredAlerts, serverName);

  if (alerts.length === 0) {
    return (
      <div className="card py-8 text-center">
        <Bell className="mx-auto h-8 w-8 text-muted-foreground/50" />
        <p className="mt-3 text-sm text-muted-foreground">Aucune alerte en cours pour ce serveur</p>
      </div>
    );
  }

  function applySeverity(sev: DisplaySeverityKey | '') {
    setSeverityFilter(sev);
    router.replace(serverAlertsHref(serverId, sev), { scroll: false });
  }

  function toggleSeverity(sev: DisplaySeverityKey) {
    applySeverity(severityFilter === sev ? '' : sev);
  }

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Alertes en cours par site</h2>
        <Link href="/alerts" className="text-sm text-primary hover:underline">
          Voir toutes les alertes
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Synthèse
        </span>
        <SeverityCountTags
          counts={severityCounts}
          showZero
          showInfo={false}
          selected={severityFilter}
          onSelect={toggleSeverity}
        />
        {severityFilter && (
          <button
            type="button"
            onClick={() => applySeverity('')}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Toutes sévérités
          </button>
        )}
      </div>

      {groups.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          Aucune alerte {DISPLAY_SEVERITY_LABELS[severityFilter as DisplaySeverityKey]}
        </p>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <div key={group.key} className="overflow-hidden rounded-lg border border-white/5">
              <div className="border-b border-white/5 bg-secondary/20 px-4 py-2.5">
                <div className="flex items-center gap-1.5">
                  <p className="font-medium">{group.label}</p>
                  <OpenExternalUrl
                    url={
                      group.alerts[0]?.website?.url ??
                      (group.subtitle?.startsWith('http') ? group.subtitle : null)
                    }
                  />
                </div>
                {group.subtitle && (
                  <p className="truncate text-xs text-muted-foreground">{group.subtitle}</p>
                )}
              </div>
              <ul className="divide-y divide-white/5">
                {group.alerts.map((alert) => {
                  const displaySev = displaySeverityOf(alert);
                  return (
                    <li key={alert.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedAlert(alert)}
                        className="flex w-full flex-wrap items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {displaySev === 'EXPIRATION_SSL' ? (
                              <span className="inline-flex items-center rounded-md border border-violet-400/40 bg-violet-600/90 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-white">
                                EXPIRATION SSL
                              </span>
                            ) : (
                              <SeverityBadge severity={alert.severity} />
                            )}
                            <span className="font-medium">{alert.title}</span>
                            <OpenExternalUrl url={alert.website?.url} />
                            {alert.occurrenceCount > 1 && (
                              <span className="rounded-md bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                                ×{alert.occurrenceCount}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">{alert.message}</p>
                          <p className="mt-1.5 font-mono text-xs text-muted-foreground">
                            {formatDate(alert.createdAt)}
                          </p>
                        </div>
                        <span
                          className={cn(
                            'shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-medium',
                            alert.status === 'ACTIVE' || alert.status === 'ACKNOWLEDGED'
                              ? 'border-destructive/30 bg-destructive/10 text-destructive'
                              : 'border-white/10 bg-secondary/30 text-muted-foreground',
                          )}
                        >
                          {statusLabels[alert.status] ?? alert.status}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      {selectedAlert && (
        <AlertDetailModal
          open
          alertId={selectedAlert.id}
          summary={selectedAlert}
          canEdit={canEdit}
          onClose={() => setSelectedAlert(null)}
          onUpdated={async () => {
            await refresh();
            const summary = await api.getAlertsSummary();
            const updated = [...summary.active, ...summary.closed].find(
              (a) => a.id === selectedAlert.id,
            );
            if (updated) setSelectedAlert(updated);
            else setSelectedAlert(null);
          }}
        />
      )}
    </div>
  );
}
