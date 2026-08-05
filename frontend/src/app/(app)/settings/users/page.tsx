'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2, Pencil, Mail, ShieldOff, X } from 'lucide-react';
import { api, type AccessProfile, type ManagedUser } from '@/lib/api';
import { useAuthProfile } from '@/hooks/use-auth-profile';
import { formatDate } from '@/lib/utils';

type FormState = {
  email: string;
  firstName: string;
  lastName: string;
  profileId: string;
  isActive: boolean;
};

const emptyForm = (profileId = ''): FormState => ({
  email: '',
  firstName: '',
  lastName: '',
  profileId,
  isActive: true,
});

export default function SettingsUsersPage() {
  const { hasPermission } = useAuthProfile();
  const canModify = hasPermission('users', 'modify');
  const canDelete = hasPermission('users', 'delete');

  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [profiles, setProfiles] = useState<AccessProfile[]>([]);
  const [mode, setMode] = useState<'create' | 'edit' | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const defaultProfileId = (list: AccessProfile[]) =>
    list.find((p) => p.slug === 'lecteur')?.id ?? list[0]?.id ?? '';

  const load = async () => {
    const [usersData, profilesData] = await Promise.all([
      api.getUsers(),
      api.getProfiles().catch(() => [] as AccessProfile[]),
    ]);
    setUsers(usersData);
    setProfiles(profilesData);
    setForm((f) => ({
      ...f,
      profileId: f.profileId || defaultProfileId(profilesData),
    }));
  };

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : 'Erreur'));
  }, []);

  function openCreate() {
    setMode('create');
    setEditingId(null);
    setForm(emptyForm(defaultProfileId(profiles)));
    setError(null);
    setInfo(null);
  }

  function openEdit(user: ManagedUser) {
    setMode('edit');
    setEditingId(user.id);
    setForm({
      email: user.email,
      firstName: user.firstName || user.name.split(' ')[0] || '',
      lastName: user.lastName || user.name.split(' ').slice(1).join(' ') || '',
      profileId: user.profileId ?? user.profile?.id ?? defaultProfileId(profiles),
      isActive: user.isActive,
    });
    setError(null);
    setInfo(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    try {
      if (mode === 'create') {
        const created = await api.createUser({
          email: form.email,
          firstName: form.firstName,
          lastName: form.lastName,
          profileId: form.profileId,
        });
        setInfo(
          `Invitation envoyée à ${created.email}. Lien valable jusqu’au ${
            created.inviteExpiresAt ? formatDate(created.inviteExpiresAt) : '72h'
          }.`,
        );
      } else if (mode === 'edit' && editingId) {
        await api.updateUser(editingId, {
          firstName: form.firstName,
          lastName: form.lastName,
          profileId: form.profileId,
          isActive: form.isActive,
        });
        setInfo('Utilisateur mis à jour.');
      }
      setMode(null);
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  async function handleResend(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const result = await api.resendUserInvite(id);
      setInfo(`Invitation renvoyée (expire le ${formatDate(result.inviteExpiresAt)}).`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusyId(null);
    }
  }

  async function handleReset2fa(id: string) {
    if (!confirm('Réinitialiser la 2FA de cet utilisateur ? Il devra la reconfigurer.')) return;
    setBusyId(id);
    setError(null);
    try {
      await api.resetUser2fa(id);
      setInfo('2FA réinitialisée.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Supprimer cet utilisateur ?')) return;
    await api.deleteUser(id);
    await load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Utilisateurs</h1>
          <p className="text-sm text-muted-foreground">
            Invitation par e-mail, profils d’accès et gestion 2FA
          </p>
        </div>
        {canModify && (
          <button type="button" onClick={openCreate} className="btn-primary">
            <Plus className="h-4 w-4" /> Ajouter
          </button>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {info && <p className="text-sm text-emerald-400">{info}</p>}

      {mode && canModify && (
        <div className="card relative">
          <button
            type="button"
            onClick={() => setMode(null)}
            className="absolute right-4 top-4 rounded-lg p-1 text-muted-foreground hover:bg-secondary/50"
          >
            <X className="h-4 w-4" />
          </button>
          <h2 className="mb-4 text-lg font-semibold">
            {mode === 'create' ? 'Inviter un utilisateur' : 'Modifier l’utilisateur'}
          </h2>
          <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm">Email</label>
              <input
                type="email"
                className="input"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
                disabled={mode === 'edit'}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm">Profil</label>
              <select
                className="input"
                value={form.profileId}
                onChange={(e) => setForm({ ...form, profileId: e.target.value })}
                required
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm">Prénom</label>
              <input
                className="input"
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm">Nom</label>
              <input
                className="input"
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                required
              />
            </div>
            {mode === 'edit' && (
              <div className="flex items-center gap-2 sm:col-span-2">
                <input
                  id="isActive"
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                />
                <label htmlFor="isActive" className="text-sm">
                  Compte actif
                </label>
              </div>
            )}
            {mode === 'create' && (
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Un e-mail d’invitation sera envoyé pour définir le mot de passe et activer la 2FA.
                Le SMTP doit être configuré.
              </p>
            )}
            <div className="flex gap-2 sm:col-span-2">
              <button type="submit" className="btn-primary">
                {mode === 'create' ? 'Envoyer l’invitation' : 'Enregistrer'}
              </button>
              <button type="button" onClick={() => setMode(null)} className="btn-secondary">
                Annuler
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 text-left text-muted-foreground">
              <th className="p-4 font-medium">Nom</th>
              <th className="p-4 font-medium">Email</th>
              <th className="p-4 font-medium">Profil</th>
              <th className="p-4 font-medium">Statut</th>
              <th className="p-4 font-medium">2FA</th>
              <th className="p-4 font-medium" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-white/5">
                <td className="p-4 font-medium">
                  {[u.firstName, u.lastName].filter(Boolean).join(' ') || u.name}
                </td>
                <td className="p-4">{u.email}</td>
                <td className="p-4">
                  <span className="badge-muted">{u.profile?.name ?? u.role}</span>
                </td>
                <td className="p-4">
                  {!u.isActive ? (
                    <span className="text-destructive">Inactif</span>
                  ) : u.invitePending ? (
                    <span className="text-amber-400">Invitation en cours</span>
                  ) : (
                    <span className="text-emerald-400">Actif</span>
                  )}
                </td>
                <td className="p-4">{u.totpEnabled ? '✓' : '—'}</td>
                <td className="p-4">
                  <div className="flex flex-wrap justify-end gap-1">
                    {canModify && (
                      <button
                        type="button"
                        onClick={() => openEdit(u)}
                        className="btn-ghost p-2"
                        title="Modifier"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                    {canModify && u.invitePending && (
                      <button
                        type="button"
                        onClick={() => handleResend(u.id)}
                        disabled={busyId === u.id}
                        className="btn-ghost p-2"
                        title="Renvoyer l’invitation"
                      >
                        <Mail className="h-4 w-4" />
                      </button>
                    )}
                    {canModify && u.totpEnabled && (
                      <button
                        type="button"
                        onClick={() => handleReset2fa(u.id)}
                        disabled={busyId === u.id}
                        className="btn-ghost p-2 text-warning"
                        title="Reset 2FA"
                      >
                        <ShieldOff className="h-4 w-4" />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => handleDelete(u.id)}
                        className="btn-ghost p-2 text-destructive"
                        title="Supprimer"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
