'use client';

import { useEffect, useState } from 'react';
import { Server, Globe, Bell, AlertTriangle } from 'lucide-react';
import { api, type DashboardData } from '@/lib/api';
import { MetricCard, StatusBadge, SeverityBadge } from '@/components/ui';
import { formatDate } from '@/lib/utils';
import Link from 'next/link';

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getDashboard()
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));

    const interval = setInterval(() => {
      api.getDashboard().then(setData).catch(console.error);
    }, 30000);
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

  const { summary, recentAlerts, servers, websites } = data;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Tableau de bord</h1>
        <p className="text-sm text-muted-foreground">Vue d&apos;ensemble de votre infrastructure</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Serveurs en ligne"
          value={`${summary.servers.online}/${summary.servers.total}`}
          subtitle={summary.servers.offline > 0 ? `${summary.servers.offline} hors ligne` : 'Tous opérationnels'}
          icon={Server}
          trend={summary.servers.offline > 0 ? 'down' : 'up'}
        />
        <MetricCard
          title="Sites en ligne"
          value={`${summary.websites.up}/${summary.websites.total}`}
          subtitle={summary.websites.down > 0 ? `${summary.websites.down} hors ligne` : 'Tous accessibles'}
          icon={Globe}
          trend={summary.websites.down > 0 ? 'down' : 'up'}
        />
        <MetricCard
          title="Alertes actives"
          value={summary.activeAlerts}
          subtitle="Non résolues"
          icon={Bell}
          trend={summary.activeAlerts > 0 ? 'down' : 'neutral'}
        />
        <MetricCard
          title="Serveurs dégradés"
          value={summary.servers.degraded}
          subtitle="Ressources élevées"
          icon={AlertTriangle}
          trend={summary.servers.degraded > 0 ? 'down' : 'up'}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Serveurs</h2>
            <Link href="/servers" className="text-sm text-primary hover:underline">Voir tout</Link>
          </div>
          <div className="space-y-3">
            {servers.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun serveur configuré</p>
            ) : (
              servers.map((s) => {
                const m = s.metrics?.[0];
                return (
                  <Link
                    key={s.id}
                    href={`/servers/${s.id}`}
                    className="flex items-center justify-between rounded-lg border border-white/5 p-3 transition-colors hover:bg-secondary/30"
                  >
                    <div>
                      <p className="font-medium">{s.name}</p>
                      <p className="text-xs text-muted-foreground">{s.hostname}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      {m && (
                        <span className="font-mono text-xs text-muted-foreground">
                          CPU {m.cpuPercent.toFixed(0)}%
                        </span>
                      )}
                      <StatusBadge status={s.status} />
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </div>

        <div className="card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Sites web</h2>
            <Link href="/websites" className="text-sm text-primary hover:underline">Voir tout</Link>
          </div>
          <div className="space-y-3">
            {websites.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun site configuré</p>
            ) : (
              websites.map((w) => (
                <Link
                  key={w.id}
                  href={`/websites/${w.id}`}
                  className="flex items-center justify-between rounded-lg border border-white/5 p-3 transition-colors hover:bg-secondary/30"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{w.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{w.url}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {w.lastResponseMs != null && (
                      <span className="font-mono text-xs text-muted-foreground">{w.lastResponseMs}ms</span>
                    )}
                    <StatusBadge status={w.status} />
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
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
                  <span className="text-xs text-muted-foreground">{formatDate(a.createdAt)}</span>
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
