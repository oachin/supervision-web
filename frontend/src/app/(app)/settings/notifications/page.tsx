'use client';

import { useCallback, useEffect, useState } from 'react';
import { Mail, Plus, Trash2, Pencil, Send, Loader2 } from 'lucide-react';
import {
  api,
  type NotificationRule,
  type NotificationRuleInput,
  type SmtpSettings,
  type ServerWithHistory,
  type User,
} from '@/lib/api';
import { cn } from '@/lib/utils';

const severityOptions = [
  { id: 'CRITICAL' as const, label: 'Critique' },
  { id: 'WARNING' as const, label: 'Avertissement' },
  { id: 'INFO' as const, label: 'Info' },
];

const emptyRuleForm = (): NotificationRuleInput => ({
  name: '',
  enabled: true,
  recipients: [''],
  serverIds: [],
  severities: [],
  notifyOnCreate: true,
  notifyOnOccurrence: true,
});

export default function NotificationsSettingsPage() {
  const [profile, setProfile] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [testingSmtp, setTestingSmtp] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [smtpMessage, setSmtpMessage] = useState<string | null>(null);
  const [smtpError, setSmtpError] = useState<string | null>(null);

  const [smtp, setSmtp] = useState({
    host: '',
    port: 587,
    secure: false,
    username: '',
    password: '',
    fromEmail: '',
    fromName: 'Havet Supervision',
    enabled: false,
    hasPassword: false,
  });

  const [servers, setServers] = useState<ServerWithHistory[]>([]);
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleForm, setRuleForm] = useState<NotificationRuleInput>(emptyRuleForm());
  const [savingRule, setSavingRule] = useState(false);
  const [ruleError, setRuleError] = useState<string | null>(null);

  const isAdmin = profile?.role === 'ADMIN';

  const load = useCallback(async () => {
    const [smtpData, rulesData, serversData] = await Promise.all([
      api.getSmtpSettings(),
      api.getNotificationRules(),
      api.getServers(),
    ]);
    setSmtp({
      host: smtpData.host,
      port: smtpData.port,
      secure: smtpData.secure,
      username: smtpData.username ?? '',
      password: '',
      fromEmail: smtpData.fromEmail,
      fromName: smtpData.fromName,
      enabled: smtpData.enabled,
      hasPassword: smtpData.hasPassword,
    });
    setRules(rulesData);
    setServers(serversData);
  }, []);

  useEffect(() => {
    api.getProfile().then(setProfile).catch(() => {});
    load()
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [load]);

  async function handleSaveSmtp(e: React.FormEvent) {
    e.preventDefault();
    if (!isAdmin) return;
    setSavingSmtp(true);
    setSmtpError(null);
    setSmtpMessage(null);
    try {
      const saved = await api.saveSmtpSettings({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        username: smtp.username || undefined,
        password: smtp.password || undefined,
        fromEmail: smtp.fromEmail,
        fromName: smtp.fromName,
        enabled: smtp.enabled,
      });
      setSmtp((current) => ({
        ...current,
        password: '',
        hasPassword: saved.hasPassword,
        enabled: saved.enabled,
      }));
      setSmtpMessage('Configuration SMTP enregistrée.');
    } catch (err) {
      setSmtpError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setSavingSmtp(false);
    }
  }

  async function handleTestSmtp() {
    if (!testEmail.trim()) return;
    setTestingSmtp(true);
    setSmtpError(null);
    setSmtpMessage(null);
    try {
      await api.testSmtp(testEmail.trim());
      setSmtpMessage(`Email de test envoyé à ${testEmail.trim()}.`);
    } catch (err) {
      setSmtpError(err instanceof Error ? err.message : 'Échec du test SMTP');
    } finally {
      setTestingSmtp(false);
    }
  }

  function openCreateRule() {
    setEditingRuleId(null);
    setRuleForm(emptyRuleForm());
    setRuleError(null);
    setShowRuleForm(true);
  }

  function openEditRule(rule: NotificationRule) {
    setEditingRuleId(rule.id);
    setRuleForm({
      name: rule.name,
      enabled: rule.enabled,
      recipients: rule.recipients.length ? rule.recipients : [''],
      serverIds: rule.serverIds,
      severities: rule.severities,
      notifyOnCreate: rule.notifyOnCreate,
      notifyOnOccurrence: rule.notifyOnOccurrence,
    });
    setRuleError(null);
    setShowRuleForm(true);
  }

  async function handleSaveRule(e: React.FormEvent) {
    e.preventDefault();
    if (!isAdmin) return;
    const recipients = ruleForm.recipients.map((r) => r.trim()).filter(Boolean);
    if (!ruleForm.name.trim() || recipients.length === 0) {
      setRuleError('Nom et au moins un destinataire requis.');
      return;
    }

    setSavingRule(true);
    setRuleError(null);
    try {
      const payload: NotificationRuleInput = {
        ...ruleForm,
        name: ruleForm.name.trim(),
        recipients,
        serverIds: ruleForm.serverIds,
        severities: ruleForm.severities,
      };
      if (editingRuleId) {
        await api.updateNotificationRule(editingRuleId, payload);
      } else {
        await api.createNotificationRule(payload);
      }
      await load();
      setShowRuleForm(false);
    } catch (err) {
      setRuleError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setSavingRule(false);
    }
  }

  async function handleDeleteRule(id: string) {
    if (!isAdmin || !confirm('Supprimer cette règle ?')) return;
    await api.deleteNotificationRule(id);
    await load();
  }

  function toggleServer(serverId: string) {
    setRuleForm((current) => {
      const has = current.serverIds?.includes(serverId);
      const serverIds = has
        ? (current.serverIds ?? []).filter((id) => id !== serverId)
        : [...(current.serverIds ?? []), serverId];
      return { ...current, serverIds };
    });
  }

  function toggleSeverity(severity: 'INFO' | 'WARNING' | 'CRITICAL') {
    setRuleForm((current) => {
      const list = current.severities ?? [];
      const severities = list.includes(severity)
        ? list.filter((s) => s !== severity)
        : [...list, severity];
      return { ...current, severities };
    });
  }

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="card">
        <div className="mb-4 flex items-center gap-2">
          <Mail className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Serveur SMTP</h2>
        </div>
        {!isAdmin && (
          <p className="mb-4 text-sm text-muted-foreground">Lecture seule — réservé aux administrateurs.</p>
        )}
        <form onSubmit={handleSaveSmtp} className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm">Hôte SMTP</label>
            <input
              className="input"
              value={smtp.host}
              onChange={(e) => setSmtp({ ...smtp, host: e.target.value })}
              placeholder="smtp.example.com"
              required
              disabled={!isAdmin}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm">Port</label>
            <input
              type="number"
              className="input"
              value={smtp.port}
              onChange={(e) => setSmtp({ ...smtp, port: parseInt(e.target.value, 10) || 587 })}
              required
              disabled={!isAdmin}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm">Identifiant</label>
            <input
              className="input"
              value={smtp.username}
              onChange={(e) => setSmtp({ ...smtp, username: e.target.value })}
              disabled={!isAdmin}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm">
              Mot de passe {smtp.hasPassword && '(laisser vide pour conserver)'}
            </label>
            <input
              type="password"
              className="input"
              value={smtp.password}
              onChange={(e) => setSmtp({ ...smtp, password: e.target.value })}
              disabled={!isAdmin}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm">Email expéditeur</label>
            <input
              type="email"
              className="input"
              value={smtp.fromEmail}
              onChange={(e) => setSmtp({ ...smtp, fromEmail: e.target.value })}
              required
              disabled={!isAdmin}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm">Nom expéditeur</label>
            <input
              className="input"
              value={smtp.fromName}
              onChange={(e) => setSmtp({ ...smtp, fromName: e.target.value })}
              required
              disabled={!isAdmin}
            />
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={smtp.secure}
              onChange={(e) => setSmtp({ ...smtp, secure: e.target.checked })}
              disabled={!isAdmin}
            />
            Connexion sécurisée (SSL/TLS direct, port 465)
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={smtp.enabled}
              onChange={(e) => setSmtp({ ...smtp, enabled: e.target.checked })}
              disabled={!isAdmin}
            />
            Activer l&apos;envoi des notifications par email
          </label>
          {isAdmin && (
            <div className="sm:col-span-2">
              <button type="submit" className="btn-primary" disabled={savingSmtp}>
                {savingSmtp ? 'Enregistrement…' : 'Enregistrer SMTP'}
              </button>
            </div>
          )}
        </form>

        {isAdmin && (
          <div className="mt-4 flex flex-col gap-2 border-t border-white/5 pt-4 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="mb-1 block text-sm">Tester l&apos;envoi</label>
              <input
                type="email"
                className="input"
                placeholder="votre@email.com"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
              />
            </div>
            <button
              type="button"
              onClick={handleTestSmtp}
              disabled={testingSmtp || !testEmail.trim()}
              className="btn-secondary"
            >
              <Send className="h-4 w-4" />
              {testingSmtp ? 'Envoi…' : 'Envoyer un test'}
            </button>
          </div>
        )}

        {smtpMessage && <p className="mt-3 text-sm text-success">{smtpMessage}</p>}
        {smtpError && <p className="mt-3 text-sm text-destructive">{smtpError}</p>}
      </div>

      <div className="card">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Règles de notification</h2>
            <p className="text-sm text-muted-foreground">
              Filtrez par serveur et sévérité, envoyez vers une ou plusieurs adresses.
            </p>
          </div>
          {isAdmin && (
            <button type="button" onClick={openCreateRule} className="btn-primary shrink-0">
              <Plus className="h-4 w-4" /> Ajouter
            </button>
          )}
        </div>

        {showRuleForm && isAdmin && (
          <form onSubmit={handleSaveRule} className="mb-6 space-y-4 rounded-lg border border-primary/20 bg-primary/5 p-4">
            <h3 className="font-semibold">{editingRuleId ? 'Modifier la règle' : 'Nouvelle règle'}</h3>
            <div>
              <label className="mb-1 block text-sm">Nom</label>
              <input
                className="input"
                value={ruleForm.name}
                onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm">Destinataires (emails)</label>
              {ruleForm.recipients.map((recipient, index) => (
                <div key={index} className="mb-2 flex gap-2">
                  <input
                    type="email"
                    className="input"
                    value={recipient}
                    onChange={(e) => {
                      const recipients = [...ruleForm.recipients];
                      recipients[index] = e.target.value;
                      setRuleForm({ ...ruleForm, recipients });
                    }}
                    placeholder="alertes@example.com"
                    required={index === 0}
                  />
                  {ruleForm.recipients.length > 1 && (
                    <button
                      type="button"
                      className="btn-ghost px-2"
                      onClick={() =>
                        setRuleForm({
                          ...ruleForm,
                          recipients: ruleForm.recipients.filter((_, i) => i !== index),
                        })
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                className="btn-ghost text-sm"
                onClick={() => setRuleForm({ ...ruleForm, recipients: [...ruleForm.recipients, ''] })}
              >
                + Ajouter un email
              </button>
            </div>
            <div>
              <label className="mb-2 block text-sm">Serveurs (vide = tous)</label>
              <div className="flex flex-wrap gap-2">
                {servers.map((server) => {
                  const selected = ruleForm.serverIds?.includes(server.id);
                  return (
                    <button
                      key={server.id}
                      type="button"
                      onClick={() => toggleServer(server.id)}
                      className={cn(
                        'rounded-lg border px-3 py-1.5 text-sm transition-colors',
                        selected
                          ? 'border-primary bg-primary/15 text-primary'
                          : 'border-white/10 text-muted-foreground hover:border-white/20',
                      )}
                    >
                      {server.name}
                    </button>
                  );
                })}
                {servers.length === 0 && (
                  <span className="text-sm text-muted-foreground">Aucun serveur</span>
                )}
              </div>
            </div>
            <div>
              <label className="mb-2 block text-sm">Sévérités (vide = toutes)</label>
              <div className="flex flex-wrap gap-2">
                {severityOptions.map((option) => {
                  const selected = ruleForm.severities?.includes(option.id);
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => toggleSeverity(option.id)}
                      className={cn(
                        'rounded-lg border px-3 py-1.5 text-sm transition-colors',
                        selected
                          ? 'border-primary bg-primary/15 text-primary'
                          : 'border-white/10 text-muted-foreground hover:border-white/20',
                      )}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={ruleForm.notifyOnCreate}
                  onChange={(e) => setRuleForm({ ...ruleForm, notifyOnCreate: e.target.checked })}
                />
                Nouvelle alerte
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={ruleForm.notifyOnOccurrence}
                  onChange={(e) => setRuleForm({ ...ruleForm, notifyOnOccurrence: e.target.checked })}
                />
                Nouvelle occurrence
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={ruleForm.enabled}
                  onChange={(e) => setRuleForm({ ...ruleForm, enabled: e.target.checked })}
                />
                Règle active
              </label>
            </div>
            {ruleError && <p className="text-sm text-destructive">{ruleError}</p>}
            <div className="flex gap-2">
              <button type="submit" className="btn-primary" disabled={savingRule}>
                {savingRule ? 'Enregistrement…' : 'Enregistrer'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setShowRuleForm(false)}>
                Annuler
              </button>
            </div>
          </form>
        )}

        {rules.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Aucune règle configurée.</p>
        ) : (
          <div className="space-y-3">
            {rules.map((rule) => (
              <div key={rule.id} className="rounded-lg border border-white/5 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{rule.name}</h3>
                      <span
                        className={cn(
                          'rounded px-2 py-0.5 text-xs',
                          rule.enabled ? 'bg-success/15 text-success' : 'bg-secondary text-muted-foreground',
                        )}
                      >
                        {rule.enabled ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      → {rule.recipients.join(', ')}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Serveurs :{' '}
                      {rule.serverIds.length
                        ? rule.serverIds
                            .map((id) => servers.find((s) => s.id === id)?.name ?? id)
                            .join(', ')
                        : 'Tous'}
                      {' · '}
                      Sévérités :{' '}
                      {rule.severities.length
                        ? rule.severities.join(', ')
                        : 'Toutes'}
                      {' · '}
                      {rule.notifyOnCreate ? 'Création' : ''}
                      {rule.notifyOnCreate && rule.notifyOnOccurrence ? ', ' : ''}
                      {rule.notifyOnOccurrence ? 'Occurrence' : ''}
                    </p>
                  </div>
                  {isAdmin && (
                    <div className="flex shrink-0 gap-1">
                      <button type="button" onClick={() => openEditRule(rule)} className="btn-ghost p-2">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => handleDeleteRule(rule.id)} className="btn-ghost p-2 text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
