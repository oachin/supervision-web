import type { Alert } from '@/lib/api';

export type SeverityKey = Alert['severity'];

export type SeverityCounts = Record<SeverityKey, number>;

export function emptySeverityCounts(): SeverityCounts {
  return { CRITICAL: 0, WARNING: 0, INFO: 0 };
}

export function countAlertsBySeverity(alerts: Alert[]): SeverityCounts {
  const counts = emptySeverityCounts();
  for (const a of alerts) {
    if (a.severity in counts) counts[a.severity] += 1;
  }
  return counts;
}
