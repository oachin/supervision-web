'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api, type CyberTargets } from '@/lib/api';
import { useAuthProfile } from '@/hooks/use-auth-profile';
import { SiteSearchInput, matchesSiteSearch } from '@/components/site-search-input';

export default function CyberCiblesPage() {
  const { hasPermission } = useAuthProfile();
  const canModify = hasPermission('cybersecurity', 'modify');
  const canDelete = hasPermission('cybersecurity', 'delete');

  const [targets, setTargets] = useState<CyberTargets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', url: '', notes: '' });
  const [showForm, setShowForm] = useState(false);
  const [siteQuery, setSiteQuery] = useState('');

  const load = () =>
    api
      .getCyberTargets()
      .then(setTargets)
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'));

  useEffect(() => {
    load();
  }, []);

  const filteredSupervision = useMemo(
    () =>
      (targets?.supervision ?? []).filter((t) =>
        matchesSiteSearch(siteQuery, t.name, t.url, t.server?.name, t.server?.hostname),
      ),
    [targets?.supervision, siteQuery],
  );

  const filteredExternal = useMemo(
    () =>
      (targets?.external ?? []).filter((t) =>
        matchesSiteSearch(siteQuery, t.name, t.url, t.notes),
      ),
    [targets?.external, siteQuery],
  );

  async function toggleSupervision(id: string, enabled: boolean) {
    await api.setCyberWebsiteScan(id, enabled);
    await load();
  }

  async function toggleExternal(id: string, enabled: boolean) {
    await api.updateCyberExternalTarget(id, { enabled });
    await load();
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.addCyberExternalTarget(form);
      setForm({ name: '', url: '', notes: '' });
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Supprimer cette cible externe ?')) return;
    await api.deleteCyberExternalTarget(id);
    await load();
  }

  if (!targets) {
    return (
      <div className="flex h-32 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Cibles d’audit</h1>
          <p className="text-sm text-muted-foreground">
            Sites de la Supervision + URLs externes à scanner
          </p>
        </div>
        {canModify && (
          <button type="button" onClick={() => setShowForm(true)} className="btn-primary">
            <Plus className="h-4 w-4" /> Site externe
          </button>
        )}
      </div>

      <SiteSearchInput
        value={siteQuery}
        onChange={setSiteQuery}
        placeholder="Rechercher un site (nom, URL, serveur…)"
      />

      {siteQuery.trim() && (
        <p className="text-sm text-muted-foreground">
          {filteredSupervision.length + filteredExternal.length} résultat
          {filteredSupervision.length + filteredExternal.length !== 1 ? 's' : ''} pour «{' '}
          {siteQuery.trim()} »
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {showForm && canModify && (
        <form onSubmit={handleAdd} className="card grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm">Nom</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm">URL</label>
            <input
              className="input"
              type="url"
              placeholder="https://exemple.com"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              required
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm">Notes</label>
            <input
              className="input"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" className="btn-primary">
              Ajouter
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">
              Annuler
            </button>
          </div>
        </form>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Sites Supervision</h2>
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-left text-muted-foreground">
                <th className="p-4 font-medium">Site</th>
                <th className="p-4 font-medium">URL</th>
                <th className="p-4 font-medium">Serveur</th>
                <th className="p-4 font-medium">Scan cyber</th>
              </tr>
            </thead>
            <tbody>
              {filteredSupervision.map((t) => (
                <tr key={t.id} className="border-b border-white/5">
                  <td className="p-4 font-medium">{t.name}</td>
                  <td className="max-w-xs truncate p-4 font-mono text-xs text-muted-foreground">
                    {t.url}
                  </td>
                  <td className="p-4 text-muted-foreground">{t.server?.name ?? '—'}</td>
                  <td className="p-4">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={t.enabled}
                      disabled={!canModify}
                      onChange={(e) => toggleSupervision(t.id, e.target.checked)}
                    />
                  </td>
                </tr>
              ))}
              {filteredSupervision.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-muted-foreground">
                    {siteQuery.trim()
                      ? `Aucun site Supervision pour « ${siteQuery.trim()} »`
                      : 'Aucun site supervisé'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Sites externes</h2>
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-left text-muted-foreground">
                <th className="p-4 font-medium">Nom</th>
                <th className="p-4 font-medium">URL</th>
                <th className="p-4 font-medium">Actif</th>
                <th className="p-4 font-medium" />
              </tr>
            </thead>
            <tbody>
              {filteredExternal.map((t) => (
                <tr key={t.id} className="border-b border-white/5">
                  <td className="p-4 font-medium">{t.name}</td>
                  <td className="max-w-xs truncate p-4 font-mono text-xs text-muted-foreground">
                    {t.url}
                  </td>
                  <td className="p-4">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={t.enabled}
                      disabled={!canModify}
                      onChange={(e) => toggleExternal(t.id, e.target.checked)}
                    />
                  </td>
                  <td className="p-4 text-right">
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => handleDelete(t.id)}
                        className="btn-ghost p-2 text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {filteredExternal.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-muted-foreground">
                    {siteQuery.trim()
                      ? `Aucune cible externe pour « ${siteQuery.trim()} »`
                      : 'Aucune cible externe — ajoutez une URL hors inventaire Supervision'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
