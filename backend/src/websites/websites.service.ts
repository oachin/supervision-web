import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AlertsService } from '../alerts/alerts.service';
import { CreateWebsiteDto, UpdateWebsiteDto } from '../common/dto';

@Injectable()
export class WebsitesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private alerts: AlertsService,
  ) {}

  async findAll() {
    return this.prisma.website.findMany({
      orderBy: { name: 'asc' },
      include: {
        server: { select: { id: true, name: true, hostname: true } },
      },
    });
  }

  async findOne(id: string) {
    const website = await this.prisma.website.findUnique({
      where: { id },
      include: {
        server: { select: { id: true, name: true, hostname: true } },
        checks: {
          take: 100,
          orderBy: { checkedAt: 'desc' },
        },
      },
    });
    if (!website) throw new NotFoundException('Site introuvable');
    return website;
  }

  async create(dto: CreateWebsiteDto, userId: string) {
    const website = await this.prisma.website.create({
      data: {
        name: dto.name,
        url: dto.url.startsWith('http') ? dto.url : `https://${dto.url}`,
        serverId: dto.serverId,
        checkInterval: dto.checkInterval ?? 60,
        expectedStatus: dto.expectedStatus ?? 200,
        expectedKeyword: dto.expectedKeyword,
        sslEnabled: dto.sslEnabled ?? true,
        tags: dto.tags ?? [],
      },
    });

    await this.audit.log(userId, 'WEBSITE_CREATED', 'websites', { websiteId: website.id });
    return website;
  }

  async update(id: string, dto: UpdateWebsiteDto, userId: string) {
    const website = await this.prisma.website.findUnique({ where: { id } });
    if (!website) throw new NotFoundException('Site introuvable');

    const data = { ...dto };
    if (dto.url && !dto.url.startsWith('http')) {
      data.url = `https://${dto.url}`;
    }

    const updated = await this.prisma.website.update({ where: { id }, data });
    await this.audit.log(userId, 'WEBSITE_UPDATED', 'websites', { websiteId: id });
    return updated;
  }

  async remove(id: string, userId: string) {
    const website = await this.prisma.website.findUnique({ where: { id } });
    if (!website) throw new NotFoundException('Site introuvable');

    await this.alerts.onResourceDeleted({
      websiteId: id,
      resourceName: website.name,
      resourceType: 'website',
      userId,
    });

    await this.prisma.website.delete({ where: { id } });
    await this.audit.log(userId, 'WEBSITE_DELETED', 'websites', { websiteId: id });
    return { success: true };
  }

  async getChecks(id: string, hours = 24) {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.prisma.websiteCheck.findMany({
      where: { websiteId: id, checkedAt: { gte: since } },
      orderBy: { checkedAt: 'asc' },
    });
  }
}
