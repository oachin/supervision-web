'use client';

import { useEffect, useState } from 'react';
import { api, type AlertEvent } from '@/lib/api';
import { SeverityBadge } from '@/components/ui';
import { formatDate } from '@/lib/utils';

const actionLabels: Record<string, string> = {
  CREATED: 'Création',
  ACKNOWLEDGED: 'Acquittement',
  SNOOZE_EXPIRED: 'Snooze expiré',
  OCCURRENCE: 'Occurrence',
  ISSUE_RESOLVED: 'Problème résolu',
  REOPENED: 'Réouverture',
  CLOSED: 'Clôture',
  RESOURCE_DELETED: 'Ressource supprimée',
};

export default function EventsPage() {
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getAlertEvents()
      .then(setEvents)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Évènements</h1>
        <p className="text-sm text-muted-foreground">
          Journal complet des alertes et acquittements
        </p>
      </div>

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : events.length === 0 ? (
        <div className="card py-12 text-center text-muted-foreground">Aucun évènement enregistré</div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-left text-muted-foreground">
                <th className="p-4 font-medium">Date</th>
                <th className="p-4 font-medium">Action</th>
                <th className="p-4 font-medium">Alerte</th>
                <th className="p-4 font-medium">Utilisateur</th>
                <th className="p-4 font-medium">Détail</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const title = e.alert?.title ?? e.alertTitle ?? '—';
                const severity = (e.alert?.severity ?? e.alertSeverity ?? 'INFO') as 'INFO' | 'WARNING' | 'CRITICAL';
                const occurrenceCount = e.alert?.occurrenceCount ?? 1;

                return (
                <tr key={e.id} className="border-b border-white/5 hover:bg-secondary/20">
                  <td className="p-4 text-xs text-muted-foreground whitespace-nowrap">{formatDate(e.createdAt)}</td>
                  <td className="p-4">
                    <span className="badge-muted">{actionLabels[e.action] ?? e.action}</span>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <SeverityBadge severity={severity} />
                      <span className="font-medium">{title}</span>
                      {e.resourceName && !e.alert && (
                        <span className="text-xs text-muted-foreground">({e.resourceName})</span>
                      )}
                      {occurrenceCount > 1 && (
                        <span className="text-xs text-muted-foreground">×{occurrenceCount}</span>
                      )}
                    </div>
                  </td>
                  <td className="p-4 text-xs">{e.user?.name ?? '—'}</td>
                  <td className="p-4 text-xs text-muted-foreground max-w-xs truncate">{e.message ?? '—'}</td>
                </tr>
              );})}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
