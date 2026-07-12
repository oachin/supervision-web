import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Alert, AlertSeverity, NotificationRule, Prisma } from '@prisma/client';
import * as nodemailer from 'nodemailer';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateNotificationRuleDto,
  TestSmtpDto,
  UpdateNotificationRuleDto,
  UpsertSmtpSettingsDto,
} from './notifications.dto';

type AlertForNotify = Alert & {
  server?: { id: string; name: string; hostname?: string | null } | null;
  website?: {
    id: string;
    name: string;
    url: string;
    serverId?: string | null;
    server?: { id: string; name: string; hostname?: string | null } | null;
  } | null;
};

export type NotificationTrigger = 'created' | 'occurrence';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
  ) {}

  private sanitizeSmtp(settings: {
    id: string;
    host: string;
    port: number;
    secure: boolean;
    username: string | null;
    passwordEnc: string | null;
    fromEmail: string;
    fromName: string;
    enabled: boolean;
    updatedAt: Date;
  }) {
    return {
      id: settings.id,
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      username: settings.username,
      hasPassword: !!settings.passwordEnc,
      fromEmail: settings.fromEmail,
      fromName: settings.fromName,
      enabled: settings.enabled,
      updatedAt: settings.updatedAt,
    };
  }

  async getSmtpSettings() {
    const settings = await this.prisma.smtpSettings.findUnique({ where: { id: 'default' } });
    if (!settings) {
      return {
        host: '',
        port: 587,
        secure: false,
        username: '',
        hasPassword: false,
        fromEmail: '',
        fromName: 'Havet Supervision',
        enabled: false,
        updatedAt: null,
      };
    }
    return this.sanitizeSmtp(settings);
  }

  async upsertSmtpSettings(dto: UpsertSmtpSettingsDto) {
    const existing = await this.prisma.smtpSettings.findUnique({ where: { id: 'default' } });
    const passwordEnc = dto.password?.trim()
      ? this.crypto.encrypt(dto.password.trim())
      : existing?.passwordEnc;

    if (dto.enabled && dto.username?.trim() && !passwordEnc) {
      throw new BadRequestException('Mot de passe SMTP requis lorsque un identifiant est défini');
    }

    const settings = await this.prisma.smtpSettings.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        host: dto.host.trim(),
        port: dto.port,
        secure: dto.secure,
        username: dto.username?.trim() || null,
        passwordEnc: passwordEnc ?? null,
        fromEmail: dto.fromEmail.trim(),
        fromName: dto.fromName.trim(),
        enabled: dto.enabled,
      },
      update: {
        host: dto.host.trim(),
        port: dto.port,
        secure: dto.secure,
        username: dto.username?.trim() || null,
        passwordEnc: passwordEnc ?? null,
        fromEmail: dto.fromEmail.trim(),
        fromName: dto.fromName.trim(),
        enabled: dto.enabled,
      },
    });

    return this.sanitizeSmtp(settings);
  }

  private async createTransport() {
    const settings = await this.prisma.smtpSettings.findUnique({ where: { id: 'default' } });
    if (!settings?.enabled || !settings.passwordEnc) return null;

    const transport = nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      auth: settings.username
        ? {
            user: settings.username,
            pass: this.crypto.decrypt(settings.passwordEnc),
          }
        : undefined,
    });

    return { transport, settings };
  }

  async testSmtp(dto: TestSmtpDto) {
    const ctx = await this.createTransport();
    if (!ctx) {
      throw new NotFoundException('SMTP non configuré ou désactivé');
    }

    await ctx.transport.sendMail({
      from: `"${ctx.settings.fromName}" <${ctx.settings.fromEmail}>`,
      to: dto.to,
      subject: '[Havet Supervision] Test SMTP',
      text: 'Ceci est un message de test depuis Havet Supervision.',
      html: '<p>Ceci est un message de test depuis <strong>Havet Supervision</strong>.</p>',
    });

    return { success: true };
  }

  async listRules() {
    return this.prisma.notificationRule.findMany({ orderBy: { name: 'asc' } });
  }

  async createRule(dto: CreateNotificationRuleDto) {
    return this.prisma.notificationRule.create({
      data: {
        name: dto.name.trim(),
        enabled: dto.enabled ?? true,
        recipients: dto.recipients.map((e) => e.trim().toLowerCase()),
        serverIds: dto.serverIds ?? [],
        severities: (dto.severities ?? []) as AlertSeverity[],
        notifyOnCreate: dto.notifyOnCreate ?? true,
        notifyOnOccurrence: dto.notifyOnOccurrence ?? true,
      },
    });
  }

  async updateRule(id: string, dto: UpdateNotificationRuleDto) {
    const existing = await this.prisma.notificationRule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Règle introuvable');

    const data: Prisma.NotificationRuleUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    if (dto.recipients !== undefined) {
      data.recipients = dto.recipients.map((e) => e.trim().toLowerCase());
    }
    if (dto.serverIds !== undefined) data.serverIds = dto.serverIds;
    if (dto.severities !== undefined) data.severities = dto.severities as AlertSeverity[];
    if (dto.notifyOnCreate !== undefined) data.notifyOnCreate = dto.notifyOnCreate;
    if (dto.notifyOnOccurrence !== undefined) data.notifyOnOccurrence = dto.notifyOnOccurrence;

    return this.prisma.notificationRule.update({ where: { id }, data });
  }

  async deleteRule(id: string) {
    const existing = await this.prisma.notificationRule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Règle introuvable');
    await this.prisma.notificationRule.delete({ where: { id } });
    return { success: true };
  }

  private ruleMatches(
    rule: NotificationRule,
    alert: AlertForNotify,
    hostingServerId: string | null | undefined,
    trigger: NotificationTrigger,
  ): boolean {
    if (!rule.enabled) return false;
    if (trigger === 'created' && !rule.notifyOnCreate) return false;
    if (trigger === 'occurrence' && !rule.notifyOnOccurrence) return false;
    if (rule.severities.length > 0 && !rule.severities.includes(alert.severity)) return false;
    if (rule.serverIds.length > 0) {
      if (!hostingServerId || !rule.serverIds.includes(hostingServerId)) return false;
    }
    return rule.recipients.length > 0;
  }

  private buildEmailContent(alert: AlertForNotify, trigger: NotificationTrigger) {
    const severityLabels: Record<AlertSeverity, string> = {
      INFO: 'Info',
      WARNING: 'Avertissement',
      CRITICAL: 'Critique',
    };
    const triggerLabel = trigger === 'created' ? 'Nouvelle alerte' : 'Nouvelle occurrence';
    const server = alert.server ?? alert.website?.server;
    const lines = [
      `${triggerLabel} — ${severityLabels[alert.severity]}`,
      '',
      alert.title,
      alert.message,
      '',
      alert.website ? `Site : ${alert.website.name} (${alert.website.url})` : null,
      server ? `Serveur : ${server.name}${server.hostname ? ` (${server.hostname})` : ''}` : null,
      `Occurrences : ${alert.occurrenceCount}`,
    ].filter(Boolean);

    return {
      subject: `[Supervision] ${severityLabels[alert.severity]} — ${alert.title}`,
      text: lines.join('\n'),
      html: lines.map((line) => `<p>${line}</p>`).join(''),
    };
  }

  async dispatchForAlert(alert: AlertForNotify, trigger: NotificationTrigger) {
    try {
      const ctx = await this.createTransport();
      if (!ctx) return;

      const rules = await this.prisma.notificationRule.findMany({ where: { enabled: true } });
      const hostingServerId = alert.serverId ?? alert.website?.serverId ?? alert.website?.server?.id;
      const content = this.buildEmailContent(alert, trigger);

      for (const rule of rules) {
        if (!this.ruleMatches(rule, alert, hostingServerId, trigger)) continue;

        await ctx.transport.sendMail({
          from: `"${ctx.settings.fromName}" <${ctx.settings.fromEmail}>`,
          to: rule.recipients.join(', '),
          subject: content.subject,
          text: content.text,
          html: content.html,
        });

        this.logger.log(
          `Notification envoyée (${trigger}) — règle « ${rule.name} » → ${rule.recipients.join(', ')}`,
        );
      }
    } catch (err) {
      this.logger.error(`Échec envoi notification: ${err instanceof Error ? err.message : err}`);
    }
  }
}
