import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
      activeAlerts,
      recentAlerts,
      serversInAlert,
      websitesInAlert,
    ] = await Promise.all([
      this.prisma.server.count(),
      this.prisma.server.count({ where: { status: 'ONLINE' } }),
      this.prisma.server.count({ where: { status: 'OFFLINE' } }),
      this.prisma.server.count({ where: { status: 'DEGRADED' } }),
      this.prisma.website.count(),
      this.prisma.website.count({ where: { status: 'UP' } }),
      this.prisma.website.count({ where: { status: 'DOWN' } }),
      this.prisma.website.count({ where: { status: 'DEGRADED' } }),
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
        where: { status: { in: ['DOWN', 'DEGRADED'] } },
        select: {
          id: true,
          name: true,
          url: true,
          status: true,
          checkMode: true,
          externalStatus: true,
          internalStatus: true,
          lastCheckAt: true,
          lastResponseMs: true,
          lastExternalResponseMs: true,
          lastInternalResponseMs: true,
          sslExpiresAt: true,
        },
        orderBy: { name: 'asc' },
        take: 20,
      }),
    ]);

    return {
      summary: {
        servers: { total: serversTotal, online: serversOnline, offline: serversOffline, degraded: serversDegraded },
        websites: { total: websitesTotal, up: websitesUp, down: websitesDown, degraded: websitesDegraded },
        activeAlerts,
      },
      recentAlerts,
      servers: serversInAlert,
      websites: websitesInAlert,
    };
  }
}
