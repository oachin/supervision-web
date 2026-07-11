'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Server as ServerIcon } from 'lucide-react';
import { cn, isMaintenanceStatus, statusLabel } from '@/lib/utils';
import { useServerTileOrder } from '@/hooks/use-server-tile-order';
import { buildServerOverview } from '@/components/server-overview-cards';
import type { Alert, ServerWithHistory, WebsiteWithHistory } from '@/lib/api';

const HEX_SIZE = 11;
const HEX_GAP = 2;
const ROWS_EVEN = 14;
const ROWS_ODD = 13;

function siteHiveClass(site: WebsiteWithHistory) {
  if (!site.monitoringEnabled) return 'bg-muted-foreground/35 hover:bg-muted-foreground/50';
  if (isMaintenanceStatus(site.status, site.lastStatusCode)) {
    return 'bg-emerald-400 hover:bg-emerald-300';
  }
  if (site.status === 'UP') return 'bg-accent hover:bg-accent/80';
  if (site.status === 'DEGRADED') return 'bg-warning hover:bg-warning/80';
  if (site.status === 'DOWN') return 'bg-destructive status-dot-pulse-danger hover:bg-destructive/80';
  return 'bg-muted-foreground/50 hover:bg-muted-foreground/70';
}

function HoneycombCell({ site }: { site: WebsiteWithHistory }) {
  const label = !site.monitoringEnabled
    ? 'Supervision off'
    : statusLabel(site.status, site.lastStatusCode);

  return (
    <Link
      href={site.server?.id ? `/servers/${site.server.id}` : `/websites/${site.id}`}
      title={`${site.name}\n${site.url}\n${label}`}
      className={cn(
        'hive-hex shrink-0 transition-transform hover:scale-110 hover:z-10',
        siteHiveClass(site),
      )}
    />
  );
}

function HoneycombGrid({ sites }: { sites: WebsiteWithHistory[] }) {
  const sorted = useMemo(
    () => [...sites].sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    [sites],
  );

  const rows = useMemo(() => {
    const result: WebsiteWithHistory[][] = [];
    let index = 0;
    let rowIndex = 0;
    while (index < sorted.length) {
      const cols = rowIndex % 2 === 0 ? ROWS_EVEN : ROWS_ODD;
      result.push(sorted.slice(index, index + cols));
      index += cols;
      rowIndex += 1;
    }
    return result;
  }, [sorted]);

  if (sorted.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Aucun site sur ce serveur</p>;
  }

  return (
    <div className="hive-grid" style={{ '--hex-size': `${HEX_SIZE}px`, '--hex-gap': `${HEX_GAP}px` } as React.CSSProperties}>
      {rows.map((row, rowIndex) => (
        <div
          key={`row-${rowIndex}`}
          className={cn('hive-row', rowIndex % 2 === 1 && 'hive-row-offset')}
        >
          {row.map((site) => (
            <HoneycombCell key={site.id} site={site} />
          ))}
        </div>
      ))}
    </div>
  );
}

function HiveLegend() {
  const items = [
    { className: 'bg-accent', label: 'En ligne' },
    { className: 'bg-emerald-400', label: 'Maintenance' },
    { className: 'bg-warning', label: 'Dégradé' },
    { className: 'bg-destructive', label: 'Hors ligne' },
    { className: 'bg-muted-foreground/35', label: 'Supervision off' },
  ];

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-2">
          <span className={cn('hive-hex hive-hex-legend', item.className)} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function ServerHivePanel({
  server,
  sites,
  alerts,
  websites,
}: {
  server: ServerWithHistory;
  sites: WebsiteWithHistory[];
  alerts: Alert[];
  websites: WebsiteWithHistory[];
}) {
  const overview = buildServerOverview(server, websites, alerts);
  const styles = {
    ok: { border: 'border-accent/40', bg: 'bg-accent/[0.04]', bar: 'bg-accent', label: 'Opérationnel' },
    warning: { border: 'border-warning/40', bg: 'bg-warning/[0.04]', bar: 'bg-warning', label: 'Attention' },
    critical: { border: 'border-destructive/50', bg: 'bg-destructive/[0.06]', bar: 'bg-destructive', label: 'Critique' },
  }[overview.level];

  const monitored = sites.filter((s) => s.monitoringEnabled);
  const counts = {
    up: monitored.filter((s) => s.status === 'UP').length,
    maintenance: monitored.filter((s) => isMaintenanceStatus(s.status, s.lastStatusCode)).length,
    degraded: monitored.filter((s) => s.status === 'DEGRADED' && !isMaintenanceStatus(s.status, s.lastStatusCode)).length,
    down: monitored.filter((s) => s.status === 'DOWN').length,
    off: sites.filter((s) => !s.monitoringEnabled).length,
  };

  return (
    <article
      className={cn(
        'relative flex min-h-[320px] flex-col overflow-hidden rounded-xl border',
        styles.border,
        styles.bg,
      )}
    >
      <div className={cn('absolute left-0 top-0 h-full w-1', styles.bar)} aria-hidden />

      <header className="flex items-start justify-between gap-3 border-b border-white/5 px-4 py-3 pl-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ServerIcon className="h-4 w-4 shrink-0 text-primary" />
            <h2 className="truncate text-base font-semibold">{server.name}</h2>
          </div>
          <p className="truncate pl-6 font-mono text-[11px] text-muted-foreground">{server.hostname}</p>
        </div>
        <span className={cn('shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium', styles.border, styles.bg)}>
          {styles.label}
        </span>
      </header>

      <div className="flex flex-wrap gap-3 px-4 py-2 pl-5 text-[11px] text-muted-foreground">
        <span>{sites.length} sites</span>
        <span className="text-accent">{counts.up} OK</span>
        {counts.maintenance > 0 && <span className="text-emerald-400">{counts.maintenance} maint.</span>}
        {counts.degraded > 0 && <span className="text-warning">{counts.degraded} dégrad.</span>}
        {counts.down > 0 && <span className="text-destructive">{counts.down} down</span>}
        {counts.off > 0 && <span>{counts.off} off</span>}
      </div>

      <div className="flex flex-1 items-start justify-center overflow-auto px-3 pb-4 pl-4">
        <HoneycombGrid sites={sites} />
      </div>
    </article>
  );
}

export function NocHiveView({
  servers,
  websites,
  alerts,
}: {
  servers: ServerWithHistory[];
  websites: WebsiteWithHistory[];
  alerts: Alert[];
}) {
  const defaultIds = useMemo(
    () => [...servers].sort((a, b) => a.name.localeCompare(b.name, 'fr')).map((s) => s.id),
    [servers],
  );
  const { order, hydrated } = useServerTileOrder(defaultIds);

  const orderedServers = useMemo(() => {
    const map = new Map(servers.map((s) => [s.id, s]));
    const ids = hydrated ? order : defaultIds;
    return ids.map((id) => map.get(id)).filter(Boolean) as ServerWithHistory[];
  }, [servers, order, defaultIds, hydrated]);

  const sitesByServer = useMemo(() => {
    const map = new Map<string, WebsiteWithHistory[]>();
    for (const site of websites) {
      const serverId = site.server?.id;
      if (!serverId) continue;
      const list = map.get(serverId) ?? [];
      list.push(site);
      map.set(serverId, list);
    }
    return map;
  }, [websites]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-4">
        {orderedServers.map((server) => (
          <ServerHivePanel
            key={server.id}
            server={server}
            sites={sitesByServer.get(server.id) ?? []}
            alerts={alerts}
            websites={websites}
          />
        ))}
      </div>
      <HiveLegend />
    </div>
  );
}
