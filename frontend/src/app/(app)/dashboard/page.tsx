'use client';

import { useEffect, useState } from 'react';
import { Server as ServerIcon, Globe, Bell, AlertTriangle, EyeOff, RefreshCw, ChevronDown } from 'lucide-react';
import { api, type DashboardData, type ServerWithHistory, type User, type WebsiteWithHistory } from '@/lib/api';
import { MetricCard, SeverityBadge } from '@/components/ui';
import { ServerOverviewCards } from '@/components/server-overview-cards';
import { AlertDetailPanel } from '@/components/alert-detail-panel';
import { getAlertHostingServer } from '@/lib/alert-hosting';
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
  const [expandedAlertId, setExpandedAlertId] = useState<string | null>(null);
  const [profile, setProfile] = useState<User | null>(null);
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);

  async function refreshOpenAlerts() {
    const summary = await api.getAlertsSummary();
    setOpenAlerts([...summary.active, ...summary.acknowledged, ...summary.pendingClose]);
    return summary;
  }

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

    api.getProfile().then(setProfile).catch(() => {});

    const interval = setInterval(() => {
      loadAll().catch(console.error);
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const canEdit = profile?.role === 'ADMIN' || profile?.role === 'OPERATOR';

  async function handleAcknowledge(e: React.MouseEvent, alertId: string) {
    e.stopPropagation();
    setAcknowledgingId(alertId);
    try {
      await api.acknowledgeAlert(alertId);
      const summary = await refreshOpenAlerts();
      setData((current) =>
        current
          ? {
              ...current,
              summary: { ...current.summary, activeAlerts: summary.counts.active + summary.counts.acknowledged + summary.counts.pendingClose },
            }
          : current,
      );
    } finally {
      setAcknowledgingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!data) return <p className="text-destructive">Erreur de chargement</p>;

  const { summary, disabledWebsites } = data;
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
          value={openAlerts.length}
          subtitle="Non résolues"
          icon={Bell}
          trend={openAlerts.length > 0 ? 'down' : 'neutral'}
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
          <h2 className="text-lg font-semibold">Alertes actives</h2>
          <Link href="/alerts" className="text-sm text-primary hover:underline">Voir tout</Link>
        </div>
        {openAlerts.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Aucune alerte en cours</p>
        ) : (
          <div className="space-y-3">
            {openAlerts.map((a) => {
              const isExpanded = expandedAlertId === a.id;
              const hostingServer = getAlertHostingServer(a);
              return (
                <div
                  key={a.id}
                  className={cn(
                    'rounded-lg border border-white/5 transition-colors',
                    isExpanded && 'ring-1 ring-primary/30',
                  )}
                >
                  <div className="flex items-start gap-3 p-3">
                    <button
                      type="button"
                      onClick={() => setExpandedAlertId(isExpanded ? null : a.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <SeverityBadge severity={a.severity} />
                        <p className="font-medium">{a.title}</p>
                        {a.occurrenceCount > 1 && (
                          <span className="badge-warning">Occurrence {a.occurrenceCount}</span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{a.message}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{formatDate(a.createdAt)}</span>
                        {hostingServer && (
                          <span className="font-medium text-primary">
                            Serveur : {hostingServer.name}
                          </span>
                        )}
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center gap-2">
                      {canEdit && a.status === 'ACTIVE' && (
                        <button
                          type="button"
                          onClick={(e) => handleAcknowledge(e, a.id)}
                          disabled={acknowledgingId === a.id}
                          className="btn-primary shrink-0 text-sm"
                        >
                          {acknowledgingId === a.id ? 'Acquittement…' : 'Acquitter'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setExpandedAlertId(isExpanded ? null : a.id)}
                        className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary/50"
                        aria-label={isExpanded ? 'Replier' : 'Déplier'}
                      >
                        <ChevronDown
                          className={cn(
                            'h-5 w-5 transition-transform',
                            isExpanded && 'rotate-180',
                          )}
                        />
                      </button>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="px-3 pb-3">
                      <AlertDetailPanel
                        alertId={a.id}
                        summary={a}
                        canEdit={canEdit}
                        onUpdated={async () => {
                          const summary = await refreshOpenAlerts();
                          setData((current) =>
                            current
                              ? {
                                  ...current,
                                  summary: {
                                    ...current.summary,
                                    activeAlerts:
                                      summary.counts.active
                                      + summary.counts.acknowledged
                                      + summary.counts.pendingClose,
                                  },
                                }
                              : current,
                          );
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
