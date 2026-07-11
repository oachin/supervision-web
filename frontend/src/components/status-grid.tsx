'use client';

import Link from 'next/link';
import { Sparkline } from './sparkline';
import { cn } from '@/lib/utils';

export interface StatusTileData {
  id: string;
  name: string;
  subtitle: string;
  status: string;
  href: string;
  metricLabel: string;
  secondaryLabel?: string;
  sparklineData: number[];
}

const severityRank: Record<string, number> = {
  OFFLINE: 0,
  DOWN: 0,
  DEGRADED: 1,
  MAINTENANCE: 2,
  UNKNOWN: 3,
  ONLINE: 4,
  UP: 4,
  DISABLED: 5,
};

function statusDotClass(status: string) {
  if (status === 'ONLINE' || status === 'UP') return 'bg-accent';
  if (status === 'OFFLINE' || status === 'DOWN') return 'bg-destructive';
  if (status === 'MAINTENANCE') return 'bg-emerald-400';
  if (status === 'DEGRADED') return 'bg-warning';
  return 'bg-muted-foreground';
}

function statusPulseClass(status: string) {
  if (status === 'OFFLINE' || status === 'DOWN') return 'status-dot-pulse-danger';
  if (status === 'DEGRADED') return 'status-dot-pulse-warning';
  return '';
}

function statusGlowColor(status: string) {
  if (status === 'ONLINE' || status === 'UP') return 'hsl(142 76% 45%)';
  if (status === 'OFFLINE' || status === 'DOWN') return 'hsl(0 84% 60%)';
  if (status === 'MAINTENANCE') return 'hsl(152 69% 58%)';
  if (status === 'DEGRADED') return 'hsl(38 92% 50%)';
  return 'hsl(215 20% 55%)';
}

export function Tile({ tile }: { tile: StatusTileData }) {
  return (
    <Link
      href={tile.href}
      className="group flex flex-col gap-2 rounded-lg border border-white/5 bg-card/60 p-3 transition-colors hover:border-primary/30"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{tile.name}</p>
          <p className="truncate text-xs text-muted-foreground">{tile.subtitle}</p>
        </div>
        <span
          className={cn(
            'h-2 w-2 shrink-0 rounded-full',
            statusDotClass(tile.status),
            statusPulseClass(tile.status),
          )}
        />
      </div>
      <Sparkline data={tile.sparklineData} color={statusGlowColor(tile.status)} height={24} />
      <div className="flex items-center justify-between font-mono text-xs text-muted-foreground">
        <span>{tile.metricLabel}</span>
        {tile.secondaryLabel && <span>{tile.secondaryLabel}</span>}
      </div>
    </Link>
  );
}

export function StatusGrid({ tiles }: { tiles: StatusTileData[] }) {
  const sorted = [...tiles].sort(
    (a, b) => (severityRank[a.status] ?? 2) - (severityRank[b.status] ?? 2),
  );

  if (sorted.length === 0) {
    return <p className="text-sm text-muted-foreground">Aucun élément à afficher.</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {sorted.map((tile) => (
        <Tile key={tile.id} tile={tile} />
      ))}
    </div>
  );
}
