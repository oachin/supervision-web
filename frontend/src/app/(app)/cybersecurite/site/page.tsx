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
  type DotProps,
} from 'recharts';
import { ArrowLeft, FileDown, FileText, AlertTriangle } from 'lucide-react';
import {
  api,
  type CyberFinding,
  type CyberHistoryPoint,
  type CyberSiteResult,
} from '@/lib/api';
import { OpenExternalUrl } from '@/components/open-external-url';
import { cn, formatDateTime } from '@/lib/utils';

function formatLabel(iso?: string | null) {
  return formatDateTime(iso, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

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

const SEV_TAG_LABELS: Record<string, string> = {
  critical: 'CRITIQUE',
  high: 'ÉLEVÉ',
  medium: 'MOYEN',
  low: 'FAIBLE',
  info: 'INFO',
};

const SEV_TAG_STYLES: Record<string, { idle: string; active: string }> = {
  critical: {
    idle: 'border-red-400/40 bg-red-600 text-white hover:bg-red-500',
    active: 'ring-2 ring-red-300 ring-offset-2 ring-offset-background',
  },
  high: {
    idle: 'border-orange-400/40 bg-orange-500 text-white hover:bg-orange-400',
    active: 'ring-2 ring-orange-200 ring-offset-2 ring-offset-background',
  },
  medium: {
    idle: 'border-amber-500/50 bg-amber-400 text-amber-950 hover:bg-amber-300',
    active: 'ring-2 ring-amber-200 ring-offset-2 ring-offset-background',
  },
  low: {
    idle: 'border-sky-400/40 bg-sky-500/90 text-white hover:bg-sky-400',
    active: 'ring-2 ring-sky-200 ring-offset-2 ring-offset-background',
  },
  info: {
    idle: 'border-slate-400/40 bg-slate-500 text-white hover:bg-slate-400',
    active: 'ring-2 ring-slate-200 ring-offset-2 ring-offset-background',
  },
};

const SEV_ORDER = ['critical', 'high', 'medium', 'low', 'info'] as const;

function gradeClass(grade?: string | null) {
  switch (grade) {
    case 'A':
    case 'A+':
      return 'border-emerald-500/40 bg-emerald-500/20 text-emerald-300';
    case 'B':
      return 'border-sky-500/40 bg-sky-500/20 text-sky-300';
    case 'C':
      return 'border-amber-500/40 bg-amber-500/20 text-amber-300';
    case 'D':
      return 'border-orange-500/40 bg-orange-500/20 text-orange-300';
    case 'E':
    case 'F':
      return 'border-destructive/40 bg-destructive/20 text-destructive';
    default:
      return 'border-white/10 bg-secondary/30 text-foreground';
  }
}

type ChartPoint = CyberHistoryPoint & { label: string; score: number };

function FindingsList({
  findings,
  filter,
  onFilter,
}: {
  findings: CyberFinding[];
  filter: string;
  onFilter: (f: string) => void;
}) {
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

  const filtered = findings.filter((f) => filter === 'all' || f.severity === filter);

  return (
    <div className="card">
      <div className="mb-4 space-y-3">
        <h2 className="font-semibold">Constats & recommandations</h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onFilter('all')}
            className={cn(
              'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide transition',
              filter === 'all'
                ? 'border-sky-400/50 bg-sky-500/20 text-sky-100 ring-2 ring-sky-300 ring-offset-2 ring-offset-background'
                : 'border-white/15 bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground',
            )}
          >
            TOUS · {findings.length}
          </button>
          {SEV_ORDER.map((sev) => {
            const count = severityCounts[sev];
            if (!count) return null;
            const isSelected = filter === sev;
            return (
              <button
                key={sev}
                type="button"
                onClick={() => onFilter(isSelected ? 'all' : sev)}
                title={
                  isSelected
                    ? 'Retirer le filtre'
                    : `Filtrer : ${SEV_LABELS[sev]}`
                }
                className={cn(
                  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide transition cursor-pointer',
                  SEV_TAG_STYLES[sev].idle,
                  isSelected && SEV_TAG_STYLES[sev].active,
                )}
              >
                {SEV_TAG_LABELS[sev]} · {count}
              </button>
            );
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Aucun constat pour ce filtre.</p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((f, idx) => {
            const headline = f.message || f.title || f.code || 'Constat';
            const reco =
              f.recommendation_fr || f.recommendation || f.recommendation_en || null;
            const showCode = Boolean(f.code && headline !== f.code);
            return (
              <li
                key={`${f.code || f.title || f.message}-${idx}`}
                className="rounded-lg border border-white/5 bg-secondary/20 p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="rounded px-2 py-0.5 text-xs font-medium text-white"
                    style={{ background: SEV_COLORS[f.severity || 'info'] }}
                  >
                    {SEV_LABELS[f.severity || 'info'] || f.severity}
                  </span>
                  {f.category && (
                    <span className="rounded border border-white/10 px-2 py-0.5 text-[11px] text-muted-foreground">
                      {f.category}
                    </span>
                  )}
                  {typeof f.penalty === 'number' && f.penalty > 0 && (
                    <span className="text-[11px] text-muted-foreground">−{f.penalty} pts</span>
                  )}
                </div>
                <p className="mt-2 font-medium leading-snug">{headline}</p>
                {showCode && (
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">{f.code}</p>
                )}
                {f.detail && f.detail !== headline && (
                  <p className="mt-2 text-sm text-muted-foreground">{f.detail}</p>
                )}
                {reco && (
                  <p className="mt-2 text-sm text-sky-300/90">
                    <span className="font-semibold">Correction :</span> {reco}
                  </p>
                )}
                {Array.isArray(f.reference_links) && f.reference_links.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {f.reference_links.map((r, i) =>
                      r.url ? (
                        <a
                          key={`${r.label}-${i}`}
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-300 hover:bg-sky-500/20"
                        >
                          {r.label || r.url}
                        </a>
                      ) : (
                        <span
                          key={`${r.label}-${i}`}
                          className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-muted-foreground"
                        >
                          {r.label}
                        </span>
                      ),
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SiteDetailInner() {
  const search = useSearchParams();
  const url = search.get('url') || '';
  const [site, setSite] = useState<CyberSiteResult | null>(null);
  const [selectedRun, setSelectedRun] = useState<CyberSiteResult | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [loadingRun, setLoadingRun] = useState(false);
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
      const data = await api.getCyberSiteResult(url);
      setSite(data);
      setSelectedRun(data);
      setSelectedRunId(typeof data.run_id === 'number' ? data.run_id : null);
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

  const history: ChartPoint[] = useMemo(
    () =>
      (site?.history || []).map((h) => ({
        ...h,
        label: formatLabel(h.started_at),
        score: h.score ?? 0,
      })),
    [site?.history],
  );

  const display = selectedRun ?? site;
  const findings = (display?.findings || []) as CyberFinding[];

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

  const selectAudit = useCallback(
    async (point: ChartPoint) => {
      if (!url || point.run_id == null) return;
      if (point.run_id === selectedRunId && selectedRun) {
        // Already showing this run — scroll to findings.
        document.getElementById('audit-findings')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      // Latest run is already loaded as `site`.
      if (site?.run_id != null && point.run_id === site.run_id) {
        setSelectedRunId(point.run_id);
        setSelectedRun(site);
        setFilter('all');
        document.getElementById('audit-findings')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      setLoadingRun(true);
      setError(null);
      try {
        const data = await api.getCyberSiteResult(url, point.run_id);
        setSelectedRunId(point.run_id);
        setSelectedRun(data);
        setFilter('all');
        document.getElementById('audit-findings')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Impossible de charger cet audit');
      } finally {
        setLoadingRun(false);
      }
    },
    [url, selectedRunId, selectedRun, site],
  );

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

  const selectedStartedAt =
    display?.started_at ||
    history.find((h) => h.run_id === selectedRunId)?.started_at ||
    null;
  const isLatest =
    site?.run_id != null && selectedRunId != null && selectedRunId === site.run_id;

  function renderDot(props: DotProps) {
    const { cx, cy, payload } = props as DotProps & { payload?: ChartPoint };
    if (cx == null || cy == null || !payload) return <g />;
    const active = payload.run_id != null && payload.run_id === selectedRunId;
    return (
      <circle
        cx={cx}
        cy={cy}
        r={active ? 7 : 4}
        fill={active ? '#38bdf8' : '#0ea5e9'}
        stroke={active ? '#e0f2fe' : '#0284c7'}
        strokeWidth={active ? 2 : 1}
        style={{ cursor: 'pointer' }}
        onClick={(e) => {
          e.stopPropagation();
          void selectAudit(payload);
        }}
      />
    );
  }

  function renderActiveDot(props: DotProps) {
    const { cx, cy, payload } = props as DotProps & { payload?: ChartPoint };
    if (cx == null || cy == null || !payload) return <g />;
    return (
      <circle
        cx={cx}
        cy={cy}
        r={8}
        fill="#38bdf8"
        stroke="#e0f2fe"
        strokeWidth={2}
        style={{ cursor: 'pointer' }}
        onClick={(e) => {
          e.stopPropagation();
          void selectAudit(payload);
        }}
      />
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
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{site?.name || 'Site'}</h1>
              <OpenExternalUrl url={url || site?.url} iconClassName="h-4 w-4" />
            </div>
            <p className="font-mono text-sm text-muted-foreground">{url}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div
              className={cn(
                'rounded-lg border px-4 py-2 text-center',
                gradeClass(display?.grade),
              )}
            >
              <p className="text-xs opacity-80">
                {isLatest ? 'Score actuel' : 'Score audit'}
              </p>
              <p className="text-2xl font-bold">{display?.score ?? '—'}/100</p>
            </div>
            <div
              className={cn(
                'rounded-lg border px-4 py-2 text-center',
                gradeClass(display?.grade),
              )}
            >
              <p className="text-xs opacity-80">Note</p>
              <p className="text-2xl font-bold">{display?.grade ?? '?'}</p>
            </div>
            <div className="rounded-lg border border-white/10 px-4 py-2 text-center">
              <p className="text-xs text-muted-foreground">
                {isLatest ? 'Date (dernier audit)' : 'Date (audit)'}
              </p>
              <p className="text-2xl font-bold tabular-nums">
                {formatLabel(selectedStartedAt)}
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
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Évolution du score</h2>
            <p className="text-xs text-muted-foreground">
              Cliquez un point pour afficher le rapport de cet audit
            </p>
          </div>
          {history.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              Aucun historique d’audit.
            </p>
          ) : history.length === 1 ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Un seul audit disponible — cliquez pour afficher le détail.
              </p>
              <button
                type="button"
                onClick={() => void selectAudit(history[0])}
                className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-left text-sm transition hover:border-sky-400/50"
              >
                <span className="font-medium text-sky-200">{history[0].label}</span>
                <span className="ml-2 text-muted-foreground">
                  {history[0].score}/100 · {history[0].grade ?? '?'}
                </span>
              </button>
            </div>
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
                    formatter={(value: number, _name, item) => [
                      `${value}/100 · ${(item?.payload as ChartPoint)?.grade ?? '?'}`,
                      'Score',
                    ]}
                    labelFormatter={(label) => `Audit · ${label}`}
                  />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke="#38bdf8"
                    strokeWidth={2}
                    dot={renderDot}
                    activeDot={renderActiveDot}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="mb-4 text-sm font-semibold">Répartition par gravité</h2>
          {loadingRun ? (
            <div className="flex h-48 items-center justify-center">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : pieData.length === 0 ? (
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

      <div id="audit-findings" className="scroll-mt-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-500/20 bg-sky-500/5 px-4 py-3 text-sm">
          <div>
            <p className="font-medium text-sky-100">
              Rapport d’audit · {formatLabel(selectedStartedAt)}
            </p>
            <p className="text-xs text-muted-foreground">
              {display?.score ?? '—'}/100 · {display?.grade ?? '?'}
              {isLatest ? ' · dernier audit' : ' · historique'}
              {selectedRunId != null ? ` · run #${selectedRunId}` : ''}
            </p>
          </div>
          {loadingRun && (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-sky-300 border-t-transparent" />
          )}
        </div>
        <FindingsList findings={findings} filter={filter} onFilter={setFilter} />
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
