import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SeedService {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  async run() {
    const email = this.config.get<string>('ADMIN_EMAIL', 'admin@localhost');
    const password = this.config.get<string>('ADMIN_PASSWORD');

    if (!password) {
      this.logger.warn('ADMIN_PASSWORD not set, skipping admin seed');
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
        passwordHash,
        role: 'ADMIN',
      },
    });

    this.logger.log(`Admin user created: ${email}`);
  }
}
