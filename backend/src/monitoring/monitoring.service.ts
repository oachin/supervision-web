import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Website } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AlertsService } from '../alerts/alerts.service';
import { availabilityStatus, isMaintenanceStatusCode, sslHostnameForProbe } from '../websites/website-status.util';
import { WebsiteProbeService } from './website-probe.service';

const SSL_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STAGGER_MS = 300;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  constructor(
    private prisma: PrismaService,
    private alerts: AlertsService,
    private probe: WebsiteProbeService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async checkWebsites() {
    const websites = await this.prisma.website.findMany({
      where: { monitoringEnabled: true },
    });
    const now = Date.now();
    let staggerIndex = 0;

    for (const website of websites) {
      if (!this.isHttpCheckDue(website, now)) continue;

      if (staggerIndex > 0) {
        await sleep(STAGGER_MS);
      }
      staggerIndex++;

      try {
        await this.runExternalCheck(website);
      } catch (err) {
        this.logger.error(`Check failed for ${website.url}: ${err}`);
      }
    }
  }

  private isHttpCheckDue(website: Website, now: number): boolean {
    const lastCheck = website.lastExternalCheckAt?.getTime() ?? 0;
    return now - lastCheck >= website.checkInterval * 1000;
  }

  private needsSslCheck(website: Website, now: number): boolean {
    if (!website.sslEnabled) return false;
    const lastSsl = website.lastSslCheckAt?.getTime() ?? 0;
    return now - lastSsl >= SSL_CHECK_INTERVAL_MS;
  }

  async runExternalCheck(website: Website) {
    const now = Date.now();
    const httpResult = await this.probe.probeHttp(
      website.url,
      website.expectedStatus,
      website.expectedKeyword,
    );
    const includeSsl = httpResult.isHttps && this.needsSslCheck(website, now);
    const sslCheckHostname = sslHostnameForProbe({
      urlHostname: httpResult.hostname,
      finalHostname: httpResult.finalHostname,
      httpOk: httpResult.ok,
    });
    const redirectSslCheck =
      httpResult.isHttps &&
      sslCheckHostname !== httpResult.hostname &&
      httpResult.ok;
    let sslResult = null;
    if (includeSsl || redirectSslCheck) {
      try {
        sslResult = await this.probe.probeSslCertificate(sslCheckHostname);
      } catch (err) {
        this.logger.warn(`SSL probe failed for ${website.url}: ${err}`);
      }
    }

    const status = availabilityStatus(httpResult.ok, httpResult.responseMs, httpResult.statusCode);
    const previousStatus = website.status;
    const isMaintenance = isMaintenanceStatusCode(httpResult.statusCode);

    await this.prisma.websiteCheck.create({
      data: {
        websiteId: website.id,
        status,
        checkSource: 'EXTERNAL',
        statusCode: httpResult.statusCode,
        responseMs: httpResult.responseMs,
        sslValid: sslResult?.sslValid,
        sslChainValid: sslResult?.sslChainValid,
        sslExpiresAt: sslResult?.sslExpiresAt,
        sslIssuer: sslResult?.sslIssuer,
        sslSubject: sslResult?.sslSubject,
        sslDaysRemaining: sslResult?.sslDaysRemaining,
        dnsOk: httpResult.dnsOk,
        port443Open: httpResult.port443Open,
        tlsVersion: sslResult?.tlsVersion,
        errorMessage: httpResult.error,
      },
    });

    const updateData: Record<string, unknown> = {
      status,
      externalStatus: status,
      internalStatus: 'UNKNOWN',
      lastCheckAt: new Date(),
      lastResponseMs: httpResult.responseMs,
      lastStatusCode: httpResult.statusCode,
      lastExternalCheckAt: new Date(),
      lastExternalResponseMs: httpResult.responseMs,
      lastExternalStatusCode: httpResult.statusCode,
      lastDnsOk: httpResult.dnsOk,
      lastPort443Open: httpResult.port443Open,
    };

    if (sslResult) {
      updateData.lastSslCheckAt = new Date();
      updateData.sslExpiresAt = sslResult.sslExpiresAt;
      updateData.sslIssuer = sslResult.sslIssuer;
      updateData.sslSubject = sslResult.sslSubject;
      updateData.sslDaysRemaining = sslResult.sslDaysRemaining;
      updateData.lastTlsVersion = sslResult.tlsVersion;
    }

    await this.prisma.website.update({
      where: { id: website.id },
      data: updateData,
    });

    if (status === 'DOWN' && !isMaintenance) {
      const details = [
        httpResult.error,
        httpResult.dnsOk === false ? 'DNS en échec' : null,
        httpResult.port443Open === false ? 'Port 443 fermé' : null,
      ].filter(Boolean).join(' · ');

      await this.alerts.create({
        title: `Site hors ligne: ${website.name}`,
        message: `${website.url} — ${details || 'Indisponible'}`,
        severity: 'CRITICAL',
        websiteId: website.id,
      });
    } else if (isMaintenance) {
      await this.alerts.onIssueResolved({
        websiteId: website.id,
        titleContains: 'hors ligne',
      });
    } else if (status === 'UP' && (previousStatus === 'DOWN' || previousStatus === 'DEGRADED')) {
      await this.alerts.onIssueResolved({
        websiteId: website.id,
        titleContains: 'hors ligne',
      });
    }

    const sslHealthy =
      sslResult != null &&
      sslResult.sslValid !== false &&
      sslResult.sslChainValid !== false;

    if (sslResult?.sslChainValid === false) {
      await this.alerts.create({
        title: `Chaîne SSL incomplète: ${website.name}`,
        message: `${website.url} — certificats intermédiaires manquants ou invalides${sslCheckHostname !== httpResult.hostname ? ` (cible ${sslCheckHostname})` : ''}`,
        severity: 'WARNING',
        websiteId: website.id,
      });
    } else if (sslHealthy) {
      await this.alerts.onIssueResolved({
        websiteId: website.id,
        titleContains: 'Chaîne SSL',
      });
    }

    if (sslResult?.sslValid === false) {
      await this.alerts.create({
        title: `Certificat SSL invalide: ${website.name}`,
        message: `${website.url} — ${sslResult.sslError ?? 'Certificat invalide'}${sslCheckHostname !== httpResult.hostname ? ` (cible ${sslCheckHostname})` : ''}`,
        severity: 'WARNING',
        websiteId: website.id,
      });
    } else if (sslHealthy) {
      await this.alerts.onIssueResolved({
        websiteId: website.id,
        titleContains: 'Certificat SSL invalide',
      });
    }

    const alertDays = website.sslAlertDays ?? 15;
    const sslDays = sslResult?.sslDaysRemaining ?? website.sslDaysRemaining;
    const sslExpires = sslResult?.sslExpiresAt ?? website.sslExpiresAt;
    if (sslDays != null && sslDays > 0 && sslDays < alertDays) {
      await this.alerts.create({
        title: `Certificat SSL expire bientôt: ${website.name}`,
        message: `Expire le ${sslExpires?.toISOString().split('T')[0]} (${sslDays} jours, seuil ${alertDays}j)`,
        severity: sslDays < 7 ? 'CRITICAL' : 'WARNING',
        websiteId: website.id,
      });
    } else if (sslResult && (sslDays == null || sslDays >= alertDays)) {
      await this.alerts.onIssueResolved({
        websiteId: website.id,
        titleContains: 'Certificat SSL expire bientôt',
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
