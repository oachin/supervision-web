'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Activity } from 'lucide-react';
import { useAlerts } from './alert-provider';
import { api, type DashboardData } from '@/lib/api';
import { cn } from '@/lib/utils';

type GlobalLevel = 'ok' | 'warning' | 'critical';

const levelStyles: Record<
  GlobalLevel,
  { bar: string; icon: string; label: string }
> = {
  ok: {
    bar: 'bg-emerald-400/15 border-emerald-400/30 text-emerald-100',
    icon: 'text-emerald-400',
    label: 'nominal',
  },
  warning: {
    bar: 'border-amber-400/35 bg-[#fde6b1] text-[#713f12] dark:bg-amber-400/20 dark:text-amber-100',
    icon: 'text-[#713f12] dark:text-amber-300',
    label: 'sous surveillance',
  },
  critical: {
    bar: 'bg-red-500/15 border-red-500/35 text-red-100',
    icon: 'text-red-400',
    label: 'incident en cours',
  },
};

export function AlertBanner() {
  const { summary } = useAlerts();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);

  useEffect(() => {
    api.getDashboard().then(setDashboard).catch(console.error);
    const interval = setInterval(() => {
      api.getDashboard().then(setDashboard).catch(console.error);
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const state = useMemo(() => {
    const counts = summary?.counts ?? { active: 0, acknowledged: 0, pendingClose: 0, closed: 0 };
    const unresolvedAlerts = counts.active + counts.acknowledged + counts.pendingClose;
    const hasCriticalActive = summary?.active.some((a) => a.severity === 'CRITICAL') ?? false;

    const serversOffline = dashboard?.summary.servers.offline ?? 0;
    const sitesDown = dashboard?.summary.websites.down ?? 0;
    const serversDegraded = dashboard?.summary.servers.degraded ?? 0;
    const sitesDegraded = dashboard?.summary.websites.degraded ?? 0;
    const sitesDisabled = dashboard?.summary.websites.disabled ?? 0;

    let level: GlobalLevel = 'ok';
    if (serversOffline > 0 || sitesDown > 0 || hasCriticalActive) {
      level = 'critical';
    } else if (
      unresolvedAlerts > 0 ||
      serversDegraded > 0 ||
      sitesDegraded > 0 ||
      sitesDisabled > 0
    ) {
      level = 'warning';
    }

    const details: string[] = [];
    if (unresolvedAlerts > 0) {
      details.push(`${unresolvedAlerts} alerte${unresolvedAlerts > 1 ? 's' : ''} non résolue${unresolvedAlerts > 1 ? 's' : ''}`);
    } else {
      details.push('Aucune alerte active');
    }
    if (sitesDisabled > 0) {
      details.push(`${sitesDisabled} site${sitesDisabled > 1 ? 's' : ''} hors supervision`);
    }

    return { level, unresolvedAlerts, sitesDisabled, details: details.join(' · ') };
  }, [summary, dashboard]);

  const styles = levelStyles[state.level];

  return (
    <Link
      href="/alerts"
      className={cn(
        'mx-4 my-2 flex min-h-[44px] items-center gap-3 rounded-xl border px-4 py-2.5 transition-opacity hover:opacity-95',
        styles.bar,
      )}
    >
      <Activity className={cn('h-4 w-4 shrink-0', styles.icon)} />
      <span className="text-sm">
        <span className="font-semibold">État global : {styles.label}</span>
      </span>
      <span className={cn('ml-auto text-sm font-normal opacity-90', state.level === 'warning' && 'dark:opacity-100')}>
        {state.details}
      </span>
    </Link>
  );
}
