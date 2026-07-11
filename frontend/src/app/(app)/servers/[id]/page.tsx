'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Trash2, Pencil, Check, Copy, Terminal } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { api, type ServerDetail, type ServerMetric } from '@/lib/api';
import { StatusBadge } from '@/components/ui';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { TagEditor } from '@/components/tag-editor';
import { formatDate, formatCpuPercent, cn } from '@/lib/utils';

type ChartMetric = 'cpu' | 'memory' | 'disk' | 'load';

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
  const [regenerating, setRegenerating] = useState(false);
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);
  const [chartFilter, setChartFilter] = useState<ChartMetric | null>(null);

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

  const latest = metrics[0] ?? server.metrics?.[0];
  const pleskServices = latest?.pleskServices;
  const chartData = metrics.map((m) => ({
    time: new Date(m.collectedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
    cpu: m.cpuPercent,
    memory: m.memoryPercent,
    disk: m.diskPercent,
    load: m.loadAvg1,
  }));
  const loadChartMax = Math.max(1, ...chartData.map((d) => d.load), 0.1);

  function toggleChartFilter(metric: ChartMetric) {
    setChartFilter((current) => (current === metric ? null : metric));
  }

  const showCpu = chartFilter === null || chartFilter === 'cpu';
  const showMemory = chartFilter === null || chartFilter === 'memory';
  const showDisk = chartFilter === null || chartFilter === 'disk';
  const showLoad = chartFilter === 'load';
  const yDomain: [number, number] = showLoad ? [0, loadChartMax] : [0, 100];

  const chartCaption = chartFilter === null
    ? 'CPU, RAM et disque — échelle unique 0–100 %.'
    : chartFilter === 'cpu'
      ? 'CPU uniquement — échelle 0–100 %. Recliquez la tuile pour tout afficher.'
      : chartFilter === 'memory'
        ? 'Mémoire uniquement — échelle 0–100 %. Recliquez la tuile pour tout afficher.'
        : chartFilter === 'disk'
          ? 'Disque uniquement — échelle 0–100 %. Recliquez la tuile pour tout afficher.'
          : `Charge (1 min) uniquement — échelle 0–${loadChartMax.toFixed(2)}. Recliquez la tuile pour tout afficher.`;

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

  async function saveTags(tags: string[]) {
    if (!id || !server) return;
    const updated = await api.updateServer(id, { tags });
    setServer({ ...server, ...updated });
  }

  async function regenerateInstall() {
    if (!id) return;
    setRegenerating(true);
    try {
      const result = await api.regenerateServerKey(id);
      setInstallCommand(result.installCommand);
      setShowRegenerateConfirm(false);
    } catch (err) {
      console.error(err);
    } finally {
      setRegenerating(false);
    }
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
          <div className="mt-4 max-w-lg">
            <TagEditor
              tags={server.tags ?? []}
              onSave={saveTags}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <StatusBadge status={server.status} />
          <button type="button" onClick={() => setShowDelete(true)} className="btn-danger text-sm">
            <Trash2 className="h-4 w-4" /> Supprimer
          </button>
          <button
            type="button"
            onClick={() => setShowRegenerateConfirm(true)}
            className="btn-secondary text-sm"
            disabled={regenerating}
          >
            <Terminal className="h-4 w-4" />
            Générer la commande wget
          </button>
        </div>
      </div>

      {installCommand && (
        <div className="card border-accent/30 bg-accent/5">
          <div className="flex items-start gap-3">
            <Terminal className="h-5 w-5 text-accent mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold">Commande d&apos;installation agent</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Exécutez en root sur le serveur distant. Une nouvelle clé invalide l&apos;ancienne.
              </p>
              <pre className="mt-3 rounded-lg bg-muted/50 p-3 text-xs overflow-x-auto whitespace-pre-wrap break-all">{installCommand}</pre>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={copyInstall} className="btn-secondary text-sm">
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  Copier
                </button>
                <button type="button" onClick={() => setShowRegenerateConfirm(true)} className="btn-ghost text-sm">
                  Régénérer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {latest && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {([
            { key: 'cpu' as const, label: 'CPU', value: formatCpuPercent(latest.cpuPercent) },
            {
              key: 'memory' as const,
              label: 'Mémoire',
              value: `${latest.memoryPercent.toFixed(1)}%`,
              sub: latest.memoryTotalMb ? `${Math.round(latest.memoryUsedMb ?? 0)} / ${Math.round(latest.memoryTotalMb)} Mo` : undefined,
            },
            {
              key: 'disk' as const,
              label: 'Disque',
              value: `${latest.diskPercent.toFixed(1)}%`,
              sub: latest.diskTotalGb ? `${(latest.diskUsedGb ?? 0).toFixed(0)} / ${latest.diskTotalGb.toFixed(0)} Go` : undefined,
            },
            { key: 'load' as const, label: 'Charge (1 min)', value: latest.loadAvg1?.toFixed(2) ?? '—' },
          ]).map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => toggleChartFilter(m.key)}
              className={cn(
                'card text-center transition-colors hover:border-primary/30',
                chartFilter === m.key && 'border-primary/50 ring-1 ring-primary/30 bg-primary/5',
              )}
              title={chartFilter === m.key ? 'Recliquer pour afficher toutes les métriques' : `Afficher uniquement ${m.label}`}
            >
              <p className="text-sm text-muted-foreground">{m.label}</p>
              <p className="mt-1 text-2xl font-bold">{m.value}</p>
              {'sub' in m && m.sub && <p className="mt-1 text-xs text-muted-foreground">{m.sub}</p>}
            </button>
          ))}
        </div>
      )}

      {chartData.length > 0 && (
        <div className="card">
          <h2 className="mb-4 text-lg font-semibold">
            Métriques (24h)
            {chartFilter && (
              <span className="ml-2 text-sm font-normal text-primary">
                — filtre actif
              </span>
            )}
          </h2>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 33% 17%)" />
              <XAxis dataKey="time" stroke="hsl(215 20% 55%)" fontSize={12} />
              <YAxis
                stroke="hsl(215 20% 55%)"
                fontSize={12}
                domain={yDomain}
                tickFormatter={(v) => (showLoad ? v.toFixed(2) : `${v}%`)}
              />
              <Tooltip
                contentStyle={{ background: 'hsl(222 47% 9%)', border: '1px solid hsl(217 33% 17%)', borderRadius: 8 }}
                formatter={(value: number, name: string) => {
                  if (name === 'Charge') return [value.toFixed(2), name];
                  return [`${value.toFixed(2)}%`, name];
                }}
              />
              {showCpu && (
                <Line type="monotone" dataKey="cpu" stroke="hsl(217 91% 60%)" strokeWidth={2} dot={false} name="CPU %" />
              )}
              {showMemory && (
                <Line type="monotone" dataKey="memory" stroke="hsl(142 76% 45%)" strokeWidth={2} dot={false} name="RAM %" />
              )}
              {showDisk && (
                <Line type="monotone" dataKey="disk" stroke="hsl(38 92% 50%)" strokeWidth={2} dot={false} name="Disque %" />
              )}
              {showLoad && (
                <Line type="monotone" dataKey="load" stroke="hsl(280 70% 60%)" strokeWidth={2} dot={false} name="Charge" />
              )}
            </LineChart>
          </ResponsiveContainer>
          <p className="mt-2 text-xs text-muted-foreground">{chartCaption}</p>
        </div>
      )}

      {server.profile === 'PLESK' && pleskServices && Object.keys(pleskServices).length > 0 && (
        <div className="card">
          <h2 className="mb-4 text-lg font-semibold">Services Plesk</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(pleskServices).map(([name, state]) => (
              <div key={name} className="flex items-center justify-between rounded-lg border border-white/5 px-3 py-2">
                <span className="font-mono text-sm">{name}</span>
                <StatusBadge status={state === 'running' ? 'ONLINE' : 'OFFLINE'} />
              </div>
            ))}
          </div>
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
        open={showRegenerateConfirm}
        title="Générer la commande wget"
        message={
          server.status === 'UNKNOWN'
            ? 'Une nouvelle clé agent sera créée. Copiez la commande et exécutez-la en root sur le serveur distant.'
            : 'Une nouvelle clé sera générée : l\'agent actuel cessera de fonctionner jusqu\'à réinstallation avec la nouvelle commande. Continuer ?'
        }
        confirmLabel="Générer"
        onConfirm={regenerateInstall}
        onCancel={() => setShowRegenerateConfirm(false)}
        loading={regenerating}
      />

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
