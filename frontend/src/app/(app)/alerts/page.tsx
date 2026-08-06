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
import {
  countAlertsBySeverity,
  DISPLAY_SEVERITY_LABELS,
  type DisplaySeverityKey,
} from '@/lib/alert-severity';
import { SeverityCountTags } from '@/components/severity-count-tags';

export default function AlertsPage() {
  const { summary, refresh } = useAlerts();
  const [loading, setLoading] = useState(!summary);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'active' | 'closed'>('active');
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [profile, setProfile] = useState<User | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<DisplaySeverityKey | ''>('');

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
  const severityCounts = useMemo(() => countAlertsBySeverity(tabAlerts), [tabAlerts]);

  const filteredAlerts = useMemo(
    () => filterAlerts(tabAlerts, searchQuery, severityFilter),
    [tabAlerts, searchQuery, severityFilter],
  );
  const hasSearch = searchQuery.trim().length > 0 || severityFilter !== '';

  const canEdit = profile?.role === 'ADMIN' || profile?.role === 'OPERATOR';

  function toggleSeverity(sev: DisplaySeverityKey) {
    setSeverityFilter((current) => (current === sev ? '' : sev));
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
    { id: 'closed' as const, label: 'Clôturées', count: data.counts.closed },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Alertes</h1>
        <p className="text-sm text-muted-foreground">
          Alertes actives et historique — clôture automatique quand le problème disparaît
        </p>
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

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Synthèse
        </span>
        <SeverityCountTags
          counts={severityCounts}
          showZero
          selected={severityFilter}
          onSelect={toggleSeverity}
        />
        {severityFilter && (
          <button
            type="button"
            onClick={() => setSeverityFilter('')}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Toutes sévérités
          </button>
        )}
      </div>

      <div className="relative min-w-0">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          className="input pl-10 pr-10"
          placeholder="Rechercher (titre, site, serveur, sévérité…)"
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

      {hasSearch && (
        <p className="text-sm text-muted-foreground">
          {filteredAlerts.length} résultat{filteredAlerts.length !== 1 ? 's' : ''}
          {searchQuery.trim() ? ` pour « ${searchQuery.trim()} »` : ''}
          {severityFilter
            ? ` · ${DISPLAY_SEVERITY_LABELS[severityFilter]}`
            : ''}
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
              <button
                key={a.id}
                type="button"
                onClick={() => setSelectedAlert(a)}
                className="card w-full text-left transition-colors hover:border-primary/20"
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
                    {a.status === 'CLOSED' && a.closedAt && (
                      <span>Clôturée le {formatDate(a.closedAt)}</span>
                    )}
                  </div>
                </div>
              </button>
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
            const updated = [...summary.active, ...summary.closed]
              .find((alert) => alert.id === selectedAlert.id);
            if (updated) setSelectedAlert(updated);
          }}
        />
      )}
    </div>
  );
}
