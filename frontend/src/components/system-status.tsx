'use client';

import { useEffect, useState, useRef } from 'react';
import { CheckCircle2, AlertTriangle, X, ChevronDown } from 'lucide-react';
import { api, type SystemHealth } from '@/lib/api';
import { cn } from '@/lib/utils';

export function SystemStatus() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = () => {
    api.getSystemHealth().then(setHealth).catch(() => {
      setHealth({
        status: 'degraded',
        label: 'Système en défaut',
        checkedAt: new Date().toISOString(),
        components: [],
        faults: ['Impossible de contacter l\'API de supervision'],
      });
    });
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  if (!health) return null;

  const operational = health.status === 'operational';

  return (
    <div className="relative px-6 pb-4" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-medium transition-all',
          operational
            ? 'border-accent/20 bg-accent/10 text-accent hover:bg-accent/15'
            : 'border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15',
        )}
      >
        {operational ? (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="flex-1">{health.label}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute left-6 right-6 top-full z-50 mt-1 rounded-lg border border-white/10 bg-card shadow-xl">
          <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
            <h3 className="text-sm font-semibold">État des services</h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded p-1 text-muted-foreground hover:bg-secondary/50"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="max-h-64 overflow-y-auto p-2">
            {health.components.map((c) => (
              <div
                key={c.id}
                className="flex items-start justify-between gap-2 rounded-md px-2 py-2 text-xs"
              >
                <div className="min-w-0">
                  <p className="font-medium">{c.name}</p>
                  <p className="text-muted-foreground">{c.container}</p>
                </div>
                <div className="shrink-0 text-right">
                  <span className={cn(
                    'badge',
                    c.status === 'up' ? 'badge-success' : 'badge-danger',
                  )}>
                    {c.status === 'up' ? 'OK' : 'Défaut'}
                  </span>
                  {c.latencyMs != null && (
                    <p className="mt-1 font-mono text-muted-foreground">{c.latencyMs}ms</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {health.faults.length > 0 && (
            <div className="border-t border-white/5 p-4">
              <p className="mb-2 text-xs font-semibold text-destructive">Défauts détectés</p>
              <ul className="space-y-1">
                {health.faults.map((fault) => (
                  <li key={fault} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-destructive" />
                    {fault}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="border-t border-white/5 px-4 py-2 text-[10px] text-muted-foreground">
            Dernière vérification : {new Date(health.checkedAt).toLocaleTimeString('fr-FR')}
          </div>
        </div>
      )}
    </div>
  );
}
