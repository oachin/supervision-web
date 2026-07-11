'use client';

import { AuthGuard } from '@/components/auth-guard';
import { Sidebar } from '@/components/sidebar';
import { UserMenu } from '@/components/user-menu';
import { AlertProvider } from '@/components/alert-provider';
import { AlertBanner } from '@/components/alert-banner';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <AlertProvider>
        <Sidebar />
        <main className="ml-64 min-h-screen flex flex-col">
          <div className="sticky top-0 z-30 shrink-0 border-b border-white/5 bg-background/80 backdrop-blur-md">
            <div className="flex min-h-14">
              <div className="flex min-w-0 flex-1 flex-col justify-center">
                <AlertBanner />
              </div>
              <div className="flex shrink-0 items-center border-l border-white/5 px-6">
                <UserMenu />
              </div>
            </div>
          </div>
          <div className="flex-1 p-8">{children}</div>
        </main>
      </AlertProvider>
    </AuthGuard>
  );
}
