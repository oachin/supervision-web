'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Loader2, RotateCcw, Save } from 'lucide-react';
import { api, type CyberExtremeRiskRules } from '@/lib/api';
import { useAuthProfile } from '@/hooks/use-auth-profile';
import { cn } from '@/lib/utils';

const PRESET_EXPOSED = 'misconfig.exposed_path';
const PRESET_TAKEOVER = ['takeover.vulnerable', 'takeover.dangling'] as const;
const GRADE_OPTIONS = ['F', 'E', 'D', 'C'] as const;

function hasExposedPath(rules: CyberExtremeRiskRules) {
  return rules.findingMatchers.some(
    (m) =>
      m.code === PRESET_EXPOSED &&
      (!m.severities?.length ||
        m.severities.includes('high') ||
        m.severities.includes('critical')),
  );
}

function hasTakeovers(rules: CyberExtremeRiskRules) {
  return PRESET_TAKEOVER.every((code) =>
    rules.findingMatchers.some((m) => m.code === code),
  );
}

function customMatchers(rules: CyberExtremeRiskRules) {
  return rules.findingMatchers.filter(
    (m) => m.code !== PRESET_EXPOSED && !PRESET_TAKEOVER.includes(m.code as (typeof PRESET_TAKEOVER)[number]),
  );
}

function buildRules(opts: {
  label: string;
  exposed: boolean;
  takeover: boolean;
  grades: string[];
  extraCodes: string;
}): CyberExtremeRiskRules {
  const findingMatchers: CyberExtremeRiskRules['findingMatchers'] = [];
  if (opts.exposed) {
    findingMatchers.push({
      code: PRESET_EXPOSED,
      severities: ['high', 'critical'],
    });
  }
  if (opts.takeover) {
    findingMatchers.push({ code: 'takeover.vulnerable' });
    findingMatchers.push({ code: 'takeover.dangling' });
  }
  for (const line of opts.extraCodes.split('\n')) {
    const code = line.trim();
    if (!code || code.startsWith('#')) continue;
    if (findingMatchers.some((m) => m.code === code)) continue;
    findingMatchers.push({ code });
  }
  return {
    label: opts.label.trim() || 'Risques critiques',
    findingMatchers,
    grades: opts.grades,
  };
}

export default function CyberRiskSettingsPage() {
  const { hasPermission } = useAuthProfile();
  const canModify =
    hasPermission('cybersecurity', 'modify') || hasPermission('settings', 'modify');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [label, setLabel] = useState('Fuites de secrets & takeovers');
  const [exposed, setExposed] = useState(true);
  const [takeover, setTakeover] = useState(true);
  const [grades, setGrades] = useState<string[]>([]);
  const [extraCodes, setExtraCodes] = useState('');

  const applyRules = useCallback((rules: CyberExtremeRiskRules) => {
    setLabel(rules.label || 'Fuites de secrets & takeovers');
    setExposed(hasExposedPath(rules));
    setTakeover(hasTakeovers(rules));
    setGrades(rules.grades || []);
    setExtraCodes(
      customMatchers(rules)
        .map((m) => m.code)
        .join('\n'),
    );
  }, []);

  const load = useCallback(async () => {
    try {
      const rules = await api.getCyberRiskRules();
      applyRules(rules);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement impossible');
    } finally {
      setLoading(false);
    }
  }, [applyRules]);

  useEffect(() => {
    void load();
  }, [load]);

  const preview = useMemo(
    () =>
      buildRules({
        label,
        exposed,
        takeover,
        grades,
        extraCodes,
      }),
    [label, exposed, takeover, grades, extraCodes],
  );

  function toggleGrade(g: string) {
    setGrades((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g],
    );
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!canModify) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const saved = await api.updateCyberRiskRules(preview);
      applyRules(saved);
      setMessage('Règles enregistrées — le KPI Audit cyber / tableau de bord s’actualise au prochain chargement.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enregistrement impossible');
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!canModify) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const saved = await api.updateCyberRiskRules({ reset: true });
      applyRules(saved);
      setMessage('Règles réinitialisées (fuites secrets & takeovers).');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Réinitialisation impossible');
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

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <AlertTriangle className="h-6 w-6 text-destructive" />
          Risques critiques
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Définit le périmètre du KPI rouge sur l’audit cyber et le tableau de bord.
          Les notes basses ne sont comptées que si vous les activez ici.
        </p>
      </div>

      <form onSubmit={handleSave} className="card space-y-6">
        <div>
          <label className="mb-1.5 block text-sm font-medium">Libellé affiché</label>
          <input
            className="input w-full"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={!canModify}
            maxLength={120}
            placeholder="Fuites de secrets & takeovers"
          />
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">Constats d’audit</legend>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={exposed}
              disabled={!canModify}
              onChange={(e) => setExposed(e.target.checked)}
            />
            <span>
              <span className="font-medium">Chemins exposés sensibles</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                <code className="text-[11px]">misconfig.exposed_path</code> en sévérité high ou
                critical (.env, .git, backups wp-config…)
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={takeover}
              disabled={!canModify}
              onChange={(e) => setTakeover(e.target.checked)}
            />
            <span>
              <span className="font-medium">Takeovers de sous-domaines</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                <code className="text-[11px]">takeover.vulnerable</code> /{' '}
                <code className="text-[11px]">takeover.dangling</code>
              </span>
            </span>
          </label>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">Notes (dernier audit)</legend>
          <p className="text-xs text-muted-foreground">
            Inclure les sites dont la note est dans la liste, même sans fuite / takeover.
          </p>
          <div className="flex flex-wrap gap-2">
            {GRADE_OPTIONS.map((g) => {
              const on = grades.includes(g);
              return (
                <button
                  key={g}
                  type="button"
                  disabled={!canModify}
                  onClick={() => toggleGrade(g)}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-sm font-medium transition',
                    on
                      ? 'border-destructive/50 bg-destructive/15 text-destructive'
                      : 'border-white/10 text-muted-foreground hover:border-white/20',
                    !canModify && 'opacity-60',
                  )}
                >
                  Note {g}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div>
          <label className="mb-1.5 block text-sm font-medium">
            Codes de constats supplémentaires
          </label>
          <p className="mb-2 text-xs text-muted-foreground">
            Un code WebSec par ligne (toute sévérité). Ex. <code>tls.cert_expired</code>,{' '}
            <code>availability.site_down</code>.
          </p>
          <textarea
            className="input min-h-[96px] w-full font-mono text-xs"
            value={extraCodes}
            onChange={(e) => setExtraCodes(e.target.value)}
            disabled={!canModify}
            placeholder="# optionnel"
          />
        </div>

        <div className="rounded-lg border border-white/10 bg-secondary/20 px-3 py-2 text-xs text-muted-foreground">
          Aperçu : {preview.findingMatchers.length} règle
          {preview.findingMatchers.length === 1 ? '' : 's'} de constat
          {preview.grades.length
            ? ` · notes ${preview.grades.join(', ')}`
            : ' · aucune note'}
          {' · '}
          <Link href="/cybersecurite" className="text-primary hover:underline">
            voir l’audit
          </Link>
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="text-sm text-emerald-400" role="status">
            {message}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={!canModify || saving}
            className="btn-primary inline-flex items-center gap-2"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Enregistrer
          </button>
          <button
            type="button"
            disabled={!canModify || saving}
            onClick={() => void handleReset()}
            className="btn-secondary inline-flex items-center gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            Réinitialiser
          </button>
          {!canModify && (
            <span className="text-xs text-muted-foreground">Lecture seule</span>
          )}
        </div>
      </form>
    </div>
  );
}
