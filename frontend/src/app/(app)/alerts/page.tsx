'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { api, type User } from '@/lib/api';
import { SeverityBadge } from '@/components/ui';
import { formatDate, cn } from '@/lib/utils';
import { useAlerts } from '@/components/alert-provider';
import { AlertDetailPanel } from '@/components/alert-detail-panel';

export default function AlertsPage() {
  const { summary, refresh } = useAlerts();
  const [loading, setLoading] = useState(!summary);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'active' | 'acknowledged' | 'pendingClose' | 'closed'>('active');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [profile, setProfile] = useState<User | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    refresh()
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur de chargement'))
      .finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    if (summary) {
      setLoading(false);
      return;
    }
    load();
  }, [summary, load]);

  useEffect(() => {
    api.getProfile().then(setProfile).catch(() => {});
  }, []);

  useEffect(() => {
    setExpandedId(null);
  }, [tab]);

  const canEdit = profile?.role === 'ADMIN' || profile?.role === 'OPERATOR';

  if (loading && !summary) {
    return (
      <div className="flex h-32 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Alertes</h1>
        <div className="card text-center py-8">
          <p className="text-destructive">{error || 'Impossible de charger les alertes'}</p>
          <button type="button" onClick={load} className="btn-primary mt-4">
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  const data = summary;

  const tabs = [
    { id: 'active' as const, label: 'En cours', count: data.counts.active },
    { id: 'acknowledged' as const, label: 'Acquittées (en cours)', count: data.counts.acknowledged },
    { id: 'pendingClose' as const, label: 'En attente de clôture', count: data.counts.pendingClose },
    { id: 'closed' as const, label: 'Acquittées (clôturées)', count: data.counts.closed },
  ];

  const alerts = data[tab];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Alertes</h1>
        <p className="text-sm text-muted-foreground">Gestion du cycle de vie des alertes</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${
              tab === t.id ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      {alerts.length === 0 ? (
        <div className="card py-12 text-center">
          <p className="text-muted-foreground">Aucune alerte dans cette catégorie</p>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((a) => {
            const isExpanded = expandedId === a.id;
            return (
              <div
                key={a.id}
                className={cn(
                  'card transition-colors',
                  isExpanded && 'ring-1 ring-primary/30',
                )}
              >
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : a.id)}
                  className="flex w-full items-start justify-between gap-4 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={a.severity} />
                      <h3 className="font-semibold">{a.title}</h3>
                      {a.occurrenceCount > 1 && (
                        <span className="badge-warning">Occurrence {a.occurrenceCount}</span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{a.message}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>{formatDate(a.createdAt)}</span>
                      {a.server && (
                        <span className="font-medium text-primary">{a.server.name}</span>
                      )}
                      {a.acknowledgedBy && (
                        <span>
                          Acquittée par {a.acknowledgedBy.name} le {formatDate(a.acknowledgedAt)}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronDown
                    className={cn(
                      'mt-1 h-5 w-5 shrink-0 text-muted-foreground transition-transform',
                      isExpanded && 'rotate-180',
                    )}
                  />
                </button>

                {isExpanded && (
                  <AlertDetailPanel
                    alertId={a.id}
                    summary={a}
                    canEdit={canEdit}
                    onUpdated={refresh}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
