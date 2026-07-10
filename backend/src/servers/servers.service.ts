import { Injectable, NotFoundException } from '@nestjs/common';
import { ServerStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto.service';
import { AuditService } from '../audit/audit.service';
import { AlertsService } from '../alerts/alerts.service';
import { CreateServerDto, UpdateServerDto } from '../common/dto';

@Injectable()
export class ServersService {
  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private audit: AuditService,
    private alerts: AlertsService,
  ) {}

  private sanitize(server: Record<string, unknown>) {
    const { agentKey, pleskApiKey, ...rest } = server;
    return {
      ...rest,
      hasPleskApiKey: !!pleskApiKey,
    };
  }

  async findAll() {
    const servers = await this.prisma.server.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { websites: true, metrics: true } },
      },
    });
    return servers.map((s) => this.sanitize(s as unknown as Record<string, unknown>));
  }

  async findOne(id: string) {
    const server = await this.prisma.server.findUnique({
      where: { id },
      include: {
        websites: { select: { id: true, name: true, url: true, status: true } },
        metrics: {
          take: 60,
          orderBy: { collectedAt: 'desc' },
        },
      },
    });
    if (!server) throw new NotFoundException('Serveur introuvable');
    return this.sanitize(server as unknown as Record<string, unknown>);
  }

  async create(dto: CreateServerDto, userId: string) {
    const plainKey = this.crypto.generateAgentKey();
    const hashedKey = this.crypto.hashAgentKey(plainKey);

    const server = await this.prisma.server.create({
      data: {
        name: dto.name,
        hostname: dto.hostname,
        ipAddress: dto.ipAddress,
        hasPlesk: dto.hasPlesk ?? false,
        pleskUrl: dto.pleskUrl,
        pleskApiKey: dto.pleskApiKey ? this.crypto.encrypt(dto.pleskApiKey) : null,
        agentKey: hashedKey,
        tags: dto.tags ?? [],
        notes: dto.notes,
      },
    });

    await this.audit.log(userId, 'SERVER_CREATED', 'servers', { serverId: server.id });

    return {
      ...this.sanitize(server as unknown as Record<string, unknown>),
      agentKeyPlain: plainKey,
    };
  }

  async update(id: string, dto: UpdateServerDto, userId: string) {
    const server = await this.prisma.server.findUnique({ where: { id } });
    if (!server) throw new NotFoundException('Serveur introuvable');

    const data: Record<string, unknown> = { ...dto };
    if (dto.pleskApiKey) {
      data.pleskApiKey = this.crypto.encrypt(dto.pleskApiKey);
    }

    const updated = await this.prisma.server.update({ where: { id }, data });
    await this.audit.log(userId, 'SERVER_UPDATED', 'servers', { serverId: id });
    return this.sanitize(updated as unknown as Record<string, unknown>);
  }

  async regenerateKey(id: string, userId: string) {
    const server = await this.prisma.server.findUnique({ where: { id } });
    if (!server) throw new NotFoundException('Serveur introuvable');

    const plainKey = this.crypto.generateAgentKey();
    const hashedKey = this.crypto.hashAgentKey(plainKey);

    await this.prisma.server.update({
      where: { id },
      data: { agentKey: hashedKey },
    });

    await this.audit.log(userId, 'SERVER_KEY_REGENERATED', 'servers', { serverId: id });

    return { agentKeyPlain: plainKey };
  }

  async remove(id: string, userId: string) {
    const server = await this.prisma.server.findUnique({ where: { id } });
    if (!server) throw new NotFoundException('Serveur introuvable');

    await this.alerts.onResourceDeleted({
      serverId: id,
      resourceName: server.name,
      resourceType: 'server',
      userId,
    });

    await this.prisma.server.delete({ where: { id } });
    await this.audit.log(userId, 'SERVER_DELETED', 'servers', { serverId: id });
    return { success: true };
  }

  async getMetrics(id: string, hours = 24) {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.prisma.serverMetric.findMany({
      where: { serverId: id, collectedAt: { gte: since } },
      orderBy: { collectedAt: 'asc' },
    });
  }

  determineStatus(cpu: number, memory: number, disk: number, lastSeen: Date | null): ServerStatus {
    if (!lastSeen || Date.now() - lastSeen.getTime() > 5 * 60 * 1000) {
      return 'OFFLINE';
    }
    if (cpu > 90 || memory > 90 || disk > 95) {
      return 'DEGRADED';
    }
    return 'ONLINE';
  }
}
