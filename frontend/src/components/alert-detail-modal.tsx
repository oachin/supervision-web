'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, ExternalLink, Loader2, Server, X } from 'lucide-react';
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

function StatusBadge({ status }: { status: Alert['status'] }) {
  return (
    <span
      className={cn(
        'rounded-md border px-2.5 py-1 text-xs font-medium',
        status === 'ACTIVE'
          ? 'border-destructive/30 bg-destructive/10 text-destructive'
          : status === 'ACKNOWLEDGED'
            ? 'border-warning/30 bg-warning/10 text-warning'
            : status === 'PENDING_CLOSE'
              ? 'border-primary/30 bg-primary/10 text-primary'
              : 'border-white/10 bg-secondary/30 text-muted-foreground',
      )}
    >
      {statusLabels[status] ?? status}
    </span>
  );
}

export function AlertDetailModal({
  open,
  alertId,
  summary,
  canEdit,
  onClose,
  onUpdated,
}: {
  open: boolean;
  alertId: string;
  summary: Alert;
  canEdit: boolean;
  onClose: () => void;
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
    if (!open) return;
    load();
    setNote('');
    setShowCloseForm(false);
    setCloseForm({ origin: '', resolutionMethod: '' });
  }, [open, load, summary.status, summary.acknowledgedAt]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

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

  if (!open) return null;

  const alert = detail ?? summary;
  const server = getAlertHostingServer(alert);
  const website = alert.website;
  const events = detail?.events ?? [];
  const occurrenceEvents = events.filter((e) => occurrenceActions.has(e.action));
  const historyEvents = events.filter((e) => !occurrenceActions.has(e.action));

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="alert-modal-title"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-white/5 px-6 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={alert.severity} />
              {alert.occurrenceCount > 1 && (
                <span className="badge-warning">{alert.occurrenceCount} occurrences</span>
              )}
            </div>
            <h2 id="alert-modal-title" className="mt-2 text-lg font-semibold leading-snug">
              {alert.title}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StatusBadge status={alert.status} />
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary/50"
              aria-label="Fermer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-2">
          <div className="space-y-4 overflow-y-auto p-6">
            <p className="text-sm text-muted-foreground">{alert.message}</p>

            {server?.id && (
              <Link
                href={`/servers/${server.id}`}
                onClick={onClose}
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
                onClick={onClose}
                className="flex items-center gap-2 rounded-lg border border-white/5 bg-secondary/20 px-4 py-2.5 text-sm transition-colors hover:bg-secondary/40"
              >
                <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="font-medium">{website.name}</span>
                <span className="truncate text-xs text-muted-foreground">{website.url}</span>
              </Link>
            )}

            <div className="space-y-1 text-xs text-muted-foreground">
              <p>Créée le {formatDate(alert.createdAt)}</p>
              {alert.acknowledgedBy && (
                <p>Acquittée par {alert.acknowledgedBy.name} le {formatDate(alert.acknowledgedAt)}</p>
              )}
              {alert.closedBy && (
                <p>Clôturée par {alert.closedBy.name} le {formatDate(alert.closedAt)}</p>
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
              <button
                type="button"
                onClick={() => setShowCloseForm(true)}
                className="btn-primary text-sm"
              >
                Clôturer
              </button>
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
                  rows={3}
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

            {error && <p className="text-sm text-destructive">{error}</p>}

            {!loading && historyEvents.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold">Historique & actions</h4>
                <ol className="relative space-y-0 border-l border-white/10 pl-4">
                  {historyEvents.map((e) => (
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
                        <p className="mt-1 whitespace-pre-wrap text-sm text-foreground/90">{e.message}</p>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>

          <div className="flex min-h-0 flex-col border-t border-white/5 bg-secondary/5 lg:border-l lg:border-t-0">
            <div className="shrink-0 border-b border-white/5 px-6 py-3">
              <h3 className="text-sm font-semibold">Occurrences</h3>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              {loading && !detail ? (
                <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Chargement…
                </div>
              ) : occurrenceEvents.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Aucune occurrence</p>
              ) : (
                <ul className="space-y-2">
                  {occurrenceEvents.map((e, i) => (
                    <li
                      key={e.id}
                      className="rounded-lg border border-white/5 bg-card/80 p-3"
                    >
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-warning/15 text-xs font-medium text-warning">
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">
                            {alertActionLabels[e.action] ?? e.action}
                          </p>
                          {e.message && (
                            <p className="mt-1 text-sm text-muted-foreground">{e.message}</p>
                          )}
                          <p className="mt-1 font-mono text-xs text-muted-foreground">
                            {formatDate(e.createdAt)}
                          </p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
