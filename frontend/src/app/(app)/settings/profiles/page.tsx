'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2, Pencil, X } from 'lucide-react';
import { api, type AccessProfile } from '@/lib/api';
import { useAuthProfile } from '@/hooks/use-auth-profile';
import {
  PERMISSION_RESOURCES,
  PERMISSION_RESOURCE_LABELS,
  emptyPermissions,
  normalizePermissions,
  type PermissionsMap,
  type PermissionAction,
} from '@/lib/permissions';
import { cn } from '@/lib/utils';

const ACTIONS: { key: PermissionAction; label: string }[] = [
  { key: 'view', label: 'Voir' },
  { key: 'modify', label: 'Modifier' },
  { key: 'delete', label: 'Supprimer' },
];

type EditorState = {
  id?: string;
  name: string;
  description: string;
  permissions: PermissionsMap;
  isSystem?: boolean;
};

function blankEditor(): EditorState {
  return {
    name: '',
    description: '',
    permissions: emptyPermissions(),
  };
}

export default function SettingsProfilesPage() {
  const { hasPermission } = useAuthProfile();
  const canModify = hasPermission('profiles', 'modify');
  const canDelete = hasPermission('profiles', 'delete');

  const [profiles, setProfiles] = useState<AccessProfile[]>([]);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .getProfiles()
      .then(setProfiles)
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'));

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setEditor(blankEditor());
    setError(null);
  }

  function openEdit(profile: AccessProfile) {
    setEditor({
      id: profile.id,
      name: profile.name,
      description: profile.description ?? '',
      permissions: normalizePermissions(profile.permissions),
      isSystem: profile.isSystem,
    });
    setError(null);
  }

  function togglePermission(
    resource: keyof PermissionsMap,
    action: PermissionAction,
    checked: boolean,
  ) {
    if (!editor) return;
    setEditor({
      ...editor,
      permissions: {
        ...editor.permissions,
        [resource]: {
          ...editor.permissions[resource],
          [action]: checked,
          ...(action !== 'view' && checked ? { view: true } : {}),
        },
      },
    });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editor) return;
    setSaving(true);
    setError(null);
    try {
      if (editor.id) {
        await api.updateProfile(editor.id, {
          name: editor.isSystem ? undefined : editor.name,
          description: editor.description,
          permissions: editor.permissions,
        });
      } else {
        await api.createProfile({
          name: editor.name,
          description: editor.description,
          permissions: editor.permissions,
        });
      }
      setEditor(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Supprimer ce profil ?')) return;
    try {
      await api.deleteProfile(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Profils</h1>
          <p className="text-sm text-muted-foreground">
            Droits par page / menu : voir, modifier, supprimer
          </p>
        </div>
        {canModify && (
          <button type="button" onClick={openCreate} className="btn-primary">
            <Plus className="h-4 w-4" /> Nouveau profil
          </button>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid gap-3">
        {profiles.map((profile) => (
          <div
            key={profile.id}
            className="card flex flex-wrap items-center justify-between gap-3"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">{profile.name}</h2>
                {profile.isSystem && (
                  <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    Système
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {profile.usersCount} utilisateur{profile.usersCount !== 1 ? 's' : ''}
                </span>
              </div>
              {profile.description && (
                <p className="mt-1 text-sm text-muted-foreground">{profile.description}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {canModify && (
                <button
                  type="button"
                  onClick={() => openEdit(profile)}
                  className="btn-secondary text-sm"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Droits
                </button>
              )}
              {canDelete && !profile.isSystem && (
                <button
                  type="button"
                  onClick={() => handleDelete(profile.id)}
                  className="btn-ghost p-2 text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {editor && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-card shadow-2xl">
            <header className="flex items-center justify-between border-b border-white/5 px-6 py-4">
              <h2 className="text-lg font-semibold">
                {editor.id ? `Profil — ${editor.name}` : 'Nouveau profil'}
              </h2>
              <button
                type="button"
                onClick={() => setEditor(null)}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary/50"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <form onSubmit={handleSave} className="flex min-h-0 flex-1 flex-col">
              <div className="space-y-4 overflow-y-auto p-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm">Nom</label>
                    <input
                      className="input"
                      value={editor.name}
                      onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                      required
                      disabled={editor.isSystem}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm">Description</label>
                    <input
                      className="input"
                      value={editor.description}
                      onChange={(e) => setEditor({ ...editor, description: e.target.value })}
                    />
                  </div>
                </div>

                <div className="overflow-x-auto rounded-lg border border-white/5">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/5 bg-secondary/20 text-left text-muted-foreground">
                        <th className="p-3 font-medium">Page / menu</th>
                        {ACTIONS.map((a) => (
                          <th key={a.key} className="p-3 text-center font-medium">
                            {a.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {PERMISSION_RESOURCES.map((resource) => (
                        <tr key={resource} className="border-b border-white/5">
                          <td className="p-3 font-medium">
                            {PERMISSION_RESOURCE_LABELS[resource]}
                          </td>
                          {ACTIONS.map((a) => (
                            <td key={a.key} className="p-3 text-center">
                              <input
                                type="checkbox"
                                className={cn('h-4 w-4 accent-primary')}
                                checked={editor.permissions[resource][a.key]}
                                onChange={(e) =>
                                  togglePermission(resource, a.key, e.target.checked)
                                }
                                disabled={!canModify}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <footer className="flex justify-end gap-2 border-t border-white/5 px-6 py-4">
                <button
                  type="button"
                  onClick={() => setEditor(null)}
                  className="btn-secondary"
                >
                  Annuler
                </button>
                {canModify && (
                  <button type="submit" disabled={saving} className="btn-primary">
                    {saving ? 'Enregistrement…' : 'Enregistrer'}
                  </button>
                )}
              </footer>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
