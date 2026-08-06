'use client';

import Link from 'next/link';
import { Users, Mail, Shield, ChevronRight, Clock } from 'lucide-react';
import { useAuthProfile } from '@/hooks/use-auth-profile';

const tiles = [
  {
    href: '/settings/general',
    title: 'Fuseau horaire',
    description: 'Fuseau serveur pour les horodatages et les automations',
    icon: Clock,
    resource: 'settings' as const,
  },
  {
    href: '/settings/users',
    title: 'Utilisateurs',
    description: 'Créer et gérer les comptes d’accès à la plateforme',
    icon: Users,
    resource: 'users' as const,
  },
  {
    href: '/settings/profiles',
    title: 'Profils',
    description: 'Droits d’accès aux pages, menus et actions (voir, modifier, supprimer)',
    icon: Shield,
    resource: 'profiles' as const,
  },
  {
    href: '/settings/notifications',
    title: 'SMTP & notifications',
    description: 'Serveur mail et règles d’envoi des alertes',
    icon: Mail,
    resource: 'notifications' as const,
  },
];

export default function SettingsHubPage() {
  const { hasPermission, loading } = useAuthProfile();

  const visibleTiles = tiles.filter(
    (tile) =>
      hasPermission(tile.resource, 'view') ||
      (tile.resource === 'notifications' && hasPermission('settings', 'view')),
  );

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Configuration</h1>
        <p className="text-sm text-muted-foreground">
          Paramètres de la plateforme — fuseau, accès, profils et notifications
        </p>
      </div>

      {visibleTiles.length === 0 ? (
        <div className="card py-10 text-center text-sm text-muted-foreground">
          Aucune section accessible avec votre profil.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visibleTiles.map((tile) => (
            <Link
              key={tile.href}
              href={tile.href}
              className="group card flex flex-col gap-4 transition-colors hover:border-primary/30 hover:bg-primary/5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <tile.icon className="h-5 w-5" />
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </div>
              <div>
                <h2 className="font-semibold">{tile.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{tile.description}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
