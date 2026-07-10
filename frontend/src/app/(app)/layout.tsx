'use client';

import { AuthGuard } from '@/components/auth-guard';
import { Sidebar } from '@/components/sidebar';
import { AlertProvider } from '@/components/alert-provider';
import { AlertBanner } from '@/components/alert-banner';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <AlertProvider>
        <Sidebar />
        <main className="ml-64 min-h-screen">
          <AlertBanner />
          <div className="p-8">{children}</div>
        </main>
      </AlertProvider>
    </AuthGuard>
  );
}
