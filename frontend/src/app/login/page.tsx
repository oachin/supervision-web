'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, Lock, KeyRound } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';
import { api } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [tempToken, setTempToken] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await api.login(email, password);
      if (result.requiresTotp && result.tempToken) {
        setTempToken(result.tempToken);
      } else if (result.accessToken && result.refreshToken) {
        api.saveTokens({
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresIn: result.expiresIn!,
        });
        router.push('/dashboard');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de connexion');
    } finally {
      setLoading(false);
    }
  }

  async function handleTotp(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.verifyTotp(tempToken!, totpCode);
      router.push('/dashboard');
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
          <BrandLogo size="lg" className="mx-auto mb-5" />
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Console de Supervision - Connectez-vous
          </h1>
        </div>

        <div className="card">
          {!tempToken ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="email"
                    className="input pl-10"
                    placeholder="admin@votredomaine.fr"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Mot de passe</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="password"
                    className="input pl-10"
                    placeholder="••••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                  />
                </div>
              </div>
              {error && (
                <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
              )}
              <button type="submit" className="btn-primary w-full" disabled={loading}>
                {loading ? 'Connexion...' : 'Se connecter'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleTotp} className="space-y-4">
              <div className="text-center">
                <KeyRound className="mx-auto h-8 w-8 text-primary" />
                <h2 className="mt-2 text-lg font-semibold">Vérification 2FA</h2>
                <p className="text-sm text-muted-foreground">
                  Entrez le code de votre application d&apos;authentification
                </p>
              </div>
              <input
                type="text"
                className="input text-center font-mono text-lg tracking-[0.5em]"
                placeholder="000000"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                maxLength={6}
                required
                autoFocus
              />
              {error && (
                <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
              )}
              <button type="submit" className="btn-primary w-full" disabled={loading || totpCode.length < 6}>
                {loading ? 'Vérification...' : 'Vérifier'}
              </button>
              <button
                type="button"
                className="btn-ghost w-full text-sm"
                onClick={() => { setTempToken(null); setTotpCode(''); }}
              >
                Retour
              </button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Connexion sécurisée · Chiffrement TLS · 2FA disponible
        </p>
      </div>
    </div>
  );
}
