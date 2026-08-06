import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_TZ = 'Europe/Paris';

function assertValidTimezone(timezone: string) {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new BadRequestException(`Fuseau horaire invalide : ${timezone}`);
  }
}

@Injectable()
export class AppSettingsService {
  constructor(private prisma: PrismaService) {}

  async get() {
    const row = await this.prisma.appSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default', timezone: DEFAULT_TZ },
      update: {},
    });
    return {
      id: row.id,
      timezone: row.timezone || DEFAULT_TZ,
      updatedAt: row.updatedAt,
    };
  }

  async update(data: { timezone: string }) {
    const timezone = (data.timezone || '').trim() || DEFAULT_TZ;
    assertValidTimezone(timezone);

    const row = await this.prisma.appSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default', timezone },
      update: { timezone },
    });

    // Keep cyber scan schedule in the same timezone for daily slots.
    await this.prisma.cyberScanSchedule.upsert({
      where: { id: 'default' },
      create: { id: 'default', timezone },
      update: { timezone },
    });

    return {
      id: row.id,
      timezone: row.timezone,
      updatedAt: row.updatedAt,
    };
  }
}
