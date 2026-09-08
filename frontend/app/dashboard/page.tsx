'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import Loader from '../../components/Loader';
import Navbar from '../../components/Navbar';
import { useAuthGuard } from '../../lib/useAuthGuard';

export default function DashboardPage() {
  const { user: me } = useAuthGuard();
  const [myStats, setMyStats] = useState<{ day: string; count: number }[] | null>(null);
  const [adminStats, setAdminStats] = useState<{ username: string; day: string; count: number }[] | null>(null);
  const [userStats, setUserStats] = useState<{ total_users: number; connected_users: number; active_users: number } | null>(null);

  useEffect(() => {
    if (!me) return;
    apiFetch('/api/logs/dashboard/me').then(setMyStats);
    if (me.role === 'admin') {
      apiFetch('/api/logs/dashboard/admin').then(setAdminStats);
      apiFetch('/api/users').then((data) => {
        if (data.stats) setUserStats(data.stats);
      });
    }
  }, [me]);

  if (!me || myStats === null) return <Loader label="Crunching the numbers…" />;

  const totalMine = myStats.reduce((sum, r) => sum + r.count, 0);

  return (
    <div>
      <Navbar user={me} />
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '32px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <h1 className="heading" style={{ fontSize: 24, margin: 0 }}>My Dashboard</h1>

        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ margin: '0 0 4px' }}>Your requests</h3>
          <p style={{ margin: '0 0 16px', color: 'var(--text-muted)', fontSize: 14 }}>
            {totalMine} song{totalMine === 1 ? '' : 's'} added in total.
          </p>
          {myStats.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
              You haven't requested any songs yet. Head over to the Queue to search and add your favorite tracks!
            </p>
          ) : (
            myStats.map((r) => (
              <div key={r.day} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 14 }}>
                <span style={{ color: 'var(--text-muted)' }}>{r.day}</span>
                <span style={{ fontWeight: 600 }}>{r.count}</span>
              </div>
            ))
          )}
        </div>

        {/* Strictly Admin Only: Connected Users & Team Overview */}
        {me.role === 'admin' && (
          <>
            {userStats && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: 12,
                }}
              >
                <div
                  className="card"
                  style={{
                    padding: '16px 20px',
                    borderLeft: '4px solid var(--success)',
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                    Connected Users
                  </div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--success)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14 }}>🟢</span> {userStats.connected_users}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                    Active online right now
                  </div>
                </div>

                <div
                  className="card"
                  style={{
                    padding: '16px 20px',
                    borderLeft: '4px solid var(--accent)',
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                    Total Accounts
                  </div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent)', marginTop: 4 }}>
                    {userStats.total_users}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                    {userStats.active_users} active accounts
                  </div>
                </div>
              </div>
            )}

            {adminStats && (
              <div className="card" style={{ padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <h3 style={{ margin: 0 }}>Everyone's requests (Admin Overview)</h3>
                  <span style={{ fontSize: 11, background: 'rgba(124, 92, 255, 0.15)', color: 'var(--accent)', padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>
                    ADMIN ONLY
                  </span>
                </div>
                {adminStats.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>No songs logged yet.</p>
                ) : (
                  adminStats.map((r, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 14, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <span style={{ fontWeight: 500 }}>{r.username}</span>
                      <span style={{ color: 'var(--text-muted)' }}>{r.day}</span>
                      <span style={{ fontWeight: 600 }}>{r.count}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
