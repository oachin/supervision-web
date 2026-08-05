'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { FileDown, FileText, RefreshCw, AlertTriangle } from 'lucide-react';
import { api, type CyberOverview } from '@/lib/api';

export default function CyberRapportPage() {
  const [data, setData] = useState<CyberOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.getCyberOverview());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function download(kind: 'global' | 'site', fmt: 'html' | 'pdf', url?: string) {
    const key = `${kind}-${fmt}-${url || 'all'}`;
    setBusy(key);
    setError(null);
    try {
      await api.downloadCyberReport(kind, { fmt, url, lang: 'fr' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Téléchargement impossible');
    } finally {
      setBusy(null);
    }
  }

  if (loading && !data) {
    return (
      <div className="flex h-32 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const sites = data?.sites ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Rapport d’audit</h1>
          <p className="text-sm text-muted-foreground">
            Export HTML / PDF du dernier scan (parc entier ou par site)
          </p>
        </div>
        <button type="button" onClick={load} className="btn-secondary text-sm">
          <RefreshCw className="h-4 w-4" /> Actualiser
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold">Rapport global</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Synthèse de tous les sites scorés ({sites.length})
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary text-sm"
              disabled={!!busy || sites.length === 0}
              onClick={() => download('global', 'html')}
            >
              <FileText className="h-4 w-4" />
              {busy === 'global-html-all' ? 'Génération…' : 'HTML'}
            </button>
            <button
              type="button"
              className="btn-primary text-sm"
              disabled={!!busy || sites.length === 0}
              onClick={() => download('global', 'pdf')}
            >
              <FileDown className="h-4 w-4" />
              {busy === 'global-pdf-all' ? 'Génération…' : 'PDF'}
            </button>
          </div>
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="border-b border-white/5 px-4 py-3">
          <h2 className="font-semibold">Rapports par site</h2>
        </div>
        {sites.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            Aucun résultat. Lancez un audit depuis Audit web.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-left text-muted-foreground">
                <th className="p-4 font-medium">Site</th>
                <th className="p-4 font-medium">Score</th>
                <th className="p-4 font-medium">Exports</th>
              </tr>
            </thead>
            <tbody>
              {[...sites]
                .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
                .map((site) => (
                  <tr key={site.url ?? site.name} className="border-b border-white/5">
                    <td className="p-4">
                      <div className="font-medium">{site.name}</div>
                      <div className="max-w-md truncate font-mono text-xs text-muted-foreground">
                        {site.url}
                      </div>
                    </td>
                    <td className="p-4">
                      {site.score ?? '—'}/100 · {site.grade ?? '?'}
                    </td>
                    <td className="p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="btn-secondary px-2 py-1 text-xs"
                          disabled={!site.url || !!busy}
                          onClick={() => site.url && download('site', 'html', site.url)}
                        >
                          HTML
                        </button>
                        <button
                          type="button"
                          className="btn-secondary px-2 py-1 text-xs"
                          disabled={!site.url || !!busy}
                          onClick={() => site.url && download('site', 'pdf', site.url)}
                        >
                          PDF
                        </button>
                        {site.url && (
                          <Link
                            href={`/cybersecurite/site?url=${encodeURIComponent(site.url)}`}
                            className="text-xs text-primary hover:underline"
                          >
                            Détail
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
