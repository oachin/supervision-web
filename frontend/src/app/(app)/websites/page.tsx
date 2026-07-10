'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { api, type Website } from '@/lib/api';
import { StatusBadge } from '@/components/ui';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { formatDate } from '@/lib/utils';

export default function WebsitesPage() {
  const [websites, setWebsites] = useState<Website[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Website | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState({ name: '', url: '', checkInterval: 60 });

  const load = () => api.getWebsites().then(setWebsites).finally(() => setLoading(false));
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sites web</h1>
          <p className="text-sm text-muted-foreground">Surveillance de disponibilité et SSL</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary">
          <Plus className="h-4 w-4" /> Ajouter
        </button>
      </div>

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
      ) : websites.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-muted-foreground">Aucun site surveillé.</p>
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-left text-muted-foreground">
                <th className="p-4 font-medium">Nom</th>
                <th className="p-4 font-medium">URL</th>
                <th className="p-4 font-medium">Réponse</th>
                <th className="p-4 font-medium">SSL expire</th>
                <th className="p-4 font-medium">Dernier check</th>
                <th className="p-4 font-medium">Statut</th>
                <th className="p-4 font-medium w-12"></th>
              </tr>
            </thead>
            <tbody>
              {websites.map((w) => (
                <tr key={w.id} className="border-b border-white/5 hover:bg-secondary/20">
                  <td className="p-4">
                    <Link href={`/websites/${w.id}`} className="font-medium hover:text-primary">{w.name}</Link>
                  </td>
                  <td className="p-4 font-mono text-xs">{w.url}</td>
                  <td className="p-4 font-mono text-xs">{w.lastResponseMs != null ? `${w.lastResponseMs}ms` : '—'}</td>
                  <td className="p-4 text-xs">{formatDate(w.sslExpiresAt)}</td>
                  <td className="p-4 text-xs text-muted-foreground">{formatDate(w.lastCheckAt)}</td>
                  <td className="p-4"><StatusBadge status={w.status} /></td>
                  <td className="p-4">
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(w)}
                      className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      title="Supprimer la supervision"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
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
