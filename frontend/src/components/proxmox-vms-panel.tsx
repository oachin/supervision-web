'use client';

import { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { api, type ProxmoxVm, type ProxmoxVmMetric } from '@/lib/api';
import { cn } from '@/lib/utils';

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

export function ProxmoxVmsPanel({
  serverId,
  vms,
}: {
  serverId: string;
  vms: ProxmoxVm[];
}) {
  const [selectedVmid, setSelectedVmid] = useState<number | null>(null);
  const [vmRange, setVmRange] = useState<VmRange>('24h');
  const [vmMetrics, setVmMetrics] = useState<ProxmoxVmMetric[]>([]);
  const [metricsLoading, setMetricsLoading] = useState(false);

  const rangeHours = VM_RANGES.find((r) => r.key === vmRange)?.hours ?? 24;

  useEffect(() => {
    if (selectedVmid == null) {
      setVmMetrics([]);
      return;
    }
    const to = new Date();
    const from = new Date(to.getTime() - rangeHours * 60 * 60 * 1000);
    setMetricsLoading(true);
    api.getProxmoxVmMetrics(serverId, selectedVmid, from.toISOString(), to.toISOString())
      .then(setVmMetrics)
      .catch(console.error)
      .finally(() => setMetricsLoading(false));
  }, [serverId, selectedVmid, vmRange, rangeHours]);

  const selectedVm = useMemo(
    () => vms.find((vm) => vm.vmid === selectedVmid) ?? null,
    [vms, selectedVmid],
  );

  const chartData = vmMetrics.map((m) => ({
    time: formatChartTime(m.collectedAt, rangeHours),
    collectedAt: m.collectedAt,
    cpu: m.cpuPercent,
    memory: m.memTotalMb > 0 ? (m.memUsedMb / m.memTotalMb) * 100 : 0,
  }));

  return (
    <div className="space-y-4">
      <div className="card overflow-hidden p-0">
        <div className="border-b border-white/5 px-4 py-3 sm:px-5">
          <h2 className="text-lg font-semibold">Machines virtuelles</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Cliquez une ligne pour afficher l&apos;historique CPU / RAM.
          </p>
        </div>
        {vms.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground sm:px-5">
            Aucune VM synchronisée pour le moment.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium sm:px-5">VMID</th>
                  <th className="px-4 py-2.5 font-medium sm:px-5">Nom</th>
                  <th className="px-4 py-2.5 font-medium sm:px-5">État</th>
                  <th className="px-4 py-2.5 font-medium sm:px-5">vCPU</th>
                  <th className="px-4 py-2.5 font-medium sm:px-5">RAM</th>
                  <th className="px-4 py-2.5 font-medium sm:px-5">Disque</th>
                </tr>
              </thead>
              <tbody>
                {vms.map((vm) => (
                  <tr
                    key={vm.id}
                    onClick={() => setSelectedVmid(vm.vmid)}
                    className={cn(
                      'cursor-pointer border-b border-white/5 transition-colors last:border-0 hover:bg-secondary/40',
                      selectedVmid === vm.vmid && 'bg-primary/5',
                    )}
                  >
                    <td className="px-4 py-2.5 font-mono text-xs sm:px-5">{vm.vmid}</td>
                    <td className="px-4 py-2.5 font-medium sm:px-5">{vm.name}</td>
                    <td className="px-4 py-2.5 sm:px-5">
                      <span className={vmStatusClass(vm.status)}>{vm.status}</span>
                    </td>
                    <td className="px-4 py-2.5 sm:px-5">{vm.cpus}</td>
                    <td className="px-4 py-2.5 sm:px-5">{formatRam(vm.maxmemMb)}</td>
                    <td className="px-4 py-2.5 sm:px-5">{formatDisk(vm.maxdiskGb)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold">
            Performance VM
            {selectedVm && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                — {selectedVm.name} ({selectedVm.vmid})
              </span>
            )}
          </h2>
          {selectedVmid != null && (
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
          )}
        </div>

        {selectedVmid == null ? (
          <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
            Sélectionnez une VM
          </div>
        ) : chartData.length > 0 ? (
          <div className={cn('grid gap-6 lg:grid-cols-2', metricsLoading && 'opacity-60')}>
            <div>
              <p className="mb-2 text-sm text-muted-foreground">CPU %</p>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 33% 17%)" />
                  <XAxis dataKey="time" stroke="hsl(215 20% 55%)" fontSize={12} minTickGap={24} />
                  <YAxis
                    stroke="hsl(215 20% 55%)"
                    fontSize={12}
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                  />
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
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 33% 17%)" />
                  <XAxis dataKey="time" stroke="hsl(215 20% 55%)" fontSize={12} minTickGap={24} />
                  <YAxis
                    stroke="hsl(215 20% 55%)"
                    fontSize={12}
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                  />
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
