'use client';

import { useEffect, useState } from 'react';
import { Plus, Copy, Check, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { api, type Server } from '@/lib/api';
import { StatusBadge } from '@/components/ui';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { formatDate } from '@/lib/utils';

export default function ServersPage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [agentKey, setAgentKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Server | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState({ name: '', hostname: '', ipAddress: '', hasPlesk: false, notes: '' });

  const load = () => api.getServers().then(setServers).finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const result = await api.createServer(form);
    setAgentKey(result.agentKeyPlain);
    setShowForm(false);
    setForm({ name: '', hostname: '', ipAddress: '', hasPlesk: false, notes: '' });
    load();
  }

  function copyKey() {
    if (agentKey) {
      navigator.clipboard.writeText(agentKey);
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Serveurs</h1>
          <p className="text-sm text-muted-foreground">Gérez vos serveurs Linux hébergement</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary">
          <Plus className="h-4 w-4" /> Ajouter
        </button>
      </div>

      {agentKey && (
        <div className="card border-accent/30 bg-accent/5">
          <h3 className="font-semibold text-accent">Clé agent générée</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Installez l&apos;agent sur le serveur avec cette clé. Elle ne sera plus affichée.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 rounded-lg bg-muted/50 p-3 font-mono text-xs break-all">{agentKey}</code>
            <button onClick={copyKey} className="btn-secondary">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          <pre className="mt-3 rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground overflow-x-auto">
{`SUPERVISION_API_URL=https://votre-supervision.fr/api \\
SUPERVISION_AGENT_KEY=${agentKey} \\
bash install.sh`}
          </pre>
          <button onClick={() => setAgentKey(null)} className="btn-ghost mt-3 text-sm">Fermer</button>
        </div>
      )}

      {showForm && (
        <div className="card">
          <h2 className="mb-4 text-lg font-semibold">Nouveau serveur</h2>
          <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm">Nom</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label className="mb-1 block text-sm">Hostname</label>
              <input className="input" value={form.hostname} onChange={(e) => setForm({ ...form, hostname: e.target.value })} required placeholder="srv01.example.com" />
            </div>
            <div>
              <label className="mb-1 block text-sm">IP (optionnel)</label>
              <input className="input" value={form.ipAddress} onChange={(e) => setForm({ ...form, ipAddress: e.target.value })} placeholder="192.168.1.10" />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.hasPlesk} onChange={(e) => setForm({ ...form, hasPlesk: e.target.checked })} className="rounded" />
                Serveur Plesk
              </label>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm">Notes</label>
              <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
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
      ) : servers.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-muted-foreground">Aucun serveur. Ajoutez votre premier serveur pour commencer.</p>
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-left text-muted-foreground">
                <th className="p-4 font-medium">Nom</th>
                <th className="p-4 font-medium">Hostname</th>
                <th className="p-4 font-medium">OS</th>
                <th className="p-4 font-medium">Plesk</th>
                <th className="p-4 font-medium">Dernier signal</th>
                <th className="p-4 font-medium">Statut</th>
                <th className="p-4 font-medium w-12"></th>
              </tr>
            </thead>
            <tbody>
              {servers.map((s) => (
                <tr key={s.id} className="border-b border-white/5 hover:bg-secondary/20 transition-colors">
                  <td className="p-4">
                    <Link href={`/servers/${s.id}`} className="font-medium hover:text-primary">{s.name}</Link>
                  </td>
                  <td className="p-4 font-mono text-xs">{s.hostname}</td>
                  <td className="p-4 text-xs">{s.osVersion || 'Linux'}</td>
                  <td className="p-4">{s.hasPlesk ? '✓' : '—'}</td>
                  <td className="p-4 text-xs text-muted-foreground">{formatDate(s.lastSeenAt)}</td>
                  <td className="p-4"><StatusBadge status={s.status} /></td>
                  <td className="p-4">
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(s)}
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
        title="Supprimer la supervision du serveur"
        message={
          deleteTarget
            ? `Êtes-vous sûr de vouloir supprimer la supervision de « ${deleteTarget.name} » (${deleteTarget.hostname}) ? L'agent ne pourra plus envoyer de métriques et l'historique sera effacé. Cette action est irréversible.`
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
