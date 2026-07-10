import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { WebsiteStatus } from '@prisma/client';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { PrismaService } from '../prisma/prisma.service';
import { AlertsService } from '../alerts/alerts.service';
import { ServersService } from '../servers/servers.service';

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);
  private lastWebsiteCheck = new Map<string, number>();

  constructor(
    private prisma: PrismaService,
    private alerts: AlertsService,
    private servers: ServersService,
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
        const result = await this.probeWebsite(website.url, website.expectedStatus, website.expectedKeyword);
        const previousStatus = website.status;
        let status: WebsiteStatus = 'UP';

        if (!result.ok) {
          status = 'DOWN';
        } else if (result.responseMs > 3000) {
          status = 'DEGRADED';
        }

        await this.prisma.websiteCheck.create({
          data: {
            websiteId: website.id,
            status,
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
            status,
            lastCheckAt: new Date(),
            lastResponseMs: result.responseMs,
            lastStatusCode: result.statusCode,
            sslExpiresAt: result.sslExpiresAt,
          },
        });

        if (status === 'DOWN') {
          await this.alerts.create({
            title: `Site hors ligne: ${website.name}`,
            message: `${website.url} - ${result.error || `HTTP ${result.statusCode}`}`,
            severity: 'CRITICAL',
            websiteId: website.id,
          });
        } else if (status === 'UP' && (previousStatus === 'DOWN' || previousStatus === 'DEGRADED')) {
          await this.alerts.onIssueResolved({
            websiteId: website.id,
            titleContains: 'hors ligne',
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
      } catch (err) {
        this.logger.error(`Check failed for ${website.url}: ${err}`);
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
  ): Promise<{
    ok: boolean;
    statusCode?: number;
    responseMs: number;
    sslValid?: boolean;
    sslExpiresAt?: Date;
    error?: string;
  }> {
    return new Promise((resolve) => {
      const start = Date.now();
      const parsed = new URL(url);
      const isHttps = parsed.protocol === 'https:';
      const lib = isHttps ? https : http;

      const req = lib.get(
        url,
        {
          timeout: 15000,
          headers: { 'User-Agent': 'HavetSupervision/1.0' },
          rejectUnauthorized: true,
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => { body += chunk; });
          res.on('end', () => {
            const responseMs = Date.now() - start;
            const statusCode = res.statusCode ?? 0;
            let sslExpiresAt: Date | undefined;

            if (isHttps && res.socket) {
              const cert = (res.socket as import('tls').TLSSocket).getPeerCertificate();
              if (cert?.valid_to) {
                sslExpiresAt = new Date(cert.valid_to);
              }
            }

            const statusOk = statusCode === expectedStatus;
            const keywordOk = !expectedKeyword || body.includes(expectedKeyword);

            resolve({
              ok: statusOk && keywordOk,
              statusCode,
              responseMs,
              sslValid: isHttps ? true : undefined,
              sslExpiresAt,
              error: !statusOk
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
  }
}
