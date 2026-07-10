'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Trash2, Pencil, Check, Copy, Terminal } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { api, type ServerDetail, type ServerMetric } from '@/lib/api';
import { StatusBadge } from '@/components/ui';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { formatDate } from '@/lib/utils';

export default function ServerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [server, setServer] = useState<ServerDetail | null>(null);
  const [metrics, setMetrics] = useState<ServerMetric[]>([]);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [installCommand, setInstallCommand] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.getServer(id).then(setServer);
    api.getServerMetrics(id, 24).then(setMetrics);
  }, [id]);

  if (!server) {
    return <div className="flex h-32 items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>;
  }

  const latest = server.metrics?.[0];
  const chartData = metrics.map((m) => ({
    time: new Date(m.collectedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
    cpu: m.cpuPercent,
    memory: m.memoryPercent,
    disk: m.diskPercent,
  }));

  async function handleDelete() {
    if (!id) return;
    setDeleting(true);
    try {
      await api.deleteServer(id);
      router.push('/servers');
    } catch (err) {
      console.error(err);
      setDeleting(false);
    }
  }

  async function saveName() {
    if (!id || !nameDraft.trim()) return;
    const updated = await api.updateServer(id, { name: nameDraft.trim() });
    setServer({ ...server!, ...updated });
    setEditingName(false);
  }

  async function regenerateInstall() {
    if (!id) return;
    const result = await api.regenerateServerKey(id);
    setInstallCommand(result.installCommand);
  }

  function copyInstall() {
    if (installCommand) {
      navigator.clipboard.writeText(installCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                className="input text-xl font-bold"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                autoFocus
              />
              <button type="button" onClick={saveName} className="btn-primary p-2">
                <Check className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{server.name}</h1>
              <button
                type="button"
                onClick={() => { setNameDraft(server.name); setEditingName(true); }}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary/50"
                title="Renommer"
              >
                <Pencil className="h-4 w-4" />
              </button>
            </div>
          )}
          <p className="font-mono text-sm text-muted-foreground">
            {server.hostname === 'en-attente' ? 'Hostname détecté à la connexion' : server.hostname}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Profil : {server.profile === 'PLESK' ? 'Plesk' : 'Linux'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={server.status} />
          <button type="button" onClick={() => setShowDelete(true)} className="btn-danger text-sm">
            <Trash2 className="h-4 w-4" /> Supprimer
          </button>
        </div>
      </div>

      {(server.status === 'UNKNOWN' || installCommand) && (
        <div className="card border-accent/30 bg-accent/5">
          <div className="flex items-start gap-3">
            <Terminal className="h-5 w-5 text-accent mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold">Agent non connecté</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Installez l&apos;agent sur le serveur distant avec wget (en root).
              </p>
              {installCommand ? (
                <>
                  <pre className="mt-3 rounded-lg bg-muted/50 p-3 text-xs overflow-x-auto">{installCommand}</pre>
                  <button onClick={copyInstall} className="btn-secondary text-sm mt-2">
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    Copier
                  </button>
                </>
              ) : (
                <button onClick={regenerateInstall} className="btn-secondary text-sm mt-3">
                  Générer une nouvelle commande wget
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {latest && (
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { label: 'CPU', value: `${latest.cpuPercent.toFixed(1)}%` },
            { label: 'Mémoire', value: `${latest.memoryPercent.toFixed(1)}%` },
            { label: 'Disque', value: `${latest.diskPercent.toFixed(1)}%` },
          ].map((m) => (
            <div key={m.label} className="card text-center">
              <p className="text-sm text-muted-foreground">{m.label}</p>
              <p className="mt-1 text-2xl font-bold">{m.value}</p>
            </div>
          ))}
        </div>
      )}

      {chartData.length > 0 && (
        <div className="card">
          <h2 className="mb-4 text-lg font-semibold">Métriques (24h)</h2>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 33% 17%)" />
              <XAxis dataKey="time" stroke="hsl(215 20% 55%)" fontSize={12} />
              <YAxis stroke="hsl(215 20% 55%)" fontSize={12} domain={[0, 100]} />
              <Tooltip
                contentStyle={{ background: 'hsl(222 47% 9%)', border: '1px solid hsl(217 33% 17%)', borderRadius: 8 }}
              />
              <Line type="monotone" dataKey="cpu" stroke="hsl(217 91% 60%)" strokeWidth={2} dot={false} name="CPU %" />
              <Line type="monotone" dataKey="memory" stroke="hsl(142 76% 45%)" strokeWidth={2} dot={false} name="RAM %" />
              <Line type="monotone" dataKey="disk" stroke="hsl(38 92% 50%)" strokeWidth={2} dot={false} name="Disque %" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {server.websites.length > 0 && (
        <div className="card">
          <h2 className="mb-4 text-lg font-semibold">Sites hébergés</h2>
          <div className="space-y-2">
            {server.websites.map((w) => (
              <div key={w.id} className="flex items-center justify-between rounded-lg border border-white/5 p-3">
                <div>
                  <p className="font-medium">{w.name}</p>
                  <p className="text-xs text-muted-foreground">{w.url}</p>
                </div>
                <StatusBadge status={w.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card text-sm text-muted-foreground">
        <p>Dernier signal : {formatDate(server.lastSeenAt)}</p>
        {server.osVersion && <p>OS : {server.osVersion}</p>}
        {server.notes && <p>Notes : {server.notes}</p>}
      </div>

      <ConfirmDialog
        open={showDelete}
        title="Supprimer la supervision du serveur"
        message={`Êtes-vous sûr de vouloir supprimer la supervision de « ${server.name} » ? L'agent ne pourra plus envoyer de métriques et tout l'historique sera effacé. Cette action est irréversible.`}
        confirmLabel="Supprimer"
        onConfirm={handleDelete}
        onCancel={() => setShowDelete(false)}
        loading={deleting}
      />
    </div>
  );
}
