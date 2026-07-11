'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Trash2, Pause, Play } from 'lucide-react';
import { api, type WebsiteDetail } from '@/lib/api';
import { WebsiteStatusBadge } from '@/components/ui';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { formatDate } from '@/lib/utils';

export default function WebsiteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [website, setWebsite] = useState<WebsiteDetail | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    if (id) api.getWebsite(id).then(setWebsite);
  }, [id]);

  async function handleToggleMonitoring() {
    if (!website) return;
    setToggling(true);
    try {
      const updated = await api.updateWebsite(website.id, { monitoringEnabled: !website.monitoringEnabled });
      setWebsite({ ...website, ...updated });
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
    return <div className="flex h-32 items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">{website.name}</h1>
          <p className="font-mono text-sm text-muted-foreground">{website.url}</p>
          <p className="text-xs text-muted-foreground mt-1">Supervision externe HTTP/SSL</p>
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
                <><Pause className="h-4 w-4" /> Désactiver</>
              ) : (
                <><Play className="h-4 w-4" /> Réactiver</>
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
            {website.lastPort443Open == null ? '—' : website.lastPort443Open ? '443 ouvert' : '443 fermé'}
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
          <p className="text-xs text-muted-foreground">Seuil alerte : {website.sslAlertDays ?? 15}j</p>
        </div>
      </div>

      {(website.sslIssuer || website.sslSubject) && (
        <div className="card text-sm space-y-1">
          {website.sslIssuer && <p><span className="text-muted-foreground">Émetteur :</span> {website.sslIssuer}</p>}
          {website.sslSubject && <p><span className="text-muted-foreground">Sujet :</span> {website.sslSubject}</p>}
        </div>
      )}

      <div className="card">
        <h2 className="mb-4 text-lg font-semibold">Historique des vérifications</h2>
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {website.checks.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-white/5 px-3 py-2 text-sm">
              <span className="text-muted-foreground">{formatDate(c.checkedAt)}</span>
              <span className="font-mono">{c.responseMs ?? '—'}ms</span>
              <span className="font-mono">HTTP {c.statusCode ?? '—'}</span>
              <span className="text-xs">{c.dnsOk === false ? 'DNS FAIL' : c.dnsOk ? 'DNS OK' : ''}</span>
              <span className="text-xs">{c.tlsVersion ?? ''}</span>
              <span className="text-xs">{c.sslDaysRemaining != null ? `SSL ${c.sslDaysRemaining}j` : ''}</span>
              <WebsiteStatusBadge status={c.status} lastStatusCode={c.statusCode} />
              {c.errorMessage && <span className="text-xs text-destructive">{c.errorMessage}</span>}
            </div>
          ))}
        </div>
      </div>

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
