'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  CalendarClock,
  Plus,
  RefreshCw,
  AlertTriangle,
  Clock,
  Repeat,
  Trash2,
} from 'lucide-react';
import { api, type CyberAutomation } from '@/lib/api';
import { useAuthProfile } from '@/hooks/use-auth-profile';
import { cn } from '@/lib/utils';

function formatWhen(iso?: string | null) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function CyberAutomationPage() {
  const { hasPermission } = useAuthProfile();
  const canModify = hasPermission('cybersecurity', 'modify');

  const [data, setData] = useState<CyberAutomation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [newTime, setNewTime] = useState('12:30');

  const [enabled, setEnabled] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState(0);
  const [dailyTimes, setDailyTimes] = useState<string[]>([]);
  const [deep, setDeep] = useState(false);
  const [timezone, setTimezone] = useState('Europe/Paris');

  const apply = useCallback((a: CyberAutomation) => {
    setData(a);
    setEnabled(a.enabled);
    setIntervalMinutes(a.intervalMinutes);
    setDailyTimes(a.dailyTimes || []);
    setDeep(a.deep);
    setTimezone(a.timezone || 'Europe/Paris');
  }, []);

  const load = useCallback(async () => {
    try {
      apply(await api.getCyberAutomation());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  async function save(partial?: Partial<{
    enabled: boolean;
    intervalMinutes: number;
    dailyTimes: string[];
    deep: boolean;
    timezone: string;
  }>) {
    if (!canModify) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateCyberAutomation({
        enabled: partial?.enabled ?? enabled,
        intervalMinutes: partial?.intervalMinutes ?? intervalMinutes,
        dailyTimes: partial?.dailyTimes ?? dailyTimes,
        deep: partial?.deep ?? deep,
        timezone: partial?.timezone ?? timezone,
      });
      apply(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enregistrement impossible');
    } finally {
      setSaving(false);
    }
  }

  function addDailyTime() {
    const t = newTime.trim();
    if (!t || dailyTimes.includes(t)) return;
    const next = [...dailyTimes, t].sort();
    setDailyTimes(next);
  }

  function removeDailyTime(t: string) {
    setDailyTimes(dailyTimes.filter((x) => x !== t));
  }

  if (loading && !data) {
    return (
      <div className="flex h-32 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1 inline-flex items-center gap-2 rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300">
            <CalendarClock className="h-3.5 w-3.5" />
            Programmation des audits
          </div>
          <h1 className="text-2xl font-bold">Automation</h1>
          <p className="text-sm text-muted-foreground">
            Scans automatiques des cibles actives — intervalle et/ou horaires quotidiens
          </p>
        </div>
        <button type="button" onClick={load} className="btn-secondary text-sm">
          <RefreshCw className="h-4 w-4" /> Actualiser
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="card border-sky-500/20 bg-sky-500/5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">État</p>
          <p className={cn('mt-2 text-lg font-semibold', enabled ? 'text-emerald-400' : 'text-muted-foreground')}>
            {enabled ? 'Automatisation active' : 'Désactivée'}
          </p>
        </div>
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Prochain scan</p>
          <p className="mt-2 text-sm font-medium">{formatWhen(data?.nextRunAt)}</p>
        </div>
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Dernier scan auto</p>
          <p className="mt-2 text-sm font-medium">{formatWhen(data?.lastRunAt)}</p>
          {data?.lastTrigger && (
            <p className="mt-1 text-xs text-muted-foreground">
              Déclencheur : {data.lastTrigger === 'daily' ? 'quotidien' : 'intervalle'}
            </p>
          )}
        </div>
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Scan en cours</p>
          <p className="mt-2 text-sm font-medium">
            {data?.scanRunning ? 'Oui' : 'Non'}
          </p>
        </div>
      </div>

      {data?.lastError && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Dernière erreur auto : {data.lastError}
        </div>
      )}

      <div className="card space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Activation</h2>
            <p className="text-sm text-muted-foreground">
              Les cibles utilisées sont celles activées dans{' '}
              <Link href="/cybersecurite/cibles" className="text-primary hover:underline">
                Cibles
              </Link>
              .
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-primary h-4 w-4"
              checked={enabled}
              disabled={!canModify || saving}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Scans automatiques
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            className="accent-primary"
            checked={deep}
            disabled={!canModify || saving}
            onChange={(e) => setDeep(e.target.checked)}
          />
          Mode approfondi pour les scans programmés (nuclei / moteurs lourds)
        </label>

        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Fuseau horaire</label>
          <input
            className="input max-w-xs"
            value={timezone}
            disabled={!canModify || saving}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="Europe/Paris"
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-4">
          <div className="flex items-center gap-2">
            <Repeat className="h-4 w-4 text-sky-400" />
            <h2 className="font-semibold">Répétitive</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Lance un audit toutes les N minutes. 0 = désactivé.
          </p>
          <div className="flex items-end gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Intervalle (minutes)</label>
              <input
                type="number"
                min={0}
                max={10080}
                className="input w-36"
                value={intervalMinutes}
                disabled={!canModify || saving}
                onChange={(e) => setIntervalMinutes(Number(e.target.value) || 0)}
              />
            </div>
            <p className="pb-2 text-xs text-muted-foreground">
              Prochain : {formatWhen(data?.nextIntervalAt)}
            </p>
          </div>
        </div>

        <div className="card space-y-4">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-sky-400" />
            <h2 className="font-semibold">Quotidienne</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Heures fixes chaque jour ({timezone}). Combinable avec l’intervalle.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Ajouter une heure</label>
              <input
                type="time"
                className="input"
                value={newTime}
                disabled={!canModify || saving}
                onChange={(e) => setNewTime(e.target.value)}
              />
            </div>
            {canModify && (
              <button type="button" className="btn-secondary text-sm" onClick={addDailyTime}>
                <Plus className="h-4 w-4" /> Ajouter
              </button>
            )}
          </div>
          {dailyTimes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune heure quotidienne.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {dailyTimes.map((t) => (
                <li
                  key={t}
                  className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-secondary/40 px-3 py-1.5 text-sm"
                >
                  {t}
                  {canModify && (
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => removeDailyTime(t)}
                      aria-label={`Retirer ${t}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Prochain créneau : {formatWhen(data?.nextDailyAt)}
          </p>
        </div>
      </div>

      {canModify && (
        <div className="flex justify-end">
          <button
            type="button"
            className="btn-primary"
            disabled={saving}
            onClick={() => save()}
          >
            {saving ? 'Enregistrement…' : 'Enregistrer la programmation'}
          </button>
        </div>
      )}
    </div>
  );
}
