'use client';

import Link from 'next/link';
import { Server as ServerIcon, AlertTriangle, Globe, Bell } from 'lucide-react';
import { cn, formatCpuPercent } from '@/lib/utils';
import { TagList } from '@/components/tag-editor';
import type { Alert, ServerWithHistory, WebsiteWithHistory } from '@/lib/api';

export type ServerHealthLevel = 'ok' | 'warning' | 'critical';

export interface ServerOverviewData {
  server: ServerWithHistory;
  level: ServerHealthLevel;
  summaryLines: string[];
  alertCount: number;
  sitesTotal: number;
  sitesDown: number;
  sitesDegraded: number;
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

function openAlertsForServer(
  serverId: string,
  websiteIds: Set<string>,
  alerts: Alert[],
): Alert[] {
  return alerts.filter(
    (a) =>
      (a.status === 'ACTIVE' || a.status === 'ACKNOWLEDGED' || a.status === 'PENDING_CLOSE') &&
      (a.serverId === serverId || (a.websiteId != null && websiteIds.has(a.websiteId))),
  );
}

export function buildServerOverview(
  server: ServerWithHistory,
  websites: WebsiteWithHistory[],
  alerts: Alert[],
): ServerOverviewData {
  const serverSites = websites.filter(
    (w) => w.server?.id === server.id && w.monitoringEnabled,
  );
  const websiteIds = new Set(serverSites.map((w) => w.id));
  const serverAlerts = openAlertsForServer(server.id, websiteIds, alerts);

  const sitesDown = serverSites.filter((w) => w.status === 'DOWN').length;
  const sitesDegraded = serverSites.filter((w) => w.status === 'DEGRADED').length;
  const criticalAlerts = serverAlerts.filter((a) => a.severity === 'CRITICAL').length;
  const warningAlerts = serverAlerts.filter((a) => a.severity === 'WARNING').length;

  let level: ServerHealthLevel = 'ok';
  if (
    server.status === 'OFFLINE' ||
    sitesDown > 0 ||
    criticalAlerts > 0
  ) {
    level = 'critical';
  } else if (
    server.status === 'DEGRADED' ||
    sitesDegraded > 0 ||
    warningAlerts > 0
  ) {
    level = 'warning';
  }

  const summaryLines: string[] = [];
  if (server.status === 'OFFLINE') {
    summaryLines.push('Serveur hors ligne');
  } else if (server.status === 'DEGRADED') {
    summaryLines.push('Ressources serveur élevées');
  }
  if (sitesDown > 0) {
    summaryLines.push(`${sitesDown} site${sitesDown > 1 ? 's' : ''} injoignable${sitesDown > 1 ? 's' : ''}`);
  }
  if (sitesDegraded > 0) {
    summaryLines.push(`${sitesDegraded} site${sitesDegraded > 1 ? 's' : ''} dégradé${sitesDegraded > 1 ? 's' : ''}`);
  }
  if (warningAlerts > 0 && level !== 'critical') {
    summaryLines.push(`${warningAlerts} alerte${warningAlerts > 1 ? 's' : ''} warning`);
  }
  if (criticalAlerts > 0) {
    summaryLines.push(`${criticalAlerts} alerte${criticalAlerts > 1 ? 's' : ''} critique${criticalAlerts > 1 ? 's' : ''}`);
  }
  if (summaryLines.length === 0) {
    summaryLines.push('Aucune alerte active');
  }

  return {
    server,
    level,
    summaryLines,
    alertCount: serverAlerts.length,
    sitesTotal: serverSites.length,
    sitesDown,
    sitesDegraded,
  };
}

function ServerOverviewCard({ data }: { data: ServerOverviewData }) {
  const { server, level, summaryLines, alertCount, sitesTotal } = data;
  const styles = levelStyles[level];
  const latest = server.metrics?.[0];
  const hostname = server.hostname === 'en-attente' ? 'Hostname en attente' : server.hostname;

  return (
    <Link
      href={`/servers/${server.id}`}
      className={cn(
        'group relative flex flex-col gap-4 overflow-hidden rounded-xl border p-5 transition-all duration-300',
        'hover:-translate-y-0.5 hover:shadow-lg',
        styles.border,
        styles.bg,
        styles.glow,
      )}
    >
      <div className={cn('absolute left-0 top-0 h-full w-1', styles.bar)} aria-hidden />

      <div className="flex items-start justify-between gap-3 pl-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', styles.bg, 'border', styles.border)}>
              <ServerIcon className={cn('h-4 w-4', level === 'ok' ? 'text-accent' : level === 'warning' ? 'text-warning' : 'text-destructive')} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold tracking-tight">{server.name}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">{hostname}</p>
              {server.tags?.length > 0 && (
                <TagList tags={server.tags} size="xs" className="mt-1.5" />
              )}
            </div>
          </div>
        </div>
        <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium', styles.bg, 'border', styles.border)}>
          <span className={cn('h-1.5 w-1.5 rounded-full', styles.dot)} />
          {styles.label}
        </span>
      </div>

      <div className="space-y-2 pl-2">
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
          {summaryLines.slice(0, 3).map((line) => (
            <li key={line} className="flex items-start gap-2 text-sm text-foreground/90">
              <AlertTriangle className={cn(
                'mt-0.5 h-3.5 w-3.5 shrink-0',
                level === 'ok' ? 'text-accent/70' : level === 'warning' ? 'text-warning' : 'text-destructive',
              )} />
              <span className="line-clamp-1">{line}</span>
            </li>
          ))}
        </ul>
      </div>

      {latest && (
        <div className="mt-auto flex flex-wrap gap-3 border-t border-white/5 pt-3 pl-2 font-mono text-xs text-muted-foreground">
          <span>CPU {formatCpuPercent(latest.cpuPercent)}</span>
          <span>RAM {latest.memoryPercent.toFixed(0)}%</span>
          <span>Disque {latest.diskPercent.toFixed(0)}%</span>
        </div>
      )}
    </Link>
  );
}

export function ServerOverviewCards({
  servers,
  websites,
  alerts,
}: {
  servers: ServerWithHistory[];
  websites: WebsiteWithHistory[];
  alerts: Alert[];
}) {
  if (servers.length === 0) return null;

  const items = servers
    .map((s) => buildServerOverview(s, websites, alerts))
    .sort((a, b) => {
      const rank = { critical: 0, warning: 1, ok: 2 };
      return rank[a.level] - rank[b.level] || a.server.name.localeCompare(b.server.name);
    });

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Serveurs</h2>
        <Link href="/servers" className="text-sm text-primary hover:underline">
          Voir tout
        </Link>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {items.map((data) => (
          <ServerOverviewCard key={data.server.id} data={data} />
        ))}
      </div>
    </section>
  );
}
