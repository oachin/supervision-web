import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type WebsecSiteTarget = { name: string; url: string; domain?: string };

export type WebsecReportFile = {
  buffer: Buffer;
  contentType: string;
  filename: string;
};

@Injectable()
export class WebsecClient {
  private readonly logger = new Logger(WebsecClient.name);

  constructor(private config: ConfigService) {}

  private baseUrl() {
    return this.config.get<string>('WEBSEC_URL', 'http://websec:8000').replace(/\/$/, '');
  }

  private apiKey() {
    return this.config.get<string>('WEBSEC_API_KEY', '');
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const key = this.apiKey();
    if (!key) {
      throw new ServiceUnavailableException(
        'WEBSEC_API_KEY non configurée — service cybersécurité indisponible',
      );
    }

    const url = `${this.baseUrl()}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          'X-Websec-Key': key,
          ...(init.headers as Record<string, string>),
        },
      });
    } catch (err) {
      this.logger.error(`Websec unreachable: ${url}`, err instanceof Error ? err.stack : undefined);
      throw new ServiceUnavailableException('Service d’audit web injoignable');
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new ServiceUnavailableException(
        body || `Erreur WebSec (${res.status})`,
      );
    }
    return res.json() as Promise<T>;
  }

  private async requestFile(path: string): Promise<WebsecReportFile> {
    const key = this.apiKey();
    if (!key) {
      throw new ServiceUnavailableException(
        'WEBSEC_API_KEY non configurée — service cybersécurité indisponible',
      );
    }

    const url = `${this.baseUrl()}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'X-Websec-Key': key },
      });
    } catch (err) {
      this.logger.error(`Websec unreachable: ${url}`, err instanceof Error ? err.stack : undefined);
      throw new ServiceUnavailableException('Service d’audit web injoignable');
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new ServiceUnavailableException(
        body || `Erreur WebSec (${res.status})`,
      );
    }

    const cd = res.headers.get('content-disposition') || '';
    const match = /filename\*?=(?:UTF-8''|")?([^\";]+)/i.exec(cd);
    const filename = match
      ? decodeURIComponent(match[1].replace(/"/g, ''))
      : path.includes('site')
        ? `audit_site.${path.includes('pdf') ? 'pdf' : 'html'}`
        : `audit_report.${path.includes('pdf') ? 'pdf' : 'html'}`;

    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get('content-type') || 'application/octet-stream',
      filename,
    };
  }

  health() {
    return fetch(`${this.baseUrl()}/health`).then((r) => r.ok).catch(() => false);
  }

  getStatus() {
    return this.request<Record<string, unknown>>('/v1/status');
  }

  listSites() {
    return this.request<{ sites: Record<string, unknown>[]; count: number }>('/v1/sites?limit=500');
  }

  getSite(url: string) {
    return this.request<Record<string, unknown>>(
      `/v1/sites/by-url?url=${encodeURIComponent(url)}`,
    );
  }

  getTrend(limit = 30) {
    return this.request<{ trend: unknown[] }>(`/v1/trend?limit=${limit}`);
  }

  getHistory(url: string, limit = 30) {
    return this.request<{ url: string; history: unknown[] }>(
      `/v1/history?url=${encodeURIComponent(url)}&limit=${limit}`,
    );
  }

  getGlobalReport(fmt: 'html' | 'pdf' = 'html', lang = 'fr') {
    return this.requestFile(`/v1/report/global?fmt=${fmt}&lang=${encodeURIComponent(lang)}`);
  }

  getSiteReport(url: string, fmt: 'html' | 'pdf' = 'html', lang = 'fr') {
    return this.requestFile(
      `/v1/report/site?url=${encodeURIComponent(url)}&fmt=${fmt}&lang=${encodeURIComponent(lang)}`,
    );
  }

  startScan(sites: WebsecSiteTarget[], deep = false, authorized = false) {
    return this.request<{ started: boolean; sites: number; deep: boolean }>('/v1/scan', {
      method: 'POST',
      body: JSON.stringify({ sites, deep, authorized }),
    });
  }
}
