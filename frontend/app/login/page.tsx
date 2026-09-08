'use client';

import { useState } from 'react';
import { apiFetch } from '../../lib/api';

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register' | 'invite'>('login');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: username.trim(), password }),
      });
      localStorage.setItem('access_token', res.access_token);
      window.location.href = res.must_change_password ? '/change-password/' : '/queue/';
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), username: username.trim(), password }),
      });
      localStorage.setItem('access_token', res.access_token);
      window.location.href = '/queue/';
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRedeem(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch('/api/auth/redeem-invite', {
        method: 'POST',
        body: JSON.stringify({
          invite_code: inviteCode.trim(),
          username: username.trim(),
          password,
          display_name: name.trim() || undefined,
        }),
      });
      localStorage.setItem('access_token', res.access_token);
      window.location.href = '/queue/';
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const onSubmit = mode === 'register' ? handleRegister : mode === 'login' ? handleLogin : handleRedeem;

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', padding: 20 }}>
      <div className="card" style={{ padding: 32, width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <span style={{ fontSize: 32 }}>🎵</span>
          <h1 className="heading" style={{ fontSize: 24, margin: '8px 0 4px' }}>Spotify Jam</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
            {mode === 'register'
              ? 'Create your account to join the jam and add songs!'
              : mode === 'login'
              ? 'Sign in to add songs to the playback queue.'
              : 'Enter the invite code issued by your host.'}
          </p>
        </div>

        {/* Tab switcher: Sign In first, Create Account second */}
        <div
          style={{
            display: 'flex',
            background: 'var(--surface-raised)',
            borderRadius: 8,
            padding: 4,
            marginBottom: 20,
            border: '1px solid var(--border)',
          }}
        >
          <button
            type="button"
            onClick={() => { setMode('login'); setError(''); }}
            style={{
              flex: 1,
              padding: '6px 0',
              borderRadius: 6,
              border: 'none',
              fontSize: 13,
              fontWeight: 600,
              background: mode === 'login' ? 'var(--accent)' : 'transparent',
              color: mode === 'login' ? 'var(--accent-text)' : 'var(--text-muted)',
              transition: 'all 0.15s ease',
            }}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => { setMode('register'); setError(''); }}
            style={{
              flex: 1,
              padding: '6px 0',
              borderRadius: 6,
              border: 'none',
              fontSize: 13,
              fontWeight: 600,
              background: mode === 'register' ? 'var(--accent)' : 'transparent',
              color: mode === 'register' ? 'var(--accent-text)' : 'var(--text-muted)',
              transition: 'all 0.15s ease',
            }}
          >
            Create Account
          </button>
        </div>

        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {mode === 'invite' && (
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                Invite Code
              </label>
              <input
                placeholder="Paste your invite code"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                required
                style={{ width: '100%' }}
              />
            </div>
          )}

          {(mode === 'register' || mode === 'invite') && (
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                Your Name
              </label>
              <input
                placeholder="e.g. Alex"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                style={{ width: '100%' }}
              />
            </div>
          )}

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
              Username
            </label>
            <input
              placeholder="e.g. alex99"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoCapitalize="none"
              style={{ width: '100%' }}
            />
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
              Password
            </label>
            <input
              placeholder="Create a password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={4}
              style={{ width: '100%' }}
            />
          </div>

          {error && (
            <p
              style={{
                color: 'var(--danger)',
                fontSize: 13,
                margin: 0,
                background: 'rgba(255, 92, 114, 0.1)',
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid rgba(255, 92, 114, 0.2)',
              }}
            >
              {error}
            </p>
          )}

          <button className="btn-primary" type="submit" disabled={busy} style={{ width: '100%', marginTop: 4 }}>
            {busy
              ? 'Please wait…'
              : mode === 'register'
              ? 'Join Jam & Setup Account'
              : mode === 'login'
              ? 'Sign in'
              : 'Redeem Invite'}
          </button>
        </form>

        <div style={{ marginTop: 16, textAlign: 'center' }}>
          {mode !== 'invite' ? (
            <button
              type="button"
              className="btn-ghost"
              style={{ width: '100%', fontSize: 12, padding: '6px 12px' }}
              onClick={() => { setMode('invite'); setError(''); }}
            >
              Have a private invite code? Click here
            </button>
          ) : (
            <button
              type="button"
              className="btn-ghost"
              style={{ width: '100%', fontSize: 12, padding: '6px 12px' }}
              onClick={() => { setMode('register'); setError(''); }}
            >
              ← Back to registration
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
