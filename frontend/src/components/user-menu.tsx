'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, LogOut, Settings, Users } from 'lucide-react';
import { api, type User } from '@/lib/api';
import { cn } from '@/lib/utils';
import { AccountSettingsPanel } from '@/components/account-settings';

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function UserMenu() {
  const [profile, setProfile] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.getProfile().then(setProfile).catch(console.error);
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  const isAdmin = profile?.role === 'ADMIN';

  return (
    <>
      <div ref={menuRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm transition-colors hover:bg-secondary/50',
            open && 'bg-secondary/50',
          )}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary">
            {profile ? initials(profile.name) : '…'}
          </span>
          <span className="hidden max-w-[140px] truncate sm:block">{profile?.name ?? 'Chargement…'}</span>
          <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </button>

        {open && (
          <div className="absolute right-0 top-full z-[60] mt-2 w-64 rounded-lg border border-white/10 bg-card py-2 shadow-xl">
            {profile && (
              <div className="border-b border-white/5 px-4 pb-3 pt-1">
                <p className="font-medium truncate">{profile.name}</p>
                <p className="text-xs text-muted-foreground truncate">{profile.email}</p>
                <p className="mt-1 text-xs text-muted-foreground">{profile.role}</p>
              </div>
            )}

            <div className="py-1">
              <button
                type="button"
                onClick={() => { setAccountOpen(true); setOpen(false); }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-secondary/50"
              >
                <Settings className="h-4 w-4 text-muted-foreground" />
                Mon compte
              </button>

              {isAdmin && (
                <Link
                  href="/users"
                  onClick={() => setOpen(false)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-secondary/50"
                >
                  <Users className="h-4 w-4 text-muted-foreground" />
                  Gestion utilisateurs
                </Link>
              )}

              <button
                type="button"
                onClick={() => api.logout()}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-destructive hover:bg-destructive/10"
              >
                <LogOut className="h-4 w-4" />
                Déconnexion
              </button>
            </div>
          </div>
        )}
      </div>

      <AccountSettingsPanel open={accountOpen} onClose={() => setAccountOpen(false)} />
    </>
  );
}
