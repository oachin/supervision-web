import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AlertStatus, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

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

      if (alert.status !== 'CLOSED') {
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

  /** Migre les anciens statuts d'acquittement vers le cycle simplifié ACTIVE / CLOSED. */
  @Cron(CronExpression.EVERY_MINUTE)
  async migrateLegacyStatuses() {
    const now = new Date();

    await this.prisma.alert.updateMany({
      where: { status: 'ACKNOWLEDGED' },
      data: {
        status: 'ACTIVE',
        snoozedUntil: null,
        acknowledged: false,
      },
    });

    const pendingClose = await this.prisma.alert.findMany({
      where: { status: 'PENDING_CLOSE' },
    });

    for (const alert of pendingClose) {
      await this.prisma.alert.update({
        where: { id: alert.id },
        data: {
          status: 'CLOSED',
          resolved: true,
          resolvedAt: alert.resolvedAt ?? now,
          closedAt: now,
          issueResolvedAt: alert.issueResolvedAt ?? now,
          origin: alert.origin ?? 'Résolution automatique',
          resolutionMethod: alert.resolutionMethod ?? 'Condition plus détectée',
        },
      });
      await this.logEvent(
        alert.id,
        'CLOSED',
        'Clôture automatique — migration (fin du cycle d\'acquittement)',
        undefined,
        { auto: true, origin: 'migration' },
      );
    }
  }

  async create(data: {
    title: string;
    message: string;
    severity: 'INFO' | 'WARNING' | 'CRITICAL';
    serverId?: string;
    websiteId?: string;
    /**
     * If set, do not reopen a CLOSED alert that was closed at/after this
     * incident start (manual close must stick until a newer failure).
     */
    issueStartedAt?: Date;
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
        status: { in: ['ACTIVE', 'ACKNOWLEDGED', 'PENDING_CLOSE'] },
      },
    });

    if (existing) {
      const keepAck =
        existing.status === 'ACTIVE' && existing.acknowledged === true;
      const updated = await this.prisma.alert.update({
        where: { id: existing.id },
        data: {
          message: data.message,
          severity: data.severity,
          issueResolvedAt: null,
          status: 'ACTIVE',
          snoozedUntil: null,
          ...(keepAck
            ? {}
            : {
                acknowledged: false,
                acknowledgedAt: null,
                acknowledgedById: null,
              }),
        },
        include: alertInclude,
      });

      if (existing.status === 'PENDING_CLOSE') {
        await this.logEvent(existing.id, 'REOPENED', 'Le problème est réapparu');
        void this.notifications.dispatchForAlert(updated, 'occurrence');
      }

      return updated;
    }

    const closed = await this.prisma.alert.findFirst({
      where: { fingerprint: fp, status: 'CLOSED' },
      orderBy: { closedAt: 'desc' },
    });

    if (closed) {
      if (
        data.issueStartedAt &&
        closed.closedAt &&
        closed.closedAt.getTime() >= data.issueStartedAt.getTime()
      ) {
        return this.prisma.alert.findUniqueOrThrow({
          where: { id: closed.id },
          include: alertInclude,
        });
      }

      const updated = await this.prisma.alert.update({
        where: { id: closed.id },
        data: {
          message: data.message,
          severity: data.severity,
          status: 'ACTIVE',
          resolved: false,
          resolvedAt: null,
          closedAt: null,
          closedById: null,
          issueResolvedAt: null,
          origin: null,
          resolutionMethod: null,
          snoozedUntil: null,
          acknowledged: false,
          occurrenceCount: { increment: 1 },
        },
        include: alertInclude,
      });

      await this.logEvent(
        closed.id,
        'REOPENED',
        data.message,
        undefined,
        { occurrenceCount: updated.occurrenceCount },
      );
      void this.notifications.dispatchForAlert(updated, 'occurrence');
      return updated;
    }

    const alert = await this.prisma.alert.create({
      data: {
        title: data.title,
        message: data.message,
        severity: data.severity,
        websiteId: data.websiteId,
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

  /** Clôture automatique dès que la condition n'est plus détectée. */
  async onIssueResolved(params: { serverId?: string; websiteId?: string; titleContains?: string }) {
    const where: Prisma.AlertWhereInput = {
      status: { in: ['ACTIVE', 'ACKNOWLEDGED', 'PENDING_CLOSE'] },
    };
    if (params.serverId) where.serverId = params.serverId;
    if (params.websiteId) where.websiteId = params.websiteId;
    if (params.titleContains) where.title = { contains: params.titleContains };

    const alerts = await this.prisma.alert.findMany({ where });
    const now = new Date();

    for (const alert of alerts) {
      await this.prisma.alert.update({
        where: { id: alert.id },
        data: {
          status: 'CLOSED',
          resolved: true,
          resolvedAt: now,
          closedAt: now,
          issueResolvedAt: now,
          snoozedUntil: null,
          acknowledged: false,
          origin: 'Résolution automatique',
          resolutionMethod: 'Condition plus détectée',
        },
      });
      await this.logEvent(
        alert.id,
        'CLOSED',
        'Problème plus détecté — clôture automatique',
        undefined,
        { auto: true, resolutionMethod: 'Condition plus détectée' },
      );
    }
  }

  /** Clôture immédiate de toutes les alertes ouvertes d'un site (ex. supervision désactivée). */
  async forceCloseForWebsite(websiteId: string, userId?: string) {
    const alerts = await this.prisma.alert.findMany({
      where: {
        websiteId,
        status: { in: ['ACTIVE', 'ACKNOWLEDGED', 'PENDING_CLOSE'] },
      },
    });

    for (const alert of alerts) {
      await this.prisma.alert.update({
        where: { id: alert.id },
        data: {
          status: 'CLOSED',
          resolved: true,
          resolvedAt: new Date(),
          closedAt: new Date(),
          issueResolvedAt: alert.issueResolvedAt ?? new Date(),
          origin: 'Supervision désactivée',
          resolutionMethod: 'Désactivation du monitoring du site',
          ...(userId ? { closedById: userId } : {}),
        },
      });
      await this.logEvent(
        alert.id,
        'CLOSED',
        'Clôture automatique — supervision du site désactivée',
        userId,
        { auto: true, reason: 'monitoring_disabled' },
      );
    }

    return alerts.length;
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
      where: {
        status: 'ACTIVE',
        acknowledged: false,
        severity: 'CRITICAL',
      },
      orderBy: [{ createdAt: 'desc' }],
      include: alertInclude,
    });
  }

  async acknowledge(id: string, userId: string) {
    const alert = await this.prisma.alert.findUnique({ where: { id } });
    if (!alert) throw new NotFoundException('Alerte introuvable');
    if (alert.status === 'CLOSED') {
      throw new BadRequestException('Impossible d’acquitter une alerte clôturée');
    }

    const updated = await this.prisma.alert.update({
      where: { id },
      data: {
        acknowledged: true,
        acknowledgedAt: new Date(),
        acknowledgedById: userId,
        // Stay ACTIVE — popup-only silence until the issue clears
        status: 'ACTIVE',
      },
      include: alertInclude,
    });

    await this.logEvent(id, 'ACKNOWLEDGED', 'Alerte acquittée (plus de popup)', userId);
    return updated;
  }

  /** Clôture manuelle (opérateur) — ex. alerte orpheline après correction hors Supervision. */
  async close(id: string, userId: string, note?: string) {
    const alert = await this.prisma.alert.findUnique({ where: { id } });
    if (!alert) throw new NotFoundException('Alerte introuvable');
    if (alert.status === 'CLOSED') {
      throw new BadRequestException('Alerte déjà clôturée');
    }

    const now = new Date();
    const message = (note || '').trim();
    await this.prisma.alert.update({
      where: { id },
      data: {
        status: 'CLOSED',
        resolved: true,
        resolvedAt: now,
        closedAt: now,
        issueResolvedAt: now,
        snoozedUntil: null,
        closedById: userId,
        origin: 'Clôture manuelle',
        resolutionMethod: message || 'Clôturée par un opérateur',
      },
    });

    await this.logEvent(
      id,
      'CLOSED',
      message || 'Alerte clôturée manuellement',
      userId,
      { manual: true },
    );

    if (message) {
      await this.addNote(id, userId, message);
    }

    return this.findOne(id);
  }

  async getSummary() {
    await this.migrateLegacyStatuses();

    const [active, closed] = await Promise.all([
      this.prisma.alert.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
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
        acknowledged: 0,
        pendingClose: 0,
        closed: closed.length,
      },
      active,
      acknowledged: [] as typeof active,
      pendingClose: [] as typeof active,
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
}
