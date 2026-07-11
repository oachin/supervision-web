'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Minimize2, RefreshCw, Shield, Clock } from 'lucide-react';
import { api, type DashboardData, type ServerWithHistory, type WebsiteWithHistory, type Alert } from '@/lib/api';
import { NocHiveView } from '@/components/noc-hive-view';
import { EventTicker } from '@/components/event-ticker';
import { useAlerts } from '@/components/alert-provider';
import { cn, formatDate } from '@/lib/utils';

function NocClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <span className="inline-flex items-center gap-2 font-mono text-sm text-muted-foreground">
      <Clock className="h-4 w-4" />
      {now.toLocaleString('fr-FR', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })}
    </span>
  );
}

function NocGlobalStatus({ summary }: { summary: DashboardData['summary'] }) {
  const serversOffline = summary.servers.offline;
  const sitesDown = summary.websites.down;
  const sitesDegraded = summary.websites.degraded;
  const activeAlerts = summary.activeAlerts;

  let level: 'ok' | 'warning' | 'critical' = 'ok';
  if (serversOffline > 0 || sitesDown > 0) level = 'critical';
  else if (activeAlerts > 0 || sitesDegraded > 0 || summary.servers.degraded > 0) level = 'warning';

  const styles = {
    ok: 'border-accent/40 bg-accent/10 text-accent',
    warning: 'border-warning/40 bg-warning/10 text-warning',
    critical: 'border-destructive/40 bg-destructive/10 text-destructive',
  }[level];

  const label = {
    ok: 'Nominal',
    warning: 'Sous surveillance',
    critical: 'Incident',
  }[level];

  return (
    <div className={cn('rounded-lg border px-4 py-2 text-sm font-medium', styles)}>
      État global : {label}
      <span className="ml-3 font-normal opacity-80">
        {summary.servers.online}/{summary.servers.total} serveurs · {summary.websites.up}/{summary.websites.total} sites · {activeAlerts} alertes
      </span>
    </div>
  );
}

export default function NocPage() {
  const { refresh: refreshAlerts } = useAlerts();
  const [data, setData] = useState<DashboardData | null>(null);
  const [servers, setServers] = useState<ServerWithHistory[]>([]);
  const [websites, setWebsites] = useState<WebsiteWithHistory[]>([]);
  const [openAlerts, setOpenAlerts] = useState<Alert[]>([]);
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
    refreshAlerts();
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await loadAll();
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadAll().catch(console.error);
    const interval = setInterval(() => loadAll().catch(console.error), 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    document.documentElement.requestFullscreen?.().catch(() => {});
    return () => {
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !document.fullscreenElement) {
        window.location.href = '/dashboard';
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (!data) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/10 bg-card/40 px-6 py-3 backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/20">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">Havet Supervision — NOC</h1>
            <p className="text-xs text-muted-foreground">Vue murale · {formatDate(new Date().toISOString())}</p>
          </div>
        </div>

        <div className="hidden flex-1 justify-center lg:flex">
          <NocGlobalStatus summary={data.summary} />
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <NocClock />
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="btn-secondary"
            title="Rafraîchir"
          >
            <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
          </button>
          <Link href="/dashboard" className="btn-secondary" title="Quitter le mode NOC">
            <Minimize2 className="h-4 w-4" />
          </Link>
        </div>
      </header>

      <div className="border-b border-white/5 px-6 py-2 lg:hidden">
        <NocGlobalStatus summary={data.summary} />
      </div>

      <main className="flex-1 overflow-auto p-4 md:p-6">
        <NocHiveView servers={servers} websites={websites} alerts={openAlerts} />
      </main>

      <footer className="shrink-0 border-t border-white/10 bg-card/30 px-4 py-2">
        <EventTicker limit={12} />
      </footer>
    </div>
  );
}
