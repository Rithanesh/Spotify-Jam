'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { apiFetch } from '../lib/api';

interface User {
  id: number;
  username: string;
  role: 'admin' | 'member';
  display_name?: string | null;
}

interface NavbarProps {
  user: User;
}

export default function Navbar({ user }: NavbarProps) {
  const pathname = usePathname() || '';

  async function handleSignOut() {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    localStorage.removeItem('access_token');
    window.location.href = '/login/';
  }

  const isQueue = pathname.includes('/queue');
  const isDashboard = pathname.includes('/dashboard');
  const isSettings = pathname.includes('/settings');

  return (
    <header
      style={{
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}
    >
      <div
        style={{
          maxWidth: 720,
          margin: '0 auto',
          padding: '12px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18 }}>🎵</span>
            <span
              style={{
                fontFamily: "'Space Grotesk', sans-serif",
                fontWeight: 700,
                fontSize: 16,
                letterSpacing: '-0.02em',
              }}
            >
              Spotify Jam
            </span>
          </div>

          <nav style={{ display: 'flex', gap: 6 }}>
            <Link
              href="/queue/"
              style={{
                textDecoration: 'none',
                padding: '6px 12px',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                color: isQueue ? 'var(--accent-text)' : 'var(--text-muted)',
                background: isQueue ? 'var(--accent)' : 'transparent',
                transition: 'all 0.15s ease',
              }}
            >
              Queue
            </Link>

            <Link
              href="/dashboard/"
              style={{
                textDecoration: 'none',
                padding: '6px 12px',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                color: isDashboard ? 'var(--accent-text)' : 'var(--text-muted)',
                background: isDashboard ? 'var(--accent)' : 'transparent',
                transition: 'all 0.15s ease',
              }}
            >
              Dashboard
            </Link>

            {user.role === 'admin' && (
              <Link
                href="/settings/"
                style={{
                  textDecoration: 'none',
                  padding: '6px 12px',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  color: isSettings ? 'var(--accent-text)' : 'var(--text-muted)',
                  background: isSettings ? 'var(--accent)' : 'transparent',
                  transition: 'all 0.15s ease',
                }}
              >
                Settings
              </Link>
            )}
          </nav>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <span style={{ color: 'var(--text-muted)' }}>{user.display_name || user.username}</span>
            <span
              style={{
                background: user.role === 'admin' ? 'rgba(124, 92, 255, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                color: user.role === 'admin' ? 'var(--accent)' : 'var(--text-muted)',
                padding: '2px 6px',
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 700,
                textTransform: 'uppercase',
              }}
            >
              {user.role}
            </span>
          </div>

          <button
            onClick={handleSignOut}
            className="btn-ghost"
            style={{
              padding: '4px 10px',
              fontSize: 12,
              borderRadius: 6,
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
