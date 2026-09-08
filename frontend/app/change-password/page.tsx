'use client';

import { useState } from 'react';
import { apiFetch } from '../../lib/api';

export default function ChangePasswordPage() {
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (newPassword !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'PATCH',
        body: JSON.stringify({ new_password: newPassword }),
      });
      window.location.href = '/queue/';
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
      <div className="card" style={{ padding: 32, width: 360 }}>
        <h1 className="heading" style={{ fontSize: 22, marginBottom: 4 }}>Set a new password</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24 }}>
          Please choose a new personal password to secure your account before continuing.
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            placeholder="New password (min 8 characters)"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
          />
          <input
            placeholder="Confirm new password"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
          {error && <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{error}</p>}
          <button className="btn-primary" type="submit" disabled={busy}>
            Set password and continue
          </button>
        </form>
      </div>
    </div>
  );
}
