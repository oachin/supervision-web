'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Boxes, Server } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { api, type ProxmoxVmMetric, type ProxmoxVmWithServer } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';

const VM_RANGES = [
  { label: '1h', key: '1h' as const, hours: 1 },
  { label: '24h', key: '24h' as const, hours: 24 },
  { label: '7d', key: '7d' as const, hours: 24 * 7 },
] as const;

type VmRange = (typeof VM_RANGES)[number]['key'];

function formatChartTime(iso: string, hours: number): string {
  const date = new Date(iso);
  if (hours <= 24) {
    return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleString('fr-FR', {
    weekday: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatChartTooltipTime(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

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

export default function VmDetailPage() {
  const params = useParams();
  const vmId = typeof params.id === 'string' ? params.id : '';
  const [vm, setVm] = useState<ProxmoxVmWithServer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vmRange, setVmRange] = useState<VmRange>('24h');
  const [metrics, setMetrics] = useState<ProxmoxVmMetric[]>([]);
  const [metricsLoading, setMetricsLoading] = useState(false);

  const rangeHours = VM_RANGES.find((r) => r.key === vmRange)?.hours ?? 24;

  useEffect(() => {
    if (!vmId) return;
    setLoading(true);
    api.getProxmoxVm(vmId)
      .then(setVm)
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'))
      .finally(() => setLoading(false));
  }, [vmId]);

  useEffect(() => {
    if (!vm) return;
    const to = new Date();
    const from = new Date(to.getTime() - rangeHours * 60 * 60 * 1000);
    setMetricsLoading(true);
    api.getProxmoxVmMetrics(vm.serverId, vm.vmid, from.toISOString(), to.toISOString())
      .then(setMetrics)
      .catch(console.error)
      .finally(() => setMetricsLoading(false));
  }, [vm, vmRange, rangeHours]);

  const chartData = useMemo(
    () =>
      metrics.map((m) => ({
        time: formatChartTime(m.collectedAt, rangeHours),
        collectedAt: m.collectedAt,
        cpu: m.cpuPercent,
        memory: m.memTotalMb > 0 ? (m.memUsedMb / m.memTotalMb) * 100 : 0,
      })),
    [metrics, rangeHours],
  );

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (error || !vm) {
    return (
      <div className="space-y-4">
        <Link href="/vms" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary">
          <ArrowLeft className="h-4 w-4" /> Retour aux VMs
        </Link>
        <p className="text-destructive">{error ?? 'VM introuvable'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/vms" className="mb-3 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary">
            <ArrowLeft className="h-4 w-4" /> Retour aux VMs
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Boxes className="h-6 w-6 text-primary" />
            {vm.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            VMID {vm.vmid} · Vue le {formatDate(vm.lastSeenAt)}
          </p>
        </div>
        <span className={cn('rounded px-3 py-1 text-sm capitalize', vmStatusClass(vm.status))}>
          {vm.status}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card">
          <p className="text-xs text-muted-foreground">vCPU</p>
          <p className="mt-1 font-mono text-2xl font-semibold">{vm.cpus}</p>
        </div>
        <div className="card">
          <p className="text-xs text-muted-foreground">RAM allouée</p>
          <p className="mt-1 font-mono text-2xl font-semibold">{formatRam(vm.maxmemMb)}</p>
        </div>
        <div className="card">
          <p className="text-xs text-muted-foreground">Disque alloué</p>
          <p className="mt-1 font-mono text-2xl font-semibold">{formatDisk(vm.maxdiskGb)}</p>
        </div>
        <div className="card">
          <p className="text-xs text-muted-foreground">Hyperviseur</p>
          <Link
            href={`/servers/${vm.serverId}`}
            className="mt-1 inline-flex items-center gap-2 font-medium hover:text-primary"
          >
            <Server className="h-4 w-4" />
            {vm.server.name}
          </Link>
          <p className="text-xs text-muted-foreground">{vm.server.hostname}</p>
        </div>
      </div>

      <div className="card">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold">Performance</h2>
          <div className="flex flex-wrap gap-2">
            {VM_RANGES.map((range) => (
              <button
                key={range.key}
                type="button"
                onClick={() => setVmRange(range.key)}
                disabled={metricsLoading}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm font-medium transition-all',
                  vmRange === range.key
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-muted-foreground hover:text-foreground',
                )}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>

        {chartData.length > 0 ? (
          <div className={cn('grid gap-6 lg:grid-cols-2', metricsLoading && 'opacity-60')}>
            <div>
              <p className="mb-2 text-sm text-muted-foreground">CPU %</p>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 33% 17%)" />
                  <XAxis dataKey="time" stroke="hsl(215 20% 55%)" fontSize={12} minTickGap={24} />
                  <YAxis stroke="hsl(215 20% 55%)" fontSize={12} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                  <Tooltip
                    contentStyle={{ background: 'hsl(222 47% 9%)', border: '1px solid hsl(217 33% 17%)', borderRadius: 8 }}
                    labelFormatter={(_, payload) => {
                      const point = payload?.[0]?.payload as { collectedAt?: string } | undefined;
                      return point?.collectedAt ? formatChartTooltipTime(point.collectedAt) : '';
                    }}
                    formatter={(value: number) => [`${value.toFixed(2)}%`, 'CPU']}
                  />
                  <Line type="monotone" dataKey="cpu" stroke="hsl(217 91% 60%)" strokeWidth={2} dot={false} name="CPU" />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div>
              <p className="mb-2 text-sm text-muted-foreground">RAM %</p>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 33% 17%)" />
                  <XAxis dataKey="time" stroke="hsl(215 20% 55%)" fontSize={12} minTickGap={24} />
                  <YAxis stroke="hsl(215 20% 55%)" fontSize={12} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                  <Tooltip
                    contentStyle={{ background: 'hsl(222 47% 9%)', border: '1px solid hsl(217 33% 17%)', borderRadius: 8 }}
                    labelFormatter={(_, payload) => {
                      const point = payload?.[0]?.payload as { collectedAt?: string } | undefined;
                      return point?.collectedAt ? formatChartTooltipTime(point.collectedAt) : '';
                    }}
                    formatter={(value: number) => [`${value.toFixed(2)}%`, 'RAM']}
                  />
                  <Line type="monotone" dataKey="memory" stroke="hsl(142 76% 45%)" strokeWidth={2} dot={false} name="RAM" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
            {metricsLoading ? (
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            ) : (
              'Aucune métrique sur cette période.'
            )}
          </div>
        )}
      </div>
    </div>
  );
}
