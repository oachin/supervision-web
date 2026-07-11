import { WebsiteStatus } from '@prisma/client';

const SEVERITY: Record<WebsiteStatus, number> = {
  DOWN: 3,
  DEGRADED: 2,
  UNKNOWN: 1,
  UP: 0,
};

export function worstWebsiteStatus(...statuses: WebsiteStatus[]): WebsiteStatus {
  return statuses.reduce((worst, current) =>
    SEVERITY[current] > SEVERITY[worst] ? current : worst,
  'UP' as WebsiteStatus);
}

/** Codes HTTP où le serveur répond mais le service n'est pas nominal (maintenance, etc.). */
export function isMaintenanceStatusCode(statusCode?: number | null): boolean {
  return statusCode === 503;
}

/**
 * Certaines apps renvoient 404 + redirection JavaScript ou meta refresh (ex. domaine legacy → www).
 * Extrait la cible pour la suivre comme une redirection HTTP classique.
 */
export function extractHtmlRedirectUrl(body: string): string | null {
  const metaRefresh = body.match(
    /<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["']([^"']+)["']/i,
  );
  if (metaRefresh) {
    const urlPart = metaRefresh[1].match(/url=(.+)$/i);
    if (urlPart) {
      return urlPart[1].trim().replace(/^['"]|['"]$/g, '');
    }
  }

  const jsPatterns = [
    /window\.location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/i,
    /(?:^|[^\w])location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/im,
    /location\.replace\s*\(\s*['"]([^'"]+)['"]\s*\)/i,
    /document\.location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/i,
  ];

  for (const pattern of jsPatterns) {
    const match = body.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}

export function shouldFollowHtmlRedirect(statusCode: number): boolean {
  return statusCode >= 400 && statusCode < 500 && statusCode !== 503;
}

/** Disponibilité HTTP : joignable si le serveur répond (y compris maintenance 503). */
export function availabilityStatus(
  httpOk: boolean,
  responseMs: number,
  statusCode?: number | null,
): WebsiteStatus {
  if (isMaintenanceStatusCode(statusCode)) return 'DEGRADED';
  if (statusCode != null && statusCode >= 500) return 'DOWN';
  if (!httpOk) return 'DOWN';

  if (statusCode != null && statusCode >= 400 && statusCode < 500) {
    return 'DEGRADED';
  }

  if (responseMs > 3000) return 'DEGRADED';
  return 'UP';
}

export function probeResultToStatus(
  ok: boolean,
  responseMs: number,
  statusCode?: number | null,
): WebsiteStatus {
  return availabilityStatus(ok, responseMs, statusCode);
}

export function isWebsiteInAlert(status: WebsiteStatus, statusCode?: number | null): boolean {
  if (isMaintenanceStatusCode(statusCode)) return false;
  return status === 'DOWN' || status === 'DEGRADED';
}

export function isServerInAlert(status: string): boolean {
  return status === 'OFFLINE' || status === 'DEGRADED';
}
