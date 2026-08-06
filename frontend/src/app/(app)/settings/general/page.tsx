'use client';

import { useCallback, useEffect, useState } from 'react';
import { Clock, Loader2, Save } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthProfile } from '@/hooks/use-auth-profile';
import { useAppTimezone } from '@/components/timezone-provider';
import { cn } from '@/lib/utils';

const TIMEZONE_OPTIONS = [
  { value: 'Europe/Paris', label: 'Europe/Paris (France métropolitaine)' },
  { value: 'Europe/Brussels', label: 'Europe/Brussels (Belgique)' },
  { value: 'Europe/Zurich', label: 'Europe/Zurich (Suisse)' },
  { value: 'Atlantic/Canary', label: 'Atlantic/Canary' },
  { value: 'Indian/Reunion', label: 'Indian/Reunion (La Réunion)' },
  { value: 'Indian/Mauritius', label: 'Indian/Mauritius' },
  { value: 'America/Martinique', label: 'America/Martinique' },
  { value: 'America/Guadeloupe', label: 'America/Guadeloupe' },
  { value: 'America/Cayenne', label: 'America/Cayenne (Guyane)' },
  { value: 'Pacific/Noumea', label: 'Pacific/Noumea (Nouvelle-Calédonie)' },
  { value: 'Pacific/Tahiti', label: 'Pacific/Tahiti' },
  { value: 'UTC', label: 'UTC' },
];

export default function GeneralSettingsPage() {
  const { hasPermission } = useAuthProfile();
  const canModify = hasPermission('settings', 'modify');
  const { applyTimezone } = useAppTimezone();

  const [timezone, setTimezone] = useState('Europe/Paris');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nowPreview, setNowPreview] = useState('');

  const load = useCallback(async () => {
    try {
      const settings = await api.getAppSettings();
      setTimezone(settings.timezone || 'Europe/Paris');
      applyTimezone(settings.timezone);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement impossible');
    } finally {
      setLoading(false);
    }
  }, [applyTimezone]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const tick = () => {
      try {
        setNowPreview(
          new Intl.DateTimeFormat('fr-FR', {
            timeZone: timezone || 'Europe/Paris',
            weekday: 'long',
            day: '2-digit',
            month: 'long',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }).format(new Date()),
        );
      } catch {
        setNowPreview('Fuseau invalide');
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timezone]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!canModify) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const saved = await api.updateAppSettings({ timezone: timezone.trim() });
      applyTimezone(saved.timezone);
      setTimezone(saved.timezone);
      setMessage('Fuseau horaire enregistré. Alertes, évènements et automations utilisent désormais ce fuseau.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enregistrement impossible');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const known = TIMEZONE_OPTIONS.some((o) => o.value === timezone);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Fuseau horaire</h1>
        <p className="text-sm text-muted-foreground">
          Fuseau serveur utilisé pour l’affichage des alertes / évènements et la planification des automations.
        </p>
      </div>

      <form onSubmit={handleSave} className="card max-w-xl space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-sky-500/20 bg-sky-500/5 px-4 py-3">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />
          <div>
            <p className="text-sm font-medium text-sky-100">Heure actuelle dans ce fuseau</p>
            <p className="mt-1 text-sm tabular-nums text-muted-foreground capitalize">{nowPreview}</p>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Fuseau IANA</label>
          <select
            className="input"
            value={known ? timezone : '__custom__'}
            disabled={!canModify || saving}
            onChange={(e) => {
              if (e.target.value === '__custom__') return;
              setTimezone(e.target.value);
            }}
          >
            {TIMEZONE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            {!known && (
              <option value="__custom__">Personnalisé — {timezone}</option>
            )}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs text-muted-foreground">
            Ou saisie libre (ex. Europe/Paris)
          </label>
          <input
            className="input font-mono text-sm"
            value={timezone}
            disabled={!canModify || saving}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="Europe/Paris"
          />
        </div>

        {message && (
          <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
            {message}
          </p>
        )}
        {error && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {canModify && (
          <button type="submit" className="btn-primary" disabled={saving || !timezone.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Enregistrer
          </button>
        )}
        {!canModify && (
          <p className={cn('text-sm text-muted-foreground')}>
            Lecture seule — droits insuffisants pour modifier la configuration.
          </p>
        )}
      </form>
    </div>
  );
}
