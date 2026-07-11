'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { api, type WebsiteDetail } from '@/lib/api';
import { WebsiteStatusBadge, HttpCodeBadge, DnsBadge } from '@/components/ui';
import { formatDate, cn } from '@/lib/utils';

interface HostedWebsite {
  id: string;
  name: string;
  url: string;
  status: string;
  lastStatusCode?: number | null;
  monitoringEnabled: boolean;
}

function HostedWebsiteDetail({ websiteId }: { websiteId: string }) {
  const [website, setWebsite] = useState<WebsiteDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.getWebsite(websiteId)
      .then(setWebsite)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [websiteId]);

  if (loading) {
    return (
      <div className="flex h-16 items-center justify-center border-t border-white/5 px-3">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!website) {
    return (
      <p className="border-t border-white/5 px-3 py-3 text-sm text-destructive">
        Impossible de charger le détail du site.
      </p>
    );
  }

  return (
    <div className="space-y-3 border-t border-white/5 px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <WebsiteStatusBadge status={website.status} monitoringEnabled={website.monitoringEnabled} lastStatusCode={website.lastStatusCode} />
        <HttpCodeBadge code={website.lastStatusCode} />
        <DnsBadge ok={website.lastDnsOk} />
        {website.lastResponseMs != null && (
          <span className="font-mono text-xs text-muted-foreground">{website.lastResponseMs} ms</span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3 text-sm">
        <div>
          <p className="text-muted-foreground">Dernière vérif.</p>
          <p>{formatDate(website.lastCheckAt)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">SSL</p>
          <p>{website.sslDaysRemaining != null ? `${website.sslDaysRemaining} jours` : '—'}</p>
        </div>
        <div>
          <p className="text-muted-foreground">TLS</p>
          <p>{website.lastTlsVersion ?? '—'}</p>
        </div>
      </div>

      {website.sslIssuer && (
        <p className="text-xs text-muted-foreground">
          Émetteur : {website.sslIssuer}
        </p>
      )}

      {website.checks.length > 0 && (
        <div className="max-h-40 space-y-1 overflow-y-auto">
          {website.checks.slice(0, 5).map((check) => (
            <div
              key={check.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-white/5 px-2 py-1.5 text-xs"
            >
              <span className="text-muted-foreground">{formatDate(check.checkedAt)}</span>
              <span className="font-mono">HTTP {check.statusCode ?? '—'}</span>
              <span className="font-mono">{check.responseMs ?? '—'} ms</span>
              <WebsiteStatusBadge status={check.status} lastStatusCode={check.statusCode} />
              {check.errorMessage && (
                <span className="text-destructive">{check.errorMessage}</span>
              )}
            </div>
          ))}
        </div>
      )}

      <a
        href={website.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
      >
        Ouvrir le site
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}

export function HostedWebsitesPanel({ websites }: { websites: HostedWebsite[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
        {sortedWebsites.map((website) => {
          const expanded = expandedId === website.id;
          return (
            <div
              key={website.id}
              className={cn(
                'overflow-hidden rounded-lg border transition-colors',
                expanded ? 'border-primary/30 bg-primary/[0.03]' : 'border-white/5',
                !website.monitoringEnabled && 'opacity-70',
              )}
            >
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : website.id)}
                className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-white/[0.02]"
              >
                <div className="min-w-0">
                  <p className="font-medium">{website.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{website.url}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <WebsiteStatusBadge
                    status={website.status}
                    monitoringEnabled={website.monitoringEnabled}
                    lastStatusCode={website.lastStatusCode}
                  />
                  <ChevronDown
                    className={cn(
                      'h-4 w-4 text-muted-foreground transition-transform',
                      expanded && 'rotate-180',
                    )}
                  />
                </div>
              </button>
              {expanded && <HostedWebsiteDetail websiteId={website.id} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
