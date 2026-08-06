/** Consecutive-check hysteresis (Zabbix-style) before raising/clearing alerts. */

export const ALERT_FAIL_STREAK = 3;
export const ALERT_RECOVER_STREAK = 3;

/** Agent heartbeats typically ~60s; allow some jitter between samples. */
export const HEARTBEAT_MAX_GAP_MS = 2.5 * 60 * 1000;

/** Mark server OFFLINE after this silence. */
export const SERVER_OFFLINE_AFTER_MS = 5 * 60 * 1000;

/**
 * Raise "serveur hors ligne" only after the offline threshold plus
 * (FAIL_STREAK - 1) extra minute ticks — confirms across several cron runs.
 */
export const SERVER_OFFLINE_ALERT_AFTER_MS =
  SERVER_OFFLINE_AFTER_MS + (ALERT_FAIL_STREAK - 1) * 60 * 1000;

/** Count how many leading items match `pred` (newest-first sequences). */
export function countLeadingStreak<T>(items: T[], pred: (item: T) => boolean): number {
  let n = 0;
  for (const item of items) {
    if (!pred(item)) break;
    n++;
  }
  return n;
}

/**
 * True when the newest `needed` heartbeats form a tight consecutive chain
 * (no long gap), i.e. the agent has reported successfully several times in a row.
 */
export function hasConsecutiveHeartbeats(
  collectedAtDesc: Date[],
  needed: number,
  maxGapMs = HEARTBEAT_MAX_GAP_MS,
): boolean {
  if (collectedAtDesc.length < needed) return false;
  const slice = collectedAtDesc.slice(0, needed);
  for (let i = 0; i < slice.length - 1; i++) {
    const newer = slice[i].getTime();
    const older = slice[i + 1].getTime();
    if (newer - older > maxGapMs) return false;
  }
  return true;
}
