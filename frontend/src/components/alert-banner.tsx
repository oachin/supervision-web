'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Bell, ChevronRight, X } from 'lucide-react';
import { useAlerts } from './alert-provider';
import { api, type Alert } from '@/lib/api';
import { SeverityBadge } from './ui';
import { cn, formatDate } from '@/lib/utils';

type Tab = 'active' | 'acknowledged' | 'pendingClose';

const tabs: { id: Tab; label: string; color: string }[] = [
  { id: 'active', label: 'En cours', color: 'text-destructive' },
  { id: 'acknowledged', label: 'Acquittées (en cours)', color: 'text-warning' },
  { id: 'pendingClose', label: 'En attente de clôture', color: 'text-primary' },
];

export function AlertBanner() {
  const { summary, refresh } = useAlerts();
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<Tab>('active');
  const [closingAlert, setClosingAlert] = useState<Alert | null>(null);
  const [closeForm, setCloseForm] = useState({ origin: '', resolutionMethod: '' });

  if (!summary) return null;

  const totalOpen = summary.counts.active + summary.counts.acknowledged + summary.counts.pendingClose;
  if (totalOpen === 0) return null;

  const alerts = summary[tab];

  async function handleClose(e: React.FormEvent) {
    e.preventDefault();
    if (!closingAlert) return;
    await api.closeAlert(closingAlert.id, closeForm.origin, closeForm.resolutionMethod);
    setClosingAlert(null);
    setCloseForm({ origin: '', resolutionMethod: '' });
    refresh();
  }

  return (
    <>
      <div className="sticky top-0 z-30 border-b border-destructive/30 bg-destructive/10 backdrop-blur-md">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-3 px-8 py-3 text-left text-sm"
        >
          <Bell className="h-4 w-4 shrink-0 text-destructive" />
          <span className="font-medium">
            {summary.counts.active > 0 && (
              <span className="text-destructive">{summary.counts.active} alerte(s) en cours</span>
            )}
            {summary.counts.active > 0 && summary.counts.pendingClose > 0 && ' · '}
            {summary.counts.pendingClose > 0 && (
              <span className="text-primary">{summary.counts.pendingClose} en attente de clôture</span>
            )}
            {summary.counts.active === 0 && summary.counts.pendingClose === 0 && summary.counts.acknowledged > 0 && (
              <span className="text-warning">{summary.counts.acknowledged} acquittée(s) en cours</span>
            )}
          </span>
          <ChevronRight className={cn('ml-auto h-4 w-4 transition-transform', expanded && 'rotate-90')} />
        </button>

        {expanded && (
          <div className="border-t border-white/5 bg-card/95 px-8 pb-4">
            <div className="flex gap-2 py-3">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
                    tab === t.id ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <span className={t.color}>{summary.counts[t.id]}</span> {t.label}
                </button>
              ))}
              <Link href="/events" className="ml-auto text-xs text-primary hover:underline self-center">
                Voir les évènements →
              </Link>
            </div>

            <div className="max-h-48 space-y-2 overflow-y-auto">
              {alerts.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">Aucune alerte dans cette catégorie</p>
              ) : (
                alerts.map((a) => (
                  <div key={a.id} className="flex items-center justify-between rounded-lg border border-white/5 bg-muted/30 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <SeverityBadge severity={a.severity} />
                        <span className="truncate text-sm font-medium">{a.title}</span>
                        {a.occurrenceCount > 1 && (
                          <span className="text-xs text-muted-foreground">×{a.occurrenceCount}</span>
                        )}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{a.message}</p>
                      {a.acknowledgedBy && (
                        <p className="text-xs text-muted-foreground">
                          Acquittée par {a.acknowledgedBy.name} — {formatDate(a.acknowledgedAt)}
                        </p>
                      )}
                    </div>
                    {a.status === 'PENDING_CLOSE' && (
                      <button
                        type="button"
                        onClick={() => setClosingAlert(a)}
                        className="btn-primary ml-2 shrink-0 py-1.5 text-xs"
                      >
                        Clôturer
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {closingAlert && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4">
          <div className="card w-full max-w-md">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Clôturer l&apos;alerte</h3>
              <button type="button" onClick={() => setClosingAlert(null)} className="btn-ghost p-1">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">{closingAlert.title}</p>
            <form onSubmit={handleClose} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm">Origine du problème</label>
                <input
                  className="input"
                  value={closeForm.origin}
                  onChange={(e) => setCloseForm({ ...closeForm, origin: e.target.value })}
                  placeholder="Ex: Expiration certificat SSL, surcharge CPU..."
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-sm">Méthode de résolution</label>
                <textarea
                  className="input"
                  rows={3}
                  value={closeForm.resolutionMethod}
                  onChange={(e) => setCloseForm({ ...closeForm, resolutionMethod: e.target.value })}
                  placeholder="Ex: Renouvellement du certificat via Certbot..."
                  required
                />
              </div>
              <div className="flex gap-2">
                <button type="submit" className="btn-primary flex-1">Clôturer l&apos;alerte</button>
                <button type="button" onClick={() => setClosingAlert(null)} className="btn-secondary">Annuler</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
