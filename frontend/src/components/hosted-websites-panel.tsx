'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { WebsiteStatusBadge } from '@/components/ui';
import { OpenExternalUrl } from '@/components/open-external-url';
import { cn } from '@/lib/utils';

interface HostedWebsite {
  id: string;
  name: string;
  url: string;
  status: string;
  lastStatusCode?: number | null;
  monitoringEnabled: boolean;
}

export function HostedWebsitesPanel({ websites }: { websites: HostedWebsite[] }) {
  if (websites.length === 0) return null;

  const sortedWebsites = [...websites].sort((a, b) => {
    if (a.monitoringEnabled !== b.monitoringEnabled) {
      return a.monitoringEnabled ? -1 : 1;
    }
    return a.name.localeCompare(b.name, 'fr');
  });

  return (
    <div className="card">
      <h2 className="mb-4 text-lg font-semibold">Sites hébergés</h2>
      <div className="space-y-2">
        {sortedWebsites.map((website) => (
          <div
            key={website.id}
            className={cn(
              'flex items-center justify-between gap-3 rounded-lg border border-white/5 p-3 transition-colors hover:border-primary/30 hover:bg-primary/[0.03]',
              !website.monitoringEnabled && 'opacity-70',
            )}
          >
            <Link href={`/websites/${website.id}`} className="min-w-0 flex-1">
              <p className="font-medium hover:text-primary">{website.name}</p>
              <p className="truncate text-xs text-muted-foreground">{website.url}</p>
            </Link>
            <div className="flex shrink-0 items-center gap-1">
              <OpenExternalUrl url={website.url} />
              <WebsiteStatusBadge
                status={website.status}
                monitoringEnabled={website.monitoringEnabled}
                lastStatusCode={website.lastStatusCode}
              />
              <Link
                href={`/websites/${website.id}`}
                className="rounded-md p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground"
                aria-label={`Voir ${website.name}`}
              >
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
