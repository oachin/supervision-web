'use client';

import { useMemo } from 'react';
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
import { CalendarClock, Shield, AlertTriangle } from 'lucide-react';
import type { CyberOverview } from '@/lib/api';
import { cn, formatDateTime } from '@/lib/utils';

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

function formatTrendLabel(iso?: string | null) {
  return formatDateTime(iso, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function CyberDashboardSummary({ data }: { data: CyberOverview }) {
  const automationOn = Boolean(data.automation?.enabled);
  const nextRun = data.automation?.nextRunAt;

  const gradeEntries = useMemo(
    () =>
      Object.entries(data.grades || {}).sort(([a], [b]) => a.localeCompare(b)),
    [data.grades],
  );

  const trendData = useMemo(
    () =>
      (data.trend || []).map((p) => ({
        label: formatTrendLabel(p.started_at),
        score: p.avg_score ?? 0,
      })),
    [data.trend],
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Shield className="h-3.5 w-3.5 text-primary" />
        <h2 className="text-sm font-semibold">Cybersécurité</h2>
      </div>

      <div className="grid gap-2 lg:grid-cols-4">
        <Link
          href="/cybersecurite/automation"
          className="rounded-lg border border-white/10 bg-secondary/20 p-3 transition hover:border-sky-500/30"
        >
          <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            <CalendarClock className="h-3 w-3" />
            État
          </p>
          <p
            className={cn(
              'mt-1 text-sm font-semibold',
              automationOn ? 'text-emerald-400' : 'text-muted-foreground',
            )}
          >
            {automationOn ? 'Automatisation active' : 'Manuelle seule'}
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {automationOn
              ? nextRun
                ? `Prochain : ${formatDateTime(nextRun)}`
                : 'Programmée'
              : 'Configurer les scans auto'}
          </p>
        </Link>

        <Link
          href="/cybersecurite"
          className="rounded-lg border border-white/10 bg-secondary/20 p-3 transition hover:border-sky-500/30"
        >
          <h3 className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
            Répartition des notes
          </h3>
          {gradeEntries.length === 0 ? (
            <p className="text-xs text-muted-foreground">Aucun score disponible</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {gradeEntries.map(([grade, count]) => (
                <span
                  key={grade}
                  className={cn(
                    'rounded-md border px-2 py-0.5 text-xs font-medium',
                    gradeClass(grade),
                  )}
                >
                  {grade} · {count}
                </span>
              ))}
            </div>
          )}
        </Link>

        <Link
          href="/cybersecurite#risques-critiques"
          className={cn(
            'rounded-lg border p-3 transition',
            (data.extremeRiskSites ?? 0) > 0
              ? 'border-destructive/40 bg-destructive/10 hover:border-destructive/60'
              : 'border-white/10 bg-secondary/20 hover:border-destructive/30',
          )}
        >
          <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-destructive">
            <AlertTriangle className="h-3 w-3" />
            Risques critiques
          </p>
          <p className="mt-1 text-sm font-semibold tabular-nums">
            {data.extremeRiskSites ?? 0} site
            {(data.extremeRiskSites ?? 0) === 1 ? '' : 's'}
            <span className="font-normal text-muted-foreground">
              {' '}
              · {data.extremeRiskFindings ?? 0} constat
              {(data.extremeRiskFindings ?? 0) === 1 ? '' : 's'}
            </span>
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Fuites de secrets & takeovers
          </p>
        </Link>

        <Link
          href="/cybersecurite/evolution"
          className="rounded-lg border border-white/10 bg-secondary/20 p-3 transition hover:border-sky-500/30"
        >
          <h3 className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            Évolution du score
          </h3>
          {trendData.length < 2 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              Historique insuffisant
            </p>
          ) : (
            <div className="h-16 pointer-events-none">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={{ top: 2, right: 2, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: '#94a3b8', fontSize: 8 }}
                    interval="preserveStartEnd"
                    minTickGap={40}
                    height={18}
                  />
                  <YAxis
                    domain={[0, 100]}
                    width={20}
                    tick={{ fill: '#94a3b8', fontSize: 8 }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#0f172a',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 8,
                      fontSize: 11,
                    }}
                    labelFormatter={(label) => `Audit · ${label}`}
                    formatter={(value: number) => [`${value}/100`, 'Score moyen']}
                  />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke="#38bdf8"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Link>
      </div>
    </div>
  );
}
