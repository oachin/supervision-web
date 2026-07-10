'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { api } from '@/lib/api';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!api.isAuthenticated() && !pathname.startsWith('/login')) {
      router.replace('/login');
    }
  }, [router, pathname]);

  if (!api.isAuthenticated()) return null;
  return <>{children}</>;
}
