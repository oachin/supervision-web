'use client';

import { AlertTriangle } from 'lucide-react';
import type { Alert } from '@/lib/api';
import { SeverityBadge } from './ui';
import { formatDate } from '@/lib/utils';

export function AlertPopup({
  alert,
  onAcknowledge,
}: {
  alert: Alert;
  onAcknowledge: () => void;
}) {
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
          {alert.server && (
            <p className="text-center text-xs text-red-200/70">Serveur : {alert.server.name}</p>
          )}
          {alert.website && (
            <p className="text-center text-xs text-red-200/70">Site : {alert.website.name}</p>
          )}
          <p className="text-center text-xs text-red-300/60">{formatDate(alert.createdAt)}</p>
        </div>

        <div className="border-t border-red-500/30 px-6 py-5">
          <button
            type="button"
            onClick={onAcknowledge}
            className="w-full rounded-xl bg-white px-6 py-3.5 text-sm font-bold text-red-900 transition-all hover:bg-red-50 active:scale-[0.98]"
          >
            Acquitter
          </button>
          <p className="mt-3 text-center text-xs text-red-200/60">
            Snooze 30 min — réaffichage si le problème persiste
          </p>
        </div>
      </div>
    </div>
  );
}
