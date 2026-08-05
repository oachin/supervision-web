import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SYSTEM_PROFILE_TEMPLATES } from '../permissions/permissions';

@Injectable()
export class SeedService {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  async run() {
    await this.ensureSystemProfiles();
    await this.ensureAdminUser();
  }

  private async ensureSystemProfiles() {
    for (const template of SYSTEM_PROFILE_TEMPLATES) {
      const existing = await this.prisma.profile.findUnique({ where: { slug: template.slug } });
      if (existing) continue;
      await this.prisma.profile.create({
        data: {
          name: template.name,
          slug: template.slug,
          description: template.description,
          isSystem: true,
          baseRole: template.baseRole,
          permissions: template.permissions as Prisma.InputJsonValue,
        },
      });
    }
  }

  private async ensureAdminUser() {
    const email = this.config.get<string>('ADMIN_EMAIL', 'admin@localhost');
    const password = this.config.get<string>('ADMIN_PASSWORD');

    if (!password) {
      this.logger.warn('ADMIN_PASSWORD not set, skipping admin seed');
      return;
    }

    const adminProfile = await this.prisma.profile.findUnique({
      where: { slug: 'administrateur' },
    });
    if (!adminProfile) {
      this.logger.error('Profil Administrateur introuvable');
      return;
    }

    const existing = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) return;

    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
    });

    await this.prisma.user.create({
      data: {
        email: email.toLowerCase(),
        name: 'Administrateur',
        firstName: 'Administrateur',
        lastName: '',
        passwordHash,
        role: 'ADMIN',
        profileId: adminProfile.id,
      },
    });

    this.logger.log(`Admin user created: ${email}`);
  }
}
