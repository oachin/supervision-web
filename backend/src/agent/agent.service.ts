import { Injectable } from '@nestjs/common';
import { Server } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ServersService } from '../servers/servers.service';
import { AlertsService } from '../alerts/alerts.service';
import { AgentMetricsDto } from '../common/dto';

@Injectable()
export class AgentService {
  constructor(
    private prisma: PrismaService,
    private servers: ServersService,
    private alerts: AlertsService,
  ) {}

  async recordMetrics(server: Server, dto: AgentMetricsDto) {
    const now = new Date();
    const status = this.servers.determineStatus(
      dto.cpuPercent,
      dto.memoryPercent,
      dto.diskPercent,
      now,
    );

    const previousStatus = server.status;

    await this.prisma.$transaction([
      this.prisma.serverMetric.create({
        data: {
          serverId: server.id,
          cpuPercent: dto.cpuPercent,
          memoryPercent: dto.memoryPercent,
          memoryUsedMb: dto.memoryUsedMb,
          memoryTotalMb: dto.memoryTotalMb,
          diskPercent: dto.diskPercent,
          diskUsedGb: dto.diskUsedGb,
          diskTotalGb: dto.diskTotalGb,
          loadAvg1: dto.loadAvg1,
          loadAvg5: dto.loadAvg5,
          loadAvg15: dto.loadAvg15,
          uptimeSeconds: dto.uptimeSeconds,
          pleskDomains: dto.pleskDomains,
          pleskServices: dto.pleskServices,
        },
      }),
      this.prisma.server.update({
        where: { id: server.id },
        data: {
          status,
          lastSeenAt: now,
          osVersion: dto.osVersion ?? server.osVersion,
        },
      }),
    ]);

    if (previousStatus !== 'OFFLINE' && status === 'OFFLINE') {
      await this.alerts.create({
        title: `Serveur hors ligne: ${server.name}`,
        message: `Le serveur ${server.hostname} ne répond plus.`,
        severity: 'CRITICAL',
        serverId: server.id,
      });
    }

    if (previousStatus === 'OFFLINE' && status === 'ONLINE') {
      await this.alerts.onIssueResolved({
        serverId: server.id,
        titleContains: 'hors ligne',
      });
    }

    if (status === 'DEGRADED') {
      const issues: string[] = [];
      if (dto.cpuPercent > 90) issues.push(`CPU ${dto.cpuPercent.toFixed(0)}%`);
      if (dto.memoryPercent > 90) issues.push(`RAM ${dto.memoryPercent.toFixed(0)}%`);
      if (dto.diskPercent > 95) issues.push(`Disque ${dto.diskPercent.toFixed(0)}%`);

      if (issues.length) {
        await this.alerts.create({
          title: `Serveur dégradé: ${server.name}`,
          message: issues.join(', '),
          severity: 'WARNING',
          serverId: server.id,
        });
      }
    } else if (previousStatus === 'DEGRADED' && status === 'ONLINE') {
      await this.alerts.onIssueResolved({
        serverId: server.id,
        titleContains: 'dégradé',
      });
    }

    return { success: true, status };
  }

  async heartbeat(server: Server) {
    await this.prisma.server.update({
      where: { id: server.id },
      data: { lastSeenAt: new Date(), status: 'ONLINE' },
    });
    return { success: true };
  }
}
