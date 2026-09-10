'use client';

import { useEffect, useState, useMemo } from 'react';
import { apiFetch } from '../../lib/api';
import Loader from '../../components/Loader';
import Navbar from '../../components/Navbar';
import { useAuthGuard } from '../../lib/useAuthGuard';

interface DashboardStats {
  top_users: { username: string; count: number }[];
  repeated: {
    day: { track_name: string; count: number }[];
    week: { track_name: string; count: number }[];
    month: { track_name: string; count: number }[];
  };
}

export default function DashboardPage() {
  const { user: me } = useAuthGuard();
  const [myStats, setMyStats] = useState<{ day: string; count: number; track_names?: string[] }[] | null>(null);
  const [adminStats, setAdminStats] = useState<{ username: string; day: string; count: number; track_names?: string[] }[] | null>(null);
  const [userStats, setUserStats] = useState<{ total_users: number; connected_users: number; active_users: number } | null>(null);
  const [dashStats, setDashStats] = useState<DashboardStats | null>(null);
  
  const [expandedUsers, setExpandedUsers] = useState<Record<string, boolean>>({});
  const [repeatTime, setRepeatTime] = useState<'day' | 'week' | 'month'>('week');

  useEffect(() => {
    if (!me) return;
    apiFetch('/api/logs/dashboard/me').then(setMyStats);
    if (me.role === 'admin') {
      apiFetch('/api/logs/dashboard/admin').then(setAdminStats);
      apiFetch('/api/logs/dashboard/stats').then(setDashStats);
      apiFetch('/api/users').then((data) => {
        if (data.stats) setUserStats(data.stats);
      });
    }
  }, [me]);

  const adminStatsByUser = useMemo(() => {
    if (!adminStats) return {};
    const grouped: Record<string, typeof adminStats> = {};
    for (const r of adminStats) {
      if (!grouped[r.username]) grouped[r.username] = [];
      grouped[r.username].push(r);
    }
    return grouped;
  }, [adminStats]);

  const toggleUser = (username: string) => {
    setExpandedUsers(prev => ({ ...prev, [username]: !prev[username] }));
  };

  if (!me || myStats === null) return <Loader label="Crunching the numbers…" />;

  const totalMine = myStats.reduce((sum, r) => sum + r.count, 0);

  // max count for histogram
  const maxUserCount = dashStats?.top_users.length ? Math.max(...dashStats.top_users.map(u => u.count)) : 1;

  return (
    <div>
      <Navbar user={me} />
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '32px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
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
              <div key={r.day} style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 4 }}>
                  <span style={{ color: 'var(--text-muted)' }}>{r.day}</span>
                  <span style={{ fontWeight: 600 }}>{r.count}</span>
                </div>
                {r.track_names && r.track_names.length > 0 && (
                  <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.6 }}>
                    {r.track_names.map((t: string, i: number) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                )}
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

            {dashStats && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
                {/* Histogram */}
                <div className="card" style={{ padding: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <h3 style={{ margin: 0, fontSize: 16 }}>Top Contributors</h3>
                    <span style={{ fontSize: 11, background: 'rgba(124, 92, 255, 0.15)', color: 'var(--accent)', padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>
                      ADMIN
                    </span>
                  </div>
                  {dashStats.top_users.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>No data.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {dashStats.top_users.map(u => (
                        <div key={u.username}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                            <span style={{ fontWeight: 600 }}>@{u.username}</span>
                            <span style={{ color: 'var(--text-muted)' }}>{u.count}</span>
                          </div>
                          <div style={{ width: '100%', background: 'rgba(255,255,255,0.05)', height: 8, borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ width: `${(u.count / maxUserCount) * 100}%`, background: 'var(--accent)', height: '100%', borderRadius: 4 }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Most Repeated Songs */}
                <div className="card" style={{ padding: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <h3 style={{ margin: 0, fontSize: 16 }}>Repeated Songs</h3>
                    <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,0.05)', padding: 4, borderRadius: 6 }}>
                      {(['day', 'week', 'month'] as const).map(t => (
                        <button
                          key={t}
                          onClick={() => setRepeatTime(t)}
                          style={{
                            background: repeatTime === t ? 'var(--accent)' : 'transparent',
                            color: repeatTime === t ? '#fff' : 'var(--text-muted)',
                            border: 'none',
                            padding: '4px 8px',
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: 'pointer',
                            textTransform: 'capitalize'
                          }}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                  {dashStats.repeated[repeatTime].length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>No repeated songs in this period.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {dashStats.repeated[repeatTime].map((r, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-muted)', width: 20 }}>{idx + 1}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.track_name}</div>
                          </div>
                          <div style={{ fontSize: 12, fontWeight: 700, background: 'rgba(34, 195, 166, 0.15)', color: 'var(--success)', padding: '2px 8px', borderRadius: 10 }}>
                            {r.count}x
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="card" style={{ padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ margin: 0 }}>Everyone's requests (Admin Overview)</h3>
              </div>
              {Object.keys(adminStatsByUser).length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>No songs logged yet.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {Object.entries(adminStatsByUser).map(([username, rows]) => {
                    const isExpanded = !!expandedUsers[username];
                    const userTotal = rows.reduce((s, r) => s + r.count, 0);
                    return (
                      <div key={username} style={{ border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, overflow: 'hidden' }}>
                        <button
                          onClick={() => toggleUser(username)}
                          style={{
                            width: '100%',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '12px 16px',
                            background: 'var(--surface-raised)',
                            border: 'none',
                            color: 'var(--text)',
                            cursor: 'pointer',
                            textAlign: 'left'
                          }}
                        >
                          <span style={{ fontWeight: 600, fontSize: 15 }}>@{username}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{userTotal} songs</span>
                            <span style={{ fontSize: 10, color: 'var(--text-muted)', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
                          </div>
                        </button>
                        {isExpanded && (
                          <div style={{ padding: '0 16px 16px', background: 'var(--surface-raised)' }}>
                            {rows.map((r, i) => (
                              <div key={i} style={{ padding: '8px 0', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                                  <span style={{ color: 'var(--text-muted)' }}>{r.day}</span>
                                  <span style={{ fontWeight: 600 }}>{r.count}</span>
                                </div>
                                {r.track_names && r.track_names.length > 0 && (
                                  <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.6 }}>
                                    {r.track_names.map((t: string, j: number) => (
                                      <li key={j}>{t}</li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
