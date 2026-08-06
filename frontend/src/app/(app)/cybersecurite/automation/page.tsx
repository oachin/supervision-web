'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  CalendarClock,
  Plus,
  RefreshCw,
  AlertTriangle,
  Clock,
  Repeat,
  Trash2,
  Info,
  ChevronDown,
} from 'lucide-react';
import { api, type CyberAutomation, type CyberAutoTarget } from '@/lib/api';
import { useAuthProfile } from '@/hooks/use-auth-profile';
import { cn } from '@/lib/utils';
import { SiteSearchInput, matchesSiteSearch } from '@/components/site-search-input';
import { OpenExternalUrl } from '@/components/open-external-url';

const DEEP_MODE_HELP =
  'Active les moteurs lourds (Nuclei, testssl, ZAP…). Plus exhaustif, mais plus long et plus agressif sur les cibles. Le mode standard suffit pour un contrôle de surface courant.';

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
  const [targets, setTargets] = useState<CyberAutoTarget[]>([]);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [siteQuery, setSiteQuery] = useState('');

  const apply = useCallback((a: CyberAutomation) => {
    setData(a);
    setEnabled(a.enabled);
    setIntervalMinutes(a.intervalMinutes);
    setDailyTimes(a.dailyTimes || []);
    setDeep(a.deep);
    setTimezone(a.timezone || 'Europe/Paris');
    setTargets(a.autoTargets || []);
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

  const excludeUrls = useMemo(
    () => targets.filter((t) => !t.includedInAuto).map((t) => t.url),
    [targets],
  );
  const includedCount = targets.filter((t) => t.includedInAuto).length;
  const allIncluded = targets.length > 0 && includedCount === targets.length;
  const filteredTargets = useMemo(
    () => targets.filter((t) => matchesSiteSearch(siteQuery, t.name, t.url, t.domain)),
    [targets, siteQuery],
  );

  async function save() {
    if (!canModify) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateCyberAutomation({
        enabled,
        intervalMinutes,
        dailyTimes,
        autoExcludeUrls: excludeUrls,
        deep,
        timezone,
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
    setDailyTimes([...dailyTimes, t].sort());
  }

  function removeDailyTime(t: string) {
    setDailyTimes(dailyTimes.filter((x) => x !== t));
  }

  function setAllIncluded(included: boolean) {
    setTargets((prev) => prev.map((t) => ({ ...t, includedInAuto: included })));
  }

  function toggleTarget(url: string, included: boolean) {
    setTargets((prev) =>
      prev.map((t) => (t.url === url ? { ...t, includedInAuto: included } : t)),
    );
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
            Scans automatiques — planning, mode et sélection des cibles
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
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Cibles auto</p>
          <p className="mt-2 text-2xl font-bold">
            {includedCount}
            <span className="text-base font-normal text-muted-foreground">/{targets.length}</span>
          </p>
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
              Base des cibles : sites activés dans{' '}
              <Link href="/cybersecurite/cibles" className="text-primary hover:underline">
                Cibles
              </Link>
              . Vous pouvez en exclure certaines du scan auto ci-dessous.
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
          Mode approfondi pour les scans programmés
          <span
            className="inline-flex cursor-help text-muted-foreground/80 hover:text-sky-300"
            title={DEEP_MODE_HELP}
            aria-label={DEEP_MODE_HELP}
          >
            <Info className="h-3.5 w-3.5" />
          </span>
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

      <div className="card space-y-0 overflow-hidden p-0">
        <button
          type="button"
          className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left hover:bg-white/[0.02]"
          onClick={() => setTargetsOpen((o) => !o)}
          aria-expanded={targetsOpen}
        >
          <div className="min-w-0">
            <h2 className="font-semibold">Cibles du scan automatique</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {includedCount}/{targets.length} incluse{includedCount > 1 ? 's' : ''}
              {!targetsOpen && ' — cliquez pour développer'}
            </p>
          </div>
          <ChevronDown
            className={cn(
              'mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform',
              targetsOpen && 'rotate-180',
            )}
          />
        </button>

        {targetsOpen && (
          <div className="space-y-4 border-t border-white/5 px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Par défaut toutes sont incluses. Décochez pour exclure du scan auto (le scan manuel reste complet).
              </p>
              {canModify && targets.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-secondary px-2 py-1 text-xs"
                    disabled={saving || allIncluded}
                    onClick={() => setAllIncluded(true)}
                  >
                    Tout inclure
                  </button>
                  <button
                    type="button"
                    className="btn-secondary px-2 py-1 text-xs"
                    disabled={saving || includedCount === 0}
                    onClick={() => setAllIncluded(false)}
                  >
                    Tout exclure
                  </button>
                </div>
              )}
            </div>

            {targets.length > 0 && (
              <SiteSearchInput
                value={siteQuery}
                onChange={setSiteQuery}
                className="w-full max-w-none"
              />
            )}

            {targets.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Aucune cible active.{' '}
                <Link href="/cybersecurite/cibles" className="text-primary hover:underline">
                  Activer des cibles
                </Link>
              </p>
            ) : filteredTargets.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Aucune cible pour « {siteQuery.trim()} ».
              </p>
            ) : (
              <ul className="divide-y divide-white/5 rounded-lg border border-white/5">
                {filteredTargets.map((t) => (
                  <li key={t.url} className="flex items-center gap-3 px-3 py-2.5">
                    <input
                      type="checkbox"
                      className="accent-primary h-4 w-4 shrink-0"
                      checked={t.includedInAuto}
                      disabled={!canModify || saving}
                      onChange={(e) => toggleTarget(t.url, e.target.checked)}
                      aria-label={`Inclure ${t.name} dans le scan auto`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <Link
                          href={`/cybersecurite/site?url=${encodeURIComponent(t.url)}`}
                          className={cn(
                            'truncate text-sm font-medium hover:underline',
                            t.includedInAuto ? 'text-primary' : 'text-muted-foreground',
                          )}
                        >
                          {t.name}
                        </Link>
                        <OpenExternalUrl url={t.url} />
                      </div>
                      <p className="truncate font-mono text-xs text-muted-foreground">{t.url}</p>
                    </div>
                    {!t.includedInAuto && (
                      <span className="shrink-0 rounded border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        Exclue
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
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
          <button type="button" className="btn-primary" disabled={saving} onClick={() => save()}>
            {saving ? 'Enregistrement…' : 'Enregistrer la programmation'}
          </button>
        </div>
      )}
    </div>
  );
}
