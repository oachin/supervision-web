import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY, type RequiredPermissionRule } from './permissions.decorator';
import { hasPermission } from '../permissions/permissions';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<RequiredPermissionRule>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) throw new ForbiddenException('Accès refusé');

    if (user.role === 'ADMIN') return true;

    const permissions = user.permissions ?? user.profile?.permissions;
    const checks = 'anyOf' in required ? required.anyOf : [required];
    const allowed = checks.some((rule) =>
      hasPermission(permissions, rule.resource, rule.action),
    );

    if (!allowed) throw new ForbiddenException('Accès refusé');
    return true;
  }
}
