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
import { RefreshCw, AlertTriangle } from 'lucide-react';
import { api, type CyberOverview, type CyberTrendPoint } from '@/lib/api';
import { SiteSearchInput, matchesSiteSearch } from '@/components/site-search-input';
import { OpenExternalUrl } from '@/components/open-external-url';

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

export default function CyberEvolutionPage() {
  const [overview, setOverview] = useState<CyberOverview | null>(null);
  const [trend, setTrend] = useState<CyberTrendPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [siteQuery, setSiteQuery] = useState('');

  const load = useCallback(async () => {
    try {
      const [ov, tr] = await Promise.all([
        api.getCyberOverview(),
        api.getCyberTrend(40),
      ]);
      setOverview(ov);
      setTrend(tr.trend ?? ov.trend ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const chartData = useMemo(
    () =>
      (trend || []).map((p) => ({
        ...p,
        label: formatLabel(p.started_at),
        score: p.avg_score ?? 0,
      })),
    [trend],
  );

  const filteredSites = useMemo(
    () =>
      [...(overview?.sites ?? [])]
        .filter((s) => matchesSiteSearch(siteQuery, s.name, s.url, s.domain))
        .sort((a, b) => (a.score ?? 0) - (b.score ?? 0)),
    [overview?.sites, siteQuery],
  );

  if (loading && !overview) {
    return (
      <div className="flex h-32 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const latest = chartData[chartData.length - 1];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Évolution du score</h1>
          <p className="text-sm text-muted-foreground">
            Score moyen du parc au fil des audits, et détail par site
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

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Dernier score moyen</p>
          <p className="mt-2 text-2xl font-bold">{latest ? `${latest.score}/100` : '—'}</p>
        </div>
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Points d’historique</p>
          <p className="mt-2 text-2xl font-bold">{chartData.length}</p>
        </div>
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Sites scorés</p>
          <p className="mt-2 text-2xl font-bold">{overview?.resultsCount ?? 0}</p>
        </div>
      </div>

      <div className="card">
        <h2 className="mb-4 text-sm font-semibold">Score moyen du parc</h2>
        {chartData.length < 2 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Pas encore assez d’historique. Lancez plusieurs audits pour voir la courbe.
          </p>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    background: '#0f172a',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8,
                  }}
                  labelFormatter={(_, payload) =>
                    payload?.[0]?.payload?.started_at
                      ? formatLabel(payload[0].payload.started_at)
                      : ''
                  }
                />
                <Line
                  type="monotone"
                  dataKey="score"
                  stroke="#38bdf8"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  name="Score moyen"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="card overflow-hidden p-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-white/5 px-4 py-3">
          <h2 className="font-semibold">Évolution par site</h2>
          <SiteSearchInput
            value={siteQuery}
            onChange={setSiteQuery}
            className="ml-auto w-full sm:w-72 sm:flex-none"
          />
        </div>
        {siteQuery.trim() && (overview?.sites?.length ?? 0) > 0 && (
          <p className="border-b border-white/5 px-4 py-2 text-xs text-muted-foreground">
            {filteredSites.length} résultat{filteredSites.length !== 1 ? 's' : ''} pour «{' '}
            {siteQuery.trim()} »
          </p>
        )}
        {filteredSites.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            {siteQuery.trim()
              ? `Aucun site ne correspond à « ${siteQuery.trim()} ».`
              : 'Aucun site scanné.'}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-left text-muted-foreground">
                <th className="p-4 font-medium">Site</th>
                <th className="p-4 font-medium">Score actuel</th>
                <th className="p-4 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {filteredSites.map((site) => (
                <tr key={site.url ?? site.name} className="border-b border-white/5">
                  <td className="p-4">
                    <div className="flex items-center gap-1.5">
                      {site.url ? (
                        <Link
                          href={`/cybersecurite/site?url=${encodeURIComponent(site.url)}`}
                          className="font-medium hover:text-primary hover:underline"
                        >
                          {site.name}
                        </Link>
                      ) : (
                        <div className="font-medium">{site.name}</div>
                      )}
                      <OpenExternalUrl url={site.url} />
                    </div>
                    <div className="max-w-md truncate font-mono text-xs text-muted-foreground">
                      {site.url}
                    </div>
                  </td>
                  <td className="p-4">{site.score ?? '—'}/100</td>
                  <td className="p-4">{site.grade ?? '?'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
