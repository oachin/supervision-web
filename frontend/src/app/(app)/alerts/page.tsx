'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type AlertSummary } from '@/lib/api';
import { SeverityBadge } from '@/components/ui';
import { formatDate } from '@/lib/utils';
import { useAlerts } from '@/components/alert-provider';

export default function AlertsPage() {
  const { summary, refresh } = useAlerts();
  const [loading, setLoading] = useState(!summary);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'active' | 'acknowledged' | 'pendingClose' | 'closed'>('active');
  const [closeForm, setCloseForm] = useState<{ id: string; origin: string; resolutionMethod: string } | null>(null);

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

  async function handleClose(e: React.FormEvent) {
    e.preventDefault();
    if (!closeForm) return;
    await api.closeAlert(closeForm.id, closeForm.origin, closeForm.resolutionMethod);
    setCloseForm(null);
    refresh();
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
          {alerts.map((a) => (
            <div key={a.id} className="card">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <SeverityBadge severity={a.severity} />
                    <h3 className="font-semibold">{a.title}</h3>
                    {a.occurrenceCount > 1 && (
                      <span className="badge-warning">Occurrence {a.occurrenceCount}</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{a.message}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{formatDate(a.createdAt)}</p>
                  {a.acknowledgedBy && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Acquittée par {a.acknowledgedBy.name} le {formatDate(a.acknowledgedAt)}
                    </p>
                  )}
                  {a.origin && (
                    <p className="mt-2 text-xs"><span className="text-muted-foreground">Origine :</span> {a.origin}</p>
                  )}
                  {a.resolutionMethod && (
                    <p className="text-xs"><span className="text-muted-foreground">Résolution :</span> {a.resolutionMethod}</p>
                  )}
                </div>
                {a.status === 'PENDING_CLOSE' && (
                  <button
                    type="button"
                    onClick={() => setCloseForm({ id: a.id, origin: '', resolutionMethod: '' })}
                    className="btn-primary shrink-0 text-sm"
                  >
                    Clôturer
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {closeForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="card w-full max-w-md">
            <h3 className="mb-4 text-lg font-semibold">Clôturer l&apos;alerte</h3>
            <form onSubmit={handleClose} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm">Origine du problème</label>
                <input className="input" value={closeForm.origin} onChange={(e) => setCloseForm({ ...closeForm, origin: e.target.value })} required />
              </div>
              <div>
                <label className="mb-1 block text-sm">Méthode de résolution</label>
                <textarea className="input" rows={3} value={closeForm.resolutionMethod} onChange={(e) => setCloseForm({ ...closeForm, resolutionMethod: e.target.value })} required />
              </div>
              <div className="flex gap-2">
                <button type="submit" className="btn-primary">Clôturer</button>
                <button type="button" onClick={() => setCloseForm(null)} className="btn-secondary">Annuler</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
