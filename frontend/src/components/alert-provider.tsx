'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, type Alert, type AlertSummary } from '@/lib/api';
import { AlertPopup } from './alert-popup';
import { usePopupSnooze } from '@/hooks/use-popup-snooze';

interface AlertContextValue {
  summary: AlertSummary | null;
  refresh: () => Promise<void>;
  popupSnoozed: boolean;
  popupSnoozeRemainingMin: number;
  snoozePopups: () => void;
  cancelPopupSnooze: () => void;
}

const AlertContext = createContext<AlertContextValue>({
  summary: null,
  refresh: async () => {},
  popupSnoozed: false,
  popupSnoozeRemainingMin: 0,
  snoozePopups: () => {},
  cancelPopupSnooze: () => {},
});

export function useAlerts() {
  return useContext(AlertContext);
}

export function AlertProvider({ children }: { children: React.ReactNode }) {
  const [popupAlerts, setPopupAlerts] = useState<Alert[]>([]);
  const [currentPopup, setCurrentPopup] = useState<Alert | null>(null);
  const [summary, setSummary] = useState<AlertSummary | null>(null);
  const { isSnoozed, snooze, cancelSnooze, remainingMin } = usePopupSnooze();

  const refresh = useCallback(async () => {
    const [summaryData, popupData] = await Promise.all([
      api.getAlertsSummary(),
      api.getAlertsPopup(),
    ]);
    setSummary(summaryData);
    setPopupAlerts(popupData);
  }, []);

  useEffect(() => {
    if (isSnoozed) {
      setCurrentPopup(null);
      return;
    }
    setCurrentPopup((prev) => {
      if (prev && popupAlerts.some((a) => a.id === prev.id)) return prev;
      return popupAlerts[0] ?? null;
    });
  }, [isSnoozed, popupAlerts]);

  useEffect(() => {
    refresh().catch(console.error);
    const interval = setInterval(() => {
      refresh().catch(console.error);
    }, 20000);
    return () => clearInterval(interval);
  }, [refresh]);

  async function handleAcknowledge() {
    if (!currentPopup) return;
    await api.acknowledgeAlert(currentPopup.id);
    const remaining = popupAlerts.filter((a) => a.id !== currentPopup.id);
    setPopupAlerts(remaining);
    setCurrentPopup(remaining[0] ?? null);
    refresh();
  }

  function handleSnoozePopups() {
    snooze();
  }

  return (
    <AlertContext.Provider
      value={{
        summary,
        refresh,
        popupSnoozed: isSnoozed,
        popupSnoozeRemainingMin: remainingMin,
        snoozePopups: handleSnoozePopups,
        cancelPopupSnooze: cancelSnooze,
      }}
    >
      {children}
      {currentPopup && !isSnoozed && (
        <AlertPopup
          alert={currentPopup}
          onAcknowledge={handleAcknowledge}
          onSnooze={handleSnoozePopups}
        />
      )}
    </AlertContext.Provider>
  );
}
