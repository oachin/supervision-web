import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Website, WebsiteStatus } from '@prisma/client';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { PrismaService } from '../prisma/prisma.service';
import { AlertsService } from '../alerts/alerts.service';
import { probeResultToStatus, worstWebsiteStatus } from '../websites/website-status.util';

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);
  private lastWebsiteCheck = new Map<string, number>();

  constructor(
    private prisma: PrismaService,
    private alerts: AlertsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async checkWebsites() {
    const websites = await this.prisma.website.findMany({
      where: { checkMode: { in: ['EXTERNAL', 'BOTH'] } },
    });
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
    const result = await this.probeWebsite(website.url, website.expectedStatus, website.expectedKeyword);
    const externalStatus = probeResultToStatus(result.ok, result.responseMs);
    const previousExternal = website.externalStatus;
    const combinedStatus = website.checkMode === 'BOTH'
      ? worstWebsiteStatus(externalStatus, website.internalStatus)
      : externalStatus;

    await this.prisma.websiteCheck.create({
      data: {
        websiteId: website.id,
        status: externalStatus,
        checkSource: 'EXTERNAL',
        statusCode: result.statusCode,
        responseMs: result.responseMs,
        sslValid: result.sslValid,
        sslExpiresAt: result.sslExpiresAt,
        errorMessage: result.error,
      },
    });

    await this.prisma.website.update({
      where: { id: website.id },
      data: {
        status: combinedStatus,
        externalStatus,
        lastCheckAt: new Date(),
        lastResponseMs: result.responseMs,
        lastStatusCode: result.statusCode,
        lastExternalCheckAt: new Date(),
        lastExternalResponseMs: result.responseMs,
        lastExternalStatusCode: result.statusCode,
        sslExpiresAt: result.sslExpiresAt,
      },
    });

    if (externalStatus === 'DOWN') {
      await this.alerts.create({
        title: `Site hors ligne (externe): ${website.name}`,
        message: `${website.url} — ${result.error || `HTTP ${result.statusCode}`}`,
        severity: 'CRITICAL',
        websiteId: website.id,
      });
    } else if (externalStatus === 'UP' && (previousExternal === 'DOWN' || previousExternal === 'DEGRADED')) {
      await this.alerts.onIssueResolved({
        websiteId: website.id,
        titleContains: 'externe',
      });
    }

    if (result.sslExpiresAt) {
      const daysUntilExpiry = (result.sslExpiresAt.getTime() - now) / (1000 * 60 * 60 * 24);
      if (daysUntilExpiry < 14 && daysUntilExpiry > 0) {
        await this.alerts.create({
          title: `Certificat SSL expire bientôt: ${website.name}`,
          message: `Expire le ${result.sslExpiresAt.toISOString().split('T')[0]} (${Math.floor(daysUntilExpiry)} jours)`,
          severity: daysUntilExpiry < 7 ? 'CRITICAL' : 'WARNING',
          websiteId: website.id,
        });
      }
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

  private probeWebsite(
    url: string,
    expectedStatus: number,
    expectedKeyword?: string | null,
    maxRedirects = 5,
  ): Promise<{
    ok: boolean;
    statusCode?: number;
    responseMs: number;
    sslValid?: boolean;
    sslExpiresAt?: Date;
    error?: string;
  }> {
    const start = Date.now();

    const follow = (targetUrl: string, redirectsLeft: number): ReturnType<MonitoringService['probeWebsite']> =>
      new Promise((resolve) => {
        let parsed: URL;
        try {
          parsed = new URL(targetUrl);
        } catch {
          resolve({ ok: false, responseMs: Date.now() - start, error: 'URL invalide' });
          return;
        }

        const isHttps = parsed.protocol === 'https:';
        const lib = isHttps ? https : http;

        const req = lib.get(
          targetUrl,
          {
            timeout: 15000,
            headers: { 'User-Agent': 'HavetSupervision/1.0' },
            rejectUnauthorized: true,
          },
          (res) => {
            const statusCode = res.statusCode ?? 0;
            const location = res.headers.location;

            if (
              redirectsLeft > 0 &&
              location &&
              [301, 302, 303, 307, 308].includes(statusCode)
            ) {
              res.resume();
              const nextUrl = new URL(location, targetUrl).href;
              follow(nextUrl, redirectsLeft - 1).then(resolve);
              return;
            }

            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
              const responseMs = Date.now() - start;
              let sslExpiresAt: Date | undefined;

              if (isHttps && res.socket) {
                const cert = (res.socket as import('tls').TLSSocket).getPeerCertificate();
                if (cert?.valid_to) {
                  sslExpiresAt = new Date(cert.valid_to);
                }
              }

              const statusOk = statusCode >= 200 && statusCode < 400;
              const keywordOk = !expectedKeyword || body.includes(expectedKeyword);
              const expectedOk = statusCode === expectedStatus || statusOk;

              resolve({
                ok: expectedOk && keywordOk,
                statusCode,
                responseMs,
                sslValid: isHttps ? true : undefined,
                sslExpiresAt,
                error: !expectedOk
                  ? `Statut attendu ${expectedStatus}, reçu ${statusCode}`
                  : !keywordOk
                    ? 'Mot-clé attendu non trouvé'
                    : undefined,
              });
            });
          },
        );

        req.on('error', (err) => {
          resolve({
            ok: false,
            responseMs: Date.now() - start,
            error: err.message,
          });
        });

        req.on('timeout', () => {
          req.destroy();
          resolve({
            ok: false,
            responseMs: Date.now() - start,
            error: 'Timeout (15s)',
          });
        });
      });

    return follow(url, maxRedirects);
  }
}
