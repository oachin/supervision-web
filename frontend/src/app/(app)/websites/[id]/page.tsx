'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Trash2, Pause, Play } from 'lucide-react';
import {
  api,
  type Alert,
  type User,
  type WebsiteAlertStability,
  type WebsiteDetail,
} from '@/lib/api';
import { WebsiteStatusBadge } from '@/components/ui';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { AlertDetailModal } from '@/components/alert-detail-modal';
import { SeverityCountTags } from '@/components/severity-count-tags';
import { OpenExternalUrl } from '@/components/open-external-url';
import { cn, formatDate, isMaintenanceStatus } from '@/lib/utils';
import {
  countAlertsBySeverity,
  type SeverityCounts,
} from '@/lib/alert-severity';

function statusLabel(
  status: string,
  monitoringEnabled: boolean,
  lastStatusCode?: number | null,
) {
  if (!monitoringEnabled) return 'Désactivé';
  if (isMaintenanceStatus(status, lastStatusCode)) return 'Maintenance';
  if (status === 'UP') return 'OK';
  if (status === 'DOWN') return 'Critique';
  if (status === 'DEGRADED') return 'Dégradé';
  return status;
}

function statusTileClass(
  status: string,
  monitoringEnabled: boolean,
  lastStatusCode?: number | null,
  hasAlerts?: boolean,
) {
  if (!monitoringEnabled) return 'border-white/10 bg-white/[0.03]';
  if (isMaintenanceStatus(status, lastStatusCode)) {
    return 'border-emerald-400/35 bg-emerald-500/10';
  }
  if (status === 'DOWN' || hasAlerts) {
    return 'border-destructive/40 bg-destructive/[0.08] hover:border-destructive/60';
  }
  if (status === 'DEGRADED') {
    return 'border-warning/40 bg-warning/[0.08] hover:border-warning/60';
  }
  if (status === 'UP') {
    return 'border-accent/35 bg-accent/[0.08]';
  }
  return 'border-white/10 bg-white/[0.03]';
}

export default function WebsiteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [website, setWebsite] = useState<WebsiteDetail | null>(null);
  const [stability, setStability] = useState<WebsiteAlertStability | null>(null);
  const [periodKey, setPeriodKey] = useState('1d');
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [profile, setProfile] = useState<User | null>(null);

  const loadStability = useCallback(() => {
    if (!id) return;
    api.getWebsiteAlertStability(id).then(setStability).catch(console.error);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    api.getWebsite(id).then(setWebsite).catch(console.error);
    loadStability();
  }, [id, loadStability]);

  useEffect(() => {
    api.getProfile().then(setProfile).catch(() => {});
  }, []);

  const canEdit = profile?.role === 'ADMIN' || profile?.role === 'OPERATOR';
  const activeAlerts = stability?.active ?? [];
  const activeCounts = useMemo(
    () => countAlertsBySeverity(activeAlerts),
    [activeAlerts],
  );
  const hasActiveAlerts = activeAlerts.length > 0;

  const selectedPeriod =
    stability?.periods.find((p) => p.key === periodKey) ??
    stability?.periods.find((p) => p.key === '1d') ??
    stability?.periods[0];

  const periodCounts: SeverityCounts = selectedPeriod
    ? {
        CRITICAL: selectedPeriod.counts.CRITICAL,
        WARNING: selectedPeriod.counts.WARNING,
        EXPIRATION_SSL: selectedPeriod.counts.EXPIRATION_SSL,
        INFO: selectedPeriod.counts.INFO,
      }
    : { CRITICAL: 0, WARNING: 0, EXPIRATION_SSL: 0, INFO: 0 };

  function openStatusAlerts() {
    if (activeAlerts.length === 0) return;
    // Prefer CRITICAL, then WARNING, then first
    const preferred =
      activeAlerts.find((a) => a.severity === 'CRITICAL') ??
      activeAlerts.find((a) => a.severity === 'WARNING') ??
      activeAlerts[0];
    setSelectedAlert(preferred);
  }

  async function handleToggleMonitoring() {
    if (!website) return;
    setToggling(true);
    try {
      const updated = await api.updateWebsite(website.id, {
        monitoringEnabled: !website.monitoringEnabled,
      });
      setWebsite({ ...website, ...updated });
      loadStability();
    } catch (err) {
      console.error(err);
    } finally {
      setToggling(false);
    }
  }

  async function handleDelete() {
    if (!id) return;
    setDeleting(true);
    try {
      await api.deleteWebsite(id);
      router.push('/websites');
    } catch (err) {
      console.error(err);
      setDeleting(false);
    }
  }

  if (!website) {
    return (
      <div className="flex h-32 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const issuerShort = website.sslIssuer
    ? website.sslIssuer.replace(/^Let's Encrypt\s*[-·]\s*/i, "Let's Encrypt · ")
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{website.name}</h1>
            <OpenExternalUrl url={website.url} iconClassName="h-4 w-4" />
          </div>
          <p className="font-mono text-sm text-muted-foreground">{website.url}</p>
          <p className="mt-1 text-xs text-muted-foreground">Supervision externe HTTP/SSL</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <WebsiteStatusBadge
            status={website.status}
            monitoringEnabled={website.monitoringEnabled}
            lastStatusCode={website.lastStatusCode}
            size="lg"
          />
          <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
            <button
              type="button"
              onClick={handleToggleMonitoring}
              disabled={toggling}
              className="btn-secondary text-sm"
            >
              {website.monitoringEnabled ? (
                <>
                  <Pause className="h-4 w-4" /> Désactiver
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" /> Réactiver
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => setShowDelete(true)}
              className="btn-danger text-sm"
            >
              <Trash2 className="h-4 w-4" /> Supprimer
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="card text-center">
          <p className="text-sm text-muted-foreground">HTTP</p>
          <p className="mt-1 text-2xl font-bold">{website.lastStatusCode ?? '—'}</p>
          <p className="text-xs text-muted-foreground">{website.lastResponseMs ?? '—'} ms</p>
        </div>
        <div className="card text-center">
          <p className="text-sm text-muted-foreground">DNS / Port 443</p>
          <p className="mt-1 text-lg font-bold">
            {website.lastDnsOk == null ? '—' : website.lastDnsOk ? 'DNS OK' : 'DNS FAIL'}
          </p>
          <p className="text-xs text-muted-foreground">
            {website.lastPort443Open == null
              ? '—'
              : website.lastPort443Open
                ? '443 ouvert'
                : '443 fermé'}
          </p>
        </div>
        <div className="card text-center">
          <p className="text-sm text-muted-foreground">SSL</p>
          <p className="mt-1 text-2xl font-bold">
            {website.sslDaysRemaining != null ? `${website.sslDaysRemaining}j` : '—'}
          </p>
          <p className="text-xs text-muted-foreground">{formatDate(website.sslExpiresAt)}</p>
        </div>
        <div className="card text-center">
          <p className="text-sm text-muted-foreground">TLS</p>
          <p className="mt-1 text-lg font-bold">{website.lastTlsVersion ?? '—'}</p>
          {issuerShort ? (
            <p className="mt-1 truncate px-1 text-[11px] text-muted-foreground" title={website.sslIssuer ?? undefined}>
              {issuerShort}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Seuil alerte : {website.sslAlertDays ?? 15}j
            </p>
          )}
          {website.sslSubject && (
            <p
              className="mt-0.5 truncate px-1 text-[10px] text-muted-foreground/80"
              title={website.sslSubject}
            >
              {website.sslSubject}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={openStatusAlerts}
          disabled={!hasActiveAlerts}
          className={cn(
            'card text-center transition',
            statusTileClass(
              website.status,
              website.monitoringEnabled,
              website.lastStatusCode,
              hasActiveAlerts,
            ),
            hasActiveAlerts ? 'cursor-pointer' : 'cursor-default opacity-95',
          )}
          title={
            hasActiveAlerts
              ? 'Ouvrir l’alerte active'
              : 'Aucune alerte active'
          }
        >
          <p className="text-sm text-muted-foreground">Statut</p>
          <p className="mt-1 text-lg font-bold">
            {statusLabel(
              website.status,
              website.monitoringEnabled,
              website.lastStatusCode,
            )}
          </p>
          {hasActiveAlerts ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {activeAlerts.length} alerte{activeAlerts.length > 1 ? 's' : ''} · ouvrir
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">Aucune alerte</p>
          )}
        </button>
      </div>

      {hasActiveAlerts && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Alertes actives
          </span>
          <SeverityCountTags
            counts={activeCounts}
            showInfo={false}
            onSelect={() => openStatusAlerts()}
          />
        </div>
      )}

      <div className="card space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Stabilité des alertes</h2>
            <p className="text-sm text-muted-foreground">
              Occurrences / réouvertures par sévérité sur la période
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(stability?.periods ?? []).map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPeriodKey(p.key)}
                className={cn(
                  'rounded-lg px-2.5 py-1 text-xs font-medium transition',
                  periodKey === p.key
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-muted-foreground hover:text-foreground',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {!stability ? (
          <div className="flex h-16 items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-3xl font-bold tabular-nums">
                  {selectedPeriod?.counts.total ?? 0}
                </p>
                <p className="text-sm text-muted-foreground">
                  événement{(selectedPeriod?.counts.total ?? 0) !== 1 ? 's' : ''} ·{' '}
                  {selectedPeriod?.label ?? periodKey}
                </p>
              </div>
              <SeverityCountTags
                counts={periodCounts}
                showZero
                showInfo={false}
                size="md"
              />
            </div>
            {(selectedPeriod?.counts.total ?? 0) === 0 && (
              <p className="rounded-lg border border-dashed border-white/10 px-4 py-6 text-center text-sm text-muted-foreground">
                Aucune alerte sur cette période — site stable
              </p>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="mb-4 text-lg font-semibold">Historique des vérifications</h2>
        <div className="max-h-96 space-y-1 overflow-y-auto">
          {website.checks.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-white/5 px-3 py-2 text-sm"
            >
              <span className="text-muted-foreground">{formatDate(c.checkedAt)}</span>
              <span className="font-mono">{c.responseMs ?? '—'}ms</span>
              <span className="font-mono">HTTP {c.statusCode ?? '—'}</span>
              <span className="text-xs">
                {c.dnsOk === false ? 'DNS FAIL' : c.dnsOk ? 'DNS OK' : ''}
              </span>
              <span className="text-xs">{c.tlsVersion ?? ''}</span>
              <span className="text-xs">
                {c.sslDaysRemaining != null ? `SSL ${c.sslDaysRemaining}j` : ''}
              </span>
              <WebsiteStatusBadge status={c.status} lastStatusCode={c.statusCode} />
              {c.errorMessage && (
                <span className="text-xs text-destructive">{c.errorMessage}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {selectedAlert && (
        <AlertDetailModal
          open
          alertId={selectedAlert.id}
          summary={selectedAlert}
          canEdit={canEdit}
          onClose={() => setSelectedAlert(null)}
          onUpdated={async () => {
            loadStability();
            const data = await api.getWebsiteAlertStability(website.id);
            setStability(data);
            const updated = data.active.find((a) => a.id === selectedAlert.id);
            if (updated) setSelectedAlert(updated);
            else setSelectedAlert(null);
          }}
        />
      )}

      <ConfirmDialog
        open={showDelete}
        title="Supprimer la supervision du site"
        message={`Êtes-vous sûr de vouloir supprimer la supervision de « ${website.name} » (${website.url}) ? Les vérifications et tout l'historique seront effacés. Cette action est irréversible.`}
        confirmLabel="Supprimer"
        onConfirm={handleDelete}
        onCancel={() => setShowDelete(false)}
        loading={deleting}
      />
    </div>
  );
}
