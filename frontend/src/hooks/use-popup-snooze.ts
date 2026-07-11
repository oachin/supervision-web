'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'havet-alert-popup-snooze-until';
export const POPUP_SNOOZE_MS = 30 * 60 * 1000;

function readSnoozeUntil(): number | null {
  if (typeof window === 'undefined') return null;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return null;
  const until = Number.parseInt(stored, 10);
  if (Number.isNaN(until) || until <= Date.now()) {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
  return until;
}

export function usePopupSnooze() {
  const [snoozedUntil, setSnoozedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setSnoozedUntil(readSnoozeUntil());
    const interval = setInterval(() => {
      const until = readSnoozeUntil();
      setSnoozedUntil(until);
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const isSnoozed = snoozedUntil != null && snoozedUntil > now;

  const snooze = useCallback(() => {
    const until = Date.now() + POPUP_SNOOZE_MS;
    localStorage.setItem(STORAGE_KEY, String(until));
    setSnoozedUntil(until);
    setNow(Date.now());
  }, []);

  const cancelSnooze = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setSnoozedUntil(null);
  }, []);

  const remainingMs = isSnoozed && snoozedUntil ? snoozedUntil - now : 0;
  const remainingMin = Math.max(1, Math.ceil(remainingMs / 60_000));

  return { isSnoozed, snooze, cancelSnooze, remainingMin };
}
