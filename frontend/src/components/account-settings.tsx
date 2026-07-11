'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Shield, KeyRound, X } from 'lucide-react';
import { api, type User } from '@/lib/api';

export function AccountSettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [profile, setProfile] = useState<User | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [passwords, setPasswords] = useState({ current: '', new: '' });
  const [message, setMessage] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (open) {
      api.getProfile().then(setProfile);
      setMessage('');
      setQrCode(null);
      setTotpCode('');
      setBackupCodes(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open || !mounted) return null;

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

  return createPortal(
    <>
      <div className="fixed inset-0 z-[100] bg-black/50" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-[100] flex h-full w-full max-w-md flex-col border-l border-white/10 bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">Mon compte</h2>
            <p className="text-xs text-muted-foreground">Sécurité et profil</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary/50">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {message && (
            <div className="rounded-lg bg-accent/10 px-4 py-3 text-sm text-accent">{message}</div>
          )}

          {profile && (
            <div className="rounded-lg border border-white/5 p-4">
              <h3 className="mb-3 text-sm font-semibold">Profil</h3>
              <div className="space-y-2 text-sm">
                <p><span className="text-muted-foreground">Nom :</span> {profile.name}</p>
                <p><span className="text-muted-foreground">Email :</span> {profile.email}</p>
                <p><span className="text-muted-foreground">Rôle :</span> {profile.role}</p>
              </div>
            </div>
          )}

          <div className="rounded-lg border border-white/5 p-4">
            <div className="mb-3 flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Authentification 2FA</h3>
            </div>

            {profile?.totpEnabled ? (
              <div>
                <p className="mb-3 text-sm text-accent">2FA activée</p>
                <button type="button" onClick={disable2FA} className="btn-danger text-sm">Désactiver la 2FA</button>
              </div>
            ) : qrCode ? (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">Scannez ce QR code avec votre application d&apos;authentification</p>
                <img src={qrCode} alt="QR Code 2FA" className="mx-auto rounded-lg" width={160} height={160} />
                <input
                  className="input text-center font-mono tracking-[0.5em]"
                  placeholder="000000"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  maxLength={6}
                />
                <button type="button" onClick={enable2FA} className="btn-primary w-full text-sm" disabled={totpCode.length < 6}>
                  Activer la 2FA
                </button>
              </div>
            ) : (
              <button type="button" onClick={setup2FA} className="btn-primary text-sm">
                <KeyRound className="h-4 w-4" /> Configurer la 2FA
              </button>
            )}

            {backupCodes && (
              <div className="mt-3 rounded-lg bg-warning/10 p-3">
                <p className="text-xs font-medium text-warning">Codes de secours</p>
                <div className="mt-2 grid grid-cols-2 gap-1 font-mono text-xs">
                  {backupCodes.map((c) => <span key={c}>{c}</span>)}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-white/5 p-4">
            <h3 className="mb-3 text-sm font-semibold">Changer le mot de passe</h3>
            <form onSubmit={changePassword} className="space-y-3">
              <div>
                <label className="mb-1 block text-xs">Mot de passe actuel</label>
                <input type="password" className="input" value={passwords.current} onChange={(e) => setPasswords({ ...passwords, current: e.target.value })} required />
              </div>
              <div>
                <label className="mb-1 block text-xs">Nouveau mot de passe (min. 12 car.)</label>
                <input type="password" className="input" value={passwords.new} onChange={(e) => setPasswords({ ...passwords, new: e.target.value })} required minLength={12} />
              </div>
              <button type="submit" className="btn-primary text-sm">Modifier</button>
            </form>
          </div>
        </div>
      </aside>
    </>,
    document.body,
  );
}
