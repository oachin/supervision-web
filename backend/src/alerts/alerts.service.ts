import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AlertStatus, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const SNOOZE_MS = 30 * 60 * 1000;

const alertInclude = {
  server: { select: { id: true, name: true, hostname: true } },
  website: {
    select: {
      id: true,
      name: true,
      url: true,
      serverId: true,
      server: { select: { id: true, name: true, hostname: true } },
    },
  },
  acknowledgedBy: { select: { id: true, name: true, email: true } },
  closedBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.AlertInclude;

@Injectable()
export class AlertsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  private fingerprint(data: { title: string; serverId?: string; websiteId?: string }) {
    return createHash('sha256')
      .update(`${data.title}|${data.serverId ?? ''}|${data.websiteId ?? ''}`)
      .digest('hex')
      .slice(0, 32);
  }

  private async logEvent(
    alertId: string | null,
    action: string,
    message?: string,
    userId?: string,
    details?: Record<string, unknown>,
    snapshot?: {
      alertTitle: string;
      alertSeverity: string;
      resourceName?: string;
      resourceType?: string;
    },
  ) {
    let resolvedSnapshot = snapshot;
    if (alertId && !resolvedSnapshot) {
      const alert = await this.prisma.alert.findUnique({
        where: { id: alertId },
        include: {
          server: { select: { name: true } },
          website: { select: { name: true } },
        },
      });
      if (alert) {
        resolvedSnapshot = {
          alertTitle: alert.title,
          alertSeverity: alert.severity,
          resourceName: alert.server?.name ?? alert.website?.name,
          resourceType: alert.serverId ? 'server' : alert.websiteId ? 'website' : undefined,
        };
      }
    }

    await this.prisma.alertEvent.create({
      data: {
        alertId: alertId ?? undefined,
        userId,
        action,
        message,
        details: details as Prisma.InputJsonValue,
        alertTitle: resolvedSnapshot?.alertTitle,
        alertSeverity: resolvedSnapshot?.alertSeverity,
        resourceName: resolvedSnapshot?.resourceName,
        resourceType: resolvedSnapshot?.resourceType,
      },
    });
  }

  async onResourceDeleted(params: {
    serverId?: string;
    websiteId?: string;
    resourceName: string;
    resourceType: 'server' | 'website';
    userId?: string;
  }) {
    const where: Prisma.AlertWhereInput = params.serverId
      ? { serverId: params.serverId }
      : { websiteId: params.websiteId };

    const alerts = await this.prisma.alert.findMany({ where });

    for (const alert of alerts) {
      const snapshot = {
        alertTitle: alert.title,
        alertSeverity: alert.severity,
        resourceName: params.resourceName,
        resourceType: params.resourceType,
      };

      if (alert.status === 'ACKNOWLEDGED' || alert.status === 'PENDING_CLOSE') {
        await this.logEvent(
          alert.id,
          'CLOSED',
          `Clôture automatique — ${params.resourceType === 'website' ? 'site' : 'serveur'} supprimé`,
          params.userId,
          {
            auto: true,
            origin: 'Suppression de la ressource',
            resolutionMethod: 'Ressource retirée de la supervision',
          },
          snapshot,
        );
      }

      await this.logEvent(
        alert.id,
        'RESOURCE_DELETED',
        `${params.resourceType === 'website' ? 'Site' : 'Serveur'} « ${params.resourceName} » supprimé de la supervision`,
        params.userId,
        { previousStatus: alert.status },
        snapshot,
      );

      await this.prisma.alertEvent.updateMany({
        where: { alertId: alert.id },
        data: {
          alertTitle: alert.title,
          alertSeverity: alert.severity,
          resourceName: params.resourceName,
          resourceType: params.resourceType,
        },
      });

      await this.prisma.alert.delete({ where: { id: alert.id } });
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processExpiredSnoozes() {
    const now = new Date();
    const expired = await this.prisma.alert.findMany({
      where: {
        status: 'ACKNOWLEDGED',
        snoozedUntil: { lt: now },
        issueResolvedAt: null,
      },
    });

    for (const alert of expired) {
      const updated = await this.prisma.alert.update({
        where: { id: alert.id },
        data: {
          status: 'ACTIVE',
          occurrenceCount: { increment: 1 },
        },
        include: alertInclude,
      });
      await this.logEvent(
        alert.id,
        'SNOOZE_EXPIRED',
        `Snooze expiré — réaffichage popup (occurrence ${updated.occurrenceCount})`,
        undefined,
        { occurrenceCount: updated.occurrenceCount },
      );
      void this.notifications.dispatchForAlert(updated, 'occurrence');
    }
  }

  async create(data: {
    title: string;
    message: string;
    severity: 'INFO' | 'WARNING' | 'CRITICAL';
    serverId?: string;
    websiteId?: string;
  }) {
    let serverId = data.serverId;
    if (data.websiteId && !serverId) {
      const website = await this.prisma.website.findUnique({
        where: { id: data.websiteId },
        select: { serverId: true },
      });
      if (website?.serverId) serverId = website.serverId;
    }

    const fp = this.fingerprint({ ...data, serverId });

    const existing = await this.prisma.alert.findFirst({
      where: {
        fingerprint: fp,
        status: { not: 'CLOSED' },
      },
    });

    if (existing) {
      const now = new Date();
      const snoozeActive =
        existing.status === 'ACKNOWLEDGED' &&
        existing.snoozedUntil &&
        existing.snoozedUntil > now;

      if (snoozeActive) {
        return this.prisma.alert.update({
          where: { id: existing.id },
          data: { message: data.message, severity: data.severity },
          include: alertInclude,
        });
      }

      const updated = await this.prisma.alert.update({
        where: { id: existing.id },
        data: {
          message: data.message,
          severity: data.severity,
          issueResolvedAt: null,
          status: existing.status === 'PENDING_CLOSE' ? 'ACTIVE' : existing.status,
        },
        include: alertInclude,
      });

      if (existing.status === 'PENDING_CLOSE') {
        await this.logEvent(existing.id, 'REOPENED', 'Le problème est réapparu');
        void this.notifications.dispatchForAlert(updated, 'occurrence');
      }

      return updated;
    }

    const alert = await this.prisma.alert.create({
      data: {
        ...data,
        serverId,
        fingerprint: fp,
        status: 'ACTIVE',
        occurrenceCount: 1,
      },
      include: alertInclude,
    });

    await this.logEvent(alert.id, 'CREATED', data.message);
    void this.notifications.dispatchForAlert(alert, 'created');
    return alert;
  }

  async onIssueResolved(params: { serverId?: string; websiteId?: string; titleContains?: string }) {
    const where: Prisma.AlertWhereInput = {
      status: { in: ['ACTIVE', 'ACKNOWLEDGED'] },
      issueResolvedAt: null,
    };
    if (params.serverId) where.serverId = params.serverId;
    if (params.websiteId) where.websiteId = params.websiteId;
    if (params.titleContains) where.title = { contains: params.titleContains };

    const alerts = await this.prisma.alert.findMany({ where });

    for (const alert of alerts) {
      await this.prisma.alert.update({
        where: { id: alert.id },
        data: {
          issueResolvedAt: new Date(),
          status: 'PENDING_CLOSE',
        },
      });
      await this.logEvent(alert.id, 'ISSUE_RESOLVED', 'Le problème semble résolu — en attente de clôture');
    }
  }

  /** Clôture automatique sans intervention (ex. faux positif SSL résolu). */
  async autoCloseResolvedByTitle(params: {
    websiteId?: string;
    serverId?: string;
    titleContains: string;
    origin: string;
    resolutionMethod: string;
  }) {
    const where: Prisma.AlertWhereInput = {
      status: { in: ['ACTIVE', 'ACKNOWLEDGED', 'PENDING_CLOSE'] },
      title: { contains: params.titleContains },
    };
    if (params.websiteId) where.websiteId = params.websiteId;
    if (params.serverId) where.serverId = params.serverId;

    const alerts = await this.prisma.alert.findMany({ where });

    for (const alert of alerts) {
      await this.prisma.alert.update({
        where: { id: alert.id },
        data: {
          status: 'CLOSED',
          resolved: true,
          resolvedAt: new Date(),
          closedAt: new Date(),
          origin: params.origin.trim(),
          resolutionMethod: params.resolutionMethod.trim(),
        },
      });
      await this.logEvent(
        alert.id,
        'CLOSED',
        `Clôture automatique — ${params.origin}`,
        undefined,
        { auto: true, resolutionMethod: params.resolutionMethod },
      );
    }
  }

  async getPendingPopup() {
    return this.prisma.alert.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      include: alertInclude,
    });
  }

  async getSummary() {
    const [active, acknowledged, pendingClose, closed] = await Promise.all([
      this.prisma.alert.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
        include: alertInclude,
      }),
      this.prisma.alert.findMany({
        where: { status: 'ACKNOWLEDGED' },
        orderBy: { acknowledgedAt: 'desc' },
        include: alertInclude,
      }),
      this.prisma.alert.findMany({
        where: { status: 'PENDING_CLOSE' },
        orderBy: { issueResolvedAt: 'desc' },
        include: alertInclude,
      }),
      this.prisma.alert.findMany({
        where: { status: 'CLOSED' },
        orderBy: { closedAt: 'desc' },
        take: 50,
        include: alertInclude,
      }),
    ]);

    return {
      counts: {
        active: active.length,
        acknowledged: acknowledged.length,
        pendingClose: pendingClose.length,
        closed: closed.length,
      },
      active,
      acknowledged,
      pendingClose,
      closed,
    };
  }

  async findAll(status?: AlertStatus) {
    return this.prisma.alert.findMany({
      where: status ? { status } : { status: { not: 'CLOSED' } },
      orderBy: { createdAt: 'desc' },
      include: alertInclude,
      take: 100,
    });
  }

  async findOne(id: string) {
    const alert = await this.prisma.alert.findUnique({
      where: { id },
      include: {
        ...alertInclude,
        events: {
          orderBy: { createdAt: 'asc' },
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });
    if (!alert) throw new NotFoundException('Alerte introuvable');
    return alert;
  }

  async addNote(id: string, userId: string, message: string) {
    const alert = await this.prisma.alert.findUnique({ where: { id } });
    if (!alert) throw new NotFoundException('Alerte introuvable');
    if (alert.status === 'CLOSED') {
      throw new BadRequestException('Impossible d\'ajouter une note à une alerte clôturée');
    }
    const trimmed = message?.trim();
    if (!trimmed) throw new BadRequestException('La note ne peut pas être vide');

    await this.logEvent(id, 'NOTE', trimmed, userId);
    return this.findOne(id);
  }

  async getEvents(limit = 200) {
    return this.prisma.alertEvent.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true } },
        alert: {
          select: {
            id: true,
            title: true,
            severity: true,
            status: true,
            occurrenceCount: true,
            server: { select: { name: true } },
            website: { select: { name: true } },
          },
        },
      },
    });
  }

  async acknowledge(id: string, userId: string) {
    const alert = await this.prisma.alert.findUnique({ where: { id } });
    if (!alert) throw new NotFoundException('Alerte introuvable');
    if (alert.status !== 'ACTIVE') {
      throw new BadRequestException('Cette alerte ne nécessite pas d\'acquittement');
    }

    const snoozedUntil = new Date(Date.now() + SNOOZE_MS);

    const updated = await this.prisma.alert.update({
      where: { id },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledged: true,
        acknowledgedById: userId,
        acknowledgedAt: new Date(),
        snoozedUntil,
      },
      include: alertInclude,
    });

    await this.logEvent(
      id,
      'ACKNOWLEDGED',
      `Acquittée par l'utilisateur — snooze 30 min`,
      userId,
      { snoozedUntil: snoozedUntil.toISOString(), occurrenceCount: alert.occurrenceCount },
    );

    return updated;
  }

  async close(id: string, userId: string, origin: string, resolutionMethod: string) {
    const alert = await this.prisma.alert.findUnique({ where: { id } });
    if (!alert) throw new NotFoundException('Alerte introuvable');
    if (alert.status !== 'PENDING_CLOSE') {
      throw new BadRequestException('Seules les alertes en attente de clôture peuvent être clôturées');
    }
    if (!origin?.trim() || !resolutionMethod?.trim()) {
      throw new BadRequestException('Origine et méthode de résolution requises');
    }

    const updated = await this.prisma.alert.update({
      where: { id },
      data: {
        status: 'CLOSED',
        resolved: true,
        resolvedAt: new Date(),
        closedAt: new Date(),
        closedById: userId,
        origin: origin.trim(),
        resolutionMethod: resolutionMethod.trim(),
      },
      include: alertInclude,
    });

    await this.logEvent(id, 'CLOSED', `Clôturée — ${origin}`, userId, { resolutionMethod });
    return updated;
  }
}
