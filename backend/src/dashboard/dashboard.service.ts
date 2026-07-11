import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const monitoredWebsite = { monitoringEnabled: true } as const;

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getOverview() {
    const [
      serversTotal,
      serversOnline,
      serversOffline,
      serversDegraded,
      websitesTotal,
      websitesUp,
      websitesDown,
      websitesDegraded,
      websitesMaintenance,
      websitesDisabled,
      activeAlerts,
      recentAlerts,
      serversInAlert,
      websitesInAlert,
      disabledWebsites,
    ] = await Promise.all([
      this.prisma.server.count(),
      this.prisma.server.count({ where: { status: 'ONLINE' } }),
      this.prisma.server.count({ where: { status: 'OFFLINE' } }),
      this.prisma.server.count({ where: { status: 'DEGRADED' } }),
      this.prisma.website.count({ where: monitoredWebsite }),
      this.prisma.website.count({ where: { ...monitoredWebsite, status: 'UP' } }),
      this.prisma.website.count({ where: { ...monitoredWebsite, status: 'DOWN' } }),
      this.prisma.website.count({
        where: { ...monitoredWebsite, status: 'DEGRADED', NOT: { lastStatusCode: 503 } },
      }),
      this.prisma.website.count({
        where: { ...monitoredWebsite, status: 'DEGRADED', lastStatusCode: 503 },
      }),
      this.prisma.website.count({ where: { monitoringEnabled: false } }),
      this.prisma.alert.count({ where: { status: { in: ['ACTIVE', 'ACKNOWLEDGED'] } } }),
      this.prisma.alert.findMany({
        where: { status: { not: 'CLOSED' } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          server: { select: { name: true } },
          website: { select: { name: true, url: true } },
        },
      }),
      this.prisma.server.findMany({
        where: { status: { in: ['OFFLINE', 'DEGRADED'] } },
        select: {
          id: true,
          name: true,
          hostname: true,
          status: true,
          lastSeenAt: true,
          hasPlesk: true,
          profile: true,
          metrics: {
            take: 1,
            orderBy: { collectedAt: 'desc' },
            select: {
              cpuPercent: true,
              memoryPercent: true,
              diskPercent: true,
              collectedAt: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.website.findMany({
        where: {
          ...monitoredWebsite,
          OR: [
            { status: 'DOWN' },
            { status: 'DEGRADED', NOT: { lastStatusCode: 503 } },
          ],
        },
        select: {
          id: true,
          name: true,
          url: true,
          status: true,
          lastStatusCode: true,
          monitoringEnabled: true,
          checkMode: true,
          lastCheckAt: true,
          lastResponseMs: true,
          lastExternalResponseMs: true,
          sslExpiresAt: true,
          sslDaysRemaining: true,
        },
        orderBy: { name: 'asc' },
        take: 20,
      }),
      this.prisma.website.findMany({
        where: { monitoringEnabled: false },
        select: {
          id: true,
          name: true,
          url: true,
          lastCheckAt: true,
        },
        orderBy: { name: 'asc' },
        take: 10,
      }),
    ]);

    return {
      summary: {
        servers: { total: serversTotal, online: serversOnline, offline: serversOffline, degraded: serversDegraded },
        websites: {
          total: websitesTotal,
          up: websitesUp,
          down: websitesDown,
          degraded: websitesDegraded,
          maintenance: websitesMaintenance,
          disabled: websitesDisabled,
        },
        activeAlerts,
      },
      recentAlerts,
      servers: serversInAlert,
      websites: websitesInAlert,
      disabledWebsites,
    };
  }
}
