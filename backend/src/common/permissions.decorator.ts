import { SetMetadata } from '@nestjs/common';
import type { PermissionAction, PermissionResource } from '../permissions/permissions';

export const PERMISSIONS_KEY = 'permissions';

export type RequiredPermission = {
  resource: PermissionResource;
  action: PermissionAction;
};

export type RequiredPermissionRule =
  | RequiredPermission
  | { anyOf: RequiredPermission[] };

export const RequirePermission = (resource: PermissionResource, action: PermissionAction) =>
  SetMetadata(PERMISSIONS_KEY, { resource, action } satisfies RequiredPermission);

export const RequireAnyPermission = (...perms: RequiredPermission[]) =>
  SetMetadata(PERMISSIONS_KEY, { anyOf: perms } satisfies RequiredPermissionRule);
