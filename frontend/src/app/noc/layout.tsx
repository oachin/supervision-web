'use client';

import { AuthGuard } from '@/components/auth-guard';
import { AlertProvider } from '@/components/alert-provider';

export default function NocLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <AlertProvider>
        <div className="h-screen overflow-hidden bg-[#060a12] text-foreground">{children}</div>
      </AlertProvider>
    </AuthGuard>
  );
}
