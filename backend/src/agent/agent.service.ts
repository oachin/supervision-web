import { Injectable } from '@nestjs/common';
import { Server } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ServersService } from '../servers/servers.service';
import { AlertsService } from '../alerts/alerts.service';
import { AgentMetricsDto } from '../common/dto';

const PLESK_CRITICAL_SERVICES = ['nginx', 'apache2', 'httpd', 'sw-engine', 'mariadb', 'mysql'] as const;

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
    const serverUpdates: Record<string, unknown> = {
      status,
      lastSeenAt: now,
      osVersion: dto.osVersion ?? server.osVersion,
    };

    if (dto.hostname?.trim() && (server.hostname === 'en-attente' || !server.hostname)) {
      serverUpdates.hostname = dto.hostname.trim();
    }

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
        data: serverUpdates,
      }),
    ]);

    if (server.profile === 'PLESK' && dto.pleskWebsites?.length) {
      await this.syncPleskWebsites(server.id, dto.pleskWebsites);
    }

    if (server.profile === 'PLESK' && dto.pleskServices) {
      await this.processPleskServiceAlerts(server, dto.pleskServices);
    }

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

  private async syncPleskWebsites(
    serverId: string,
    sites: { name: string; url: string }[],
  ) {
    for (const site of sites) {
      const url = site.url.startsWith('http') ? site.url : `https://${site.url}`;
      const normalized = url.replace(/\/$/, '') + '/';

      const existing = await this.prisma.website.findFirst({
        where: { serverId, url: { in: [url, normalized, url.replace(/\/$/, '')] } },
      });

      if (existing) {
        if (existing.source === 'agent' && existing.name !== site.name) {
          await this.prisma.website.update({
            where: { id: existing.id },
            data: { name: site.name },
          });
        }
        continue;
      }

      await this.prisma.website.create({
        data: {
          name: site.name,
          url: normalized,
          serverId,
          source: 'agent',
          checkMode: 'EXTERNAL',
          sslEnabled: url.startsWith('https'),
        },
      });
    }
  }

  private async processPleskServiceAlerts(
    server: Server,
    services: Record<string, string>,
  ) {
    for (const serviceName of PLESK_CRITICAL_SERVICES) {
      const state = services[serviceName];
      if (!state) continue;

      const label = serviceName === 'httpd' ? 'Apache (httpd)' : serviceName;

      if (state === 'running') {
        await this.alerts.onIssueResolved({
          serverId: server.id,
          titleContains: `Service ${label}`,
        });
        continue;
      }

      if (state === 'stopped' || state === 'inactive' || state === 'failed' || state === 'dead') {
        await this.alerts.create({
          title: `Service Plesk arrêté: ${label}`,
          message: `${server.name} — état systemctl: ${state}`,
          severity: 'CRITICAL',
          serverId: server.id,
        });
      }
    }
  }

  async heartbeat(server: Server) {
    await this.prisma.server.update({
      where: { id: server.id },
      data: { lastSeenAt: new Date(), status: 'ONLINE' },
    });
    return { success: true };
  }
}
