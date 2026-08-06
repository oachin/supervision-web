import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AlertsService } from '../alerts/alerts.service';
import { CyberService } from '../cyber/cyber.service';
import { CreateWebsiteDto, UpdateWebsiteDto } from '../common/dto';

@Injectable()
export class WebsitesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private alerts: AlertsService,
    private cyber: CyberService,
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

    if (dto.monitoringEnabled === false && website.monitoringEnabled) {
      await this.alerts.forceCloseForWebsite(id, userId);
      await this.audit.log(userId, 'WEBSITE_MONITORING_DISABLED', 'websites', { websiteId: id });
    } else if (dto.monitoringEnabled === true && !website.monitoringEnabled) {
      await this.audit.log(userId, 'WEBSITE_MONITORING_ENABLED', 'websites', { websiteId: id });
    } else {
      await this.audit.log(userId, 'WEBSITE_UPDATED', 'websites', { websiteId: id });
    }

    return updated;
  }

  async remove(id: string, userId: string) {
    const website = await this.prisma.website.findUnique({ where: { id } });
    if (!website) throw new NotFoundException('Site introuvable');

    // Agent/Plesk sites: remember exclusion so the next inventory sync does not recreate them.
    if (website.serverId && website.source === 'agent') {
      const normalized = website.url.startsWith('http')
        ? website.url.replace(/\/$/, '') + '/'
        : `https://${website.url}`.replace(/\/$/, '') + '/';
      const server = await this.prisma.server.findUnique({
        where: { id: website.serverId },
        select: { pleskExcludedUrls: true },
      });
      const excluded = server?.pleskExcludedUrls ?? [];
      if (!excluded.includes(normalized)) {
        await this.prisma.server.update({
          where: { id: website.serverId },
          data: { pleskExcludedUrls: [...excluded, normalized] },
        });
      }
    }

    await this.alerts.onResourceDeleted({
      websiteId: id,
      resourceName: website.name,
      resourceType: 'website',
      userId,
    });

    await this.prisma.website.delete({ where: { id } });
    await this.cyber.onTargetRemoved(website.url);
    await this.audit.log(userId, 'WEBSITE_DELETED', 'websites', {
      websiteId: id,
      pleskExcluded: website.source === 'agent',
    });
    return { success: true };
  }

  async getChecks(id: string, hours = 24) {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.prisma.websiteCheck.findMany({
      where: { websiteId: id, checkedAt: { gte: since } },
      orderBy: { checkedAt: 'asc' },
    });
  }

  /**
   * Active alerts + severity counts over stability windows
   * (occurrences / créations / réouvertures).
   */
  async getAlertStability(id: string) {
    const website = await this.prisma.website.findUnique({ where: { id } });
    if (!website) throw new NotFoundException('Site introuvable');

    const periods = [
      { key: '5m', label: '5 min', ms: 5 * 60 * 1000 },
      { key: '1h', label: '1 h', ms: 60 * 60 * 1000 },
      { key: '12h', label: '12 h', ms: 12 * 60 * 60 * 1000 },
      { key: '1d', label: '1 j', ms: 24 * 60 * 60 * 1000 },
      { key: '1mo', label: '1 mois', ms: 30 * 24 * 60 * 60 * 1000 },
      { key: '3mo', label: '3 mois', ms: 90 * 24 * 60 * 60 * 1000 },
      { key: '6mo', label: '6 mois', ms: 180 * 24 * 60 * 60 * 1000 },
      { key: '1y', label: '1 an', ms: 365 * 24 * 60 * 60 * 1000 },
    ] as const;

    const longestMs = periods[periods.length - 1].ms;
    const since = new Date(Date.now() - longestMs);

    const [active, events] = await Promise.all([
      this.prisma.alert.findMany({
        where: {
          websiteId: id,
          status: { in: ['ACTIVE', 'ACKNOWLEDGED'] },
        },
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        include: {
          server: { select: { id: true, name: true, hostname: true } },
          website: {
            select: {
              id: true,
              name: true,
              url: true,
              serverId: true,
              server: { select: { id: true, name: true, hostname: true } },
            },
          },
          acknowledgedBy: { select: { id: true, name: true, email: true } },
          closedBy: { select: { id: true, name: true, email: true } },
        },
      }),
      this.prisma.alertEvent.findMany({
        where: {
          createdAt: { gte: since },
          action: { in: ['CREATED', 'REOPENED', 'OCCURRENCE', 'SNOOZE_EXPIRED'] },
          alert: { websiteId: id },
        },
        select: {
          createdAt: true,
          alert: { select: { severity: true, title: true } },
        },
      }),
    ]);

    const empty = () => ({
      CRITICAL: 0,
      WARNING: 0,
      EXPIRATION_SSL: 0,
      INFO: 0,
      total: 0,
    });

    const classify = (title: string, severity: string) => {
      const t = title.toLowerCase();
      if (
        t.includes('expiration ssl') ||
        t.includes('certificat ssl') ||
        t.includes('chaîne ssl') ||
        t.includes('chaine ssl')
      ) {
        return 'EXPIRATION_SSL' as const;
      }
      if (severity === 'CRITICAL' || severity === 'WARNING' || severity === 'INFO') {
        return severity as 'CRITICAL' | 'WARNING' | 'INFO';
      }
      return 'INFO' as const;
    };

    const now = Date.now();
    const byPeriod = Object.fromEntries(
      periods.map((p) => [p.key, empty()]),
    ) as Record<string, ReturnType<typeof empty>>;

    for (const ev of events) {
      if (!ev.alert) continue;
      const bucket = classify(ev.alert.title, ev.alert.severity);
      const age = now - ev.createdAt.getTime();
      for (const p of periods) {
        if (age <= p.ms) {
          byPeriod[p.key][bucket] += 1;
          byPeriod[p.key].total += 1;
        }
      }
    }

    return {
      websiteId: id,
      active,
      periods: periods.map((p) => ({
        key: p.key,
        label: p.label,
        counts: byPeriod[p.key],
      })),
    };
  }
}
