'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type User } from '@/lib/api';
import { can, type PermissionAction, type PermissionResource } from '@/lib/permissions';

export function useAuthProfile() {
  const [profile, setProfile] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    return api
      .getProfile()
      .then(setProfile)
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const hasPermission = useCallback(
    (resource: PermissionResource, action: PermissionAction) =>
      can(profile?.permissions, resource, action, profile?.role),
    [profile],
  );

  return { profile, loading, refresh, hasPermission };
}
