/** VMs whose Proxmox name ends with this marker are hidden from inventory. */
export const EXCLUDED_PROXMOX_VM_NAME_SUFFIX = 'T18';

export function isExcludedProxmoxVmName(name: string | null | undefined): boolean {
  if (!name) return false;
  return name.trimEnd().endsWith(EXCLUDED_PROXMOX_VM_NAME_SUFFIX);
}

/** Prisma where clause: keep only VMs that are not name-excluded. */
export const proxmoxVmVisibleWhere = {
  NOT: { name: { endsWith: EXCLUDED_PROXMOX_VM_NAME_SUFFIX } },
} as const;
