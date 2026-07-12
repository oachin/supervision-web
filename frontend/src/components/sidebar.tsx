'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Server,
  Globe,
  Bell,
  ScrollText,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SystemStatus } from '@/components/system-status';
import { BrandLogo } from '@/components/brand-logo';

const navItems = [
  { href: '/dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
  { href: '/servers', label: 'Serveurs', icon: Server },
  { href: '/websites', label: 'Sites web', icon: Globe },
  { href: '/alerts', label: 'Alertes', icon: Bell },
  { href: '/events', label: 'Évènements', icon: ScrollText },
  { href: '/settings', label: 'Configuration', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-white/5 bg-card/60 backdrop-blur-xl">
      <div className="border-b border-white/5 px-6 py-5">
        <BrandLogo size="sm" />
        <p className="mt-2 text-xs text-muted-foreground">Console de Supervision</p>
      </div>

      <SystemStatus />

      <nav className="flex-1 space-y-1 p-4">
        {navItems.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
                active
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
