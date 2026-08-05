'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { ProxmoxVm } from '@/lib/api';
import { isExcludedProxmoxVmName } from '@/lib/proxmox-vm';
import { cn } from '@/lib/utils';

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

export function ProxmoxVmsPanel({ vms }: { vms: ProxmoxVm[] }) {
  const visible = vms.filter((vm) => !isExcludedProxmoxVmName(vm.name));
  return (
    <div className="card overflow-hidden p-0">
      <div className="border-b border-white/5 px-4 py-3 sm:px-5">
        <h2 className="text-lg font-semibold">Machines virtuelles</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Cliquez une VM pour ouvrir sa fiche (performances et détails).
        </p>
      </div>
      {visible.length === 0 ? (
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
                <th className="px-4 py-2.5 font-medium sm:px-5" />
              </tr>
            </thead>
            <tbody>
              {visible.map((vm) => (
                <tr key={vm.id} className="border-b border-white/5 transition-colors last:border-0 hover:bg-secondary/40">
                  <td className="px-4 py-2.5 font-mono text-xs sm:px-5">{vm.vmid}</td>
                  <td className="px-4 py-2.5 font-medium sm:px-5">
                    <Link href={`/vms/${vm.id}`} className="hover:text-primary hover:underline">
                      {vm.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 sm:px-5">
                    <span className={cn('rounded px-2 py-0.5 text-xs capitalize', vmStatusClass(vm.status))}>
                      {vm.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 sm:px-5">{vm.cpus}</td>
                  <td className="px-4 py-2.5 sm:px-5">{formatRam(vm.maxmemMb)}</td>
                  <td className="px-4 py-2.5 sm:px-5">{formatDisk(vm.maxdiskGb)}</td>
                  <td className="px-4 py-2.5 sm:px-5">
                    <Link
                      href={`/vms/${vm.id}`}
                      className="inline-flex items-center text-muted-foreground hover:text-primary"
                      title="Ouvrir la fiche VM"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
