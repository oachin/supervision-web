'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { api, type Alert, type User } from '@/lib/api';
import { SeverityBadge } from '@/components/ui';
import { formatDate } from '@/lib/utils';
import { useAlerts } from '@/components/alert-provider';
import { AlertDetailModal } from '@/components/alert-detail-modal';
import { getAlertHostingServer } from '@/lib/alert-hosting';
import { filterAlerts } from '@/lib/alert-search';

export default function AlertsPage() {
  const { summary, refresh } = useAlerts();
  const [loading, setLoading] = useState(!summary);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'active' | 'acknowledged' | 'pendingClose' | 'closed'>('active');
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [profile, setProfile] = useState<User | null>(null);
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<Alert['severity'] | ''>('');

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
    setSelectedAlert(null);
  }, [tab, searchQuery, severityFilter]);

  const tabAlerts = summary?.[tab] ?? [];
  const filteredAlerts = useMemo(
    () => filterAlerts(tabAlerts, searchQuery, severityFilter),
    [tabAlerts, searchQuery, severityFilter],
  );
  const hasSearch = searchQuery.trim().length > 0 || severityFilter !== '';

  const canEdit = profile?.role === 'ADMIN' || profile?.role === 'OPERATOR';

  async function handleAcknowledge(e: React.MouseEvent, alertId: string) {
    e.stopPropagation();
    setAcknowledgingId(alertId);
    try {
      await api.acknowledgeAlert(alertId);
      await refresh();
    } finally {
      setAcknowledgingId(null);
    }
  }

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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            className="input pl-10 pr-10"
            placeholder="Rechercher (titre, site, serveur, sévérité, statut…)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
              title="Effacer la recherche"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <select
          className="input w-full sm:w-44"
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value as Alert['severity'] | '')}
          aria-label="Filtrer par sévérité"
        >
          <option value="">Toutes sévérités</option>
          <option value="CRITICAL">Critique</option>
          <option value="WARNING">Avertissement</option>
          <option value="INFO">Info</option>
        </select>
      </div>

      {hasSearch && (
        <p className="text-sm text-muted-foreground">
          {filteredAlerts.length} résultat{filteredAlerts.length !== 1 ? 's' : ''}
          {searchQuery.trim() ? ` pour « ${searchQuery.trim()} »` : ''}
          {severityFilter ? ` · sévérité ${severityFilter === 'CRITICAL' ? 'critique' : severityFilter === 'WARNING' ? 'avertissement' : 'info'}` : ''}
        </p>
      )}

      {filteredAlerts.length === 0 ? (
        <div className="card py-12 text-center">
          <p className="text-muted-foreground">
            {hasSearch
              ? 'Aucune alerte ne correspond à votre recherche.'
              : 'Aucune alerte dans cette catégorie'}
          </p>
          {hasSearch && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSeverityFilter('');
              }}
              className="btn-secondary mt-4"
            >
              Effacer les filtres
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredAlerts.map((a) => {
            const hostingServer = getAlertHostingServer(a);
            return (
              <div
                key={a.id}
                className="card transition-colors hover:border-primary/20"
              >
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedAlert(a)}
                    className="min-w-0 flex-1 text-left"
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
                        {hostingServer && (
                          <span className="font-medium text-primary">
                            Serveur : {hostingServer.name}
                            {hostingServer.hostname && (
                              <span className="font-mono font-normal text-muted-foreground">
                                {' '}({hostingServer.hostname})
                              </span>
                            )}
                          </span>
                        )}
                        {a.acknowledgedBy && (
                          <span>
                            Acquittée par {a.acknowledgedBy.name} le {formatDate(a.acknowledgedAt)}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                  <div className="flex shrink-0 items-center gap-2">
                    {canEdit && a.status === 'ACTIVE' && (
                      <button
                        type="button"
                        onClick={(e) => handleAcknowledge(e, a.id)}
                        disabled={acknowledgingId === a.id}
                        className="btn-primary shrink-0 text-sm"
                      >
                        {acknowledgingId === a.id ? 'Acquittement…' : 'Acquitter'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
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
            const updated = [...summary.active, ...summary.acknowledged, ...summary.pendingClose, ...summary.closed]
              .find((alert) => alert.id === selectedAlert.id);
            if (updated) setSelectedAlert(updated);
          }}
        />
      )}
    </div>
  );
}
