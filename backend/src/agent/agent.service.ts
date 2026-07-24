import { Injectable } from '@nestjs/common';
import { Server } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ServersService } from '../servers/servers.service';
import { AlertsService } from '../alerts/alerts.service';
import { AgentMetricsDto } from '../common/dto';

const PLESK_CRITICAL_SERVICE_GROUPS = [
  ['sw-engine'],
  ['sw-cp-server'],
  ['nginx'],
  ['apache2', 'httpd'],
  ['mariadb', 'mysql'],
] as const;

const PROXMOX_BACKUP_STALE_MS = 48 * 60 * 60 * 1000;
const PROXMOX_BACKUP_LONG_MS = 6 * 60 * 60 * 1000;

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

    if (server.profile === 'PROXMOX') {
      if (dto.proxmoxVms?.length) {
        await this.syncProxmoxVms(server.id, dto.proxmoxVms);
      }
      if (dto.proxmoxBackups?.length) {
        await this.syncProxmoxBackups(server, dto.proxmoxBackups);
      }
      await this.evaluateProxmoxBackupAlerts(server);
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

  private pleskServiceLabel(serviceName: string): string {
    if (serviceName === 'httpd' || serviceName === 'apache2') {
      return `Apache (${serviceName})`;
    }
    if (serviceName === 'mysql' || serviceName === 'mariadb') {
      return `MariaDB (${serviceName})`;
    }
    return serviceName;
  }

  private async processPleskServiceAlerts(
    server: Server,
    services: Record<string, string>,
  ) {
    for (const aliases of PLESK_CRITICAL_SERVICE_GROUPS) {
      const serviceName = aliases.find((name) => services[name] !== undefined);
      if (!serviceName) continue;

      const state = services[serviceName];
      const label = this.pleskServiceLabel(serviceName);

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

  private async syncProxmoxVms(serverId: string, vms: NonNullable<AgentMetricsDto['proxmoxVms']>) {
    const now = new Date();
    for (const vm of vms) {
      const row = await this.prisma.proxmoxVm.upsert({
        where: { serverId_vmid: { serverId, vmid: vm.vmid } },
        create: {
          serverId,
          vmid: vm.vmid,
          name: vm.name,
          status: vm.status,
          cpus: vm.cpus,
          maxmemMb: vm.maxmemMb,
          maxdiskGb: vm.maxdiskGb,
          lastSeenAt: now,
        },
        update: {
          name: vm.name,
          status: vm.status,
          cpus: vm.cpus,
          maxmemMb: vm.maxmemMb,
          maxdiskGb: vm.maxdiskGb,
          lastSeenAt: now,
        },
      });

      if (vm.status === 'running' && vm.cpuPercent != null && vm.memUsedMb != null) {
        await this.prisma.proxmoxVmMetric.create({
          data: {
            vmId: row.id,
            cpuPercent: vm.cpuPercent,
            memUsedMb: vm.memUsedMb,
            memTotalMb: vm.maxmemMb,
          },
        });
      }
    }
  }

  private async syncProxmoxBackups(
    server: Server,
    backups: NonNullable<AgentMetricsDto['proxmoxBackups']>,
  ) {
    for (const backup of backups) {
      const sizeBytes =
        backup.sizeBytes != null ? BigInt(Math.trunc(backup.sizeBytes)) : null;

      await this.prisma.proxmoxBackup.upsert({
        where: { serverId_upid: { serverId: server.id, upid: backup.upid } },
        create: {
          serverId: server.id,
          upid: backup.upid,
          vmid: backup.vmid,
          vmName: backup.vmName,
          status: backup.status,
          startedAt: new Date(backup.startedAt),
          finishedAt: backup.finishedAt ? new Date(backup.finishedAt) : null,
          durationSec: backup.durationSec,
          error: backup.error,
          sizeBytes,
        },
        update: {
          vmid: backup.vmid,
          vmName: backup.vmName,
          status: backup.status,
          startedAt: new Date(backup.startedAt),
          finishedAt: backup.finishedAt ? new Date(backup.finishedAt) : null,
          durationSec: backup.durationSec,
          error: backup.error,
          sizeBytes,
        },
      });
    }
  }

  private async evaluateProxmoxBackupAlerts(server: Server) {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const staleBefore = new Date(now.getTime() - PROXMOX_BACKUP_STALE_MS);

    const backups = await this.prisma.proxmoxBackup.findMany({
      where: {
        serverId: server.id,
        OR: [{ startedAt: { gte: weekAgo } }, { status: 'running' }],
      },
      orderBy: { startedAt: 'asc' },
    });

    const latestOkByVmid = new Map<number, Date>();
    const okBackups = await this.prisma.proxmoxBackup.findMany({
      where: { serverId: server.id, status: 'ok', vmid: { not: null } },
      select: { vmid: true, startedAt: true },
      orderBy: { startedAt: 'desc' },
    });
    for (const ok of okBackups) {
      if (ok.vmid != null && !latestOkByVmid.has(ok.vmid)) {
        latestOkByVmid.set(ok.vmid, ok.startedAt);
      }
    }

    const longRunningLabels = new Set<string>();

    for (const backup of backups) {
      const vmLabel = String(backup.vmid ?? '?');

      if (backup.status === 'failed' || backup.status === 'warning') {
        const newerOk =
          backup.vmid != null &&
          latestOkByVmid.has(backup.vmid) &&
          latestOkByVmid.get(backup.vmid)!.getTime() > backup.startedAt.getTime();

        if (newerOk) {
          await this.alerts.onIssueResolved({
            serverId: server.id,
            titleContains: `Backup Proxmox échoué: ${server.name} VM ${backup.vmid}`,
          });
          continue;
        }

        await this.alerts.create({
          title: `Backup Proxmox échoué: ${server.name} VM ${vmLabel}`,
          message: backup.error ?? 'Job vzdump en échec',
          severity: backup.status === 'failed' ? 'CRITICAL' : 'WARNING',
          serverId: server.id,
        });
        continue;
      }

      if (backup.status === 'running') {
        if (now.getTime() - backup.startedAt.getTime() > PROXMOX_BACKUP_LONG_MS) {
          longRunningLabels.add(vmLabel);
          await this.alerts.create({
            title: `Backup Proxmox trop long: ${server.name} VM ${vmLabel}`,
            message: `Job vzdump en cours depuis plus de 6 heures (upid ${backup.upid})`,
            severity: 'WARNING',
            serverId: server.id,
          });
        }
      }
    }

    const tropLongCandidates = new Set(backups.map((b) => String(b.vmid ?? '?')));
    for (const label of tropLongCandidates) {
      if (!longRunningLabels.has(label)) {
        await this.alerts.onIssueResolved({
          serverId: server.id,
          titleContains: `Backup Proxmox trop long: ${server.name} VM ${label}`,
        });
      }
    }

    const vms = await this.prisma.proxmoxVm.findMany({
      where: { serverId: server.id },
    });

    const anyBackupCount = await this.prisma.proxmoxBackup.count({
      where: { serverId: server.id },
    });

    for (const vm of vms) {
      const latestOk = latestOkByVmid.get(vm.vmid) ?? null;
      const historyForVmid = await this.prisma.proxmoxBackup.count({
        where: { serverId: server.id, vmid: vm.vmid },
      });
      const hasBaseline = historyForVmid > 0 || anyBackupCount > 0;

      if (!hasBaseline) continue;

      if (!latestOk || latestOk < staleBefore) {
        await this.alerts.create({
          title: `Backup Proxmox manquant: ${server.name} VM ${vm.vmid}`,
          message: latestOk
            ? `Aucun backup OK depuis ${latestOk.toISOString()} pour ${vm.name}`
            : `Aucun backup OK connu pour la VM ${vm.name} (${vm.vmid})`,
          severity: 'WARNING',
          serverId: server.id,
        });
      } else {
        await this.alerts.onIssueResolved({
          serverId: server.id,
          titleContains: `Backup Proxmox manquant: ${server.name} VM ${vm.vmid}`,
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
