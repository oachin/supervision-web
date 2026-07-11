'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, ExternalLink, Loader2, Server } from 'lucide-react';
import { api, type Alert, type AlertDetail } from '@/lib/api';
import { alertActionLabels, occurrenceActions } from '@/lib/alert-event-labels';
import { SeverityBadge } from '@/components/ui';
import { cn, formatDate } from '@/lib/utils';
import { getAlertHostingServer } from '@/lib/alert-hosting';

const statusLabels: Record<string, string> = {
  ACTIVE: 'En cours',
  ACKNOWLEDGED: 'Acquittée',
  PENDING_CLOSE: 'En attente de clôture',
  CLOSED: 'Clôturée',
};

export function AlertDetailPanel({
  alertId,
  summary,
  canEdit,
  onUpdated,
}: {
  alertId: string;
  summary: Alert;
  canEdit: boolean;
  onUpdated: () => void;
}) {
  const [detail, setDetail] = useState<AlertDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState<'note' | 'close' | null>(null);
  const [closeForm, setCloseForm] = useState({ origin: '', resolutionMethod: '' });
  const [showCloseForm, setShowCloseForm] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .getAlert(alertId)
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur de chargement'))
      .finally(() => setLoading(false));
  }, [alertId]);

  useEffect(() => {
    load();
  }, [load, summary.status, summary.acknowledgedAt]);

  async function handleNote(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    setSubmitting('note');
    try {
      const updated = await api.addAlertNote(alertId, note.trim());
      setDetail(updated);
      setNote('');
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setSubmitting(null);
    }
  }

  async function handleClose(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting('close');
    try {
      await api.closeAlert(alertId, closeForm.origin, closeForm.resolutionMethod);
      setShowCloseForm(false);
      onUpdated();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setSubmitting(null);
    }
  }

  const alert = detail ?? summary;
  const server = getAlertHostingServer(alert);
  const website = alert.website;
  const events = detail?.events ?? [];

  const occurrenceEvents = events.filter((e) => occurrenceActions.has(e.action));

  return (
    <div className="mt-4 space-y-4 border-t border-white/5 pt-4">
      {server?.id && (
        <Link
          href={`/servers/${server.id}`}
          className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 transition-colors hover:bg-primary/10"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15">
            <Server className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-primary">Serveur associé</p>
            <p className="truncate font-semibold">{server.name}</p>
            {server.hostname && (
              <p className="truncate font-mono text-xs text-muted-foreground">{server.hostname}</p>
            )}
          </div>
          <ChevronRight className="h-5 w-5 shrink-0 text-primary/70" />
        </Link>
      )}

      {website?.id && (
        <Link
          href={`/websites/${website.id}`}
          className="flex items-center gap-2 rounded-lg border border-white/5 bg-secondary/20 px-4 py-2.5 text-sm transition-colors hover:bg-secondary/40"
        >
          <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="font-medium">{website.name}</span>
          <span className="truncate text-xs text-muted-foreground">{website.url}</span>
        </Link>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span
          className={cn(
            'rounded-md border px-2 py-0.5 text-[11px] font-medium',
            alert.status === 'ACTIVE'
              ? 'border-destructive/30 bg-destructive/10 text-destructive'
              : alert.status === 'ACKNOWLEDGED'
                ? 'border-warning/30 bg-warning/10 text-warning'
                : alert.status === 'PENDING_CLOSE'
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-white/10 bg-secondary/30 text-muted-foreground',
          )}
        >
          {statusLabels[alert.status] ?? alert.status}
        </span>
        {alert.occurrenceCount > 1 && (
          <span className="badge-warning">{alert.occurrenceCount} occurrences</span>
        )}
        {alert.acknowledgedBy && (
          <span className="text-xs text-muted-foreground">
            Acquittée par {alert.acknowledgedBy.name} le {formatDate(alert.acknowledgedAt)}
          </span>
        )}
        {alert.closedBy && (
          <span className="text-xs text-muted-foreground">
            Clôturée par {alert.closedBy.name} le {formatDate(alert.closedAt)}
          </span>
        )}
      </div>

      {alert.origin && (
        <p className="text-sm">
          <span className="text-muted-foreground">Origine :</span> {alert.origin}
        </p>
      )}
      {alert.resolutionMethod && (
        <p className="text-sm">
          <span className="text-muted-foreground">Résolution :</span> {alert.resolutionMethod}
        </p>
      )}

      {canEdit && alert.status !== 'CLOSED' && alert.status === 'PENDING_CLOSE' && !showCloseForm && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowCloseForm(true)}
            className="btn-primary text-sm"
          >
            Clôturer
          </button>
        </div>
      )}

      {showCloseForm && canEdit && (
        <form onSubmit={handleClose} className="space-y-3 rounded-lg border border-white/5 bg-secondary/10 p-4">
          <h4 className="text-sm font-semibold">Clôturer l&apos;alerte</h4>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Origine du problème</label>
            <input
              className="input"
              value={closeForm.origin}
              onChange={(e) => setCloseForm({ ...closeForm, origin: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Méthode de résolution</label>
            <textarea
              className="input"
              rows={3}
              value={closeForm.resolutionMethod}
              onChange={(e) => setCloseForm({ ...closeForm, resolutionMethod: e.target.value })}
              required
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={submitting !== null} className="btn-primary text-sm">
              {submitting === 'close' ? 'Clôture…' : 'Confirmer la clôture'}
            </button>
            <button
              type="button"
              onClick={() => setShowCloseForm(false)}
              className="btn-secondary text-sm"
            >
              Annuler
            </button>
          </div>
        </form>
      )}

      {canEdit && alert.status !== 'CLOSED' && (
        <form onSubmit={handleNote} className="space-y-2">
          <label className="block text-sm font-medium">Ajouter une note</label>
          <textarea
            className="input"
            rows={2}
            placeholder="Information complémentaire, action en cours…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            type="submit"
            disabled={!note.trim() || submitting !== null}
            className="btn-secondary text-sm"
          >
            {submitting === 'note' ? 'Enregistrement…' : 'Enregistrer la note'}
          </button>
        </form>
      )}

      {loading && !detail ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement de l&apos;historique…
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <>
          {occurrenceEvents.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">Occurrences</h4>
              <ul className="space-y-1.5 rounded-lg border border-white/5 bg-secondary/10 p-3">
                {occurrenceEvents.map((e, i) => (
                  <li key={e.id} className="flex items-start gap-2 text-xs">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-warning/15 font-medium text-warning">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="font-medium">{alertActionLabels[e.action] ?? e.action}</span>
                      {e.message && <span className="text-muted-foreground"> — {e.message}</span>}
                      <p className="font-mono text-muted-foreground">{formatDate(e.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-2">
            <h4 className="text-sm font-semibold">Historique & actions</h4>
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun évènement enregistré</p>
            ) : (
              <ol className="relative space-y-0 border-l border-white/10 pl-4">
                {events.map((e) => (
                  <li key={e.id} className="relative pb-4 last:pb-0">
                    <span className="absolute -left-[calc(0.25rem+1px)] top-1.5 h-2 w-2 rounded-full bg-primary/60" />
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                          e.action === 'NOTE'
                            ? 'bg-blue-500/15 text-blue-400'
                            : e.action === 'CLOSED'
                              ? 'bg-success/15 text-success'
                              : 'bg-secondary text-muted-foreground',
                        )}
                      >
                        {alertActionLabels[e.action] ?? e.action}
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {formatDate(e.createdAt)}
                      </span>
                      {e.user && (
                        <span className="text-[11px] text-muted-foreground">— {e.user.name}</span>
                      )}
                    </div>
                    {e.message && (
                      <p className="mt-1 text-sm text-foreground/90 whitespace-pre-wrap">{e.message}</p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </>
      )}
    </div>
  );
}
