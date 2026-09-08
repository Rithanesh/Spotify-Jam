'use client';

import { useEffect } from 'react';
import Loader from '../components/Loader';
import { apiFetch } from '../lib/api';

export default function Home() {
  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      window.location.href = '/login/';
      return;
    }
    apiFetch('/api/auth/me')
      .then((u) => {
        window.location.href = u.must_change_password ? '/change-password/' : '/queue/';
      })
      .catch(() => {
        localStorage.removeItem('access_token');
        window.location.href = '/login/';
      });
  }, []);

  return <Loader label="Tuning in\u2026" />;
}
