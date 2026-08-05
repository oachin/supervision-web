'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { Play, RefreshCw, Shield, AlertTriangle, FileText, TrendingUp } from 'lucide-react';
import { api, type CyberOverview } from '@/lib/api';
import { useAuthProfile } from '@/hooks/use-auth-profile';
import { cn } from '@/lib/utils';

function formatTrendLabel(iso?: string | null) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function gradeClass(grade?: string) {
  switch (grade) {
    case 'A':
    case 'A+':
      return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    case 'B':
      return 'bg-sky-500/15 text-sky-400 border-sky-500/30';
    case 'C':
      return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    case 'D':
    case 'E':
    case 'F':
      return 'bg-destructive/15 text-destructive border-destructive/30';
    default:
      return 'bg-secondary text-muted-foreground border-white/10';
  }
}

export default function CybersecuritePage() {
  const { hasPermission } = useAuthProfile();
  const canScan = hasPermission('cybersecurity', 'modify');
  const [data, setData] = useState<CyberOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [deep, setDeep] = useState(false);

  const load = useCallback(async () => {
    try {
      const overview = await api.getCyberOverview();
      setData(overview);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  async function handleScan() {
    setScanning(true);
    setError(null);
    try {
      await api.startCyberScan({ deep });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de démarrer le scan');
    } finally {
      setScanning(false);
    }
  }

  const trendData = useMemo(
    () =>
      (data?.trend || []).map((p) => ({
        label: formatTrendLabel(p.started_at),
        score: p.avg_score ?? 0,
      })),
    [data?.trend],
  );

  if (loading && !data) {
    return (
      <div className="flex h-32 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const scanRunning = Boolean(data?.scan?.running);
  const sites = data?.sites ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Cybersécurité — Audit web</h1>
          <p className="text-sm text-muted-foreground">
            Scan des sites Supervision et des cibles externes (EASM / Web Security Audit)
          </p>
          <div className="mt-2 flex flex-wrap gap-3 text-sm">
            <Link href="/cybersecurite/evolution" className="inline-flex items-center gap-1 text-primary hover:underline">
              <TrendingUp className="h-3.5 w-3.5" /> Évolution du score
            </Link>
            <Link href="/cybersecurite/rapport" className="inline-flex items-center gap-1 text-primary hover:underline">
              <FileText className="h-3.5 w-3.5" /> Rapport HTML / PDF
            </Link>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={load} className="btn-secondary text-sm">
            <RefreshCw className="h-4 w-4" /> Actualiser
          </button>
          {canScan && (
            <>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={deep}
                  onChange={(e) => setDeep(e.target.checked)}
                />
                Mode approfondi
              </label>
              <button
                type="button"
                onClick={handleScan}
                disabled={scanning || scanRunning}
                className="btn-primary text-sm"
              >
                <Play className="h-4 w-4" />
                {scanRunning || scanning ? 'Scan en cours…' : 'Lancer un scan'}
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Service audit</p>
          <p className={cn('mt-2 text-lg font-semibold', data?.healthy ? 'text-emerald-400' : 'text-destructive')}>
            {data?.healthy ? 'Opérationnel' : 'Indisponible'}
          </p>
        </div>
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Cibles actives</p>
          <p className="mt-2 text-2xl font-bold">{data?.enabledTargets ?? 0}</p>
          <Link href="/cybersecurite/cibles" className="mt-1 text-xs text-primary hover:underline">
            Gérer les cibles
          </Link>
        </div>
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Sites scorés</p>
          <p className="mt-2 text-2xl font-bold">{data?.resultsCount ?? 0}</p>
        </div>
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Dernier scan</p>
          <p className="mt-2 text-sm font-medium">
            {scanRunning
              ? 'En cours…'
              : data?.scan?.finished_at
                ? String(data.scan.finished_at)
                : 'Aucun'}
          </p>
          {data?.scan?.error ? (
            <p className="mt-1 text-xs text-destructive">{String(data.scan.error)}</p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {data?.grades && Object.keys(data.grades).length > 0 && (
          <div className="card">
            <h2 className="mb-3 text-sm font-semibold">Répartition des notes</h2>
            <div className="flex flex-wrap gap-2">
              {Object.entries(data.grades)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([grade, count]) => (
                  <span
                    key={grade}
                    className={cn('rounded-md border px-3 py-1.5 text-sm font-medium', gradeClass(grade))}
                  >
                    {grade} · {count}
                  </span>
                ))}
            </div>
          </div>
        )}
        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Évolution du score (parc)</h2>
            <Link href="/cybersecurite/evolution" className="text-xs text-primary hover:underline">
              Voir plus
            </Link>
          </div>
          {trendData.length < 2 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Historique insuffisant — plusieurs audits sont nécessaires.
            </p>
          ) : (
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="label" hide />
                  <YAxis domain={[0, 100]} width={28} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{
                      background: '#0f172a',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 8,
                    }}
                  />
                  <Line type="monotone" dataKey="score" stroke="#38bdf8" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
          <Shield className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Résultats par site</h2>
        </div>
        {sites.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            Aucun résultat pour l’instant. Activez des cibles puis lancez un scan.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-left text-muted-foreground">
                <th className="p-4 font-medium">Site</th>
                <th className="p-4 font-medium">URL</th>
                <th className="p-4 font-medium">Score</th>
                <th className="p-4 font-medium">Note</th>
                <th className="p-4 font-medium">Constats</th>
              </tr>
            </thead>
            <tbody>
              {[...sites]
                .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
                .map((site) => (
                  <tr key={site.url ?? site.name} className="border-b border-white/5">
                    <td className="p-4 font-medium">
                      {site.url ? (
                        <Link
                          href={`/cybersecurite/site?url=${encodeURIComponent(site.url)}`}
                          className="hover:text-primary hover:underline"
                        >
                          {site.name}
                        </Link>
                      ) : (
                        site.name
                      )}
                    </td>
                    <td className="max-w-xs truncate p-4 font-mono text-xs text-muted-foreground">
                      {site.url}
                    </td>
                    <td className="p-4">{site.score ?? '—'}</td>
                    <td className="p-4">
                      <span className={cn('rounded border px-2 py-0.5 text-xs font-medium', gradeClass(site.grade))}>
                        {site.grade ?? '?'}
                      </span>
                    </td>
                    <td className="p-4 text-muted-foreground">
                      {Array.isArray(site.findings) ? site.findings.length : '—'}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
