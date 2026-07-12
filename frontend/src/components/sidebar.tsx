'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Server,
  Globe,
  Bell,
  Shield,
  ScrollText,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SystemStatus } from '@/components/system-status';

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
      <div className="flex items-center gap-3 border-b border-white/5 px-6 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/20">
          <Shield className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-sm font-semibold tracking-tight">Havet Supervision</h1>
          <p className="text-xs text-muted-foreground">Monitoring Pro</p>
        </div>
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
