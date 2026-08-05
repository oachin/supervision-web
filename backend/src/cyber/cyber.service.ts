import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WebsecClient, type WebsecSiteTarget } from './websec-client';

function domainFromUrl(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

@Injectable()
export class CyberService {
  constructor(
    private prisma: PrismaService,
    private websec: WebsecClient,
  ) {}

  async listTargets() {
    const [websites, external] = await Promise.all([
      this.prisma.website.findMany({
        where: { monitoringEnabled: true },
        select: {
          id: true,
          name: true,
          url: true,
          cyberScanEnabled: true,
          status: true,
          server: { select: { id: true, name: true, hostname: true } },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.cyberExternalTarget.findMany({ orderBy: { name: 'asc' } }),
    ]);

    return {
      supervision: websites.map((w) => ({
        id: w.id,
        name: w.name,
        url: w.url,
        enabled: w.cyberScanEnabled,
        source: 'supervision' as const,
        status: w.status,
        server: w.server,
      })),
      external: external.map((e) => ({
        id: e.id,
        name: e.name,
        url: e.url,
        enabled: e.enabled,
        source: 'external' as const,
        notes: e.notes,
      })),
    };
  }

  async setWebsiteScan(websiteId: string, enabled: boolean) {
    const website = await this.prisma.website.findUnique({ where: { id: websiteId } });
    if (!website) throw new NotFoundException('Site introuvable');
    return this.prisma.website.update({
      where: { id: websiteId },
      data: { cyberScanEnabled: enabled },
      select: { id: true, name: true, url: true, cyberScanEnabled: true },
    });
  }

  async addExternal(data: { name: string; url: string; notes?: string }) {
    const url = data.url.trim();
    if (!/^https?:\/\//i.test(url)) {
      throw new BadRequestException('URL invalide (http/https requis)');
    }
    const exists = await this.prisma.cyberExternalTarget.findUnique({ where: { url } });
    if (exists) throw new ConflictException('Cette URL est déjà enregistrée');

    return this.prisma.cyberExternalTarget.create({
      data: {
        name: data.name.trim() || domainFromUrl(url) || url,
        url,
        notes: data.notes?.trim() || null,
        enabled: true,
      },
    });
  }

  async updateExternal(
    id: string,
    data: { name?: string; enabled?: boolean; notes?: string | null },
  ) {
    const target = await this.prisma.cyberExternalTarget.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Cible introuvable');
    return this.prisma.cyberExternalTarget.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
        ...(data.notes !== undefined ? { notes: data.notes?.trim() || null } : {}),
      },
    });
  }

  async removeExternal(id: string) {
    const target = await this.prisma.cyberExternalTarget.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Cible introuvable');
    await this.prisma.cyberExternalTarget.delete({ where: { id } });
    return { success: true };
  }

  async collectScanTargets(): Promise<WebsecSiteTarget[]> {
    const [websites, external] = await Promise.all([
      this.prisma.website.findMany({
        where: { monitoringEnabled: true, cyberScanEnabled: true },
        select: { name: true, url: true },
      }),
      this.prisma.cyberExternalTarget.findMany({
        where: { enabled: true },
        select: { name: true, url: true },
      }),
    ]);

    const byUrl = new Map<string, WebsecSiteTarget>();
    for (const w of [...websites, ...external]) {
      const url = w.url.trim();
      if (!byUrl.has(url)) {
        byUrl.set(url, {
          name: w.name,
          url,
          domain: domainFromUrl(url),
        });
      }
    }
    return [...byUrl.values()];
  }

  async overview() {
    const [targets, status, sites, trend, healthy] = await Promise.all([
      this.listTargets(),
      this.websec.getStatus().catch(() => ({ running: false, error: 'unavailable' })),
      this.websec.listSites().catch(() => ({ sites: [], count: 0 })),
      this.websec.getTrend().catch(() => ({ trend: [] })),
      this.websec.health(),
    ]);

    const enabledCount =
      targets.supervision.filter((t) => t.enabled).length +
      targets.external.filter((t) => t.enabled).length;

    const grades = (sites.sites as Array<{ grade?: string }>).reduce<Record<string, number>>(
      (acc, s) => {
        const g = s.grade || '?';
        acc[g] = (acc[g] || 0) + 1;
        return acc;
      },
      {},
    );

    return {
      healthy,
      scan: status,
      enabledTargets: enabledCount,
      resultsCount: sites.count,
      grades,
      sites: sites.sites,
      trend: trend.trend,
    };
  }

  async startScan(options: { deep?: boolean; authorized?: boolean } = {}) {
    const sites = await this.collectScanTargets();
    if (sites.length === 0) {
      throw new BadRequestException('Aucune cible activée pour le scan');
    }
    return this.websec.startScan(sites, !!options.deep, !!options.authorized);
  }

  getScanStatus() {
    return this.websec.getStatus();
  }

  getSiteResult(url: string) {
    if (!url?.trim()) throw new BadRequestException('URL requise');
    return this.websec.getSite(url.trim());
  }

  getTrend(limit = 30) {
    return this.websec.getTrend(limit);
  }

  getHistory(url: string, limit = 30) {
    if (!url?.trim()) throw new BadRequestException('URL requise');
    return this.websec.getHistory(url.trim(), limit);
  }

  getGlobalReport(fmt: 'html' | 'pdf' = 'html', lang = 'fr') {
    return this.websec.getGlobalReport(fmt, lang);
  }

  getSiteReport(url: string, fmt: 'html' | 'pdf' = 'html', lang = 'fr') {
    if (!url?.trim()) throw new BadRequestException('URL requise');
    return this.websec.getSiteReport(url.trim(), fmt, lang);
  }
}
