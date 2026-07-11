import { Injectable } from '@nestjs/common';
import * as dns from 'dns/promises';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import * as tls from 'tls';
import { URL } from 'url';
import { isMaintenanceStatusCode, extractHtmlRedirectUrl, shouldFollowHtmlRedirect } from '../websites/website-status.util';

export interface WebsiteHttpProbeResult {
  ok: boolean;
  statusCode?: number;
  responseMs: number;
  error?: string;
  dnsOk: boolean;
  dnsAddresses: string[];
  dnsError?: string;
  port443Open?: boolean;
  port443Error?: string;
  hostname: string;
  /** Hôte atteint après redirections HTTP/HTML (si différent de hostname). */
  finalHostname?: string;
  isHttps: boolean;
}

export interface WebsiteSslProbeResult {
  sslValid?: boolean;
  sslChainValid?: boolean;
  sslExpiresAt?: Date;
  sslDaysRemaining?: number;
  sslIssuer?: string;
  sslSubject?: string;
  tlsVersion?: string;
  sslError?: string;
}

@Injectable()
export class WebsiteProbeService {
  /** Vérification légère : DNS, port 443, HTTP (sans analyse certificat complète). */
  async probeHttp(
    url: string,
    expectedStatus = 200,
    expectedKeyword?: string | null,
  ): Promise<WebsiteHttpProbeResult> {
    const start = Date.now();
    let hostname: string;
    let isHttps = true;

    try {
      const parsed = new URL(url);
      hostname = parsed.hostname;
      isHttps = parsed.protocol === 'https:';
    } catch {
      return {
        ok: false,
        responseMs: Date.now() - start,
        error: 'URL invalide',
        dnsOk: false,
        dnsAddresses: [],
        hostname: '',
        isHttps: true,
      };
    }

    const dnsResult = await this.checkDns(hostname);
    if (!dnsResult.ok) {
      return {
        ok: false,
        responseMs: Date.now() - start,
        error: `DNS: ${dnsResult.error}`,
        dnsOk: false,
        dnsAddresses: [],
        dnsError: dnsResult.error,
        hostname,
        isHttps,
      };
    }

    let port443Open: boolean | undefined;
    let port443Error: string | undefined;
    if (isHttps) {
      const portResult = await this.checkPort443(hostname);
      port443Open = portResult.open;
      port443Error = portResult.error;
      if (!port443Open) {
        return {
          ok: false,
          responseMs: Date.now() - start,
          error: `Port 443 fermé: ${port443Error ?? 'injoignable'}`,
          dnsOk: true,
          dnsAddresses: dnsResult.addresses,
          port443Open: false,
          port443Error,
          hostname,
          isHttps,
        };
      }
    }

    const httpResult = await this.probeHttpRequest(url, expectedStatus, expectedKeyword);

    return {
      ok: httpResult.ok,
      statusCode: httpResult.statusCode,
      responseMs: httpResult.responseMs || Date.now() - start,
      error: httpResult.error,
      dnsOk: true,
      dnsAddresses: dnsResult.addresses,
      port443Open,
      port443Error,
      hostname,
      finalHostname: httpResult.finalHostname,
      isHttps,
    };
  }

  /** Vérification certificat SSL/TLS (chaîne, expiration) — à exécuter une fois par jour.
   *  CA-agnostique : Let's Encrypt (Plesk), DigiCert, GeoTrust, Sectigo, etc.
   *  via le magasin de confiance système (rejectUnauthorized). */
  async probeSslCertificate(hostname: string): Promise<WebsiteSslProbeResult> {
    return this.probeSsl(hostname);
  }

  private async checkDns(hostname: string): Promise<{ ok: boolean; addresses: string[]; error?: string }> {
    try {
      const [v4, v6] = await Promise.allSettled([
        dns.resolve4(hostname),
        dns.resolve6(hostname),
      ]);
      const addresses = [
        ...(v4.status === 'fulfilled' ? v4.value : []),
        ...(v6.status === 'fulfilled' ? v6.value : []),
      ];
      if (addresses.length === 0) {
        const err = v4.status === 'rejected' ? v4.reason : v6.status === 'rejected' ? v6.reason : undefined;
        return { ok: false, addresses: [], error: err?.message ?? 'Aucun enregistrement DNS' };
      }
      return { ok: true, addresses };
    } catch (err) {
      return { ok: false, addresses: [], error: err instanceof Error ? err.message : 'Erreur DNS' };
    }
  }

  private checkPort443(hostname: string, timeoutMs = 5000): Promise<{ open: boolean; error?: string }> {
    return new Promise((resolve) => {
      const socket = net.connect({ host: hostname, port: 443, timeout: timeoutMs });
      socket.on('connect', () => {
        socket.destroy();
        resolve({ open: true });
      });
      socket.on('error', (err) => {
        socket.destroy();
        resolve({ open: false, error: err.message });
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve({ open: false, error: 'Timeout port 443' });
      });
    });
  }

  private probeSsl(hostname: string): Promise<WebsiteSslProbeResult> {
    return new Promise((resolve) => {
      const socket = tls.connect(
        {
          host: hostname,
          port: 443,
          servername: hostname,
          rejectUnauthorized: true,
          timeout: 10000,
        },
        () => {
          const cert = socket.getPeerCertificate(false);
          const protocol = socket.getProtocol() ?? undefined;
          const authError = (socket as tls.TLSSocket & { authorizationError?: Error }).authorizationError;
          // Si Node.js valide la chaîne (CA publique externe ou Let's Encrypt), on fait confiance.
          const sslValid = !authError;
          const sslChainValid = !authError;

          const sslExpiresAt = cert?.valid_to ? new Date(cert.valid_to) : undefined;
          const sslDaysRemaining = sslExpiresAt
            ? Math.floor((sslExpiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
            : undefined;

          socket.end();
          resolve({
            sslValid,
            sslChainValid,
            sslExpiresAt,
            sslDaysRemaining,
            sslIssuer: this.formatCertIssuer(cert?.issuer),
            sslSubject: this.certFieldToString(cert?.subject),
            tlsVersion: protocol ?? undefined,
            sslError: authError
              ? (authError instanceof Error ? authError.message : String(authError))
              : undefined,
          });
        },
      );

      socket.on('error', (err) => {
        resolve({
          sslValid: false,
          sslChainValid: false,
          sslError: err.message,
        });
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve({ sslValid: false, sslError: 'Timeout SSL' });
      });
    });
  }

  private probeHttpRequest(
    url: string,
    expectedStatus: number,
    expectedKeyword?: string | null,
    maxRedirects = 5,
  ): Promise<{ ok: boolean; statusCode?: number; responseMs: number; error?: string; finalHostname: string }> {
    const start = Date.now();

    const follow = (targetUrl: string, redirectsLeft: number) =>
      new Promise<{ ok: boolean; statusCode?: number; responseMs: number; error?: string; finalHostname: string }>((resolve) => {
        let parsed: URL;
        try {
          parsed = new URL(targetUrl);
        } catch {
          resolve({ ok: false, responseMs: Date.now() - start, error: 'URL invalide', finalHostname: '' });
          return;
        }

        const lib = parsed.protocol === 'https:' ? https : http;
        const req = lib.get(
          targetUrl,
          {
            timeout: 15000,
            headers: { 'User-Agent': 'HavetSupervision/1.0' },
            // Disponibilité HTTP : ne pas bloquer sur un certificat expiré (contrôle SSL séparé).
            rejectUnauthorized: false,
          },
          (res) => {
            const statusCode = res.statusCode ?? 0;
            const location = res.headers.location;

            if (redirectsLeft > 0 && location && [301, 302, 303, 307, 308].includes(statusCode)) {
              res.resume();
              follow(new URL(location, targetUrl).href, redirectsLeft - 1).then(resolve);
              return;
            }

            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
              if (
                redirectsLeft > 0 &&
                shouldFollowHtmlRedirect(statusCode)
              ) {
                const htmlRedirect = extractHtmlRedirectUrl(body);
                if (htmlRedirect) {
                  try {
                    const nextUrl = new URL(htmlRedirect, targetUrl).href;
                    follow(nextUrl, redirectsLeft - 1).then(resolve);
                    return;
                  } catch {
                    // URL HTML invalide — évaluer la réponse telle quelle
                  }
                }
              }

              const responseMs = Date.now() - start;
              const keywordOk = !expectedKeyword || body.includes(expectedKeyword);
              const maintenance = isMaintenanceStatusCode(statusCode);
              const reachable = (statusCode >= 200 && statusCode < 500) || maintenance;
              const healthy = statusCode === expectedStatus || (statusCode >= 200 && statusCode < 400);

              resolve({
                ok: reachable && keywordOk,
                statusCode,
                responseMs,
                finalHostname: parsed.hostname,
                error: maintenance
                  ? 'HTTP 503 (maintenance)'
                  : !reachable
                    ? `HTTP ${statusCode} (erreur serveur)`
                    : !healthy
                      ? `HTTP ${statusCode} (attendu ${expectedStatus})`
                      : !keywordOk
                        ? 'Mot-clé attendu non trouvé'
                        : undefined,
              });
            });
          },
        );

        req.on('error', (err) => {
          resolve({ ok: false, responseMs: Date.now() - start, error: err.message, finalHostname: parsed.hostname });
        });

        req.on('timeout', () => {
          req.destroy();
          resolve({ ok: false, responseMs: Date.now() - start, error: 'Timeout HTTP (15s)', finalHostname: parsed.hostname });
        });
      });

    return follow(url, maxRedirects);
  }

  private formatCertIssuer(issuer: unknown): string | undefined {
    if (issuer == null) return undefined;
    if (typeof issuer === 'string') return issuer;
    if (typeof issuer === 'object') {
      const fields = issuer as Record<string, unknown>;
      const org = fields.O ?? fields.o;
      const cn = fields.CN ?? fields.cn;
      const parts = [org, cn].filter(Boolean).map(String);
      if (parts.length > 0) return parts.join(' · ');
    }
    return this.certFieldToString(issuer);
  }

  private certFieldToString(value: unknown): string | undefined {
    if (value == null) return undefined;
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>)
        .map(([key, part]) => `${key}=${part}`)
        .join(', ');
    }
    return undefined;
  }
}
