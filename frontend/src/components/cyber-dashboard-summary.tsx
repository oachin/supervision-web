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
import { CalendarClock, Shield } from 'lucide-react';
import type { CyberOverview } from '@/lib/api';
import { cn } from '@/lib/utils';

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
    <div className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          <h2 className="text-lg font-semibold">Audit cyber</h2>
        </div>
        <Link href="/cybersecurite" className="text-sm text-primary hover:underline">
          Voir l’audit
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Link
          href="/cybersecurite/automation"
          className="rounded-lg border border-white/10 bg-secondary/20 p-4 transition hover:border-sky-500/30"
        >
          <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
            <CalendarClock className="h-3.5 w-3.5" />
            État
          </p>
          <p
            className={cn(
              'mt-2 text-lg font-semibold',
              automationOn ? 'text-emerald-400' : 'text-muted-foreground',
            )}
          >
            {automationOn ? 'Automatisation active' : 'Manuelle seule'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {automationOn
              ? nextRun
                ? `Prochain : ${new Date(nextRun).toLocaleString('fr-FR')}`
                : 'Programmée'
              : 'Configurer les scans auto'}
          </p>
        </Link>

        <div className="rounded-lg border border-white/10 bg-secondary/20 p-4 lg:col-span-1">
          <h3 className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">
            Répartition des notes
          </h3>
          {gradeEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun score disponible</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {gradeEntries.map(([grade, count]) => (
                <span
                  key={grade}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-sm font-medium',
                    gradeClass(grade),
                  )}
                >
                  {grade} · {count}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-white/10 bg-secondary/20 p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-xs uppercase tracking-wide text-muted-foreground">
              Évolution du score
            </h3>
            <Link
              href="/cybersecurite/evolution"
              className="text-xs text-primary hover:underline"
            >
              Voir plus
            </Link>
          </div>
          {trendData.length < 2 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Historique insuffisant
            </p>
          ) : (
            <div className="h-28">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: '#94a3b8', fontSize: 9 }}
                    interval="preserveStartEnd"
                    minTickGap={36}
                  />
                  <YAxis
                    domain={[0, 100]}
                    width={24}
                    tick={{ fill: '#94a3b8', fontSize: 9 }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#0f172a',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 8,
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
        </div>
      </div>
    </div>
  );
}
