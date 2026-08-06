'use client';

import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

export function normalizeExternalUrl(url?: string | null): string | null {
  const raw = (url || '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

/** Icon link that opens a website URL in a new browser tab. */
export function OpenExternalUrl({
  url,
  className,
  iconClassName,
  title = 'Ouvrir le site dans un nouvel onglet',
}: {
  url?: string | null;
  className?: string;
  iconClassName?: string;
  title?: string;
}) {
  const href = normalizeExternalUrl(url);
  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md p-1 text-muted-foreground transition hover:bg-white/10 hover:text-sky-300',
        className,
      )}
      title={title}
      aria-label={title}
    >
      <ExternalLink className={cn('h-3.5 w-3.5', iconClassName)} />
    </a>
  );
}
