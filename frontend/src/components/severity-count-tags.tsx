'use client';

import { cn } from '@/lib/utils';
import {
  type SeverityCounts,
  type SeverityKey,
} from '@/lib/alert-severity';

const SEVERITY_TAG_STYLES: Record<
  SeverityKey,
  { idle: string; active: string }
> = {
  CRITICAL: {
    idle: 'border-red-400/40 bg-red-600 text-white hover:bg-red-500',
    active: 'ring-2 ring-red-300 ring-offset-2 ring-offset-background',
  },
  WARNING: {
    idle: 'border-amber-500/50 bg-amber-400 text-amber-950 hover:bg-amber-300',
    active: 'ring-2 ring-amber-200 ring-offset-2 ring-offset-background',
  },
  INFO: {
    idle: 'border-sky-400/40 bg-sky-500/90 text-white hover:bg-sky-400',
    active: 'ring-2 ring-sky-200 ring-offset-2 ring-offset-background',
  },
};

const ORDER: SeverityKey[] = ['CRITICAL', 'WARNING', 'INFO'];

/** Pills CRITICAL · N / WARNING · N — shared by banner, alerts page, server tiles. */
export function SeverityCountTags({
  counts,
  showZero = false,
  showInfo = true,
  selected,
  onSelect,
  className,
  stacked = false,
  size = 'sm',
}: {
  counts: SeverityCounts;
  showZero?: boolean;
  showInfo?: boolean;
  selected?: SeverityKey | '';
  onSelect?: (sev: SeverityKey) => void;
  className?: string;
  stacked?: boolean;
  size?: 'sm' | 'md';
}) {
  const items = ORDER.filter((sev) => showInfo || sev !== 'INFO').filter(
    (sev) => showZero || counts[sev] > 0 || selected === sev,
  );

  if (items.length === 0) return null;

  const interactive = typeof onSelect === 'function';

  return (
    <div
      className={cn(
        'flex gap-1.5',
        stacked ? 'flex-col items-end' : 'flex-wrap items-center',
        className,
      )}
    >
      {items.map((sev) => {
        const count = counts[sev];
        const isSelected = selected === sev;
        const disabled = !interactive || (count === 0 && !isSelected);
        const className = cn(
          'inline-flex items-center rounded-full border font-semibold tracking-wide',
          size === 'md' ? 'px-3 py-1 text-xs' : 'px-2.5 py-0.5 text-[11px]',
          SEVERITY_TAG_STYLES[sev].idle,
          isSelected && SEVERITY_TAG_STYLES[sev].active,
          count === 0 && !isSelected && 'opacity-40',
          interactive && !disabled && 'cursor-pointer transition',
        );
        const label = `${sev} · ${count}`;

        if (interactive) {
          return (
            <button
              key={sev}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(sev)}
              title={
                isSelected
                  ? 'Retirer le filtre'
                  : count === 0
                    ? `Aucune alerte ${sev}`
                    : `Filtrer : ${sev}`
              }
              className={className}
            >
              {label}
            </button>
          );
        }

        return (
          <span key={sev} className={className}>
            {label}
          </span>
        );
      })}
    </div>
  );
}
