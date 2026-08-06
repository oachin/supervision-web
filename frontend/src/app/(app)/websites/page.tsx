'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, X, Pause, Play, Search, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, type Website } from '@/lib/api';
import { WebsiteStatusBadge, HttpCodeBadge, DnsBadge } from '@/components/ui';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { OpenExternalUrl } from '@/components/open-external-url';
import { formatDate, cn, isSiteDegraded } from '@/lib/utils';

const filterLabels: Record<string, string> = {
  alert: 'sites en alerte',
  down: 'sites hors ligne',
  degraded: 'sites dégradés',
  up: 'sites en ligne',
  disabled: 'supervision désactivée',
};

function WebsitesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const filter = searchParams.get('filter');
  const activeFilter = filter && filterLabels[filter] ? filter : 'all';
  const [websites, setWebsites] = useState<Website[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Website | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [form, setForm] = useState({ name: '', url: '', checkInterval: 60 });

  const load = () => api.getWebsites().then(setWebsites).finally(() => setLoading(false));

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await api.getWebsites().then(setWebsites);
    } catch (err) {
      console.error(err);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    await api.createWebsite(form);
    setShowForm(false);
    setForm({ name: '', url: '', checkInterval: 60 });
    load();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteWebsite(deleteTarget.id);
      setDeleteTarget(null);
      load();
    } catch (err) {
      console.error(err);
    } finally {
      setDeleting(false);
    }
  }

  async function handleToggleMonitoring(website: Website) {
    setTogglingId(website.id);
    try {
      await api.updateWebsite(website.id, { monitoringEnabled: !website.monitoringEnabled });
      load();
    } catch (err) {
      console.error(err);
    } finally {
      setTogglingId(null);
    }
  }

  function setStatusFilter(id: string) {
    if (id === 'all') {
      router.push('/websites');
      return;
    }
    router.push(`/websites?filter=${id}`);
  }

  const counts = useMemo(() => {
    let up = 0;
    let degraded = 0;
    let down = 0;
    let disabled = 0;
    for (const w of websites) {
      if (!w.monitoringEnabled) {
        disabled += 1;
        continue;
      }
      if (w.status === 'DOWN') down += 1;
      else if (isSiteDegraded(w.status, w.lastStatusCode)) degraded += 1;
      else if (w.status === 'UP') up += 1;
    }
    return { total: websites.length, up, degraded, down, disabled };
  }, [websites]);

  const filteredWebsites = useMemo(() => {
    let list = websites;
    if (activeFilter === 'disabled') {
      list = list.filter((w) => !w.monitoringEnabled);
    } else if (activeFilter === 'alert') {
      list = list.filter(
        (w) =>
          w.monitoringEnabled &&
          (w.status === 'DOWN' || isSiteDegraded(w.status, w.lastStatusCode)),
      );
    } else if (activeFilter === 'down') {
      list = list.filter((w) => w.monitoringEnabled && w.status === 'DOWN');
    } else if (activeFilter === 'degraded') {
      list = list.filter(
        (w) => w.monitoringEnabled && isSiteDegraded(w.status, w.lastStatusCode),
      );
    } else if (activeFilter === 'up') {
      list = list.filter(
        (w) =>
          w.monitoringEnabled &&
          w.status === 'UP' &&
          !isSiteDegraded(w.status, w.lastStatusCode),
      );
    }

    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;

    return list.filter((w) => {
      const haystack = [
        w.name,
        w.url,
        w.server?.name,
        w.server?.hostname,
        w.status,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [websites, activeFilter, searchQuery]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sites web</h1>
          <p className="text-sm text-muted-foreground">
            {activeFilter !== 'all' && filterLabels[activeFilter]
              ? `Filtre actif : ${filterLabels[activeFilter]}`
              : 'Surveillance externe HTTP/SSL depuis la plateforme (DNS, port 443, certificat, redirections)'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="btn-secondary"
          >
            <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
            Rafraîchir
          </button>
          <button onClick={() => setShowForm(true)} className="btn-primary">
            <Plus className="h-4 w-4" /> Ajouter
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              {
                id: 'all',
                label: 'TOTAL',
                count: counts.total,
                idle: 'border-sky-400/40 bg-sky-500/90 text-white hover:bg-sky-400',
                active: 'ring-2 ring-sky-300 ring-offset-2 ring-offset-background',
              },
              {
                id: 'up',
                label: 'EN LIGNE',
                count: counts.up,
                idle: 'border-emerald-400/40 bg-emerald-600 text-white hover:bg-emerald-500',
                active: 'ring-2 ring-emerald-300 ring-offset-2 ring-offset-background',
              },
              {
                id: 'degraded',
                label: 'DÉGRADÉS',
                count: counts.degraded,
                idle: 'border-amber-500/50 bg-amber-400 text-amber-950 hover:bg-amber-300',
                active: 'ring-2 ring-amber-200 ring-offset-2 ring-offset-background',
              },
              {
                id: 'down',
                label: 'HORS LIGNE',
                count: counts.down,
                idle: 'border-red-400/40 bg-red-600 text-white hover:bg-red-500',
                active: 'ring-2 ring-red-300 ring-offset-2 ring-offset-background',
              },
              {
                id: 'disabled',
                label: 'DÉSACTIVÉS',
                count: counts.disabled,
                idle: 'border-slate-400/40 bg-slate-500 text-white hover:bg-slate-400',
                active: 'ring-2 ring-slate-200 ring-offset-2 ring-offset-background',
              },
            ] as const
          ).map((tag) => {
            const isSelected = activeFilter === tag.id;
            const hideZero = tag.id !== 'all' && tag.count === 0 && !isSelected;
            if (hideZero) return null;
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => setStatusFilter(isSelected && tag.id !== 'all' ? 'all' : tag.id)}
                title={
                  isSelected && tag.id !== 'all'
                    ? 'Retirer le filtre'
                    : `Filtrer : ${tag.label}`
                }
                className={cn(
                  'inline-flex cursor-pointer items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide transition',
                  tag.idle,
                  isSelected && tag.active,
                )}
              >
                {tag.label} · {tag.count}
              </button>
            );
          })}
        </div>

        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            className="input pl-10 pr-10"
            placeholder="Rechercher un site (nom, URL, serveur…)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
              title="Effacer la recherche"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {!loading && searchQuery.trim() && (
        <p className="text-sm text-muted-foreground">
          {filteredWebsites.length} résultat{filteredWebsites.length !== 1 ? 's' : ''} pour « {searchQuery.trim()} »
        </p>
      )}

      {showForm && (
        <div className="card">
          <h2 className="mb-4 text-lg font-semibold">Nouveau site</h2>
          <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm">Nom</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label className="mb-1 block text-sm">URL</label>
              <input className="input" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} required placeholder="https://example.com" />
            </div>
            <div>
              <label className="mb-1 block text-sm">Intervalle (secondes)</label>
              <input type="number" className="input" value={form.checkInterval} onChange={(e) => setForm({ ...form, checkInterval: parseInt(e.target.value) })} min={30} />
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <button type="submit" className="btn-primary">Créer</button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Annuler</button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : filteredWebsites.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-muted-foreground">
            {searchQuery.trim()
              ? 'Aucun site ne correspond à votre recherche.'
              : activeFilter !== 'all'
                ? 'Aucun site ne correspond à ce filtre.'
                : 'Aucun site surveillé.'}
          </p>
          {activeFilter !== 'all' && (
            <button type="button" onClick={() => setStatusFilter('all')} className="btn-secondary mt-4 inline-flex">
              Voir tous les sites
            </button>
          )}
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-left text-muted-foreground">
                <th className="p-4 font-medium">Nom</th>
                <th className="p-4 font-medium">URL</th>
                <th className="p-4 font-medium">HTTP</th>
                <th className="p-4 font-medium">DNS</th>
                <th className="p-4 font-medium">SSL (jours)</th>
                <th className="p-4 font-medium">Dernier check</th>
                <th className="p-4 font-medium">Statut</th>
                <th className="p-4 font-medium w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredWebsites.map((w) => (
                <tr key={w.id} className={`border-b border-white/5 hover:bg-secondary/20 ${!w.monitoringEnabled ? 'opacity-60' : ''}`}>
                  <td className="p-4">
                    <div className="flex items-center gap-1.5">
                      <Link href={`/websites/${w.id}`} className="font-medium hover:text-primary">
                        {w.name}
                      </Link>
                      <OpenExternalUrl url={w.url} />
                    </div>
                  </td>
                  <td className="p-4 font-mono text-xs">{w.url}</td>
                  <td className="p-4">
                    {!w.monitoringEnabled ? (
                      <span className="text-muted-foreground">—</span>
                    ) : w.lastStatusCode != null ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <HttpCodeBadge code={w.lastStatusCode} />
                        <span className="font-mono text-xs text-muted-foreground">{w.lastResponseMs ?? '—'}ms</span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="p-4">
                    {!w.monitoringEnabled ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <DnsBadge ok={w.lastDnsOk} />
                    )}
                  </td>
                  <td className="p-4 text-xs">
                    {!w.monitoringEnabled ? '—' : w.sslDaysRemaining != null ? `${w.sslDaysRemaining}j` : formatDate(w.sslExpiresAt)}
                  </td>
                  <td className="p-4 text-xs text-muted-foreground">{formatDate(w.lastCheckAt)}</td>
                  <td className="p-4"><WebsiteStatusBadge status={w.status} monitoringEnabled={w.monitoringEnabled} lastStatusCode={w.lastStatusCode} /></td>
                  <td className="p-4">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleToggleMonitoring(w)}
                        disabled={togglingId === w.id}
                        className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
                        title={w.monitoringEnabled ? 'Désactiver la supervision' : 'Réactiver la supervision'}
                      >
                        {w.monitoringEnabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(w)}
                        className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        title="Supprimer la supervision"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Supprimer la supervision du site"
        message={
          deleteTarget
            ? `Êtes-vous sûr de vouloir supprimer la supervision de « ${deleteTarget.name} » (${deleteTarget.url}) ? Les vérifications et l'historique seront effacés. Cette action est irréversible.`
            : ''
        }
        confirmLabel="Supprimer"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
      />
    </div>
  );
}

export default function WebsitesPage() {
  return (
    <Suspense fallback={
      <div className="flex h-32 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    }>
      <WebsitesPageContent />
    </Suspense>
  );
}
