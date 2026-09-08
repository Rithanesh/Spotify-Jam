'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from './api';

export interface CurrentUser {
  id: number;
  username: string;
  role: 'admin' | 'member';
  display_name: string | null;
  must_change_password: boolean;
}

/**
 * Every real page uses this instead of calling /api/auth/me directly —
 * one place enforces "no token -> login" and "must change password ->
 * change-password screen" so a direct URL visit can't skip either.
 */
export function useAuthGuard(): { user: CurrentUser | null } {
  const [user, setUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      window.location.href = '/login/';
      return;
    }
    apiFetch('/api/auth/me')
      .then((u: CurrentUser) => {
        if (u.must_change_password && window.location.pathname !== '/change-password/') {
          window.location.href = '/change-password/';
          return;
        }
        setUser(u);
      })
      .catch(() => {
        localStorage.removeItem('access_token');
        window.location.href = '/login/';
      });
  }, []);

  return { user };
}
