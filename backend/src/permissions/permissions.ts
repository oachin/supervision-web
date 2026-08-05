import { Role } from '@prisma/client';

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

export function emptyPermissions(): PermissionsMap {
  return Object.fromEntries(
    PERMISSION_RESOURCES.map((resource) => [
      resource,
      { view: false, modify: false, delete: false },
    ]),
  ) as PermissionsMap;
}

export function fullPermissions(): PermissionsMap {
  return Object.fromEntries(
    PERMISSION_RESOURCES.map((resource) => [
      resource,
      { view: true, modify: true, delete: true },
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
    // modify/delete imply view
    if (base[resource].modify || base[resource].delete) {
      base[resource].view = true;
    }
  }
  return base;
}

export function hasPermission(
  permissions: unknown,
  resource: PermissionResource,
  action: PermissionAction,
): boolean {
  const map = normalizePermissions(permissions);
  return Boolean(map[resource]?.[action]);
}

/** Derive legacy Role for existing @Roles guards. */
export function deriveRoleFromPermissions(permissions: unknown): Role {
  const map = normalizePermissions(permissions);
  if (
    map.users.modify ||
    map.users.delete ||
    map.profiles.modify ||
    map.profiles.delete ||
    map.notifications.modify
  ) {
    return 'ADMIN';
  }
  const canModify = PERMISSION_RESOURCES.some((r) => map[r].modify || map[r].delete);
  return canModify ? 'OPERATOR' : 'VIEWER';
}

export const SYSTEM_PROFILE_TEMPLATES: Array<{
  slug: string;
  name: string;
  description: string;
  baseRole: Role;
  permissions: PermissionsMap;
}> = [
  {
    slug: 'administrateur',
    name: 'Administrateur',
    description: 'Accès complet à la plateforme',
    baseRole: 'ADMIN',
    permissions: {
      ...fullPermissions(),
      events: { view: true, modify: false, delete: false },
    },
  },
  {
    slug: 'operateur',
    name: 'Opérateur',
    description: 'Supervision opérationnelle sans administration des accès',
    baseRole: 'OPERATOR',
    permissions: {
      ...emptyPermissions(),
      dashboard: { view: true, modify: false, delete: false },
      servers: { view: true, modify: true, delete: false },
      vms: { view: true, modify: true, delete: false },
      websites: { view: true, modify: true, delete: false },
      alerts: { view: true, modify: true, delete: false },
      events: { view: true, modify: false, delete: false },
      cybersecurity: { view: true, modify: true, delete: false },
      settings: { view: true, modify: false, delete: false },
      notifications: { view: true, modify: false, delete: false },
    },
  },
  {
    slug: 'lecteur',
    name: 'Lecteur',
    description: 'Lecture seule des écrans de supervision',
    baseRole: 'VIEWER',
    permissions: {
      ...emptyPermissions(),
      dashboard: { view: true, modify: false, delete: false },
      servers: { view: true, modify: false, delete: false },
      vms: { view: true, modify: false, delete: false },
      websites: { view: true, modify: false, delete: false },
      alerts: { view: true, modify: false, delete: false },
      events: { view: true, modify: false, delete: false },
      cybersecurity: { view: true, modify: false, delete: false },
    },
  },
];
