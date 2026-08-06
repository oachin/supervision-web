'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { Alert } from '@/lib/api';
import { SeverityBadge } from './ui';
import { formatDate } from '@/lib/utils';
import { getAlertHostingServer } from '@/lib/alert-hosting';

export function AlertPopup({
  alert,
  onAcknowledge,
  onSnooze,
  acknowledging,
}: {
  alert: Alert;
  onAcknowledge: () => void | Promise<void>;
  onSnooze: () => void;
  acknowledging?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const loading = acknowledging || busy;

  async function handleAck() {
    if (loading) return;
    setBusy(true);
    try {
      await onAcknowledge();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg animate-in fade-in zoom-in-95 rounded-2xl border-2 border-red-500/50 bg-gradient-to-b from-red-950 to-red-900 shadow-2xl shadow-red-900/50">
        <div className="border-b border-red-500/30 px-6 py-5 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-red-500/20">
            <AlertTriangle className="h-8 w-8 text-red-400" />
          </div>
          <h2 className="text-xl font-bold text-white">Alerte critique</h2>
          {alert.occurrenceCount > 1 && (
            <p className="mt-2 text-sm font-semibold text-red-200">
              Occurrence {alert.occurrenceCount}
            </p>
          )}
        </div>

        <div className="space-y-4 px-6 py-5">
          <div className="flex items-center justify-center gap-2">
            <SeverityBadge severity={alert.severity} />
          </div>
          <h3 className="text-center text-lg font-semibold text-white">{alert.title}</h3>
          <p className="text-center text-sm text-red-100/90">{alert.message}</p>
          {(() => {
            const server = getAlertHostingServer(alert);
            return server ? (
              <p className="text-center text-xs text-red-200/70">
                Serveur : {server.name}
                {server.hostname ? ` (${server.hostname})` : ''}
              </p>
            ) : null;
          })()}
          {alert.website && (
            <p className="text-center text-xs text-red-200/70">Site : {alert.website.name}</p>
          )}
          <p className="text-center text-xs text-red-300/60">{formatDate(alert.createdAt)}</p>
        </div>

        <div className="space-y-3 border-t border-red-500/30 px-6 py-5">
          <button
            type="button"
            onClick={handleAck}
            disabled={loading}
            className="w-full rounded-xl bg-white px-6 py-3.5 text-sm font-bold text-red-900 transition-all hover:bg-red-50 active:scale-[0.98] disabled:opacity-60"
          >
            {loading ? 'Acquittement…' : 'Acquitter'}
          </button>
          <button
            type="button"
            onClick={onSnooze}
            disabled={loading}
            className="w-full rounded-xl border border-red-400/30 bg-transparent px-6 py-2.5 text-sm font-medium text-red-100/90 transition-all hover:bg-red-500/15 disabled:opacity-60"
          >
            Masquer tous les popups 30 min
          </button>
          <p className="text-center text-xs text-red-200/60">
            L&apos;acquittement masque ce popup tant que l&apos;alerte est active.
            Elle reste visible dans Alertes jusqu&apos;à disparition du problème.
          </p>
        </div>
      </div>
    </div>
  );
}
