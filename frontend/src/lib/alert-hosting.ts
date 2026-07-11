import type { Alert } from '@/lib/api';

/** Serveur hébergeur : directement sur l'alerte ou via le site web associé. */
export function getAlertHostingServer(alert: Alert) {
  return alert.server ?? alert.website?.server;
}

export function getAlertHostingServerLabel(alert: Alert): string | undefined {
  const server = getAlertHostingServer(alert);
  if (!server) return undefined;
  return server.hostname ? `${server.name} (${server.hostname})` : server.name;
}
