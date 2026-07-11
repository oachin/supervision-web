'use client';

import { AuthGuard } from '@/components/auth-guard';
import { AlertProvider } from '@/components/alert-provider';

export default function NocLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <AlertProvider>
        <div className="min-h-screen bg-background text-foreground">{children}</div>
      </AlertProvider>
    </AuthGuard>
  );
}
