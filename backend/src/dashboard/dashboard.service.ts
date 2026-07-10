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
      activeAlerts,
      recentAlerts,
      servers,
      websites,
    ] = await Promise.all([
      this.prisma.server.count(),
      this.prisma.server.count({ where: { status: 'ONLINE' } }),
      this.prisma.server.count({ where: { status: 'OFFLINE' } }),
      this.prisma.server.count({ where: { status: 'DEGRADED' } }),
      this.prisma.website.count(),
      this.prisma.website.count({ where: { status: 'UP' } }),
      this.prisma.website.count({ where: { status: 'DOWN' } }),
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
        select: {
          id: true,
          name: true,
          hostname: true,
          status: true,
          lastSeenAt: true,
          hasPlesk: true,
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
        select: {
          id: true,
          name: true,
          url: true,
          status: true,
          lastCheckAt: true,
          lastResponseMs: true,
          sslExpiresAt: true,
        },
        orderBy: { name: 'asc' },
      }),
    ]);

    return {
      summary: {
        servers: { total: serversTotal, online: serversOnline, offline: serversOffline, degraded: serversDegraded },
        websites: { total: websitesTotal, up: websitesUp, down: websitesDown },
        activeAlerts,
      },
      recentAlerts,
      servers,
      websites,
    };
  }
}
