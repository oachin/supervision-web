import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
function isMaintenance(status: string, statusCode?: number | null) {
  return status === 'DEGRADED' && statusCode === 503;
}

function isDegraded(status: string, statusCode?: number | null) {
  return status === 'DEGRADED' && !isMaintenance(status, statusCode);
}

type NocWebsite = {
  id: string;
  name: string;
  status: string;
  lastStatusCode: number | null;
  monitoringEnabled: boolean;
  lastResponseMs: number | null;
  serverId: string | null;
};

type NocAlert = {
  id: string;
  title: string;
  message: string;
  severity: string;
  status: string;
  createdAt: Date;
  closedAt: Date | null;
  serverId: string | null;
  websiteId: string | null;
  server: { id: string; name: string } | null;
  website: { id: string; name: string; serverId: string | null } | null;
};

/**
 * Same rules as frontend openAlertsForServer:
 * ACTIVE only, monitored sites only, ignore stale/false offline alerts.
 */
function isOpenAlertForServer(
  alert: NocAlert,
  serverId: string,
  serverSites: NocWebsite[],
): boolean {
  const monitoredIds = new Set(
    serverSites.filter((s) => s.monitoringEnabled).map((s) => s.id),
  );
  const site = alert.websiteId
    ? serverSites.find((s) => s.id === alert.websiteId)
    : undefined;

  if (alert.websiteId) {
    if (!monitoredIds.has(alert.websiteId)) return false;

    const title = alert.title.toLowerCase();
    if (title.includes('hors ligne')) {
      if (site && isMaintenance(site.status, site.lastStatusCode)) return false;
      // Site already recovered — alert should auto-close; don't drive NOC
      if (site && site.status !== 'DOWN') return false;
    }
    return true;
  }

  return alert.serverId === serverId;
}

function isOpenAlertGlobally(alert: NocAlert, websitesById: Map<string, NocWebsite>) {
  if (alert.websiteId) {
    const site = websitesById.get(alert.websiteId);
    if (!site?.monitoringEnabled) return false;
    const title = alert.title.toLowerCase();
    if (title.includes('hors ligne')) {
      if (isMaintenance(site.status, site.lastStatusCode)) return false;
      if (site.status !== 'DOWN') return false;
    }
    return true;
  }
  return true;
}

const MS_HOUR = 60 * 60 * 1000;
const MS_30D = 30 * 24 * MS_HOUR;

function mergeIntervals(intervals: Array<[number, number]>): Array<[number, number]> {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [[sorted[0][0], sorted[0][1]]];
  for (let i = 1; i < sorted.length; i++) {
    const [start, end] = sorted[i];
    const last = out[out.length - 1];
    if (start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      out.push([start, end]);
    }
  }
  return out;
}

function downtimeMs(intervals: Array<[number, number]>): number {
  return mergeIntervals(intervals).reduce((sum, [a, b]) => sum + Math.max(0, b - a), 0);
}

function isSslAlertTitle(title: string): boolean {
  const t = title.toLowerCase();
  return (
    t.includes('expiration ssl') ||
    t.includes('certificat ssl') ||
    t.includes('chaîne ssl') ||
    t.includes('chaine ssl')
  );
}

@Injectable()
export class NocService {
  constructor(private prisma: PrismaService) {}

  /**
   * Global availability over 30 days for servers + Proxmox VMs (sites excluded).
   * - Servers: downtime from « Serveur hors ligne » alerts (+ current OFFLINE from lastSeenAt)
   * - VMs: hourly metric presence (metrics are only written while running);
   *   parked VMs with no metrics in the window are excluded
   */
  private async computeAvailability30d(): Promise<number | null> {
    const nowMs = Date.now();
    const since = new Date(nowMs - MS_30D);

    const [servers, offlineAlerts, vms, vmHourRows] = await Promise.all([
      this.prisma.server.findMany({
        select: {
          id: true,
          status: true,
          createdAt: true,
          lastSeenAt: true,
        },
      }),
      this.prisma.alert.findMany({
        where: {
          websiteId: null,
          serverId: { not: null },
          title: { startsWith: 'Serveur hors ligne' },
          OR: [
            { createdAt: { gte: since } },
            { closedAt: { gte: since } },
            { status: { in: ['ACTIVE', 'ACKNOWLEDGED', 'PENDING_CLOSE'] } },
          ],
        },
        select: {
          serverId: true,
          createdAt: true,
          closedAt: true,
          status: true,
        },
      }),
      this.prisma.proxmoxVm.findMany({
        select: { id: true, status: true, createdAt: true },
      }),
      this.prisma.$queryRaw<Array<{ vmId: string; hours: bigint }>>`
        SELECT "vmId", COUNT(DISTINCT date_trunc('hour', "collectedAt"))::bigint AS hours
        FROM "ProxmoxVmMetric"
        WHERE "collectedAt" >= ${since}
        GROUP BY "vmId"
      `,
    ]);

    const alertsByServer = new Map<string, typeof offlineAlerts>();
    for (const a of offlineAlerts) {
      if (!a.serverId) continue;
      const list = alertsByServer.get(a.serverId) ?? [];
      list.push(a);
      alertsByServer.set(a.serverId, list);
    }

    const vmHours = new Map(
      vmHourRows.map((r) => [r.vmId, Number(r.hours)]),
    );

    let totalWindowMs = 0;
    let totalUpMs = 0;

    for (const server of servers) {
      const windowStart = Math.max(server.createdAt.getTime(), since.getTime());
      const windowMs = Math.max(0, nowMs - windowStart);
      if (windowMs <= 0) continue;

      const intervals: Array<[number, number]> = [];
      for (const a of alertsByServer.get(server.id) ?? []) {
        const start = Math.max(a.createdAt.getTime(), windowStart);
        const end = Math.min(
          a.status === 'CLOSED' && a.closedAt
            ? a.closedAt.getTime()
            : nowMs,
          nowMs,
        );
        if (end > start) intervals.push([start, end]);
      }

      if (server.status === 'OFFLINE' && server.lastSeenAt) {
        const start = Math.max(server.lastSeenAt.getTime(), windowStart);
        if (nowMs > start) intervals.push([start, nowMs]);
      }

      const down = Math.min(windowMs, downtimeMs(intervals));
      totalWindowMs += windowMs;
      totalUpMs += windowMs - down;
    }

    for (const vm of vms) {
      const hoursUp = vmHours.get(vm.id) ?? 0;
      const isRunning = vm.status.toLowerCase() === 'running';
      // Parked / never-seen guests: do not drag the SLA down
      if (!isRunning && hoursUp === 0) continue;

      const windowStart = Math.max(vm.createdAt.getTime(), since.getTime());
      const windowMs = Math.max(0, nowMs - windowStart);
      if (windowMs <= 0) continue;

      const expectedHours = Math.max(1, Math.ceil(windowMs / MS_HOUR));
      const upHours = Math.min(expectedHours, hoursUp);
      // If currently running but metrics lag, don't report below current pulse
      const effectiveUp = isRunning && hoursUp === 0 ? expectedHours : upHours;

      totalWindowMs += expectedHours * MS_HOUR;
      totalUpMs += effectiveUp * MS_HOUR;
    }

    if (totalWindowMs <= 0) return null;
    return Math.round((totalUpMs / totalWindowMs) * 1000) / 10; // 1 decimal
  }

  async getState() {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [servers, websites, vms, activeAlerts, recentClosed, created24h, availability30d] =
      await Promise.all([
        this.prisma.server.findMany({
          orderBy: { name: 'asc' },
          include: {
            metrics: {
              take: 40,
              orderBy: { collectedAt: 'desc' },
              select: {
                cpuPercent: true,
                memoryPercent: true,
                collectedAt: true,
                uptimeSeconds: true,
              },
            },
          },
        }),
        this.prisma.website.findMany({
          select: {
            id: true,
            name: true,
            status: true,
            lastStatusCode: true,
            monitoringEnabled: true,
            lastResponseMs: true,
            serverId: true,
          },
        }),
        this.prisma.proxmoxVm.findMany({
          select: { id: true, name: true, status: true, serverId: true },
        }),
        this.prisma.alert.findMany({
          where: { status: 'ACTIVE' },
          orderBy: { createdAt: 'desc' },
          include: {
            server: { select: { id: true, name: true } },
            website: { select: { id: true, name: true, serverId: true } },
          },
        }),
        this.prisma.alert.findMany({
          where: {
            status: 'CLOSED',
            closedAt: { gte: since24h },
          },
          orderBy: { closedAt: 'desc' },
          take: 5,
          include: {
            server: { select: { id: true, name: true } },
            website: { select: { id: true, name: true, serverId: true } },
          },
        }),
        this.prisma.alert.findMany({
          where: {
            createdAt: { gte: since24h },
            severity: { in: ['CRITICAL', 'WARNING'] },
          },
          select: { createdAt: true, severity: true },
        }),
        this.computeAvailability30d(),
      ]);

    const sitesByServer = new Map<string, typeof websites>();
    for (const w of websites) {
      if (!w.serverId) continue;
      const list = sitesByServer.get(w.serverId) ?? [];
      list.push(w);
      sitesByServer.set(w.serverId, list);
    }

    const vmsByServer = new Map<string, typeof vms>();
    for (const vm of vms) {
      const list = vmsByServer.get(vm.serverId) ?? [];
      list.push(vm);
      vmsByServer.set(vm.serverId, list);
    }

    const websitesById = new Map(websites.map((w) => [w.id, w]));

    const openActiveAlerts = activeAlerts.filter((a) =>
      isOpenAlertGlobally(a as NocAlert, websitesById),
    );

    const alertsByServer = new Map<string, NocAlert[]>();
    for (const server of servers) {
      const serverSites = sitesByServer.get(server.id) ?? [];
      const list = activeAlerts.filter((a) =>
        isOpenAlertForServer(a as NocAlert, server.id, serverSites),
      ) as NocAlert[];
      alertsByServer.set(server.id, list);
    }

    const hosts = servers.map((server) => {
      const isHyper = server.profile === 'PROXMOX';
      const serverSites = sitesByServer.get(server.id) ?? [];
      const monitored = serverSites.filter((s) => s.monitoringEnabled);
      const serverVms = vmsByServer.get(server.id) ?? [];
      const serverAlerts = alertsByServer.get(server.id) ?? [];

      const sites = {
        total: monitored.length,
        ok: monitored.filter((s) => s.status === 'UP').length,
        maintenance: monitored.filter((s) =>
          isMaintenance(s.status, s.lastStatusCode),
        ).length,
        degraded: monitored.filter((s) =>
          isDegraded(s.status, s.lastStatusCode),
        ).length,
        down: monitored.filter((s) => s.status === 'DOWN').length,
        off: serverSites.filter((s) => !s.monitoringEnabled).length,
      };

      const vmsSummary = {
        total: serverVms.length,
        ok: serverVms.filter((v) => v.status.toLowerCase() === 'running').length,
        stopped: serverVms.filter((v) => v.status.toLowerCase() === 'stopped')
          .length,
      };

      const criticalAlerts = serverAlerts.filter(
        (a) => a.severity === 'CRITICAL' && !isSslAlertTitle(a.title),
      ).length;
      const warningAlerts = serverAlerts.filter(
        (a) => a.severity === 'WARNING' && !isSslAlertTitle(a.title),
      ).length;
      const sslAlerts = serverAlerts.filter((a) => isSslAlertTitle(a.title))
        .length;

      let status: 'ok' | 'degraded' | 'critical' = 'ok';
      if (
        server.status === 'OFFLINE' ||
        sites.down > 0 ||
        criticalAlerts > 0
      ) {
        status = 'critical';
      } else if (
        server.status === 'DEGRADED' ||
        sites.degraded > 0 ||
        warningAlerts > 0 ||
        sslAlerts > 0
      ) {
        status = 'degraded';
      }

      const downSites = monitored
        .filter((s) => s.status === 'DOWN')
        .map((s) => s.name)
        .slice(0, 8);

      const metricsChrono = [...server.metrics].reverse();
      const latest = metricsChrono[metricsChrono.length - 1];
      const latencySamples = monitored
        .map((s) => s.lastResponseMs)
        .filter((n): n is number => n != null && n > 0);
      const latencyMs =
        latencySamples.length > 0
          ? Math.round(
              latencySamples.reduce((a, b) => a + b, 0) / latencySamples.length,
            )
          : null;

      const oldestAlert = serverAlerts.reduce<Date | null>((acc, a) => {
        const t = a.createdAt;
        if (!acc || t < acc) return t;
        return acc;
      }, null);

      let incidentSince: string | null = null;
      if (status === 'critical' || status === 'degraded') {
        if (oldestAlert) incidentSince = oldestAlert.toISOString();
        else if (server.status === 'OFFLINE' && server.lastSeenAt) {
          incidentSince = server.lastSeenAt.toISOString();
        }
      }

      return {
        id: server.id,
        name: server.name,
        hostname: server.hostname,
        tags: server.tags ?? [],
        type: isHyper ? ('hyperviseur' as const) : ('web' as const),
        status,
        sites: isHyper ? null : sites,
        vms: isHyper ? vmsSummary : null,
        downSites: isHyper ? [] : downSites,
        metrics: {
          cpu: latest?.cpuPercent ?? null,
          ram: latest?.memoryPercent ?? null,
          latency_ms: latencyMs,
          uptimeSeconds: latest?.uptimeSeconds ?? null,
          series: {
            cpu: metricsChrono.map((m) => m.cpuPercent),
            ram: metricsChrono.map((m) => m.memoryPercent),
          },
        },
        incidentSince,
      };
    });

    hosts.sort((a, b) => {
      const rank = { critical: 0, degraded: 1, ok: 2 };
      const d = rank[a.status] - rank[b.status];
      if (d !== 0) return d;
      return a.name.localeCompare(b.name, 'fr');
    });

    const serversOk = hosts.filter((h) => h.status === 'ok').length;
    const sitesMonitored = websites.filter((w) => w.monitoringEnabled);
    const sitesOk = sitesMonitored.filter((w) => w.status === 'UP').length;
    const sitesDown = sitesMonitored.filter((w) => w.status === 'DOWN').length;
    const sitesDegraded = sitesMonitored.filter((w) =>
      isDegraded(w.status, w.lastStatusCode),
    ).length;
    const vmsRunning = vms.filter((v) => v.status.toLowerCase() === 'running')
      .length;
    const critAlerts = openActiveAlerts.filter(
      (a) => a.severity === 'CRITICAL' && !isSslAlertTitle(a.title),
    ).length;
    const warnAlerts = openActiveAlerts.filter(
      (a) => a.severity === 'WARNING' && !isSslAlertTitle(a.title),
    ).length;
    const sslAlerts = openActiveAlerts.filter((a) => isSslAlertTitle(a.title))
      .length;
    const criticalHosts = hosts.filter((h) => h.status === 'critical');

    const feedAlerts = [
      ...openActiveAlerts.slice(0, 10).map((a) => ({
        time: a.createdAt.toISOString(),
        severity: isSslAlertTitle(a.title)
          ? ('ssl' as const)
          : a.severity === 'CRITICAL'
            ? ('crit' as const)
            : a.severity === 'WARNING'
              ? ('warn' as const)
              : ('info' as const),
        host: a.server?.name ?? a.website?.name ?? '—',
        message: a.title,
      })),
      ...recentClosed.slice(0, 3).map((a) => ({
        time: (a.closedAt ?? a.createdAt).toISOString(),
        severity: 'ok' as const,
        host: a.server?.name ?? a.website?.name ?? '—',
        message: `${a.title} — rétabli`,
      })),
    ]
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 10);

    const hourBuckets = new Map<number, { crit: number; warn: number }>();
    const now = new Date();
    for (let i = 0; i < 24; i++) {
      hourBuckets.set(i, { crit: 0, warn: 0 });
    }
    // Index 0 = 23h ago, 23 = current hour
    for (const a of created24h) {
      const ageH = Math.floor(
        (now.getTime() - a.createdAt.getTime()) / (60 * 60 * 1000),
      );
      const idx = 23 - Math.min(23, Math.max(0, ageH));
      const bucket = hourBuckets.get(idx)!;
      if (a.severity === 'CRITICAL') bucket.crit += 1;
      else bucket.warn += 1;
    }

    const history24h = Array.from({ length: 24 }, (_, i) => {
      const hour = new Date(
        now.getTime() - (23 - i) * 60 * 60 * 1000,
      ).getHours();
      const b = hourBuckets.get(i)!;
      return { hour, crit: b.crit, warn: b.warn };
    });

    const globalStatus =
      criticalHosts.length > 0 ? ('incident' as const) : ('ok' as const);

    return {
      generatedAt: now.toISOString(),
      global: {
        status: globalStatus,
        alerts: openActiveAlerts.length,
        criticalHosts: criticalHosts.length,
        criticalAlerts: critAlerts,
        warningAlerts: warnAlerts,
        sslAlerts,
      },
      kpis: {
        servers: { ok: serversOk, total: hosts.length },
        sites: {
          ok: sitesOk,
          total: sitesMonitored.length,
          down: sitesDown,
          degraded: sitesDegraded,
        },
        alerts: {
          active: openActiveAlerts.length,
          critical: critAlerts,
          warning: warnAlerts,
          ssl: sslAlerts,
        },
        vms: { ok: vmsRunning, total: vms.length },
        availability30d,
      },
      hosts,
      alerts: feedAlerts,
      history24h,
    };
  }
}
