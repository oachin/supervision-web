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

export function probeResultToStatus(ok: boolean, responseMs: number): WebsiteStatus {
  if (!ok) return 'DOWN';
  if (responseMs > 3000) return 'DEGRADED';
  return 'UP';
}

export function isWebsiteInAlert(status: WebsiteStatus): boolean {
  return status === 'DOWN' || status === 'DEGRADED';
}

export function isServerInAlert(status: string): boolean {
  return status === 'OFFLINE' || status === 'DEGRADED';
}
