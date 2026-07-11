'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Server as ServerIcon,
  AlertTriangle,
  Globe,
  Bell,
  GripVertical,
  Maximize2,
} from 'lucide-react';
import { cn, formatCpuPercent, isMaintenanceStatus, isSiteDegraded } from '@/lib/utils';
import { TagList } from '@/components/tag-editor';
import { useServerTileOrder } from '@/hooks/use-server-tile-order';
import type { Alert, ServerWithHistory, WebsiteWithHistory } from '@/lib/api';
import { openAlertsForServer } from '@/lib/server-alerts';

export type ServerHealthLevel = 'ok' | 'warning' | 'critical';

export interface ServerOverviewData {
  server: ServerWithHistory;
  level: ServerHealthLevel;
  summaryLines: string[];
  alertCount: number;
  sitesTotal: number;
  sitesDown: number;
  sitesDegraded: number;
  sitesMaintenance: number;
  sitesUnsupervised: number;
}

const levelStyles: Record<
  ServerHealthLevel,
  { border: string; bg: string; glow: string; dot: string; bar: string; label: string }
> = {
  ok: {
    border: 'border-accent/40',
    bg: 'bg-accent/[0.06]',
    glow: 'shadow-accent/10',
    dot: 'bg-accent',
    bar: 'bg-accent',
    label: 'Opérationnel',
  },
  warning: {
    border: 'border-warning/40',
    bg: 'bg-warning/[0.06]',
    glow: 'shadow-warning/10',
    dot: 'bg-warning',
    bar: 'bg-warning',
    label: 'Attention',
  },
  critical: {
    border: 'border-destructive/50',
    bg: 'bg-destructive/[0.08]',
    glow: 'shadow-destructive/15',
    dot: 'bg-destructive status-dot-pulse-danger',
    bar: 'bg-destructive',
    label: 'Critique',
  },
};

export { openAlertsForServer } from '@/lib/server-alerts';

export function buildServerOverview(
  server: ServerWithHistory,
  websites: WebsiteWithHistory[],
  alerts: Alert[],
): ServerOverviewData {
  const allServerSites = websites.filter((w) => w.server?.id === server.id);
  const serverSites = allServerSites.filter((w) => w.monitoringEnabled);
  const sitesUnsupervised = allServerSites.length - serverSites.length;
  const websiteIds = new Set(serverSites.map((w) => w.id));
  const serverAlerts = openAlertsForServer(server.id, websiteIds, alerts);

  const sitesDown = serverSites.filter((w) => w.status === 'DOWN').length;
  const sitesMaintenance = serverSites.filter((w) =>
    isMaintenanceStatus(w.status, w.lastStatusCode),
  ).length;
  const sitesDegraded = serverSites.filter((w) =>
    isSiteDegraded(w.status, w.lastStatusCode),
  ).length;
  const criticalAlerts = serverAlerts.filter((a) => a.severity === 'CRITICAL').length;
  const warningAlerts = serverAlerts.filter((a) => a.severity === 'WARNING').length;

  let level: ServerHealthLevel = 'ok';
  if (server.status === 'OFFLINE' || sitesDown > 0 || criticalAlerts > 0) {
    level = 'critical';
  } else if (server.status === 'DEGRADED' || sitesDegraded > 0 || warningAlerts > 0) {
    level = 'warning';
  }

  const summaryLines: string[] = [];
  if (server.status === 'OFFLINE') summaryLines.push('Serveur hors ligne');
  else if (server.status === 'DEGRADED') summaryLines.push('Ressources serveur élevées');
  if (sitesDown > 0) {
    summaryLines.push(`${sitesDown} site${sitesDown > 1 ? 's' : ''} injoignable${sitesDown > 1 ? 's' : ''}`);
  }
  if (sitesDegraded > 0) {
    summaryLines.push(`${sitesDegraded} site${sitesDegraded > 1 ? 's' : ''} dégradé${sitesDegraded > 1 ? 's' : ''}`);
  }
  if (sitesMaintenance > 0) {
    summaryLines.push(`${sitesMaintenance} site${sitesMaintenance > 1 ? 's' : ''} en maintenance`);
  }
  if (sitesUnsupervised > 0) {
    summaryLines.push(`${sitesUnsupervised} site${sitesUnsupervised > 1 ? 's' : ''} non supervisé${sitesUnsupervised > 1 ? 's' : ''}`);
  }
  if (warningAlerts > 0 && level !== 'critical') {
    summaryLines.push(`${warningAlerts} alerte${warningAlerts > 1 ? 's' : ''} warning`);
  }
  if (criticalAlerts > 0) {
    summaryLines.push(`${criticalAlerts} alerte${criticalAlerts > 1 ? 's' : ''} critique${criticalAlerts > 1 ? 's' : ''}`);
  }
  if (summaryLines.length === 0) summaryLines.push('Aucune alerte active');

  return {
    server,
    level,
    summaryLines,
    alertCount: serverAlerts.length,
    sitesTotal: serverSites.length,
    sitesDown,
    sitesDegraded,
    sitesMaintenance,
    sitesUnsupervised,
  };
}

function ServerOverviewCard({
  data,
  nocMode,
  draggable,
  isDragging,
  isDropTarget,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  data: ServerOverviewData;
  nocMode?: boolean;
  draggable?: boolean;
  isDragging?: boolean;
  isDropTarget?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
}) {
  const { server, level, summaryLines, alertCount, sitesTotal } = data;
  const styles = levelStyles[level];
  const latest = server.metrics?.[0];
  const hostname = server.hostname === 'en-attente' ? 'Hostname en attente' : server.hostname;

  const maxSummaryLines = nocMode ? 4 : 3;
  const paddedSummaryLines = [...summaryLines.slice(0, maxSummaryLines)];
  while (paddedSummaryLines.length < maxSummaryLines) {
    paddedSummaryLines.push('');
  }

  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn(
        'relative h-full transition-all duration-200',
        isDragging && 'scale-[0.98] opacity-40',
        isDropTarget && 'ring-2 ring-primary/50 ring-offset-2 ring-offset-background',
      )}
    >
      <Link
        href={`/servers/${server.id}`}
        className={cn(
          'group relative flex h-full min-h-[280px] flex-col overflow-hidden rounded-xl border transition-all duration-300',
          'hover:-translate-y-0.5 hover:shadow-lg',
          nocMode ? 'min-h-[300px] gap-5 p-6' : 'gap-4 p-5',
          styles.border,
          styles.bg,
          styles.glow,
        )}
      >
        <div className={cn('absolute left-0 top-0 h-full w-1', styles.bar)} aria-hidden />

        {draggable && (
          <button
            type="button"
            draggable
            onDragStart={(e) => {
              e.stopPropagation();
              onDragStart?.();
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', server.id);
            }}
            onDragEnd={(e) => {
              e.stopPropagation();
              onDragEnd?.();
            }}
            onClick={(e) => e.preventDefault()}
            className="absolute right-2 top-2 z-10 cursor-grab rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-white/10 hover:text-foreground active:cursor-grabbing group-hover:opacity-100"
            aria-label="Réordonner"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}

        <div className="flex items-start justify-between gap-3 pl-2 pr-6">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className={cn('flex shrink-0 items-center justify-center rounded-lg border', styles.bg, styles.border, nocMode ? 'h-11 w-11' : 'h-9 w-9')}>
                <ServerIcon className={cn('h-4 w-4', level === 'ok' ? 'text-accent' : level === 'warning' ? 'text-warning' : 'text-destructive', nocMode && 'h-5 w-5')} />
              </div>
              <div className="min-w-0">
                <p className={cn('truncate font-semibold tracking-tight', nocMode ? 'text-lg' : 'text-base')}>{server.name}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">{hostname}</p>
                <div className="mt-1.5 min-h-[22px]">
                  {server.tags?.length > 0 && (
                    <TagList tags={server.tags} size="xs" />
                  )}
                </div>
              </div>
            </div>
          </div>
          <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium', styles.bg, styles.border, nocMode ? 'text-xs' : 'text-[11px]')}>
            <span className={cn('h-1.5 w-1.5 rounded-full', styles.dot)} />
            {styles.label}
          </span>
        </div>

        <div className="flex flex-1 flex-col space-y-2 pl-2">
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Globe className="h-3.5 w-3.5" />
              {sitesTotal} site{sitesTotal !== 1 ? 's' : ''}
            </span>
            <span className="inline-flex items-center gap-1">
              <Bell className="h-3.5 w-3.5" />
              {alertCount} alerte{alertCount !== 1 ? 's' : ''}
            </span>
            {server.profile === 'PLESK' && (
              <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">Plesk</span>
            )}
          </div>

          <ul className="space-y-1">
            {paddedSummaryLines.map((line, index) => {
              const isMaintenanceLine = line?.includes('en maintenance');
              const isUnsupervisedLine = line?.includes('non supervisé');
              return (
              <li
                key={`${line || 'empty'}-${index}`}
                className={cn(
                  'flex min-h-[22px] items-start gap-2 text-sm text-foreground/90',
                  !line && 'invisible',
                )}
              >
                <AlertTriangle className={cn(
                  'mt-0.5 h-3.5 w-3.5 shrink-0',
                  isMaintenanceLine
                    ? 'text-emerald-400'
                    : isUnsupervisedLine
                      ? 'text-muted-foreground'
                    : level === 'ok'
                      ? 'text-accent/70'
                      : level === 'warning'
                        ? 'text-warning'
                        : 'text-destructive',
                )} />
                <span className={cn(
                  'line-clamp-2',
                  isMaintenanceLine && 'text-emerald-300/90',
                  isUnsupervisedLine && 'text-muted-foreground',
                )}>{line || '—'}</span>
              </li>
            );
            })}
          </ul>
        </div>

        <div className={cn('mt-auto flex flex-wrap gap-3 border-t border-white/5 pt-3 pl-2 font-mono text-muted-foreground', nocMode ? 'text-sm' : 'text-xs')}>
          {latest ? (
            <>
              <span>CPU {formatCpuPercent(latest.cpuPercent)}</span>
              <span>RAM {latest.memoryPercent.toFixed(0)}%</span>
              <span>Disque {latest.diskPercent.toFixed(0)}%</span>
            </>
          ) : (
            <>
              <span className="invisible">CPU —</span>
              <span className="invisible">RAM —</span>
              <span className="invisible">Disque —</span>
            </>
          )}
        </div>
      </Link>
    </div>
  );
}

export function ServerOverviewCards({
  servers,
  websites,
  alerts,
  nocMode = false,
  showHeader = true,
}: {
  servers: ServerWithHistory[];
  websites: WebsiteWithHistory[];
  alerts: Alert[];
  nocMode?: boolean;
  showHeader?: boolean;
}) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const itemsById = useMemo(() => {
    const map = new Map<string, ServerOverviewData>();
    for (const server of servers) {
      map.set(server.id, buildServerOverview(server, websites, alerts));
    }
    return map;
  }, [servers, websites, alerts]);

  const defaultIds = useMemo(() => {
    return [...itemsById.values()]
      .sort((a, b) => {
        const rank = { critical: 0, warning: 1, ok: 2 };
        return rank[a.level] - rank[b.level] || a.server.name.localeCompare(b.server.name);
      })
      .map((item) => item.server.id);
  }, [itemsById]);

  const { order, move, hydrated } = useServerTileOrder(defaultIds);

  const items = useMemo(() => {
    const ids = hydrated ? order : defaultIds;
    return ids.map((id) => itemsById.get(id)).filter(Boolean) as ServerOverviewData[];
  }, [order, defaultIds, itemsById, hydrated]);

  if (servers.length === 0) return null;

  return (
    <section className={nocMode ? 'h-full' : undefined}>
      {showHeader && (
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Serveurs</h2>
          <div className="flex items-center gap-2">
            <Link
              href="/noc"
              className="btn-secondary px-2.5"
              title="Mode NOC plein écran"
            >
              <Maximize2 className="h-4 w-4" />
            </Link>
            <Link href="/servers" className="text-sm text-primary hover:underline">
              Voir tout
            </Link>
          </div>
        </div>
      )}

      <div
        className={cn(
          'grid items-stretch gap-4',
          nocMode
            ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'
            : 'sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4',
        )}
      >
        {items.map((data) => (
          <ServerOverviewCard
            key={data.server.id}
            data={data}
            nocMode={nocMode}
            draggable
            isDragging={draggedId === data.server.id}
            isDropTarget={dropTargetId === data.server.id && draggedId !== data.server.id}
            onDragStart={() => setDraggedId(data.server.id)}
            onDragEnd={() => {
              setDraggedId(null);
              setDropTargetId(null);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (draggedId && draggedId !== data.server.id) {
                setDropTargetId(data.server.id);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData('text/plain') || draggedId;
              if (id && id !== data.server.id) move(id, data.server.id);
              setDraggedId(null);
              setDropTargetId(null);
            }}
          />
        ))}
      </div>
    </section>
  );
}
