'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { ArrowLeft, FileDown, FileText, AlertTriangle } from 'lucide-react';
import { api, type CyberFinding, type CyberSiteResult } from '@/lib/api';
import { cn } from '@/lib/utils';

const SEV_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#38bdf8',
  info: '#64748b',
};

const SEV_LABELS: Record<string, string> = {
  critical: 'Critique',
  high: 'Élevé',
  medium: 'Moyen',
  low: 'Faible',
  info: 'Info',
};

function formatLabel(iso?: string | null) {
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

function SiteDetailInner() {
  const search = useSearchParams();
  const url = search.get('url') || '';
  const [site, setSite] = useState<CyberSiteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!url) {
      setError('URL manquante');
      setLoading(false);
      return;
    }
    try {
      setSite(await api.getCyberSiteResult(url));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    load();
  }, [load]);

  const findings = (site?.findings || []) as CyberFinding[];
  const severityCounts = useMemo(() => {
    const counts: Record<string, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    };
    for (const f of findings) {
      const sev = f.severity || 'info';
      counts[sev] = (counts[sev] || 0) + 1;
    }
    return counts;
  }, [findings]);

  const pieData = useMemo(
    () =>
      Object.entries(severityCounts)
        .filter(([, n]) => n > 0)
        .map(([key, value]) => ({ name: SEV_LABELS[key] || key, key, value })),
    [severityCounts],
  );

  const history = useMemo(
    () =>
      (site?.history || []).map((h) => ({
        ...h,
        label: formatLabel(h.started_at),
        score: h.score ?? 0,
      })),
    [site?.history],
  );

  const filtered = findings.filter((f) => filter === 'all' || f.severity === filter);

  async function download(fmt: 'html' | 'pdf') {
    setBusy(fmt);
    setError(null);
    try {
      await api.downloadCyberReport('site', { fmt, url, lang: 'fr' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Téléchargement impossible');
    } finally {
      setBusy(null);
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
    <div className="space-y-6">
      <div>
        <Link
          href="/cybersecurite"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Retour à l’audit
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{site?.name || 'Site'}</h1>
            <p className="font-mono text-sm text-muted-foreground">{url}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-lg border border-white/10 px-4 py-2 text-center">
              <p className="text-xs text-muted-foreground">Score</p>
              <p className="text-2xl font-bold">
                {site?.score ?? '—'}/100
                <span className="ml-2 text-base text-muted-foreground">{site?.grade ?? '?'}</span>
              </p>
            </div>
            <button
              type="button"
              className="btn-secondary text-sm"
              disabled={!!busy}
              onClick={() => download('html')}
            >
              <FileText className="h-4 w-4" />
              {busy === 'html' ? '…' : 'Rapport HTML'}
            </button>
            <button
              type="button"
              className="btn-primary text-sm"
              disabled={!!busy}
              onClick={() => download('pdf')}
            >
              <FileDown className="h-4 w-4" />
              {busy === 'pdf' ? '…' : 'Rapport PDF'}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <h2 className="mb-4 text-sm font-semibold">Évolution du score</h2>
          {history.length < 2 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              Historique insuffisant (au moins 2 scans nécessaires).
            </p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      background: '#0f172a',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 8,
                    }}
                  />
                  <Line type="monotone" dataKey="score" stroke="#38bdf8" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="mb-4 text-sm font-semibold">Répartition par gravité</h2>
          {pieData.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">Aucun constat</p>
          ) : (
            <>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70}>
                      {pieData.map((entry) => (
                        <Cell key={entry.key} fill={SEV_COLORS[entry.key] || '#64748b'} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: '#0f172a',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 8,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                {pieData.map((d) => (
                  <span key={d.key} className="text-muted-foreground">
                    <span
                      className="mr-1 inline-block h-2 w-2 rounded-full"
                      style={{ background: SEV_COLORS[d.key] }}
                    />
                    {d.name} ({d.value})
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Constats & recommandations</h2>
          <div className="flex flex-wrap gap-1 text-xs">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={cn(
                'rounded border px-2 py-1',
                filter === 'all' ? 'border-primary text-primary' : 'border-white/10 text-muted-foreground',
              )}
            >
              Tous
            </button>
            {(['critical', 'high', 'medium', 'low', 'info'] as const).map((sev) =>
              severityCounts[sev] ? (
                <button
                  key={sev}
                  type="button"
                  onClick={() => setFilter(sev)}
                  className={cn(
                    'rounded border px-2 py-1',
                    filter === sev ? 'border-primary text-primary' : 'border-white/10 text-muted-foreground',
                  )}
                >
                  {SEV_LABELS[sev]} ({severityCounts[sev]})
                </button>
              ) : null,
            )}
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Aucun constat pour ce filtre.</p>
        ) : (
          <ul className="space-y-3">
            {filtered.map((f, idx) => (
              <li
                key={`${f.code || f.title}-${idx}`}
                className="rounded-lg border border-white/5 bg-secondary/20 p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="rounded px-2 py-0.5 text-xs font-medium text-white"
                    style={{ background: SEV_COLORS[f.severity || 'info'] }}
                  >
                    {SEV_LABELS[f.severity || 'info'] || f.severity}
                  </span>
                  <span className="font-medium">{f.title || f.code || 'Constats'}</span>
                  {f.category && (
                    <span className="text-xs text-muted-foreground">{f.category}</span>
                  )}
                </div>
                {f.detail && <p className="mt-2 text-sm text-muted-foreground">{f.detail}</p>}
                {f.recommendation && (
                  <p className="mt-2 text-sm text-sky-300/90">→ {f.recommendation}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function CyberSitePage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-32 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      <SiteDetailInner />
    </Suspense>
  );
}
