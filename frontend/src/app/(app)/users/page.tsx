'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api, type ManagedUser } from '@/lib/api';

export default function UsersPage() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'VIEWER' });

  const load = () => api.getUsers().then(setUsers);
  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    await api.createUser(form);
    setShowForm(false);
    setForm({ email: '', name: '', password: '', role: 'VIEWER' });
    load();
  }

  async function handleDelete(id: string) {
    if (confirm('Supprimer cet utilisateur ?')) {
      await api.deleteUser(id);
      load();
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Utilisateurs</h1>
          <p className="text-sm text-muted-foreground">Gestion des accès et rôles</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary">
          <Plus className="h-4 w-4" /> Ajouter
        </button>
      </div>

      {showForm && (
        <div className="card">
          <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm">Email</label>
              <input type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </div>
            <div>
              <label className="mb-1 block text-sm">Nom</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label className="mb-1 block text-sm">Mot de passe</label>
              <input type="password" className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={12} />
            </div>
            <div>
              <label className="mb-1 block text-sm">Rôle</label>
              <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="VIEWER">Viewer (lecture seule)</option>
                <option value="OPERATOR">Operator (gestion)</option>
                <option value="ADMIN">Admin (complet)</option>
              </select>
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <button type="submit" className="btn-primary">Créer</button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Annuler</button>
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
              <th className="p-4 font-medium">Rôle</th>
              <th className="p-4 font-medium">2FA</th>
              <th className="p-4 font-medium">Actif</th>
              <th className="p-4 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-white/5">
                <td className="p-4 font-medium">{u.name}</td>
                <td className="p-4">{u.email}</td>
                <td className="p-4"><span className="badge-muted">{u.role}</span></td>
                <td className="p-4">{u.totpEnabled ? '✓' : '—'}</td>
                <td className="p-4">{u.isActive ? '✓' : '✗'}</td>
                <td className="p-4">
                  <button onClick={() => handleDelete(u.id)} className="btn-ghost p-2 text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
