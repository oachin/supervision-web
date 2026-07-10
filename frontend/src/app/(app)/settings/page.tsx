'use client';

import { useEffect, useState } from 'react';
import { Shield, KeyRound } from 'lucide-react';
import { api, type User } from '@/lib/api';

export default function SettingsPage() {
  const [profile, setProfile] = useState<User | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [passwords, setPasswords] = useState({ current: '', new: '' });
  const [message, setMessage] = useState('');

  useEffect(() => { api.getProfile().then(setProfile); }, []);

  async function setup2FA() {
    const result = await api.setupTotp();
    setQrCode(result.qrCode);
  }

  async function enable2FA() {
    const result = await api.enableTotp(totpCode);
    setBackupCodes(result.backupCodes);
    setQrCode(null);
    setTotpCode('');
    api.getProfile().then(setProfile);
    setMessage('2FA activée avec succès');
  }

  async function disable2FA() {
    const pwd = prompt('Entrez votre mot de passe pour désactiver la 2FA:');
    if (!pwd) return;
    await api.disableTotp(pwd);
    api.getProfile().then(setProfile);
    setMessage('2FA désactivée');
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    await api.changePassword(passwords.current, passwords.new);
    setPasswords({ current: '', new: '' });
    setMessage('Mot de passe modifié');
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Paramètres</h1>
        <p className="text-sm text-muted-foreground">Sécurité du compte</p>
      </div>

      {message && (
        <div className="rounded-lg bg-accent/10 px-4 py-3 text-sm text-accent">{message}</div>
      )}

      {profile && (
        <div className="card">
          <h2 className="mb-4 text-lg font-semibold">Profil</h2>
          <div className="space-y-2 text-sm">
            <p><span className="text-muted-foreground">Nom :</span> {profile.name}</p>
            <p><span className="text-muted-foreground">Email :</span> {profile.email}</p>
            <p><span className="text-muted-foreground">Rôle :</span> {profile.role}</p>
          </div>
        </div>
      )}

      <div className="card">
        <div className="mb-4 flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Authentification à deux facteurs (2FA)</h2>
        </div>

        {profile?.totpEnabled ? (
          <div>
            <p className="text-sm text-accent mb-4">2FA activée sur votre compte</p>
            <button onClick={disable2FA} className="btn-danger">Désactiver la 2FA</button>
          </div>
        ) : qrCode ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Scannez ce QR code avec votre application d&apos;authentification (Google Authenticator, Authy...)</p>
            <img src={qrCode} alt="QR Code 2FA" className="mx-auto rounded-lg" width={200} height={200} />
            <input
              className="input text-center font-mono tracking-[0.5em]"
              placeholder="000000"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              maxLength={6}
            />
            <button onClick={enable2FA} className="btn-primary w-full" disabled={totpCode.length < 6}>
              Activer la 2FA
            </button>
          </div>
        ) : (
          <button onClick={setup2FA} className="btn-primary">
            <KeyRound className="h-4 w-4" /> Configurer la 2FA
          </button>
        )}

        {backupCodes && (
          <div className="mt-4 rounded-lg bg-warning/10 p-4">
            <p className="text-sm font-medium text-warning">Codes de secours (conservez-les en lieu sûr)</p>
            <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-sm">
              {backupCodes.map((c) => <span key={c}>{c}</span>)}
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="mb-4 text-lg font-semibold">Changer le mot de passe</h2>
        <form onSubmit={changePassword} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm">Mot de passe actuel</label>
            <input type="password" className="input" value={passwords.current} onChange={(e) => setPasswords({ ...passwords, current: e.target.value })} required />
          </div>
          <div>
            <label className="mb-1 block text-sm">Nouveau mot de passe (min. 12 caractères)</label>
            <input type="password" className="input" value={passwords.new} onChange={(e) => setPasswords({ ...passwords, new: e.target.value })} required minLength={12} />
          </div>
          <button type="submit" className="btn-primary">Modifier</button>
        </form>
      </div>
    </div>
  );
}
