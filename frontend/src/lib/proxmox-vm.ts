export const EXCLUDED_PROXMOX_VM_NAME_SUFFIX = 'T18';

export function isExcludedProxmoxVmName(name: string | null | undefined): boolean {
  if (!name) return false;
  return name.trimEnd().endsWith(EXCLUDED_PROXMOX_VM_NAME_SUFFIX);
}
