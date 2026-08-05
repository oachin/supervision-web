'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Lock, ShieldCheck, KeyRound } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';
import { api } from '@/lib/api';

type Step = 'loading' | 'password' | 'totp' | 'backup' | 'done' | 'error';

export default function InvitePage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const router = useRouter();

  const [step, setStep] = useState<Step>('loading');
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    api
      .getInviteInfo(token)
      .then(async (info) => {
        setEmail(info.email);
        setFirstName(info.firstName);
        if (info.step === 'done') {
          setStep('done');
          return;
        }
        if (info.step === 'totp') {
          const resumed = await api.resumeInvite(token);
          setInviteToken(resumed.inviteToken);
          const totp = await api.setupInviteTotp(resumed.inviteToken);
          setQrCode(totp.qrCode);
          setSecret(totp.secret);
          setStep('totp');
          return;
        }
        setStep('password');
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Lien invalide');
        setStep('error');
      });
  }, [token]);

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password !== passwordConfirm) {
      setError('Les mots de passe ne correspondent pas');
      return;
    }
    if (password.length < 12) {
      setError('Le mot de passe doit contenir au moins 12 caractères');
      return;
    }
    setLoading(true);
    try {
      const result = await api.completeInvitePassword(token, password);
      setInviteToken(result.inviteToken);
      const totp = await api.setupInviteTotp(result.inviteToken);
      setQrCode(totp.qrCode);
      setSecret(totp.secret);
      setStep('totp');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setLoading(false);
    }
  }

  async function handleTotp(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteToken) return;
    setError('');
    setLoading(true);
    try {
      const result = await api.enableInviteTotp(inviteToken, totpCode);
      setBackupCodes(result.backupCodes ?? []);
      setStep('backup');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Code invalide');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <BrandLogo size="lg" className="mb-5 justify-center" />
          <h1 className="text-xl font-semibold tracking-tight">Activation du compte</h1>
          {email && (
            <p className="mt-2 text-sm text-muted-foreground">
              {firstName ? `${firstName} · ` : ''}
              {email}
            </p>
          )}
        </div>

        <div className="card space-y-4">
          {step === 'loading' && (
            <p className="text-center text-sm text-muted-foreground">Vérification du lien…</p>
          )}

          {step === 'error' && (
            <p className="text-center text-sm text-destructive">{error}</p>
          )}

          {step === 'done' && (
            <div className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground">Ce compte est déjà activé.</p>
              <button type="button" className="btn-primary w-full" onClick={() => router.push('/login')}>
                Se connecter
              </button>
            </div>
          )}

          {step === 'password' && (
            <form onSubmit={handlePassword} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Choisissez un mot de passe (12 caractères minimum), puis configurez la 2FA.
              </p>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Mot de passe</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="password"
                    className="input pl-10"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={12}
                    autoComplete="new-password"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Confirmation</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="password"
                    className="input pl-10"
                    value={passwordConfirm}
                    onChange={(e) => setPasswordConfirm(e.target.value)}
                    required
                    minLength={12}
                    autoComplete="new-password"
                  />
                </div>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <button type="submit" disabled={loading} className="btn-primary w-full">
                {loading ? 'Enregistrement…' : 'Continuer'}
              </button>
            </form>
          )}

          {step === 'totp' && (
            <form onSubmit={handleTotp} className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Configurer l’authentification 2FA
              </div>
              <p className="text-sm text-muted-foreground">
                Scannez ce QR code avec votre application (Google Authenticator, 1Password, etc.).
              </p>
              {qrCode && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrCode} alt="QR 2FA" className="mx-auto rounded-lg bg-white p-2" />
              )}
              {secret && (
                <p className="break-all text-center font-mono text-xs text-muted-foreground">
                  Clé manuelle : {secret}
                </p>
              )}
              <div>
                <label className="mb-1.5 block text-sm font-medium">Code à 6 chiffres</label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    className="input pl-10 tracking-widest"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    required
                    minLength={6}
                    maxLength={6}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                  />
                </div>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <button type="submit" disabled={loading || totpCode.length !== 6} className="btn-primary w-full">
                {loading ? 'Validation…' : 'Activer la 2FA'}
              </button>
            </form>
          )}

          {step === 'backup' && (
            <div className="space-y-4">
              <p className="text-sm font-medium text-emerald-400">Compte activé</p>
              <p className="text-sm text-muted-foreground">
                Conservez ces codes de secours en lieu sûr. Ils ne seront plus affichés.
              </p>
              <ul className="grid grid-cols-2 gap-2 rounded-lg border border-white/10 bg-secondary/20 p-3 font-mono text-xs">
                {backupCodes.map((code) => (
                  <li key={code}>{code}</li>
                ))}
              </ul>
              <button
                type="button"
                className="btn-primary w-full"
                onClick={() => router.push('/dashboard')}
              >
                Accéder à la plateforme
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
