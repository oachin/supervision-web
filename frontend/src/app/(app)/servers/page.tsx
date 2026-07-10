'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { Plus, Copy, Check, Trash2, Terminal, X } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api, type Server, type ServerCreateResult } from '@/lib/api';
import { StatusBadge } from '@/components/ui';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { formatDate } from '@/lib/utils';

const profileLabels: Record<string, string> = {
  LINUX: 'Linux',
  PLESK: 'Plesk',
};

const filterLabels: Record<string, string> = {
  alert: 'serveurs en alerte',
  degraded: 'serveurs dégradés',
  offline: 'serveurs hors ligne',
};

function ServersPageContent() {
  const searchParams = useSearchParams();
  const filter = searchParams.get('filter');
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [installInfo, setInstallInfo] = useState<ServerCreateResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Server | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState({
    name: '',
    profile: 'LINUX' as 'LINUX' | 'PLESK',
    notes: '',
  });

  const load = () => api.getServers().then(setServers).finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const result = await api.createServer({
      name: form.name.trim() || undefined,
      profile: form.profile,
      notes: form.notes || undefined,
    });
    setInstallInfo(result);
    setShowForm(false);
    setForm({ name: '', profile: 'LINUX', notes: '' });
    load();
  }

  function copyCommand() {
    if (installInfo?.installCommand) {
      navigator.clipboard.writeText(installInfo.installCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteServer(deleteTarget.id);
      setDeleteTarget(null);
      load();
    } catch (err) {
      console.error(err);
    } finally {
      setDeleting(false);
    }
  }

  const filteredServers = useMemo(() => {
    if (filter === 'alert') {
      return servers.filter((s) => s.status === 'OFFLINE' || s.status === 'DEGRADED');
    }
    if (filter === 'degraded') return servers.filter((s) => s.status === 'DEGRADED');
    if (filter === 'offline') return servers.filter((s) => s.status === 'OFFLINE');
    return servers;
  }, [servers, filter]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Serveurs</h1>
          <p className="text-sm text-muted-foreground">
            {filter && filterLabels[filter]
              ? `Filtre actif : ${filterLabels[filter]}`
              : 'Installez l\'agent via wget depuis chaque serveur distant'}
          </p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary">
          <Plus className="h-4 w-4" /> Ajouter
        </button>
      </div>

      {filter && (
        <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          <span>Affichage filtré : {filterLabels[filter] ?? filter} ({filteredServers.length})</span>
          <Link href="/servers" className="inline-flex items-center gap-1 text-primary hover:underline">
            <X className="h-4 w-4" /> Tout afficher
          </Link>
        </div>
      )}

      {installInfo && (
        <div className="card border-accent/30 bg-accent/5">
          <div className="flex items-start gap-3">
            <Terminal className="h-5 w-5 text-accent mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-accent">
                Installation agent — profil {profileLabels[installInfo.profile] ?? installInfo.profile}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Exécutez cette commande <strong>en root</strong> sur le serveur distant. Il apparaîtra automatiquement
                dans la console (nom modifiable ensuite).
              </p>
              <pre className="mt-3 rounded-lg bg-muted/50 p-3 text-xs overflow-x-auto whitespace-pre-wrap break-all">
                {installInfo.installCommand}
              </pre>
              <p className="mt-2 text-xs text-muted-foreground">
                Alternative curl :{' '}
                <code className="text-foreground">curl -fsSL &quot;{installInfo.installUrl}&quot; | sudo bash</code>
              </p>
              {installInfo.profile === 'PLESK' && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Le profil Plesk importe automatiquement tous les domaines hébergés comme sites web supervisés.
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <button onClick={copyCommand} className="btn-secondary text-sm">
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  Copier la commande
                </button>
                <button onClick={() => setInstallInfo(null)} className="btn-ghost text-sm">Fermer</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div className="card">
          <h2 className="mb-4 text-lg font-semibold">Nouveau serveur</h2>
          <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-2 block text-sm font-medium">Profil agent</label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className={`card cursor-pointer border-2 p-4 transition-colors ${form.profile === 'LINUX' ? 'border-primary bg-primary/5' : 'border-white/10 hover:border-white/20'}`}>
                  <input
                    type="radio"
                    name="profile"
                    value="LINUX"
                    checked={form.profile === 'LINUX'}
                    onChange={() => setForm({ ...form, profile: 'LINUX' })}
                    className="sr-only"
                  />
                  <p className="font-medium">Linux (défaut)</p>
                  <p className="mt-1 text-xs text-muted-foreground">Métriques CPU, RAM, disque, uptime</p>
                </label>
                <label className={`card cursor-pointer border-2 p-4 transition-colors ${form.profile === 'PLESK' ? 'border-primary bg-primary/5' : 'border-white/10 hover:border-white/20'}`}>
                  <input
                    type="radio"
                    name="profile"
                    value="PLESK"
                    checked={form.profile === 'PLESK'}
                    onChange={() => setForm({ ...form, profile: 'PLESK' })}
                    className="sr-only"
                  />
                  <p className="font-medium">Serveur Plesk</p>
                  <p className="mt-1 text-xs text-muted-foreground">Métriques + import auto des sites hébergés</p>
                </label>
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm">Nom d&apos;affichage (optionnel)</label>
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Modifiable après connexion de l'agent"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm">Notes</label>
              <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <button type="submit" className="btn-primary">Générer la commande wget</button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Annuler</button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : filteredServers.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-muted-foreground">
            {filter ? 'Aucun serveur ne correspond à ce filtre.' : 'Aucun serveur. Ajoutez un serveur et installez l\'agent via wget.'}
          </p>
          {filter && (
            <Link href="/servers" className="btn-secondary mt-4 inline-flex">Voir tous les serveurs</Link>
          )}
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-left text-muted-foreground">
                <th className="p-4 font-medium">Nom</th>
                <th className="p-4 font-medium">Hostname</th>
                <th className="p-4 font-medium">Profil</th>
                <th className="p-4 font-medium">OS</th>
                <th className="p-4 font-medium">Dernier signal</th>
                <th className="p-4 font-medium">Statut</th>
                <th className="p-4 font-medium w-12"></th>
              </tr>
            </thead>
            <tbody>
              {filteredServers.map((s) => (
                <tr key={s.id} className="border-b border-white/5 hover:bg-secondary/20 transition-colors">
                  <td className="p-4">
                    <Link href={`/servers/${s.id}`} className="font-medium hover:text-primary">{s.name}</Link>
                  </td>
                  <td className="p-4 font-mono text-xs">{s.hostname === 'en-attente' ? '—' : s.hostname}</td>
                  <td className="p-4">
                    <span className="badge-muted">{profileLabels[s.profile] ?? s.profile}</span>
                  </td>
                  <td className="p-4 text-xs">{s.osVersion || '—'}</td>
                  <td className="p-4 text-xs text-muted-foreground">{formatDate(s.lastSeenAt)}</td>
                  <td className="p-4"><StatusBadge status={s.status} /></td>
                  <td className="p-4">
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(s)}
                      className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      title="Supprimer"
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
        title="Supprimer la supervision du serveur"
        message={
          deleteTarget
            ? `Supprimer « ${deleteTarget.name} » ? L'agent sera déconnecté et l'historique effacé.`
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

export default function ServersPage() {
  return (
    <Suspense fallback={
      <div className="flex h-32 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    }>
      <ServersPageContent />
    </Suspense>
  );
}
