/** Proxmox guest tag excluded from inventory / UI. */
export const EXCLUDED_PROXMOX_TAG = '18';

export function hasExcludedProxmoxTag(tags: string[] | null | undefined): boolean {
  if (!tags?.length) return false;
  return tags.some((t) => t.trim() === EXCLUDED_PROXMOX_TAG);
}
