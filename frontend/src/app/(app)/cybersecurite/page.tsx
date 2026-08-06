'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { Play, RefreshCw, Shield, AlertTriangle, FileText, TrendingUp, CalendarClock, Info } from 'lucide-react';
import { SiteSearchInput, matchesSiteSearch } from '@/components/site-search-input';
import { OpenExternalUrl } from '@/components/open-external-url';

const DEEP_MODE_HELP =
  'Active les moteurs lourds (Nuclei, testssl, ZAP…). Plus exhaustif, mais plus long et plus agressif sur les cibles. Le mode standard suffit pour un contrôle de surface courant.';
import {
  api,
  type CyberOverview,
  type CyberScanSiteProgress,
  type CyberScanStatus,
  type CyberSiteResult,
} from '@/lib/api';
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

function normalizeUrl(url?: string | null) {
  return (url || '').trim().replace(/\/+$/, '').toLowerCase();
}

function ProgressBar({
  percent,
  className,
  barClassName,
}: {
  percent: number;
  className?: string;
  barClassName?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-white/10', className)}>
      <div
        className={cn('h-full rounded-full bg-sky-400 transition-[width] duration-500', barClassName)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function siteProgressLabel(p?: CyberScanSiteProgress | null) {
  if (!p) return null;
  if (p.status === 'queued') return 'En file';
  if (p.status === 'done') return 'Terminé';
  if (p.status === 'error') return p.error ? `Erreur` : 'Erreur';
  if (p.status === 'scanning') {
    if (p.check) return p.check;
    return 'Scan…';
  }
  return p.status || null;
}

export default function CybersecuritePage() {
  const { hasPermission } = useAuthProfile();
  const canScan = hasPermission('cybersecurity', 'modify');
  const [data, setData] = useState<CyberOverview | null>(null);
  const [scanLive, setScanLive] = useState<CyberScanStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [deep, setDeep] = useState(false);
  const [siteQuery, setSiteQuery] = useState('');
  const wasRunning = useRef(false);

  const load = useCallback(async () => {
    try {
      const overview = await api.getCyberOverview();
      setData(overview);
      setScanLive(overview.scan ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  const scan = scanLive ?? data?.scan ?? null;
  const scanRunning = Boolean(scan?.running) || scanning;

  useEffect(() => {
    if (!scanRunning) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const st = await api.getCyberScanStatus();
        if (cancelled) return;
        setScanLive(st);
        if (!st.running && wasRunning.current) {
          await load();
        }
        wasRunning.current = Boolean(st.running);
      } catch {
        /* ignore transient poll errors */
      }
    };
    wasRunning.current = true;
    tick();
    const id = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [scanRunning, load]);

  async function handleScan() {
    setScanning(true);
    setError(null);
    try {
      await api.startCyberScan({ deep });
      wasRunning.current = true;
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

  const progressByUrl = useMemo(() => {
    const map = new Map<string, CyberScanSiteProgress>();
    for (const s of scan?.sites || []) {
      const key = normalizeUrl(s.url);
      if (key) map.set(key, s);
    }
    return map;
  }, [scan?.sites]);

  const displaySites = useMemo(() => {
    const results = data?.sites ?? [];
    let rows: { result: CyberSiteResult; progress: CyberScanSiteProgress | null }[];
    if (!scanRunning || !scan?.sites?.length) {
      rows = results.map((s) => ({
        result: s,
        progress: progressByUrl.get(normalizeUrl(s.url)) ?? null,
      }));
    } else {
      // Pendant un scan : une ligne par cible du scan (ordre file), enrichie des derniers scores connus.
      const byUrl = new Map(results.map((s) => [normalizeUrl(s.url), s]));
      rows = (scan.sites || []).map((p) => {
        const prior = byUrl.get(normalizeUrl(p.url));
        const result: CyberSiteResult = prior ?? {
          name: p.name || p.url || '—',
          url: p.url,
          score: p.score ?? undefined,
          grade: p.grade ?? undefined,
          findingsCount: typeof p.findings === 'number' ? p.findings : undefined,
        };
        return { result, progress: p };
      });
    }
    return rows.filter(({ result }) =>
      matchesSiteSearch(siteQuery, result.name, result.url, result.domain),
    );
  }, [data?.sites, scanRunning, scan?.sites, progressByUrl, siteQuery]);

  const totalSitesForSearch = useMemo(() => {
    if (scanRunning && scan?.sites?.length) return scan.sites.length;
    return data?.sites?.length ?? 0;
  }, [scanRunning, scan?.sites, data?.sites]);

  const globalPercent = typeof scan?.percent === 'number' ? scan.percent : 0;
  const globalDone = typeof scan?.done === 'number' ? scan.done : 0;
  const globalTotal = typeof scan?.total === 'number' ? scan.total : 0;

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
          <h1 className="text-2xl font-bold">Cybersécurité — Audit web</h1>
          <p className="text-sm text-muted-foreground">
            Scan des sites Supervision et des cibles externes (EASM / Web Security Audit)
          </p>
          <div className="mt-2 flex flex-wrap gap-3 text-sm">
            <Link href="/cybersecurite/cibles" className="inline-flex items-center gap-1 text-primary hover:underline">
              Cibles
            </Link>
            <Link href="/cybersecurite/evolution" className="inline-flex items-center gap-1 text-primary hover:underline">
              <TrendingUp className="h-3.5 w-3.5" /> Évolution du score
            </Link>
            <Link href="/cybersecurite/rapport" className="inline-flex items-center gap-1 text-primary hover:underline">
              <FileText className="h-3.5 w-3.5" /> Rapport HTML / PDF
            </Link>
            <Link href="/cybersecurite/automation" className="inline-flex items-center gap-1 text-sky-300 hover:underline">
              <CalendarClock className="h-3.5 w-3.5" /> Automation
            </Link>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={load} className="btn-secondary text-sm">
            <RefreshCw className="h-4 w-4" /> Actualiser
          </button>
          {canScan && (
            <>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={deep}
                  onChange={(e) => setDeep(e.target.checked)}
                />
                Mode approfondi
                <span
                  className="inline-flex cursor-help text-muted-foreground/80 hover:text-sky-300"
                  title={DEEP_MODE_HELP}
                  aria-label={DEEP_MODE_HELP}
                >
                  <Info className="h-3.5 w-3.5" />
                </span>
              </label>
              <button
                type="button"
                onClick={handleScan}
                disabled={scanning || Boolean(scan?.running)}
                className="btn-primary text-sm"
              >
                <Play className="h-4 w-4" />
                {scan?.running || scanning ? 'Scan en cours…' : 'Lancer un scan'}
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

      {scan?.running && (
        <div className="card border-sky-500/25 bg-sky-500/5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-sky-200">Scan en cours</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {scan?.progress || 'Analyse des cibles…'}
                {globalTotal > 0 ? ` · ${globalDone}/${globalTotal} cibles` : null}
              </p>
            </div>
            <p className="text-2xl font-bold tabular-nums text-sky-300">{globalPercent}%</p>
          </div>
          <ProgressBar percent={globalPercent} className="mt-3 h-2" barClassName="bg-sky-400" />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
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
            {scan?.running
              ? globalTotal > 0
                ? `${globalPercent}% · ${globalDone}/${globalTotal}`
                : 'En cours…'
              : scan?.finished_at
                ? String(scan.finished_at)
                : 'Aucun'}
          </p>
          {scan?.error ? <p className="mt-1 text-xs text-destructive">{String(scan.error)}</p> : null}
        </div>
        <Link
          href="/cybersecurite/automation"
          className="card border-sky-500/25 bg-sky-500/5 transition hover:border-sky-400/40"
        >
          <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-sky-300">
            <CalendarClock className="h-3.5 w-3.5" /> Automation
          </p>
          <p className="mt-2 text-sm font-semibold">
            {data?.automation?.enabled ? 'Programmée' : 'Manuelle seule'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {data?.automation?.enabled
              ? data.automation.nextRunAt
                ? `Prochain : ${new Date(data.automation.nextRunAt).toLocaleString('fr-FR')}`
                : 'Active'
              : 'Configurer les scans auto'}
          </p>
        </Link>
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
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: '#94a3b8', fontSize: 10 }}
                    interval="preserveStartEnd"
                    minTickGap={28}
                  />
                  <YAxis domain={[0, 100]} width={28} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{
                      background: '#0f172a',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 8,
                    }}
                    labelFormatter={(label) => `Audit · ${label}`}
                    formatter={(value: number) => [`${value}/100`, 'Score moyen']}
                  />
                  <Line type="monotone" dataKey="score" stroke="#38bdf8" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-white/5 px-4 py-3">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">Résultats par site</h2>
          </div>
          <SiteSearchInput
            value={siteQuery}
            onChange={setSiteQuery}
            className="ml-auto w-full sm:w-72 sm:flex-none"
          />
        </div>
        {siteQuery.trim() && totalSitesForSearch > 0 && (
          <p className="border-b border-white/5 px-4 py-2 text-xs text-muted-foreground">
            {displaySites.length} résultat{displaySites.length !== 1 ? 's' : ''} pour «{' '}
            {siteQuery.trim()} »
          </p>
        )}
        {displaySites.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            {siteQuery.trim()
              ? `Aucun site ne correspond à « ${siteQuery.trim()} ».`
              : 'Aucun résultat pour l’instant. Activez des cibles puis lancez un scan.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 text-left text-muted-foreground">
                  <th className="p-4 font-medium">Site</th>
                  <th className="p-4 font-medium">URL</th>
                  <th className="p-4 font-medium">Score</th>
                  <th className="p-4 font-medium">Note</th>
                  <th className="p-4 font-medium">Constats</th>
                  <th className="min-w-[140px] p-4 font-medium">Progression</th>
                </tr>
              </thead>
              <tbody>
                {[...displaySites]
                  .sort((a, b) => {
                    if (scanRunning) return 0;
                    return (a.result.score ?? 0) - (b.result.score ?? 0);
                  })
                  .map(({ result: site, progress }) => {
                    const pct = typeof progress?.percent === 'number' ? progress.percent : null;
                    const label = siteProgressLabel(progress);
                    const liveScore =
                      progress?.status === 'done' && progress.score != null ? progress.score : site.score;
                    const liveGrade =
                      progress?.status === 'done' && progress.grade ? progress.grade : site.grade;
                    const liveFindings =
                      progress?.status === 'done' && typeof progress.findings === 'number'
                        ? progress.findings
                        : typeof site.findingsCount === 'number'
                          ? site.findingsCount
                          : Array.isArray(site.findings)
                            ? site.findings.length
                            : '—';

                    return (
                      <tr key={site.url ?? site.name} className="border-b border-white/5">
                        <td className="p-4 font-medium">
                          <div className="flex items-center gap-1.5">
                            {site.url ? (
                              <Link
                                href={`/cybersecurite/site?url=${encodeURIComponent(site.url)}`}
                                className="text-primary hover:underline"
                              >
                                {site.name}
                              </Link>
                            ) : (
                              site.name
                            )}
                            <OpenExternalUrl url={site.url} />
                          </div>
                        </td>
                        <td className="max-w-xs truncate p-4 font-mono text-xs text-muted-foreground">
                          {site.url}
                        </td>
                        <td className="p-4">{liveScore ?? '—'}</td>
                        <td className="p-4">
                          <span
                            className={cn(
                              'rounded border px-2 py-0.5 text-xs font-medium',
                              gradeClass(liveGrade),
                            )}
                          >
                            {liveGrade ?? '?'}
                          </span>
                        </td>
                        <td className="p-4 text-muted-foreground">{liveFindings}</td>
                        <td className="p-4">
                          {scan?.running ? (
                            <div className="min-w-[120px] space-y-1">
                              <div className="flex items-center justify-between gap-2 text-[11px]">
                                <span
                                  className={cn(
                                    'truncate text-muted-foreground',
                                    progress?.status === 'scanning' && 'text-sky-300',
                                    progress?.status === 'done' && 'text-emerald-400',
                                    progress?.status === 'error' && 'text-destructive',
                                  )}
                                  title={label || undefined}
                                >
                                  {label || (pct != null ? `${pct}%` : '—')}
                                </span>
                                <span className="shrink-0 tabular-nums text-muted-foreground">
                                  {pct != null ? `${pct}%` : '—'}
                                </span>
                              </div>
                              <ProgressBar
                                percent={pct ?? 0}
                                barClassName={cn(
                                  progress?.status === 'error' && 'bg-destructive',
                                  progress?.status === 'done' && 'bg-emerald-400',
                                  progress?.status === 'scanning' && 'bg-sky-400',
                                  progress?.status === 'queued' && 'bg-white/30',
                                )}
                              />
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
