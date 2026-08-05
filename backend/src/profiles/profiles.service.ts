import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  deriveRoleFromPermissions,
  normalizePermissions,
  type PermissionsMap,
} from '../permissions/permissions';

function slugify(name: string) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

@Injectable()
export class ProfilesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async findAll() {
    const profiles = await this.prisma.profile.findMany({
      include: { _count: { select: { users: true } } },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
    return profiles.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      description: p.description,
      isSystem: p.isSystem,
      baseRole: p.baseRole,
      permissions: normalizePermissions(p.permissions),
      usersCount: p._count.users,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));
  }

  async findOne(id: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!profile) throw new NotFoundException('Profil introuvable');
    return {
      id: profile.id,
      name: profile.name,
      slug: profile.slug,
      description: profile.description,
      isSystem: profile.isSystem,
      baseRole: profile.baseRole,
      permissions: normalizePermissions(profile.permissions),
      usersCount: profile._count.users,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }

  async create(
    data: { name: string; description?: string; permissions: PermissionsMap },
    adminId: string,
  ) {
    const name = data.name.trim();
    if (!name) throw new BadRequestException('Le nom est requis');

    const permissions = normalizePermissions(data.permissions);
    const baseRole = deriveRoleFromPermissions(permissions);
    let slug = slugify(name) || `profil-${Date.now()}`;

    const existingSlug = await this.prisma.profile.findUnique({ where: { slug } });
    if (existingSlug) slug = `${slug}-${Date.now().toString(36)}`;

    try {
      const profile = await this.prisma.profile.create({
        data: {
          name,
          slug,
          description: data.description?.trim() || null,
          isSystem: false,
          baseRole,
          permissions: permissions as Prisma.InputJsonValue,
        },
      });
      await this.audit.log(adminId, 'PROFILE_CREATED', 'profiles', { profileId: profile.id });
      return this.findOne(profile.id);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Un profil avec ce nom existe déjà');
      }
      throw err;
    }
  }

  async update(
    id: string,
    data: { name?: string; description?: string; permissions?: PermissionsMap },
    adminId: string,
  ) {
    const profile = await this.prisma.profile.findUnique({ where: { id } });
    if (!profile) throw new NotFoundException('Profil introuvable');

    const permissions = data.permissions
      ? normalizePermissions(data.permissions)
      : normalizePermissions(profile.permissions);

    const baseRole = profile.isSystem
      ? profile.baseRole
      : deriveRoleFromPermissions(permissions);

    const updated = await this.prisma.profile.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.description !== undefined
          ? { description: data.description.trim() || null }
          : {}),
        permissions: permissions as Prisma.InputJsonValue,
        baseRole,
      },
    });

    // Keep user.role in sync for legacy @Roles guards
    await this.prisma.user.updateMany({
      where: { profileId: id },
      data: { role: baseRole },
    });

    await this.audit.log(adminId, 'PROFILE_UPDATED', 'profiles', {
      profileId: id,
      changes: data,
    });
    return this.findOne(updated.id);
  }

  async remove(id: string, adminId: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!profile) throw new NotFoundException('Profil introuvable');
    if (profile.isSystem) {
      throw new BadRequestException('Impossible de supprimer un profil système');
    }
    if (profile._count.users > 0) {
      throw new BadRequestException('Des utilisateurs sont encore associés à ce profil');
    }

    await this.prisma.profile.delete({ where: { id } });
    await this.audit.log(adminId, 'PROFILE_DELETED', 'profiles', {
      profileId: id,
      name: profile.name,
    });
    return { success: true };
  }
}
