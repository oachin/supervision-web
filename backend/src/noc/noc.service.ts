import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

function isMaintenance(status: string, statusCode?: number | null) {
  return status === 'DEGRADED' && statusCode === 503;
}

function isDegraded(status: string, statusCode?: number | null) {
  return status === 'DEGRADED' && !isMaintenance(status, statusCode);
}

@Injectable()
export class NocService {
  constructor(private prisma: PrismaService) {}

  async getState() {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [servers, websites, vms, activeAlerts, recentClosed, created24h] =
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
            website: { select: { name: true, serverId: true } },
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
            website: { select: { name: true } },
          },
        }),
        this.prisma.alert.findMany({
          where: {
            createdAt: { gte: since24h },
            severity: { in: ['CRITICAL', 'WARNING'] },
          },
          select: { createdAt: true, severity: true },
        }),
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

    const alertsByServer = new Map<string, typeof activeAlerts>();
    for (const a of activeAlerts) {
      const sid = a.serverId ?? a.website?.serverId ?? null;
      if (!sid) continue;
      const list = alertsByServer.get(sid) ?? [];
      list.push(a);
      alertsByServer.set(sid, list);
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

      const criticalAlerts = serverAlerts.filter((a) => a.severity === 'CRITICAL')
        .length;
      const warningAlerts = serverAlerts.filter((a) => a.severity === 'WARNING')
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
        (isHyper && vmsSummary.stopped > 0 && vmsSummary.ok < vmsSummary.total)
      ) {
        // stopped VMs alone are normal — don't degrade hyper on stopped
        if (
          server.status === 'DEGRADED' ||
          sites.degraded > 0 ||
          warningAlerts > 0
        ) {
          status = 'degraded';
        }
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
    const critAlerts = activeAlerts.filter((a) => a.severity === 'CRITICAL')
      .length;
    const warnAlerts = activeAlerts.filter((a) => a.severity === 'WARNING')
      .length;
    const criticalHosts = hosts.filter((h) => h.status === 'critical');

    const feedAlerts = [
      ...activeAlerts.slice(0, 10).map((a) => ({
        time: a.createdAt.toISOString(),
        severity:
          a.severity === 'CRITICAL'
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
        alerts: activeAlerts.length,
        criticalHosts: criticalHosts.length,
        criticalAlerts: critAlerts,
        warningAlerts: warnAlerts,
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
          active: activeAlerts.length,
          critical: critAlerts,
          warning: warnAlerts,
        },
        vms: { ok: vmsRunning, total: vms.length },
        availability30d: null as number | null,
      },
      hosts,
      alerts: feedAlerts,
      history24h,
    };
  }
}
