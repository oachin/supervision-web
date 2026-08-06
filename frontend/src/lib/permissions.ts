export const PERMISSION_RESOURCES = [
  'dashboard',
  'servers',
  'vms',
  'websites',
  'alerts',
  'events',
  'cybersecurity',
  'settings',
  'users',
  'profiles',
  'notifications',
] as const;

export type PermissionResource = (typeof PERMISSION_RESOURCES)[number];
export type PermissionAction = 'view' | 'modify' | 'delete';

export type ResourcePermissions = Record<PermissionAction, boolean>;
export type PermissionsMap = Record<PermissionResource, ResourcePermissions>;

export const PERMISSION_RESOURCE_LABELS: Record<PermissionResource, string> = {
  dashboard: 'Tableau de bord',
  servers: 'Serveurs',
  vms: 'VMs',
  websites: 'Sites web',
  alerts: 'Alertes',
  events: 'Évènements',
  cybersecurity: 'Cybersécurité',
  settings: 'Configuration',
  users: 'Utilisateurs',
  profiles: 'Profils',
  notifications: 'SMTP / Notifications',
};

export const MENU_PERMISSION: Record<string, PermissionResource> = {
  '/dashboard': 'dashboard',
  '/servers': 'servers',
  '/vms': 'vms',
  '/websites': 'websites',
  '/alerts': 'alerts',
  '/events': 'events',
  '/cybersecurite': 'cybersecurity',
  '/settings': 'settings',
  '/settings/general': 'settings',
};

export function emptyPermissions(): PermissionsMap {
  return Object.fromEntries(
    PERMISSION_RESOURCES.map((resource) => [
      resource,
      { view: false, modify: false, delete: false },
    ]),
  ) as PermissionsMap;
}

export function normalizePermissions(raw: unknown): PermissionsMap {
  const base = emptyPermissions();
  if (!raw || typeof raw !== 'object') return base;
  for (const resource of PERMISSION_RESOURCES) {
    const entry = (raw as Record<string, unknown>)[resource];
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    base[resource] = {
      view: Boolean(e.view),
      modify: Boolean(e.modify),
      delete: Boolean(e.delete),
    };
    if (base[resource].modify || base[resource].delete) {
      base[resource].view = true;
    }
  }
  return base;
}

export function can(
  permissions: unknown,
  resource: PermissionResource,
  action: PermissionAction,
  role?: string,
): boolean {
  if (role === 'ADMIN') return true;
  return Boolean(normalizePermissions(permissions)[resource]?.[action]);
}
