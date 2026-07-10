'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, type Alert, type AlertSummary } from '@/lib/api';
import { AlertPopup } from './alert-popup';

interface AlertContextValue {
  summary: AlertSummary | null;
  refresh: () => void;
}

const AlertContext = createContext<AlertContextValue>({ summary: null, refresh: () => {} });

export function useAlerts() {
  return useContext(AlertContext);
}

export function AlertProvider({ children }: { children: React.ReactNode }) {
  const [popupAlerts, setPopupAlerts] = useState<Alert[]>([]);
  const [currentPopup, setCurrentPopup] = useState<Alert | null>(null);
  const [summary, setSummary] = useState<AlertSummary | null>(null);

  const refresh = useCallback(() => {
    api.getAlertsSummary().then(setSummary).catch(console.error);
    api.getAlertsPopup().then((alerts) => {
      setPopupAlerts(alerts);
      setCurrentPopup((prev) => {
        if (prev && alerts.some((a) => a.id === prev.id)) return prev;
        return alerts[0] ?? null;
      });
    }).catch(console.error);
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 20000);
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
