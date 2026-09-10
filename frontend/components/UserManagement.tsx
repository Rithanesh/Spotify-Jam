'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

interface UserRecord {
  id: number;
  username: string;
  role: 'admin' | 'member';
  display_name: string | null;
  is_active: number;
  is_connected?: boolean;
  created_at: string;
  last_login_at: string | null;
  last_seen_at?: string | null;
}

interface UserStats {
  total_users: number;
  connected_users: number;
  active_users: number;
}

export default function UserManagement() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [stats, setStats] = useState<UserStats>({ total_users: 0, connected_users: 0, active_users: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [resettingId, setResettingId] = useState<number | null>(null);
  const [customPassword, setCustomPassword] = useState('');
  const [resetSuccessInfo, setResetSuccessInfo] = useState<{ username: string; temp_pass: string } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  useEffect(() => {
    loadUsers();
    const timer = setInterval(loadUsers, 10000); // auto-refresh every 10s so admin sees live connections
    return () => clearInterval(timer);
  }, []);

  async function loadUsers() {
    setError('');
    try {
      const data = await apiFetch('/api/users');
      if (data.users && data.stats) {
        setUsers(data.users);
        setStats(data.stats);
      } else if (Array.isArray(data)) {
        setUsers(data);
        setStats({
          total_users: data.length,
          connected_users: data.filter((u: any) => u.is_connected).length,
          active_users: data.filter((u: any) => u.is_active === 1).length,
        });
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword(userId: number) {
    setActionBusy(true);
    setError('');
    setResetSuccessInfo(null);
    try {
      const res = await apiFetch(`/api/users/${userId}/reset-password`, {
        method: 'PATCH',
        body: JSON.stringify({ new_password: customPassword.trim() || undefined }),
      });
      setResetSuccessInfo({
        username: res.username,
        temp_pass: res.temp_password,
      });
      setResettingId(null);
      setCustomPassword('');
      loadUsers();
    } catch (err: any) {
      setError(err.message || 'Failed to reset password');
    } finally {
      setActionBusy(false);
    }
  }

  async function toggleActive(userId: number, currentActive: number) {
    setActionBusy(true);
    try {
      const endpoint = currentActive === 1 ? `/api/users/${userId}/deactivate` : `/api/users/${userId}/activate`;
      await apiFetch(endpoint, { method: 'PATCH' });
      loadUsers();
    } catch (err: any) {
      setError(err.message || 'Failed to change user status');
    } finally {
      setActionBusy(false);
    }
  }

  async function handleDeleteUser(userId: number, username: string) {
    if (!window.confirm(`Are you sure you want to permanently delete @${username}? This cannot be undone.`)) {
      return;
    }
    setActionBusy(true);
    setError('');
    try {
      await apiFetch(`/api/users/${userId}`, { method: 'DELETE' });
      loadUsers();
    } catch (err: any) {
      setError(err.message || 'Failed to delete user');
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <div className="card" style={{ padding: 22 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>Registered Users & Passwords</h3>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
            Manage user accounts, toggle access, and reset passwords if anyone forgets their login credentials.
          </p>
        </div>
        <button className="btn-ghost" onClick={loadUsers} disabled={loading} style={{ padding: '6px 12px', fontSize: 12 }}>
          ↻ Refresh
        </button>
      </div>

      {resetSuccessInfo && (
        <div
          style={{
            background: 'rgba(74, 222, 128, 0.12)',
            border: '1px solid var(--success)',
            color: 'var(--text)',
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          ✅ Password reset for <strong>{resetSuccessInfo.username}</strong>! Temporary password is{' '}
          <code style={{ background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: 4, fontWeight: 'bold' }}>
            {resetSuccessInfo.temp_pass}
          </code>
          . The user will be automatically prompted to set their own new password on their next sign in.
        </div>
      )}

      {error && (
        <div
          style={{
            background: 'rgba(255, 92, 114, 0.1)',
            border: '1px solid var(--danger)',
            color: 'var(--danger)',
            borderRadius: 8,
            padding: '10px 14px',
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {/* Connection & User Stats Bar */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            background: 'var(--surface-raised)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '12px 14px',
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Connected Now
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--success)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12 }}>🟢</span> {stats.connected_users}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Active in last 5 mins</div>
        </div>

        <div
          style={{
            background: 'var(--surface-raised)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '12px 14px',
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Total Users
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent)', marginTop: 4 }}>
            {stats.total_users}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>All registered accounts</div>
        </div>

        <div
          style={{
            background: 'var(--surface-raised)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '12px 14px',
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Active Accounts
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', marginTop: 4 }}>
            {stats.active_users}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Non-deactivated users</div>
        </div>
      </div>

      {loading && users.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading users…</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {users.map((u) => (
            <div
              key={u.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 14px',
                background: 'var(--surface-raised)',
                borderRadius: 8,
                border: u.is_connected ? '1px solid rgba(74, 222, 128, 0.4)' : '1px solid var(--border)',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {u.is_connected ? (
                    <span
                      title="User is connected right now"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: 'rgba(74, 222, 128, 0.15)',
                        color: 'var(--success)',
                        textTransform: 'uppercase',
                      }}
                    >
                      ● Connected
                    </span>
                  ) : (
                    <span
                      title="Offline"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: 10,
                        fontWeight: 600,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: 'rgba(255, 255, 255, 0.05)',
                        color: 'var(--text-muted)',
                        textTransform: 'uppercase',
                      }}
                    >
                      ○ Offline
                    </span>
                  )}
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{u.display_name || u.username}</span>
                  <code style={{ fontSize: 12, color: 'var(--text-muted)' }}>@{u.username}</code>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: u.role === 'admin' ? 'rgba(124, 92, 255, 0.2)' : 'rgba(255,255,255,0.08)',
                      color: u.role === 'admin' ? 'var(--accent)' : 'var(--text-muted)',
                      textTransform: 'uppercase',
                    }}
                  >
                    {u.role}
                  </span>
                  {u.is_active === 0 && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: 'rgba(255, 92, 114, 0.15)',
                        color: 'var(--danger)',
                        textTransform: 'uppercase',
                      }}
                    >
                      Deactivated
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  Joined: {u.created_at ? new Date(u.created_at).toLocaleDateString() : 'N/A'} • Last activity:{' '}
                  {u.last_seen_at || u.last_login_at ? new Date((u.last_seen_at || u.last_login_at)!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Never'}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {resettingId === u.id ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      placeholder="Leave blank for random"
                      value={customPassword}
                      onChange={(e) => setCustomPassword(e.target.value)}
                      style={{ fontSize: 12, padding: '4px 8px', width: 160 }}
                    />
                    <button
                      className="btn-primary"
                      onClick={() => handleResetPassword(u.id)}
                      disabled={actionBusy}
                      style={{ padding: '4px 10px', fontSize: 12 }}
                    >
                      Confirm Reset
                    </button>
                    <button
                      className="btn-ghost"
                      onClick={() => { setResettingId(null); setCustomPassword(''); }}
                      style={{ padding: '4px 8px', fontSize: 12 }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      className="btn-ghost"
                      onClick={() => { setResettingId(u.id); setCustomPassword(''); }}
                      disabled={actionBusy}
                      style={{ padding: '4px 10px', fontSize: 12 }}
                    >
                      🔑 Reset Password
                    </button>
                    {u.role !== 'admin' && (
                      <>
                        <button
                          className="btn-ghost"
                          onClick={() => toggleActive(u.id, u.is_active)}
                          disabled={actionBusy}
                          style={{
                            padding: '4px 10px',
                            fontSize: 12,
                            color: u.is_active === 1 ? 'var(--danger)' : 'var(--success)',
                          }}
                        >
                          {u.is_active === 1 ? 'Deactivate' : 'Activate'}
                        </button>
                        {u.is_active === 0 && (
                          <button
                            className="btn-ghost"
                            onClick={() => handleDeleteUser(u.id, u.username)}
                            disabled={actionBusy}
                            title="Permanently delete this deactivated account"
                            style={{
                              padding: '4px 10px',
                              fontSize: 12,
                              color: 'var(--danger)',
                              background: 'rgba(255, 92, 114, 0.1)',
                              borderColor: 'rgba(255, 92, 114, 0.3)',
                            }}
                          >
                            🗑 Delete
                          </button>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
