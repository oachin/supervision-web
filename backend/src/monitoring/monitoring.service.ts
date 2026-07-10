import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Website } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AlertsService } from '../alerts/alerts.service';
import { probeResultToStatus } from '../websites/website-status.util';
import { WebsiteProbeService } from './website-probe.service';

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);
  private lastWebsiteCheck = new Map<string, number>();

  constructor(
    private prisma: PrismaService,
    private alerts: AlertsService,
    private probe: WebsiteProbeService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async checkWebsites() {
    const websites = await this.prisma.website.findMany();
    const now = Date.now();

    for (const website of websites) {
      const lastCheck = this.lastWebsiteCheck.get(website.id) ?? 0;
      if (now - lastCheck < website.checkInterval * 1000) continue;

      this.lastWebsiteCheck.set(website.id, now);

      try {
        await this.runExternalCheck(website, now);
      } catch (err) {
        this.logger.error(`Check failed for ${website.url}: ${err}`);
      }
    }
  }

  async runExternalCheck(website: Website, now = Date.now()) {
    const result = await this.probe.probe(website.url, website.expectedStatus, website.expectedKeyword);
    const status = probeResultToStatus(result.ok, result.responseMs);
    const previousStatus = website.status;

    await this.prisma.websiteCheck.create({
      data: {
        websiteId: website.id,
        status,
        checkSource: 'EXTERNAL',
        statusCode: result.statusCode,
        responseMs: result.responseMs,
        sslValid: result.sslValid,
        sslChainValid: result.sslChainValid,
        sslExpiresAt: result.sslExpiresAt,
        sslIssuer: result.sslIssuer,
        sslSubject: result.sslSubject,
        sslDaysRemaining: result.sslDaysRemaining,
        dnsOk: result.dnsOk,
        port443Open: result.port443Open,
        tlsVersion: result.tlsVersion,
        errorMessage: result.error,
      },
    });

    await this.prisma.website.update({
      where: { id: website.id },
      data: {
        status,
        externalStatus: status,
        lastCheckAt: new Date(),
        lastResponseMs: result.responseMs,
        lastStatusCode: result.statusCode,
        lastExternalCheckAt: new Date(),
        lastExternalResponseMs: result.responseMs,
        lastExternalStatusCode: result.statusCode,
        sslExpiresAt: result.sslExpiresAt,
        sslIssuer: result.sslIssuer,
        sslSubject: result.sslSubject,
        sslDaysRemaining: result.sslDaysRemaining,
        lastDnsOk: result.dnsOk,
        lastPort443Open: result.port443Open,
        lastTlsVersion: result.tlsVersion,
      },
    });

    if (status === 'DOWN') {
      const details = [
        result.error,
        result.dnsOk === false ? 'DNS en échec' : null,
        result.port443Open === false ? 'Port 443 fermé' : null,
        result.sslValid === false ? result.sslError : null,
      ].filter(Boolean).join(' · ');

      await this.alerts.create({
        title: `Site hors ligne: ${website.name}`,
        message: `${website.url} — ${details || 'Indisponible'}`,
        severity: 'CRITICAL',
        websiteId: website.id,
      });
    } else if (status === 'UP' && (previousStatus === 'DOWN' || previousStatus === 'DEGRADED')) {
      await this.alerts.onIssueResolved({
        websiteId: website.id,
        titleContains: 'hors ligne',
      });
    }

    if (result.sslChainValid === false) {
      await this.alerts.create({
        title: `Chaîne SSL incomplète: ${website.name}`,
        message: `${website.url} — certificats intermédiaires manquants ou invalides`,
        severity: 'WARNING',
        websiteId: website.id,
      });
    }

    const alertDays = website.sslAlertDays ?? 15;
    if (result.sslDaysRemaining != null && result.sslDaysRemaining > 0 && result.sslDaysRemaining < alertDays) {
      await this.alerts.create({
        title: `Certificat SSL expire bientôt: ${website.name}`,
        message: `Expire le ${result.sslExpiresAt?.toISOString().split('T')[0]} (${result.sslDaysRemaining} jours, seuil ${alertDays}j)`,
        severity: result.sslDaysRemaining < 7 ? 'CRITICAL' : 'WARNING',
        websiteId: website.id,
      });
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async checkServerHeartbeats() {
    const servers = await this.prisma.server.findMany({
      where: { status: { not: 'OFFLINE' } },
    });

    for (const server of servers) {
      if (!server.lastSeenAt) continue;

      const elapsed = Date.now() - server.lastSeenAt.getTime();
      if (elapsed > 5 * 60 * 1000) {
        await this.prisma.server.update({
          where: { id: server.id },
          data: { status: 'OFFLINE' },
        });

        await this.alerts.create({
          title: `Serveur hors ligne: ${server.name}`,
          message: `Pas de signal depuis ${Math.floor(elapsed / 60000)} minutes`,
          severity: 'CRITICAL',
          serverId: server.id,
        });
      }
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async cleanupOldMetrics() {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await this.prisma.serverMetric.deleteMany({ where: { collectedAt: { lt: cutoff } } });
    await this.prisma.websiteCheck.deleteMany({ where: { checkedAt: { lt: cutoff } } });
    this.logger.log('Old metrics cleaned up');
  }
}
