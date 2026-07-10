import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date?: string) {
  if (!date) return '—';
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(date));
}

export function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}j ${hours}h`;
  return `${hours}h`;
}

export function statusColor(status: string) {
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

export function statusLabel(status: string) {
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
