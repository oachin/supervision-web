'use client';

import Link from 'next/link';
import { Bell } from 'lucide-react';
import type { Alert } from '@/lib/api';
import { SeverityBadge } from '@/components/ui';
import { formatDate, cn } from '@/lib/utils';
import { groupServerAlertsBySite } from '@/lib/server-alerts';

const statusLabels: Record<string, string> = {
  ACTIVE: 'En cours',
  ACKNOWLEDGED: 'Acquittée',
  PENDING_CLOSE: 'Clôture en attente',
};

export function ServerAlertsBySitePanel({
  alerts,
  serverName,
}: {
  alerts: Alert[];
  serverName: string;
}) {
  const groups = groupServerAlertsBySite(alerts, serverName);

  if (groups.length === 0) {
    return (
      <div className="card py-8 text-center">
        <Bell className="mx-auto h-8 w-8 text-muted-foreground/50" />
        <p className="mt-3 text-sm text-muted-foreground">Aucune alerte en cours pour ce serveur</p>
      </div>
    );
  }

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Alertes en cours par site</h2>
        <Link href="/alerts" className="text-sm text-primary hover:underline">
          Voir toutes les alertes
        </Link>
      </div>

      <div className="space-y-3">
        {groups.map((group) => (
          <div key={group.key} className="overflow-hidden rounded-lg border border-white/5">
            <div className="border-b border-white/5 bg-secondary/20 px-4 py-2.5">
              <p className="font-medium">{group.label}</p>
              {group.subtitle && (
                <p className="truncate text-xs text-muted-foreground">{group.subtitle}</p>
              )}
            </div>
            <ul className="divide-y divide-white/5">
              {group.alerts.map((alert) => (
                <li key={alert.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={alert.severity} />
                      <span className="font-medium">{alert.title}</span>
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
                      alert.status === 'ACTIVE'
                        ? 'border-destructive/30 bg-destructive/10 text-destructive'
                        : alert.status === 'ACKNOWLEDGED'
                          ? 'border-warning/30 bg-warning/10 text-warning'
                          : 'border-primary/30 bg-primary/10 text-primary',
                    )}
                  >
                    {statusLabels[alert.status] ?? alert.status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
