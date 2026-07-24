'use client';

import type { ProxmoxBackup } from '@/lib/api';
import { formatDate, cn } from '@/lib/utils';

function backupStatusClass(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === 'ok') return 'badge-success';
  if (normalized === 'failed') return 'badge-danger';
  if (normalized === 'warning' || normalized === 'running') return 'badge-warning';
  return 'badge-muted';
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  if (minutes < 60) return rem > 0 ? `${minutes}m ${rem}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return remMin > 0 ? `${hours}h ${remMin}m` : `${hours}h`;
}

export function ProxmoxBackupsPanel({ backups }: { backups: ProxmoxBackup[] }) {
  return (
    <div className="card overflow-hidden p-0">
      <div className="border-b border-white/5 px-4 py-3 sm:px-5">
        <h2 className="text-lg font-semibold">Sauvegardes</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Tâches vzdump récentes synchronisées par l&apos;agent.
        </p>
      </div>
      {backups.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground sm:px-5">
          Aucune sauvegarde enregistrée.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-medium sm:px-5">Début</th>
                <th className="px-4 py-2.5 font-medium sm:px-5">VM</th>
                <th className="px-4 py-2.5 font-medium sm:px-5">Statut</th>
                <th className="px-4 py-2.5 font-medium sm:px-5">Durée</th>
                <th className="px-4 py-2.5 font-medium sm:px-5">Erreur</th>
              </tr>
            </thead>
            <tbody>
              {backups.map((backup) => (
                <tr key={backup.id} className="border-b border-white/5 last:border-0">
                  <td className="whitespace-nowrap px-4 py-2.5 sm:px-5">
                    {formatDate(backup.startedAt)}
                  </td>
                  <td className="px-4 py-2.5 sm:px-5">
                    {backup.vmName ?? (backup.vmid != null ? `VM ${backup.vmid}` : '—')}
                    {backup.vmName && backup.vmid != null && (
                      <span className="ml-1 font-mono text-xs text-muted-foreground">
                        ({backup.vmid})
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 sm:px-5">
                    <span className={cn(backupStatusClass(backup.status))}>{backup.status}</span>
                  </td>
                  <td className="px-4 py-2.5 sm:px-5">{formatDuration(backup.durationSec)}</td>
                  <td className="max-w-xs truncate px-4 py-2.5 text-muted-foreground sm:px-5" title={backup.error ?? undefined}>
                    {backup.error || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
