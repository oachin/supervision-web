import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const DEFAULT_APP_TIMEZONE = 'Europe/Paris';
let appTimeZone = DEFAULT_APP_TIMEZONE;

export function getAppTimeZone() {
  return appTimeZone || DEFAULT_APP_TIMEZONE;
}

export function setAppTimeZone(timezone: string) {
  const next = (timezone || '').trim();
  if (!next) return;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: next });
    appTimeZone = next;
  } catch {
    // keep previous valid timezone
  }
}

export function parseAppDate(date?: string | Date | null): Date | null {
  if (!date) return null;
  if (date instanceof Date) return Number.isNaN(date.getTime()) ? null : date;
  const raw = date.trim();
  if (!raw) return null;
  // Naive ISO from WebSec SQLite is UTC — force Z so browsers don't treat as local.
  const normalized =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw) &&
    !/[zZ]|[+-]\d{2}:\d{2}$/.test(raw)
      ? `${raw}Z`
      : raw;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(date?: string | Date | null) {
  const d = parseAppDate(date);
  if (!d) return '—';
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: getAppTimeZone(),
  }).format(d);
}

export function formatDateTime(
  date?: string | Date | null,
  options?: Intl.DateTimeFormatOptions,
) {
  const d = parseAppDate(date);
  if (!d) return '—';
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: getAppTimeZone(),
    ...options,
  }).format(d);
}

export function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}j ${hours}h`;
  return `${hours}h`;
}

export function formatCpuPercent(value: number) {
  if (value > 0 && value < 0.1) return '< 0.1%';
  return `${value.toFixed(value < 10 ? 2 : 1)}%`;
}

export function isMaintenanceStatus(status: string, statusCode?: number | null) {
  return status === 'DEGRADED' && statusCode === 503;
}

export function isSiteDegraded(status: string, statusCode?: number | null) {
  return status === 'DEGRADED' && !isMaintenanceStatus(status, statusCode);
}

export function statusColor(status: string, statusCode?: number | null) {
  if (isMaintenanceStatus(status, statusCode)) return 'maintenance';
  switch (status) {
    case 'ONLINE':
    case 'UP':
      return 'success';
    case 'OFFLINE':
    case 'DOWN':
      return 'danger';
    case 'DEGRADED':
      return 'warning';
    default:
      return 'muted';
  }
}

export function statusLabel(status: string, statusCode?: number | null) {
  if (isMaintenanceStatus(status, statusCode)) return 'En maintenance';
  const labels: Record<string, string> = {
    ONLINE: 'En ligne',
    OFFLINE: 'Hors ligne',
    DEGRADED: 'Dégradé',
    UNKNOWN: 'Inconnu',
    UP: 'En ligne',
    DOWN: 'Hors ligne',
  };
  return labels[status] || status;
}
