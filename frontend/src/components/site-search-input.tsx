'use client';

import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export function matchesSiteSearch(
  query: string,
  ...fields: Array<string | null | undefined>
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => (f || '').toLowerCase().includes(q));
}

export function SiteSearchInput({
  value,
  onChange,
  placeholder = 'Rechercher un site (nom, URL…)',
  className,
  inputClassName,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
}) {
  return (
    <div className={cn('relative min-w-[12rem] max-w-md flex-1', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        className={cn('input pl-10 pr-10', inputClassName)}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={placeholder}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
          title="Effacer la recherche"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
