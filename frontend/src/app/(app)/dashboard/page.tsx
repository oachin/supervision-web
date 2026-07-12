'use client';

import { useEffect, useState } from 'react';
import { Server as ServerIcon, Globe, Bell, AlertTriangle, EyeOff, RefreshCw } from 'lucide-react';
import { api, type DashboardData, type ServerWithHistory, type WebsiteWithHistory } from '@/lib/api';
import { MetricCard, SeverityBadge } from '@/components/ui';
import { ServerOverviewCards } from '@/components/server-overview-cards';
import { EventTicker } from '@/components/event-ticker';
import { formatDate, cn } from '@/lib/utils';
import Link from 'next/link';
import type { Alert } from '@/lib/api';

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [servers, setServers] = useState<ServerWithHistory[]>([]);
  const [websites, setWebsites] = useState<WebsiteWithHistory[]>([]);
  const [openAlerts, setOpenAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function loadAll() {
    const [dashboard, serversData, websitesData, summary] = await Promise.all([
      api.getDashboard(),
      api.getServers(),
      api.getWebsites(),
      api.getAlertsSummary(),
    ]);
    setData(dashboard);
    setServers(serversData);
    setWebsites(websitesData);
    setOpenAlerts([...summary.active, ...summary.acknowledged, ...summary.pendingClose]);
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await loadAll();
    } catch (err) {
      console.error(err);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll()
      .catch(console.error)
      .finally(() => setLoading(false));

    const interval = setInterval(() => {
      loadAll().catch(console.error);
    }, 10000);
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

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tableau de bord</h1>
          <p className="text-sm text-muted-foreground">Vue d&apos;ensemble de votre infrastructure</p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="btn-secondary"
        >
          <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
          Rafraîchir
        </button>
      </div>

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

      <ServerOverviewCards servers={servers} websites={websites} alerts={openAlerts} />

      <EventTicker />

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
