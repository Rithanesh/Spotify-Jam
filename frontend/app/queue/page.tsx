'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../lib/api';
import Loader from '../../components/Loader';
import Navbar from '../../components/Navbar';
import { useAuthGuard } from '../../lib/useAuthGuard';

interface QueueItem {
  id: number;
  track_name: string;
  artist_name: string;
  status: string;
  position: number;
  added_by: number;
  added_by_username?: string;
  added_by_display_name?: string;
  added_at?: string;
}

interface SearchResult {
  uri: string;
  name: string;
  artist: string;
  album_art_url: string | null;
  duration_ms: number;
}

interface NowPlayingInfo {
  is_playing: boolean;
  progress_ms: number;
  duration_ms: number;
  track_name: string;
  artist_name: string;
  album_art_url: string | null;
  uri: string;
}

export default function QueuePage() {
  const { user } = useAuthGuard();
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [nowPlaying, setNowPlaying] = useState<NowPlayingInfo | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState('');
  const [searching, setSearching] = useState(false);
  const [spotifyConnected, setSpotifyConnected] = useState<boolean | null>(null);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function loadQueue() {
    try {
      const [q, np] = await Promise.all([
        apiFetch(`/api/queue${showAllHistory ? '?all=true' : ''}`),
        apiFetch('/api/queue/now-playing').catch(() => null),
      ]);
      setQueue(q);
      setNowPlaying(np);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function refreshQueue() {
    setRefreshing(true);
    setError('');
    try {
      await loadQueue();
    } finally {
      setTimeout(() => setRefreshing(false), 500);
    }
  }

  useEffect(() => {
    if (!user) return;
    loadQueue();
    const interval = setInterval(loadQueue, 4000);

    if (user.role === 'admin') {
      apiFetch('/api/spotify/status')
        .then((res) => setSpotifyConnected(Boolean(res && res.connected)))
        .catch(() => setSpotifyConnected(false));
    }

    return () => clearInterval(interval);
  }, [user, showAllHistory]);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setError('');
    setSearching(true);
    try {
      const r = await apiFetch(`/api/queue/search?q=${encodeURIComponent(query)}`);
      setResults(r || []);
      if (r && r.length === 0) {
        setError('No songs found matching your search.');
      }
    } catch (err: any) {
      setError(err.message || 'Search failed');
    } finally {
      setSearching(false);
    }
  }

  async function addSong(track: SearchResult) {
    await apiFetch('/api/queue', {
      method: 'POST',
      body: JSON.stringify({
        uri: track.uri,
        name: track.name,
        artist: track.artist,
        album_art_url: track.album_art_url,
        duration_ms: track.duration_ms,
      }),
    });
    setResults([]);
    setQuery('');
    loadQueue();
  }

  async function removeSong(id: number) {
    await apiFetch(`/api/queue/${id}`, { method: 'DELETE' });
    loadQueue();
  }

  async function move(item: QueueItem, direction: -1 | 1) {
    await apiFetch(`/api/queue/${item.id}/position`, {
      method: 'PATCH',
      body: JSON.stringify({ new_position: item.position + direction }),
    });
    loadQueue();
  }

  async function pushNow(id: number) {
    try {
      await apiFetch(`/api/queue/${id}/push`, { method: 'POST' });
      loadQueue();
    } catch (err: any) {
      setError(err.message || 'Failed to push song to Spotify');
    }
  }

  if (!user || queue === null) return <Loader label="Loading the queue…" />;

  return (
    <div>
      <Navbar user={user} />
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '32px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h1 className="heading" style={{ fontSize: 24, margin: 0 }}>
            Up next
          </h1>
          <button
            type="button"
            className="btn-ghost"
            onClick={refreshQueue}
            disabled={refreshing}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              cursor: refreshing ? 'not-allowed' : 'pointer',
              opacity: refreshing ? 0.7 : 1,
            }}
            title="Refresh the queue from Spotify and database"
          >
            <span
              style={{
                display: 'inline-block',
                transition: 'transform 0.4s ease',
                transform: refreshing ? 'rotate(360deg)' : 'none',
              }}
            >
              🔄
            </span>
            <span>{refreshing ? 'Refreshing…' : 'Refresh Queue'}</span>
          </button>
        </div>

        {/* Current Playing in the top */}
        {nowPlaying && nowPlaying.track_name && (
          <div
            className="card"
            style={{
              padding: '16px',
              marginBottom: 24,
              background: 'linear-gradient(135deg, rgba(124, 92, 255, 0.12), rgba(34, 195, 166, 0.08))',
              border: '1px solid rgba(124, 92, 255, 0.35)',
              borderRadius: 12,
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: nowPlaying.is_playing ? 'var(--success, #22c3a6)' : '#f59e0b',
                    boxShadow: nowPlaying.is_playing ? '0 0 8px var(--success, #22c3a6)' : 'none',
                  }}
                />
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    color: nowPlaying.is_playing ? 'var(--success, #22c3a6)' : 'var(--text-muted)',
                  }}
                >
                  {nowPlaying.is_playing ? '▶ Now Playing on Spotify' : '⏸ Paused on Spotify'}
                </span>
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Live Stream
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              {nowPlaying.album_art_url ? (
                <img
                  src={nowPlaying.album_art_url}
                  alt={nowPlaying.track_name}
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 8,
                    objectFit: 'cover',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
                    flexShrink: 0,
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 8,
                    background: 'var(--surface-light, #262638)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 22,
                    flexShrink: 0,
                  }}
                >
                  🎵
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 16,
                    color: 'var(--text)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={nowPlaying.track_name}
                >
                  {nowPlaying.track_name}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: 'var(--text-muted)',
                    marginTop: 2,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={nowPlaying.artist_name}
                >
                  {nowPlaying.artist_name}
                </div>
              </div>
            </div>

            {nowPlaying.duration_ms > 0 && (
              <div style={{ marginTop: 12 }}>
                <div
                  style={{
                    width: '100%',
                    height: 4,
                    background: 'rgba(255, 255, 255, 0.1)',
                    borderRadius: 2,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      background: 'var(--accent, #7c5cff)',
                      width: `${Math.min(100, Math.max(0, (nowPlaying.progress_ms / nowPlaying.duration_ms) * 100))}%`,
                      transition: 'width 0.4s ease',
                      borderRadius: 2,
                    }}
                  />
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    marginTop: 4,
                  }}
                >
                  <span>
                    {Math.floor(nowPlaying.progress_ms / 60000)}:
                    {String(Math.floor((nowPlaying.progress_ms % 60000) / 1000)).padStart(2, '0')}
                  </span>
                  <span>
                    {Math.floor(nowPlaying.duration_ms / 60000)}:
                    {String(Math.floor((nowPlaying.duration_ms % 60000) / 1000)).padStart(2, '0')}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Not connected banner for admin */}
        {spotifyConnected === false && user.role === 'admin' && (
          <div
            style={{
              background: 'rgba(124, 92, 255, 0.12)',
              border: '1px solid var(--accent)',
              borderRadius: 8,
              padding: '12px 16px',
              marginBottom: 20,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <div style={{ fontSize: 13, color: 'var(--text)' }}>
              ⚠️ <strong>Spotify account not linked yet.</strong> Connect your account in Settings so you and members can search and queue songs.
            </div>
            <Link
              href="/settings/"
              className="btn-primary"
              style={{
                textDecoration: 'none',
                padding: '6px 12px',
                fontSize: 12,
                borderRadius: 6,
                whiteSpace: 'nowrap',
              }}
            >
              Open Settings →
            </Link>
          </div>
        )}

        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input
            placeholder="Search a song or artist"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ flex: 1 }}
          />
          <button className="btn-primary" type="submit" disabled={searching}>
            {searching ? 'Searching…' : 'Search'}
          </button>
        </form>

        {error && (
          <div
            style={{
              background: 'rgba(255, 92, 114, 0.12)',
              border: '1px solid var(--danger)',
              borderRadius: 8,
              padding: '10px 14px',
              marginBottom: 16,
              color: 'var(--danger)',
              fontSize: 13,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>{error}</span>
            {user.role === 'admin' && error.includes('Settings') && (
              <Link
                href="/settings/"
                style={{
                  color: 'var(--accent)',
                  fontWeight: 600,
                  fontSize: 13,
                  marginLeft: 12,
                  whiteSpace: 'nowrap',
                }}
              >
                Go to Settings →
              </Link>
            )}
          </div>
        )}

        {results.length > 0 && (
          <div className="card" style={{ padding: 12, marginBottom: 20 }}>
            {results.map((r) => (
              <div
                key={r.uri}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 4px',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{r.name}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{r.artist}</div>
                </div>
                <button className="btn-ghost" onClick={() => addSong(r)}>
                  Add
                </button>
              </div>
            ))}
          </div>
        )}

        {user?.role === 'admin' && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>
              Queue View (Admin):
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className={!showAllHistory ? 'btn-primary' : 'btn-ghost'}
                onClick={() => setShowAllHistory(false)}
                style={{ padding: '4px 12px', fontSize: 12, borderRadius: 6 }}
              >
                Active Queue ({queue.filter(q => ['pending', 'pushed', 'playing'].includes(q.status)).length})
              </button>
              <button
                type="button"
                className={showAllHistory ? 'btn-primary' : 'btn-ghost'}
                onClick={() => setShowAllHistory(true)}
                style={{ padding: '4px 12px', fontSize: 12, borderRadius: 6 }}
              >
                All Songs ({queue.length})
              </button>
            </div>
          </div>
        )}

        <div className="card" style={{ padding: 8 }}>
          {queue.length === 0 && (
            <p style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center' }}>
              Nothing queued yet — search above to add the first song.
            </p>
          )}
          {queue.map((item, idx) => (
            <div
              key={item.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 12px',
                borderBottom: idx < queue.length - 1 ? '1px solid var(--border)' : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: item.status === 'playing' ? 'var(--accent)' : 'var(--text-muted)',
                    background: item.status === 'playing' ? 'rgba(124, 92, 255, 0.15)' : 'var(--surface-light, rgba(255,255,255,0.06))',
                    borderRadius: 6,
                    padding: '4px 8px',
                    minWidth: 32,
                    textAlign: 'center',
                  }}
                  title={`Queue Position #${idx + 1}`}
                >
                  #{idx + 1}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span>{item.track_name}</span>
                    {item.status === 'playing' && (
                      <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700, padding: '2px 6px', background: 'rgba(124, 92, 255, 0.15)', borderRadius: 4 }}>
                        ▶ NOW PLAYING
                      </span>
                    )}
                    {item.status === 'pending' && (
                      <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700, padding: '2px 6px', background: 'rgba(245, 158, 11, 0.15)', borderRadius: 4 }}>
                        ⏳ NOT PUSHED (#{idx + 1})
                      </span>
                    )}
                    {item.status === 'pushed' && (
                      <span style={{ fontSize: 11, color: 'var(--success, #22c3a6)', fontWeight: 700, padding: '2px 6px', background: 'rgba(34, 195, 166, 0.15)', borderRadius: 4 }}>
                        ✓ PUSHED (#{idx + 1})
                      </span>
                    )}
                  {['played', 'removed', 'skipped'].includes(item.status) && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, padding: '2px 6px', background: 'rgba(255, 255, 255, 0.06)', borderRadius: 4, textTransform: 'uppercase' }}>
                      {item.status}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>{item.artist_name}</span>
                  {item.added_by_username && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', opacity: 0.8 }}>
                      • added by <strong style={{ color: 'var(--text)' }}>@{item.added_by_username}</strong>
                    </span>
                  )}
                </div>
              </div>
            </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {item.status === 'pending' && (
                  <>
                    <button
                      className="btn-primary"
                      onClick={() => pushNow(item.id)}
                      style={{ padding: '3px 8px', fontSize: 11, borderRadius: 4, whiteSpace: 'nowrap' }}
                      title="Push this song to Spotify's queue right now"
                    >
                      ▶ Push to Spotify
                    </button>
                    <button className="btn-ghost" onClick={() => move(item, -1)} aria-label="Move up" title="Move up">
                      ↑
                    </button>
                    <button className="btn-ghost" onClick={() => move(item, 1)} aria-label="Move down" title="Move down">
                      ↓
                    </button>
                  </>
                )}
                <button className="btn-ghost" onClick={() => removeSong(item.id)} aria-label="Remove" title="Remove song">
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
