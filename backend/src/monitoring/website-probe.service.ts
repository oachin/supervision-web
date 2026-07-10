import { Injectable } from '@nestjs/common';
import * as dns from 'dns/promises';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import * as tls from 'tls';
import { URL } from 'url';

export interface WebsiteProbeResult {
  ok: boolean;
  statusCode?: number;
  responseMs: number;
  error?: string;
  dnsOk: boolean;
  dnsAddresses: string[];
  dnsError?: string;
  port443Open?: boolean;
  port443Error?: string;
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
  async probe(
    url: string,
    expectedStatus = 200,
    expectedKeyword?: string | null,
  ): Promise<WebsiteProbeResult> {
    const start = Date.now();
    let hostname: string;
    let isHttps = true;

    try {
      const parsed = new URL(url);
      hostname = parsed.hostname;
      isHttps = parsed.protocol === 'https:';
    } catch {
      return this.fail(start, 'URL invalide', { dnsOk: false, dnsAddresses: [] });
    }

    const dnsResult = await this.checkDns(hostname);
    if (!dnsResult.ok) {
      return this.fail(start, `DNS: ${dnsResult.error}`, {
        dnsOk: false,
        dnsAddresses: [],
        dnsError: dnsResult.error,
      });
    }

    let port443Open: boolean | undefined;
    let port443Error: string | undefined;
    if (isHttps) {
      const portResult = await this.checkPort443(hostname);
      port443Open = portResult.open;
      port443Error = portResult.error;
      if (!port443Open) {
        return this.fail(start, `Port 443 fermé: ${port443Error ?? 'injoignable'}`, {
          dnsOk: true,
          dnsAddresses: dnsResult.addresses,
          port443Open: false,
          port443Error,
        });
      }
    }

    let sslResult: Partial<WebsiteProbeResult> = {};
    if (isHttps) {
      const ssl = await this.probeSsl(hostname);
      sslResult = ssl;
      if (!ssl.sslValid) {
        return {
          ok: false,
          responseMs: Date.now() - start,
          error: ssl.sslError ?? 'Certificat SSL invalide',
          dnsOk: true,
          dnsAddresses: dnsResult.addresses,
          port443Open: true,
          ...sslResult,
        };
      }
    }

    const httpResult = await this.probeHttp(url, expectedStatus, expectedKeyword);
    const responseMs = Date.now() - start;

    const issues: string[] = [];
    if (!httpResult.ok && httpResult.error) issues.push(httpResult.error);
    if (sslResult.sslChainValid === false) issues.push('Chaîne de certificats intermédiaires incomplète');

    return {
      ok: httpResult.ok && sslResult.sslValid !== false && sslResult.sslChainValid !== false,
      statusCode: httpResult.statusCode,
      responseMs: httpResult.responseMs || responseMs,
      error: issues.length ? issues.join(' · ') : httpResult.error,
      dnsOk: true,
      dnsAddresses: dnsResult.addresses,
      port443Open,
      port443Error,
      ...sslResult,
    };
  }

  private fail(
    start: number,
    error: string,
    partial: Pick<WebsiteProbeResult, 'dnsOk' | 'dnsAddresses'> & Partial<WebsiteProbeResult>,
  ): WebsiteProbeResult {
    return {
      ok: false,
      responseMs: Date.now() - start,
      error,
      ...partial,
    };
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

  private probeSsl(hostname: string): Promise<Partial<WebsiteProbeResult>> {
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
          const cert = socket.getPeerCertificate(true) as tls.PeerCertificate & {
            issuerCertificate?: tls.PeerCertificate;
          };
          const protocol = socket.getProtocol() ?? undefined;
          const authError = (socket as tls.TLSSocket & { authorizationError?: Error }).authorizationError;

          let sslChainValid = !authError;
          if (cert?.issuerCertificate) {
            let depth = 0;
            let current: (tls.PeerCertificate & { issuerCertificate?: tls.PeerCertificate }) | undefined = cert;
            while (current?.issuerCertificate && depth < 10) {
              if (current.fingerprint === current.issuerCertificate.fingerprint) break;
              current = current.issuerCertificate;
              depth++;
            }
            if (depth === 0 && cert.subject !== cert.issuer) {
              sslChainValid = false;
            }
          } else if (cert && cert.subject !== cert.issuer) {
            sslChainValid = false;
          }

          const sslExpiresAt = cert?.valid_to ? new Date(cert.valid_to) : undefined;
          const sslDaysRemaining = sslExpiresAt
            ? Math.floor((sslExpiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
            : undefined;

          socket.end();
          resolve({
            sslValid: true,
            sslChainValid,
            sslExpiresAt,
            sslDaysRemaining,
            sslIssuer: cert?.issuer ? String(cert.issuer) : undefined,
            sslSubject: cert?.subject ? String(cert.subject) : undefined,
            tlsVersion: protocol ?? undefined,
            sslError: sslChainValid ? undefined : 'Chaîne de certificats intermédiaires incomplète',
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

  private probeHttp(
    url: string,
    expectedStatus: number,
    expectedKeyword?: string | null,
    maxRedirects = 5,
  ): Promise<{ ok: boolean; statusCode?: number; responseMs: number; error?: string }> {
    const start = Date.now();

    const follow = (targetUrl: string, redirectsLeft: number) =>
      new Promise<{ ok: boolean; statusCode?: number; responseMs: number; error?: string }>((resolve) => {
        let parsed: URL;
        try {
          parsed = new URL(targetUrl);
        } catch {
          resolve({ ok: false, responseMs: Date.now() - start, error: 'URL invalide' });
          return;
        }

        const lib = parsed.protocol === 'https:' ? https : http;
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

            if (redirectsLeft > 0 && location && [301, 302, 303, 307, 308].includes(statusCode)) {
              res.resume();
              follow(new URL(location, targetUrl).href, redirectsLeft - 1).then(resolve);
              return;
            }

            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
              const responseMs = Date.now() - start;
              const statusOk = statusCode >= 200 && statusCode < 400;
              const keywordOk = !expectedKeyword || body.includes(expectedKeyword);
              const expectedOk = statusCode === expectedStatus || statusOk;

              resolve({
                ok: expectedOk && keywordOk,
                statusCode,
                responseMs,
                error: !expectedOk
                  ? `HTTP ${statusCode} (attendu ${expectedStatus} ou 2xx/3xx)`
                  : !keywordOk
                    ? 'Mot-clé attendu non trouvé'
                    : undefined,
              });
            });
          },
        );

        req.on('error', (err) => {
          resolve({ ok: false, responseMs: Date.now() - start, error: err.message });
        });

        req.on('timeout', () => {
          req.destroy();
          resolve({ ok: false, responseMs: Date.now() - start, error: 'Timeout HTTP (15s)' });
        });
      });

    return follow(url, maxRedirects);
  }
}
