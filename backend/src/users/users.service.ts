import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateUserDto, UpdateUserDto } from '../common/dto';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async findAll() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        totpEnabled: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(dto: CreateUserDto, adminId: string) {
    const exists = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (exists) throw new ConflictException('Email déjà utilisé');

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
    });

    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        name: dto.name,
        passwordHash,
        role: dto.role ?? 'VIEWER',
      },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });

    await this.audit.log(adminId, 'USER_CREATED', 'users', { userId: user.id });
    return user;
  }

  async update(id: string, dto: UpdateUserDto, adminId: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Utilisateur introuvable');

    const updated = await this.prisma.user.update({
      where: { id },
      data: dto,
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });

    await this.audit.log(adminId, 'USER_UPDATED', 'users', { userId: id, changes: dto });
    return updated;
  }

  async remove(id: string, adminId: string) {
    if (id === adminId) throw new ConflictException('Impossible de supprimer votre propre compte');

    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Utilisateur introuvable');

    await this.prisma.user.delete({ where: { id } });
    await this.audit.log(adminId, 'USER_DELETED', 'users', { userId: id, email: user.email });
    return { success: true };
  }
}
