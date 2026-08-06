'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import {
  ChevronRight,
  Clock3,
  FileText,
  Globe,
  Loader2,
  RotateCcw,
  Server,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { api, type Alert, type AlertDetail, type AlertEvent } from '@/lib/api';
import { alertActionLabels, occurrenceActions } from '@/lib/alert-event-labels';
import { SeverityBadge } from '@/components/ui';
import { OpenExternalUrl } from '@/components/open-external-url';
import { cn, formatDate } from '@/lib/utils';
import { getAlertHostingServer } from '@/lib/alert-hosting';
import { displaySeverityOf, isSslExpirationAlert } from '@/lib/alert-severity';

const statusLabels: Record<string, string> = {
  ACTIVE: 'En cours',
  ACKNOWLEDGED: 'En cours',
  PENDING_CLOSE: 'Clôturée',
  CLOSED: 'Clôturée',
};

const ACTION_TILE: Record<
  string,
  { icon: typeof Zap; tone: string; chip: string }
> = {
  CREATED: {
    icon: Sparkles,
    tone: 'border-rose-500/35 bg-rose-500/10',
    chip: 'bg-rose-500/20 text-rose-200',
  },
  REOPENED: {
    icon: RotateCcw,
    tone: 'border-amber-500/35 bg-amber-500/10',
    chip: 'bg-amber-500/20 text-amber-100',
  },
  OCCURRENCE: {
    icon: Zap,
    tone: 'border-amber-500/30 bg-amber-500/[0.08]',
    chip: 'bg-amber-500/15 text-amber-200',
  },
  SNOOZE_EXPIRED: {
    icon: Clock3,
    tone: 'border-orange-400/30 bg-orange-400/10',
    chip: 'bg-orange-400/15 text-orange-100',
  },
  ACKNOWLEDGED: {
    icon: ShieldCheck,
    tone: 'border-sky-500/35 bg-sky-500/10',
    chip: 'bg-sky-500/20 text-sky-200',
  },
  ISSUE_RESOLVED: {
    icon: Sparkles,
    tone: 'border-emerald-500/30 bg-emerald-500/10',
    chip: 'bg-emerald-500/15 text-emerald-200',
  },
  CLOSED: {
    icon: ShieldCheck,
    tone: 'border-emerald-500/35 bg-emerald-500/10',
    chip: 'bg-emerald-500/20 text-emerald-200',
  },
  NOTE: {
    icon: FileText,
    tone: 'border-blue-500/30 bg-blue-500/10',
    chip: 'bg-blue-500/15 text-blue-200',
  },
  RESOURCE_DELETED: {
    icon: X,
    tone: 'border-white/15 bg-secondary/40',
    chip: 'bg-secondary text-muted-foreground',
  },
};

function StatusBadge({ status }: { status: Alert['status'] }) {
  const isActive = status === 'ACTIVE' || status === 'ACKNOWLEDGED';
  return (
    <span
      className={cn(
        'rounded-full border px-2.5 py-1 text-xs font-medium',
        isActive
          ? 'border-destructive/30 bg-destructive/10 text-destructive'
          : 'border-white/10 bg-secondary/30 text-muted-foreground',
      )}
    >
      {statusLabels[status] ?? status}
    </span>
  );
}

function EventTile({
  event,
  index,
}: {
  event: AlertEvent;
  index?: number;
}) {
  const style = ACTION_TILE[event.action] ?? ACTION_TILE.NOTE;
  const Icon = style.icon;

  return (
    <article
      className={cn(
        'flex flex-col gap-2 rounded-xl border p-3.5 transition-colors',
        style.tone,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {index != null ? (
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-black/25 text-xs font-bold tabular-nums text-warning">
              {index}
            </span>
          ) : (
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-black/20">
              <Icon className="h-3.5 w-3.5 opacity-90" />
            </span>
          )}
          <span
            className={cn(
              'rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
              style.chip,
            )}
          >
            {alertActionLabels[event.action] ?? event.action}
          </span>
        </div>
        <time className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {formatDate(event.createdAt)}
        </time>
      </div>
      {event.message && (
        <p className="line-clamp-4 text-sm leading-snug text-foreground/90">
          {event.message}
        </p>
      )}
      {event.user && (
        <p className="text-[11px] text-muted-foreground">par {event.user.name}</p>
      )}
    </article>
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
  const [submitting, setSubmitting] = useState(false);
  const [listPanel, setListPanel] = useState<'occurrences' | 'events' | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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
    setListPanel(null);
  }, [open, load, summary.status]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (listPanel) {
        setListPanel(null);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, listPanel]);

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
    setSubmitting(true);
    try {
      const updated = await api.addAlertNote(alertId, note.trim());
      setDetail(updated);
      setNote('');
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open || !mounted) return null;

  const alert = detail ?? summary;
  const server = getAlertHostingServer(alert);
  const website = alert.website;
  const events = detail?.events ?? [];
  const occurrenceEvents = events.filter((e) => occurrenceActions.has(e.action));
  const historyEvents = events.filter((e) => !occurrenceActions.has(e.action));
  const displaySev = displaySeverityOf(alert);
  const accent =
    displaySev === 'CRITICAL'
      ? 'from-rose-600/40 via-rose-500/10 to-transparent'
      : displaySev === 'WARNING'
        ? 'from-amber-500/35 via-amber-500/10 to-transparent'
        : displaySev === 'EXPIRATION_SSL'
          ? 'from-violet-500/35 via-violet-500/10 to-transparent'
          : 'from-sky-500/30 via-sky-500/10 to-transparent';

  return createPortal(
    <div
      className="fixed inset-0 z-[100] overflow-y-auto bg-black/70 backdrop-blur-sm"
      onClick={() => {
        if (listPanel) {
          setListPanel(null);
          return;
        }
        onClose();
      }}
    >
      <div className="flex min-h-full items-start justify-center p-3 py-6 sm:items-center sm:p-4 sm:py-8">
        <div
          className="relative flex w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0b1220] shadow-2xl max-h-[calc(100vh-3rem)] sm:max-h-[calc(100vh-4rem)]"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="alert-modal-title"
        >
          <div
            className={cn('pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b', accent)}
            aria-hidden
          />

          <header className="relative z-[1] flex shrink-0 items-start justify-between gap-4 border-b border-white/5 px-5 pb-4 pt-5 sm:px-6">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {isSslExpirationAlert(alert) ? (
                  <span className="inline-flex items-center rounded-full border border-violet-400/40 bg-violet-600/90 px-2.5 py-0.5 text-[11px] font-semibold tracking-wide text-white">
                    EXPIRATION SSL
                  </span>
                ) : (
                  <SeverityBadge severity={alert.severity} />
                )}
                {alert.occurrenceCount > 1 && (
                  <span className="rounded-full border border-amber-400/30 bg-amber-400/15 px-2.5 py-0.5 text-[11px] font-semibold text-amber-100">
                    {alert.occurrenceCount} occurrences
                  </span>
                )}
                {alert.acknowledged && (
                  <span className="rounded-full border border-sky-400/30 bg-sky-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-sky-200">
                    Acquittée
                  </span>
                )}
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <h2
                  id="alert-modal-title"
                  className="text-lg font-semibold leading-snug tracking-tight sm:text-xl"
                >
                  {alert.title}
                </h2>
                <OpenExternalUrl
                  url={website?.url}
                  iconClassName="h-4 w-4"
                />
              </div>
              <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">{alert.message}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <StatusBadge status={alert.status} />
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-white/10"
                aria-label="Fermer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </header>

          <div className="relative z-[1] min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 sm:px-6 sm:pb-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Créée
                </p>
                <p className="mt-1 font-mono text-sm">{formatDate(alert.createdAt)}</p>
              </div>
              <button
                type="button"
                onClick={() => setListPanel('occurrences')}
                disabled={loading && !detail}
                className="rounded-xl border border-amber-500/25 bg-amber-500/[0.07] p-3.5 text-left transition hover:border-amber-400/45 hover:bg-amber-500/15 disabled:opacity-60"
                title="Voir les occurrences"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-200/80">
                  Occurrences
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums leading-none text-amber-100">
                  {loading && !detail ? '—' : occurrenceEvents.length || alert.occurrenceCount}
                </p>
              </button>
              <button
                type="button"
                onClick={() => setListPanel('events')}
                disabled={loading && !detail}
                className="rounded-xl border border-sky-500/25 bg-sky-500/[0.07] p-3.5 text-left transition hover:border-sky-400/45 hover:bg-sky-500/15 disabled:opacity-60"
                title="Voir les événements"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wider text-sky-200/80">
                  Événements
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums leading-none text-sky-100">
                  {loading && !detail ? '—' : historyEvents.length}
                </p>
              </button>
              <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {alert.status === 'CLOSED' ? 'Clôturée' : 'Statut'}
                </p>
                <p className="mt-1 text-sm font-medium">
                  {alert.status === 'CLOSED' && alert.closedAt
                    ? formatDate(alert.closedAt)
                    : statusLabels[alert.status]}
                </p>
              </div>
            </div>

            {(server?.id || website?.id) && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {server?.id && (
                  <Link
                    href={`/servers/${server.id}`}
                    onClick={onClose}
                    className="group flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/[0.07] px-4 py-3 transition hover:border-primary/45 hover:bg-primary/10"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15">
                      <Server className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                        Serveur
                      </p>
                      <p className="truncate font-semibold">{server.name}</p>
                      {server.hostname && (
                        <p className="truncate font-mono text-[11px] text-muted-foreground">
                          {server.hostname}
                        </p>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-primary/60 transition group-hover:translate-x-0.5" />
                  </Link>
                )}
                {website?.id && (
                  <Link
                    href={`/websites/${website.id}`}
                    onClick={onClose}
                    className="group flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 transition hover:border-white/20 hover:bg-white/[0.05]"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/5">
                      <Globe className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Site
                      </p>
                      <div className="flex items-center gap-1.5">
                        <p className="truncate font-semibold">{website.name}</p>
                        <OpenExternalUrl url={website.url} />
                      </div>
                      <p className="truncate text-[11px] text-muted-foreground">{website.url}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60 transition group-hover:translate-x-0.5" />
                  </Link>
                )}
              </div>
            )}

            {(alert.origin || alert.resolutionMethod) && (
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {alert.origin && (
                  <p>
                    <span className="text-foreground/70">Origine :</span> {alert.origin}
                  </p>
                )}
                {alert.resolutionMethod && (
                  <p>
                    <span className="text-foreground/70">Résolution :</span>{' '}
                    {alert.resolutionMethod}
                  </p>
                )}
              </div>
            )}

            {canEdit && (
              <form
                onSubmit={handleNote}
                className="mt-4 rounded-xl border border-white/8 bg-white/[0.03] p-4"
              >
                <label className="block text-sm font-medium">Ajouter une note</label>
                <textarea
                  className="input mt-2"
                  rows={2}
                  placeholder="Information complémentaire, action en cours…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  {error ? (
                    <p className="text-sm text-destructive">{error}</p>
                  ) : (
                    <span />
                  )}
                  <button
                    type="submit"
                    disabled={!note.trim() || submitting}
                    className="btn-secondary text-sm"
                  >
                    {submitting ? 'Enregistrement…' : 'Enregistrer'}
                  </button>
                </div>
              </form>
            )}

            {error && !canEdit && (
              <p className="mt-3 text-sm text-destructive">{error}</p>
            )}

            {loading && !detail && (
              <div className="mt-6 flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Chargement…
              </div>
            )}
          </div>
        </div>
      </div>

      {listPanel && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-3 backdrop-blur-[2px] sm:p-6"
          onClick={() => setListPanel(null)}
        >
          <div
            className="flex max-h-[min(85vh,720px)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0d1526] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="alert-list-panel-title"
          >
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/8 px-5 py-4">
              <div>
                <h3 id="alert-list-panel-title" className="text-base font-semibold">
                  {listPanel === 'occurrences' ? 'Occurrences' : 'Événements & notes'}
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {listPanel === 'occurrences'
                    ? `${occurrenceEvents.length} entrée${occurrenceEvents.length !== 1 ? 's' : ''}`
                    : `${historyEvents.length} entrée${historyEvents.length !== 1 ? 's' : ''}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setListPanel(null)}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-white/10"
                aria-label="Fermer"
              >
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {listPanel === 'occurrences' ? (
                occurrenceEvents.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    Aucune occurrence
                  </p>
                ) : (
                  <div className="grid gap-2.5">
                    {occurrenceEvents.map((e, i) => (
                      <EventTile key={e.id} event={e} index={i + 1} />
                    ))}
                  </div>
                )
              ) : historyEvents.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Aucun événement
                </p>
              ) : (
                <div className="grid gap-2.5">
                  {[...historyEvents].reverse().map((e) => (
                    <EventTile key={e.id} event={e} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
