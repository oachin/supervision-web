'use client';

import { cn } from '@/lib/utils';

export type StatusSummaryTone = 'default' | 'success' | 'warning' | 'danger' | 'muted';

export type StatusSummaryTile = {
  id: string;
  label: string;
  count: number;
  tone?: StatusSummaryTone;
};

const toneStyles: Record<StatusSummaryTone, { active: string; idle: string; count: string }> = {
  default: {
    active: 'border-primary bg-primary/15',
    idle: 'border-white/10 hover:border-white/20 hover:bg-secondary/30',
    count: 'text-foreground',
  },
  success: {
    active: 'border-accent/50 bg-accent/15',
    idle: 'border-white/10 hover:border-accent/30 hover:bg-accent/5',
    count: 'text-accent',
  },
  warning: {
    active: 'border-warning/50 bg-warning/15',
    idle: 'border-white/10 hover:border-warning/30 hover:bg-warning/5',
    count: 'text-warning',
  },
  danger: {
    active: 'border-destructive/50 bg-destructive/15',
    idle: 'border-white/10 hover:border-destructive/30 hover:bg-destructive/5',
    count: 'text-destructive',
  },
  muted: {
    active: 'border-white/20 bg-secondary/50',
    idle: 'border-white/10 hover:border-white/20 hover:bg-secondary/30',
    count: 'text-muted-foreground',
  },
};

export function StatusSummaryBanner({
  tiles,
  activeId,
  onSelect,
}: {
  tiles: StatusSummaryTile[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div
      className={cn(
        'grid gap-3',
        tiles.length <= 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5',
      )}
    >
      {tiles.map((tile) => {
        const tone = tile.tone ?? 'default';
        const styles = toneStyles[tone];
        const active = activeId === tile.id;
        return (
          <button
            key={tile.id}
            type="button"
            onClick={() => onSelect(active ? 'all' : tile.id)}
            className={cn(
              'rounded-xl border px-4 py-3 text-left transition-colors',
              active ? styles.active : styles.idle,
            )}
          >
            <div className="text-xs font-medium text-muted-foreground">{tile.label}</div>
            <div className={cn('mt-1 font-mono text-2xl font-semibold tabular-nums', styles.count)}>
              {tile.count}
            </div>
          </button>
        );
      })}
    </div>
  );
}
