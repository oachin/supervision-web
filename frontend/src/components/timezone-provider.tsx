'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, type AppSettings } from '@/lib/api';
import { getAppTimeZone, setAppTimeZone } from '@/lib/utils';

type TimezoneContextValue = {
  timezone: string;
  loading: boolean;
  refresh: () => Promise<void>;
  applyTimezone: (timezone: string) => void;
};

const TimezoneContext = createContext<TimezoneContextValue>({
  timezone: getAppTimeZone(),
  loading: true,
  refresh: async () => undefined,
  applyTimezone: () => undefined,
});

export function TimezoneProvider({ children }: { children: React.ReactNode }) {
  const [timezone, setTimezone] = useState(getAppTimeZone());
  const [loading, setLoading] = useState(true);

  const applyTimezone = useCallback((next: string) => {
    setAppTimeZone(next);
    setTimezone(getAppTimeZone());
  }, []);

  const refresh = useCallback(async () => {
    try {
      const settings = await api.getAppSettings();
      applyTimezone(settings.timezone);
    } catch {
      // keep default / previous
    } finally {
      setLoading(false);
    }
  }, [applyTimezone]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ timezone, loading, refresh, applyTimezone }),
    [timezone, loading, refresh, applyTimezone],
  );

  return <TimezoneContext.Provider value={value}>{children}</TimezoneContext.Provider>;
}

export function useAppTimezone() {
  return useContext(TimezoneContext);
}

export type { AppSettings };
