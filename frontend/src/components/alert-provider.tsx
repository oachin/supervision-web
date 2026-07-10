'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, type Alert, type AlertSummary } from '@/lib/api';
import { AlertPopup } from './alert-popup';

interface AlertContextValue {
  summary: AlertSummary | null;
  refresh: () => Promise<void>;
}

const AlertContext = createContext<AlertContextValue>({ summary: null, refresh: async () => {} });

export function useAlerts() {
  return useContext(AlertContext);
}

export function AlertProvider({ children }: { children: React.ReactNode }) {
  const [popupAlerts, setPopupAlerts] = useState<Alert[]>([]);
  const [currentPopup, setCurrentPopup] = useState<Alert | null>(null);
  const [summary, setSummary] = useState<AlertSummary | null>(null);

  const refresh = useCallback(async () => {
    const [summaryData, popupData] = await Promise.all([
      api.getAlertsSummary(),
      api.getAlertsPopup(),
    ]);
    setSummary(summaryData);
    setPopupAlerts(popupData);
    setCurrentPopup((prev) => {
      if (prev && popupData.some((a) => a.id === prev.id)) return prev;
      return popupData[0] ?? null;
    });
  }, []);

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

  return (
    <AlertContext.Provider value={{ summary, refresh }}>
      {children}
      {currentPopup && (
        <AlertPopup alert={currentPopup} onAcknowledge={handleAcknowledge} />
      )}
    </AlertContext.Provider>
  );
}
