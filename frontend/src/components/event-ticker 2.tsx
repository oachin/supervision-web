'use client';

import { useEffect, useState } from 'react';
import { api, type AlertEvent } from '@/lib/api';
import { SeverityBadge } from './ui';
import { formatDate } from '@/lib/utils';

const actionLabels: Record<string, string> = {
  CREATED: 'Créée',
  ACKNOWLEDGED: 'Acquittée',
  SNOOZE_EXPIRED: 'Snooze expiré',
  OCCURRENCE: 'Occurrence',
  ISSUE_RESOLVED: 'Résolue',
  REOPENED: 'Réouverte',
  CLOSED: 'Clôturée',
  RESOURCE_DELETED: 'Ressource supprimée',
};

export function EventTicker({ limit = 8 }: { limit?: number }) {
  const [events, setEvents] = useState<AlertEvent[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api.getAlertEvents(limit)
        .then((data) => {
          if (!cancelled) setEvents(data);
        })
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [limit]);

  if (events.length === 0) return null;

  return (
    <div className="card max-h-56 overflow-y-auto p-0">
      <ul className="divide-y divide-white/5">
        {events.map((e) => {
          const title = e.alert?.title ?? e.alertTitle ?? '—';
          const severity = (e.alert?.severity ?? e.alertSeverity ?? 'INFO') as
            | 'INFO'
            | 'WARNING'
            | 'CRITICAL';
          return (
            <li key={e.id} className="event-ticker-row flex items-center gap-3 px-4 py-2 text-sm">
              <SeverityBadge severity={severity} />
              <span className="truncate font-medium">{title}</span>
              <span className="text-xs text-muted-foreground">{actionLabels[e.action] ?? e.action}</span>
              <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                {formatDate(e.createdAt)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
