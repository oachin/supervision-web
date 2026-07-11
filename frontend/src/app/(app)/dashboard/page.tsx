'use client';

import { useEffect, useState } from 'react';
import { Server as ServerIcon, Globe, Bell, AlertTriangle, EyeOff } from 'lucide-react';
import { api, type DashboardData, type ServerWithHistory, type WebsiteWithHistory } from '@/lib/api';
import { MetricCard, SeverityBadge } from '@/components/ui';
import { StatusGrid, type StatusTileData } from '@/components/status-grid';
import { EventTicker } from '@/components/event-ticker';
import { formatDate, formatCpuPercent } from '@/lib/utils';
import Link from 'next/link';

function serverToTile(s: ServerWithHistory): StatusTileData {
  const latest = s.metrics?.[0];
  const history = s.metrics ? [...s.metrics].reverse().map((m) => m.cpuPercent) : [];
  return {
    id: s.id,
    name: s.name,
    subtitle: s.hostname === 'en-attente' ? '—' : s.hostname,
    status: s.status,
    href: `/servers/${s.id}`,
    metricLabel: latest ? `CPU ${formatCpuPercent(latest.cpuPercent)}` : '—',
    secondaryLabel: latest ? `RAM ${latest.memoryPercent.toFixed(0)}%` : undefined,
    sparklineData: history,
  };
}

function websiteToTile(w: WebsiteWithHistory): StatusTileData {
  const history = w.checks ? [...w.checks].reverse().map((c) => c.responseMs ?? 0) : [];
  return {
    id: w.id,
    name: w.name,
    subtitle: w.url,
    status: w.monitoringEnabled ? w.status : 'DISABLED',
    href: `/websites/${w.id}`,
    metricLabel: w.lastStatusCode != null ? `${w.lastStatusCode} · ${w.lastResponseMs ?? '—'}ms` : '—',
    secondaryLabel: w.sslDaysRemaining != null ? `SSL ${w.sslDaysRemaining}j` : undefined,
    sparklineData: history,
  };
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [servers, setServers] = useState<ServerWithHistory[]>([]);
  const [websites, setWebsites] = useState<WebsiteWithHistory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getDashboard()
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));

    const interval = setInterval(() => {
      api.getDashboard().then(setData).catch(console.error);
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const load = () => {
      api.getServers().then(setServers).catch(console.error);
      api.getWebsites().then(setWebsites).catch(console.error);
    };
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!data) return <p className="text-destructive">Erreur de chargement</p>;

  const { summary, recentAlerts, disabledWebsites } = data;
  const serversInAlert = summary.servers.offline + summary.servers.degraded;
  const websitesInAlert = summary.websites.down + summary.websites.degraded;
  const websitesDisabled = summary.websites.disabled ?? 0;

  const tiles: StatusTileData[] = [
    ...servers.map(serverToTile),
    ...websites.map(websiteToTile),
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Tableau de bord</h1>
        <p className="text-sm text-muted-foreground">Vue d&apos;ensemble de votre infrastructure</p>
      </div>

      <EventTicker />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard
          title="Serveurs en ligne"
          value={`${summary.servers.online}/${summary.servers.total}`}
          subtitle={serversInAlert > 0 ? `${serversInAlert} en alerte` : 'Tous opérationnels'}
          icon={ServerIcon}
          trend={serversInAlert > 0 ? 'down' : 'up'}
          href={serversInAlert > 0 ? '/servers?filter=alert' : '/servers'}
        />
        <MetricCard
          title="Sites en ligne"
          value={`${summary.websites.up}/${summary.websites.total}`}
          subtitle={websitesInAlert > 0 ? `${websitesInAlert} en alerte` : 'Tous accessibles'}
          icon={Globe}
          trend={websitesInAlert > 0 ? 'down' : 'up'}
          href={websitesInAlert > 0 ? '/websites?filter=alert' : '/websites'}
        />
        <MetricCard
          title="Alertes actives"
          value={summary.activeAlerts}
          subtitle="Non résolues"
          icon={Bell}
          trend={summary.activeAlerts > 0 ? 'down' : 'neutral'}
          href="/alerts"
        />
        <MetricCard
          title="Serveurs dégradés"
          value={summary.servers.degraded}
          subtitle="Ressources élevées"
          icon={AlertTriangle}
          trend={summary.servers.degraded > 0 ? 'down' : 'up'}
          href={summary.servers.degraded > 0 ? '/servers?filter=degraded' : '/servers'}
        />
        <MetricCard
          title="Supervision off"
          value={websitesDisabled}
          subtitle={websitesDisabled > 0 ? 'Sites non surveillés' : 'Tous surveillés'}
          icon={EyeOff}
          trend="neutral"
          href={websitesDisabled > 0 ? '/websites?filter=disabled' : '/websites'}
        />
      </div>

      {websitesDisabled > 0 && (
        <div className="card border-white/10">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground">Sites avec supervision désactivée</h2>
            <Link href="/websites?filter=disabled" className="text-sm text-primary hover:underline">Gérer</Link>
          </div>
          <div className="flex flex-wrap gap-2">
            {disabledWebsites.map((w) => (
              <Link
                key={w.id}
                href={`/websites/${w.id}`}
                className="rounded-lg border border-white/10 bg-secondary/20 px-3 py-1.5 text-sm transition-colors hover:border-primary/30"
              >
                {w.name}
              </Link>
            ))}
            {websitesDisabled > disabledWebsites.length && (
              <span className="self-center text-xs text-muted-foreground">
                +{websitesDisabled - disabledWebsites.length} autre{websitesDisabled - disabledWebsites.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Vue d&apos;ensemble</h2>
          <span className="font-mono text-xs text-muted-foreground">
            {tiles.length} élément{tiles.length > 1 ? 's' : ''}
          </span>
        </div>
        <StatusGrid tiles={tiles} />
      </div>

      {recentAlerts.length > 0 && (
        <div className="card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Alertes récentes</h2>
            <Link href="/alerts" className="text-sm text-primary hover:underline">Voir tout</Link>
          </div>
          <div className="space-y-2">
            {recentAlerts.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-lg border border-white/5 p-3">
                <div>
                  <p className="font-medium">{a.title}</p>
                  <p className="text-xs text-muted-foreground">{a.message}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{formatDate(a.createdAt)}</span>
                  <SeverityBadge severity={a.severity} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
