'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Server,
  Boxes,
  Globe,
  Bell,
  ScrollText,
  Settings,
  Activity,
  Shield,
  Crosshair,
  ChevronDown,
  TrendingUp,
  FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SystemStatus } from '@/components/system-status';
import { BrandLogo } from '@/components/brand-logo';
import { useAuthProfile } from '@/hooks/use-auth-profile';
import type { PermissionResource } from '@/lib/permissions';

const topItems = [
  { href: '/dashboard', label: 'Tableau de bord', icon: LayoutDashboard, resource: 'dashboard' as const },
];

const supervisionItems = [
  { href: '/servers', label: 'Serveurs', icon: Server, resource: 'servers' as const },
  { href: '/vms', label: 'VMs', icon: Boxes, resource: 'vms' as const },
  { href: '/websites', label: 'Sites web', icon: Globe, resource: 'websites' as const },
  { href: '/alerts', label: 'Alertes', icon: Bell, resource: 'alerts' as const },
  { href: '/events', label: 'Évènements', icon: ScrollText, resource: 'events' as const },
];

const cyberItems = [
  { href: '/cybersecurite', label: 'Audit web', icon: Shield, resource: 'cybersecurity' as const },
  { href: '/cybersecurite/evolution', label: 'Évolution du score', icon: TrendingUp, resource: 'cybersecurity' as const },
  { href: '/cybersecurite/rapport', label: 'Rapport', icon: FileText, resource: 'cybersecurity' as const },
  { href: '/cybersecurite/cibles', label: 'Cibles', icon: Crosshair, resource: 'cybersecurity' as const },
];

const bottomItems = [
  { href: '/settings', label: 'Configuration', icon: Settings, resource: 'settings' as const },
];

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  nested,
}: {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  active: boolean;
  nested?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-3 rounded-lg py-2.5 text-sm font-medium transition-all',
        nested ? 'px-3 pl-9' : 'px-3',
        active
          ? 'bg-primary/15 text-primary'
          : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </Link>
  );
}

function CollapsibleGroup({
  label,
  icon: Icon,
  open,
  onToggle,
  active,
  children,
}: {
  label: string;
  icon: typeof LayoutDashboard;
  open: boolean;
  onToggle: () => void;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="pt-1">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
          active
            ? 'text-foreground'
            : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
        )}
        aria-expanded={open}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left">{label}</span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 transition-transform',
            open ? 'rotate-0' : '-rotate-90',
          )}
        />
      </button>
      {open && <div className="mt-1 space-y-1">{children}</div>}
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { hasPermission, loading } = useAuthProfile();

  const canView = (resource: PermissionResource) =>
    hasPermission(resource, 'view') ||
    (resource === 'settings' &&
      (hasPermission('users', 'view') ||
        hasPermission('profiles', 'view') ||
        hasPermission('notifications', 'view')));

  const visibleTop = topItems.filter((item) => canView(item.resource));
  const visibleSupervision = supervisionItems.filter((item) => canView(item.resource));
  const visibleCyber = cyberItems.filter((item) => canView(item.resource));
  const visibleBottom = bottomItems.filter((item) => canView(item.resource));

  const supervisionActive = visibleSupervision.some((item) => pathname.startsWith(item.href));
  const cyberActive = pathname.startsWith('/cybersecurite');
  const [supervisionOpen, setSupervisionOpen] = useState(supervisionActive);
  const [cyberOpen, setCyberOpen] = useState(cyberActive);

  useEffect(() => {
    if (supervisionActive) setSupervisionOpen(true);
  }, [supervisionActive]);

  useEffect(() => {
    if (cyberActive) setCyberOpen(true);
  }, [cyberActive]);

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-white/5 bg-card/60 backdrop-blur-xl">
      <div className="border-b border-white/5 px-6 py-5">
        <BrandLogo size="sm" />
        <p className="mt-2 text-xs leading-snug text-muted-foreground">
          Centre de Supervision & Cybersécurité
        </p>
      </div>

      <SystemStatus />

      <nav className="flex-1 space-y-1 overflow-y-auto p-4">
        {loading ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">Chargement…</div>
        ) : (
          <>
            {visibleTop.map((item) => (
              <NavLink
                key={item.href}
                {...item}
                active={pathname.startsWith(item.href)}
              />
            ))}

            {visibleSupervision.length > 0 && (
              <CollapsibleGroup
                label="Supervision"
                icon={Activity}
                open={supervisionOpen}
                onToggle={() => setSupervisionOpen((o) => !o)}
                active={supervisionActive}
              >
                {visibleSupervision.map((item) => (
                  <NavLink
                    key={item.href}
                    {...item}
                    nested
                    active={pathname.startsWith(item.href)}
                  />
                ))}
              </CollapsibleGroup>
            )}

            {visibleCyber.length > 0 && (
              <CollapsibleGroup
                label="Cybersécurité"
                icon={Shield}
                open={cyberOpen}
                onToggle={() => setCyberOpen((o) => !o)}
                active={cyberActive}
              >
                {visibleCyber.map((item) => (
                  <NavLink
                    key={item.href}
                    {...item}
                    nested
                    active={
                      item.href === '/cybersecurite'
                        ? pathname === '/cybersecurite'
                        : pathname.startsWith(item.href)
                    }
                  />
                ))}
              </CollapsibleGroup>
            )}

            {visibleBottom.map((item) => (
              <NavLink
                key={item.href}
                {...item}
                active={pathname.startsWith(item.href)}
              />
            ))}
          </>
        )}
      </nav>
    </aside>
  );
}
