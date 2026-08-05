import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WebsecClient, type WebsecSiteTarget } from './websec-client';

function domainFromUrl(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

function normalizeDailyTime(raw: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function clockInTimezone(timezone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone || 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '00';
  const hour = get('hour');
  const minute = get('minute');
  return {
    hm: `${hour}:${minute}`,
    dayKey: `${get('year')}-${get('month')}-${get('day')}`,
    slot: `${get('year')}-${get('month')}-${get('day')}T${hour}:${minute}`,
  };
}

function nextDailyAt(
  dailyTimes: string[],
  timezone: string,
  from = new Date(),
): Date | null {
  if (!dailyTimes.length) return null;
  const wanted = new Set(dailyTimes);
  const horizon = from.getTime() + 48 * 3600_000;
  for (let t = from.getTime() + 60_000; t < horizon; t += 60_000) {
    const d = new Date(t);
    if (wanted.has(clockInTimezone(timezone, d).hm)) return d;
  }
  return null;
}

@Injectable()
export class CyberService {
  private readonly logger = new Logger(CyberService.name);
  private scheduleTickRunning = false;

  constructor(
    private prisma: PrismaService,
    private websec: WebsecClient,
  ) {}

  private async ensureSchedule() {
    return this.prisma.cyberScanSchedule.upsert({
      where: { id: 'default' },
      create: { id: 'default' },
      update: {},
    });
  }

  async getAutomation() {
    const schedule = await this.ensureSchedule();
    const status = await this.websec.getStatus().catch(() => ({ running: false }));
    const now = new Date();
    const nextIntervalAt =
      schedule.enabled && schedule.intervalMinutes > 0
        ? new Date(
            (schedule.lastRunAt?.getTime() ?? now.getTime()) +
              schedule.intervalMinutes * 60_000,
          )
        : null;
    const nextDaily =
      schedule.enabled && schedule.dailyTimes.length
        ? nextDailyAt(schedule.dailyTimes, schedule.timezone, now)
        : null;

    let nextRunAt: Date | null = null;
    if (nextIntervalAt && nextDaily) {
      nextRunAt = nextIntervalAt < nextDaily ? nextIntervalAt : nextDaily;
    } else {
      nextRunAt = nextIntervalAt || nextDaily;
    }

    return {
      ...schedule,
      scanRunning: Boolean((status as { running?: boolean }).running),
      nextIntervalAt,
      nextDailyAt: nextDaily,
      nextRunAt,
    };
  }

  async updateAutomation(data: {
    enabled?: boolean;
    intervalMinutes?: number;
    dailyTimes?: string[];
    deep?: boolean;
    timezone?: string;
  }) {
    const current = await this.ensureSchedule();

    let dailyTimes = current.dailyTimes;
    if (data.dailyTimes !== undefined) {
      dailyTimes = [
        ...new Set(
          data.dailyTimes
            .map(normalizeDailyTime)
            .filter((t): t is string => !!t),
        ),
      ].sort();
    }

    const intervalMinutes =
      data.intervalMinutes !== undefined
        ? Math.max(0, Math.min(60 * 24 * 7, Math.floor(data.intervalMinutes)))
        : current.intervalMinutes;

    const enabled = data.enabled !== undefined ? data.enabled : current.enabled;
    if (enabled && intervalMinutes <= 0 && dailyTimes.length === 0) {
      throw new BadRequestException(
        'Activez un intervalle (minutes) et/ou au moins une heure quotidienne',
      );
    }

    await this.prisma.cyberScanSchedule.update({
      where: { id: 'default' },
      data: {
        enabled,
        intervalMinutes,
        dailyTimes,
        ...(data.deep !== undefined ? { deep: data.deep } : {}),
        ...(data.timezone !== undefined
          ? { timezone: data.timezone.trim() || 'Europe/Paris' }
          : {}),
        lastError: null,
      },
    });

    return this.getAutomation();
  }

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
    const [targets, status, sites, trend, healthy, automation] = await Promise.all([
      this.listTargets(),
      this.websec.getStatus().catch(() => ({ running: false, error: 'unavailable' })),
      this.websec.listSites().catch(() => ({ sites: [], count: 0 })),
      this.websec.getTrend().catch(() => ({ trend: [] })),
      this.websec.health(),
      this.getAutomation().catch(() => null),
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
      automation,
    };
  }

  async startScan(options: { deep?: boolean; authorized?: boolean } = {}) {
    const sites = await this.collectScanTargets();
    if (sites.length === 0) {
      throw new BadRequestException('Aucune cible activée pour le scan');
    }
    return this.websec.startScan(sites, !!options.deep, !!options.authorized);
  }

  private async startScheduledScan(trigger: 'interval' | 'daily', deep: boolean, dailySlot?: string) {
    const sites = await this.collectScanTargets();
    if (sites.length === 0) {
      await this.prisma.cyberScanSchedule.update({
        where: { id: 'default' },
        data: { lastError: 'Aucune cible activée pour le scan automatique' },
      });
      return;
    }

    try {
      await this.websec.startScan(sites, deep, false);
      await this.prisma.cyberScanSchedule.update({
        where: { id: 'default' },
        data: {
          lastRunAt: new Date(),
          lastTrigger: trigger,
          lastError: null,
          ...(dailySlot ? { lastDailySlot: dailySlot } : {}),
        },
      });
      this.logger.log(`Scheduled cyber scan started (${trigger}, ${sites.length} sites)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Keep lastDailySlot unset on failure so a busy minute can retry… but daily
      // only matches one minute; store error for the UI.
      await this.prisma.cyberScanSchedule.update({
        where: { id: 'default' },
        data: { lastError: message },
      });
      this.logger.warn(`Scheduled cyber scan failed (${trigger}): ${message}`);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async runScheduledScans() {
    if (this.scheduleTickRunning) return;
    this.scheduleTickRunning = true;
    try {
      const schedule = await this.ensureSchedule();
      if (!schedule.enabled) return;
      if (schedule.intervalMinutes <= 0 && schedule.dailyTimes.length === 0) return;

      const now = new Date();
      const clock = clockInTimezone(schedule.timezone, now);

      let trigger: 'interval' | 'daily' | null = null;
      let dailySlot: string | undefined;

      if (schedule.dailyTimes.includes(clock.hm) && schedule.lastDailySlot !== clock.slot) {
        trigger = 'daily';
        dailySlot = clock.slot;
      } else if (schedule.intervalMinutes > 0) {
        const last = schedule.lastRunAt?.getTime() ?? 0;
        if (now.getTime() - last >= schedule.intervalMinutes * 60_000) {
          trigger = 'interval';
        }
      }

      if (!trigger) return;

      const status = await this.websec.getStatus().catch(() => ({ running: false }));
      if ((status as { running?: boolean }).running) {
        this.logger.warn('Skipping scheduled cyber scan: a scan is already running');
        return;
      }

      await this.startScheduledScan(trigger, schedule.deep, dailySlot);
    } finally {
      this.scheduleTickRunning = false;
    }
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
