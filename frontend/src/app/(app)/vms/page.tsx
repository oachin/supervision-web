'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Boxes, RefreshCw, Search, X } from 'lucide-react';
import { api, type ProxmoxVmWithServer } from '@/lib/api';
import { StatusSummaryBanner } from '@/components/status-summary-banner';
import { cn, formatDate } from '@/lib/utils';

function vmStatusClass(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === 'running') return 'badge-success';
  if (normalized === 'stopped') return 'badge-muted';
  return 'badge-warning';
}

function formatRam(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)} Go`;
  return `${Math.round(mb)} Mo`;
}

function formatDisk(gb: number): string {
  if (gb >= 1024) return `${(gb / 1024).toFixed(gb >= 10240 ? 0 : 1)} To`;
  return `${gb % 1 === 0 ? gb.toFixed(0) : gb.toFixed(1)} Go`;
}

type VmStatusFilter = 'all' | 'running' | 'stopped' | 'other';

const filterLabels: Record<VmStatusFilter, string> = {
  all: 'toutes les VMs',
  running: 'VMs en cours',
  stopped: 'VMs arrêtées',
  other: 'autres états',
};

export default function VmsPage() {
  const [vms, setVms] = useState<ProxmoxVmWithServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<VmStatusFilter>('all');

  async function load() {
    const data = await api.getAllProxmoxVms();
    setVms(data);
  }

  useEffect(() => {
    load()
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await load();
    } catch (err) {
      console.error(err);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }

  const counts = useMemo(() => {
    let running = 0;
    let stopped = 0;
    let other = 0;
    for (const vm of vms) {
      const status = vm.status.toLowerCase();
      if (status === 'running') running += 1;
      else if (status === 'stopped') stopped += 1;
      else other += 1;
    }
    return { total: vms.length, running, stopped, other };
  }, [vms]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return vms.filter((vm) => {
      const status = vm.status.toLowerCase();
      if (statusFilter === 'running' && status !== 'running') return false;
      if (statusFilter === 'stopped' && status !== 'stopped') return false;
      if (statusFilter === 'other' && (status === 'running' || status === 'stopped')) return false;
      if (!q) return true;
      return (
        vm.name.toLowerCase().includes(q) ||
        String(vm.vmid).includes(q) ||
        vm.server.name.toLowerCase().includes(q) ||
        vm.server.hostname.toLowerCase().includes(q)
      );
    });
  }, [vms, query, statusFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Boxes className="h-6 w-6 text-primary" />
            VMs
          </h1>
          <p className="text-sm text-muted-foreground">
            {statusFilter !== 'all'
              ? `Filtre actif : ${filterLabels[statusFilter]}`
              : 'Machines virtuelles QEMU remontées par les hyperviseurs Proxmox'}
          </p>
        </div>
        <button type="button" onClick={handleRefresh} disabled={refreshing} className="btn-secondary">
          <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
          Rafraîchir
        </button>
      </div>

      <StatusSummaryBanner
        activeId={statusFilter}
        onSelect={(id) => setStatusFilter(id as VmStatusFilter)}
        tiles={[
          { id: 'all', label: 'Total', count: counts.total, tone: 'default' },
          { id: 'running', label: 'Running', count: counts.running, tone: 'success' },
          { id: 'stopped', label: 'Stopped', count: counts.stopped, tone: 'muted' },
          { id: 'other', label: 'Autres', count: counts.other, tone: 'warning' },
        ]}
      />

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          className="input pl-10 pr-10"
          placeholder="Rechercher nom, VMID, serveur…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
            title="Effacer la recherche"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="card overflow-x-auto p-0">
        {loading ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Chargement…</p>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-muted-foreground">
              {vms.length === 0
                ? 'Aucune VM Proxmox. Ajoutez un serveur profil Proxmox et installez l’agent.'
                : 'Aucun résultat pour ce filtre.'}
            </p>
            {statusFilter !== 'all' && vms.length > 0 && (
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className="btn-secondary mt-4 inline-flex"
              >
                Voir toutes les VMs
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">VMID</th>
                <th className="px-4 py-3 font-medium">Nom</th>
                <th className="px-4 py-3 font-medium">État</th>
                <th className="px-4 py-3 font-medium">Hyperviseur</th>
                <th className="px-4 py-3 font-medium">vCPU</th>
                <th className="px-4 py-3 font-medium">RAM</th>
                <th className="px-4 py-3 font-medium">Disque</th>
                <th className="px-4 py-3 font-medium">Vu</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((vm) => (
                <tr key={vm.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                  <td className="px-4 py-3 font-mono text-muted-foreground">{vm.vmid}</td>
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/vms/${vm.id}`} className="hover:text-primary hover:underline">
                      {vm.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('rounded px-2 py-0.5 text-xs capitalize', vmStatusClass(vm.status))}>
                      {vm.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/servers/${vm.serverId}`} className="text-muted-foreground hover:text-primary hover:underline">
                      {vm.server.name}
                    </Link>
                    <div className="text-xs text-muted-foreground/70">{vm.server.hostname}</div>
                  </td>
                  <td className="px-4 py-3 font-mono">{vm.cpus}</td>
                  <td className="px-4 py-3 font-mono">{formatRam(vm.maxmemMb)}</td>
                  <td className="px-4 py-3 font-mono">{formatDisk(vm.maxdiskGb)}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(vm.lastSeenAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
