'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { api, type WebsiteDetail } from '@/lib/api';
import { StatusBadge } from '@/components/ui';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { formatDate } from '@/lib/utils';

export default function WebsiteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [website, setWebsite] = useState<WebsiteDetail | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (id) api.getWebsite(id).then(setWebsite);
  }, [id]);

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{website.name}</h1>
          <p className="font-mono text-sm text-muted-foreground">{website.url}</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={website.status} />
          <button
            type="button"
            onClick={() => setShowDelete(true)}
            className="btn-danger text-sm"
          >
            <Trash2 className="h-4 w-4" /> Supprimer
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <div className="card text-center">
          <p className="text-sm text-muted-foreground">Temps de réponse</p>
          <p className="mt-1 text-2xl font-bold">{website.lastResponseMs ?? '—'}<span className="text-sm font-normal">ms</span></p>
        </div>
        <div className="card text-center">
          <p className="text-sm text-muted-foreground">Code HTTP</p>
          <p className="mt-1 text-2xl font-bold">{website.lastStatusCode ?? '—'}</p>
        </div>
        <div className="card text-center">
          <p className="text-sm text-muted-foreground">Intervalle</p>
          <p className="mt-1 text-2xl font-bold">{website.checkInterval}<span className="text-sm font-normal">s</span></p>
        </div>
        <div className="card text-center">
          <p className="text-sm text-muted-foreground">SSL expire</p>
          <p className="mt-1 text-lg font-bold">{formatDate(website.sslExpiresAt)}</p>
        </div>
      </div>

      <div className="card">
        <h2 className="mb-4 text-lg font-semibold">Historique des vérifications</h2>
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {website.checks.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-lg border border-white/5 px-3 py-2 text-sm">
              <span className="text-muted-foreground">{formatDate(c.checkedAt)}</span>
              <span className="font-mono">{c.responseMs ?? '—'}ms</span>
              <span className="font-mono">{c.statusCode ?? '—'}</span>
              <StatusBadge status={c.status} />
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
