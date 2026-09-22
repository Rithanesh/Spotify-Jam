'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../lib/api';
import Loader from '../../components/Loader';
import Navbar from '../../components/Navbar';
import { useAuthGuard } from '../../lib/useAuthGuard';

interface QueueItem {
  id: number;
  track_uri: string;
  track_name: string;
  artist_name: string;
  status: string;
  position: number;
  added_by: number;
  added_by_username?: string;
  added_by_display_name?: string;
  added_at?: string;
  album_art_url?: string | null;
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [spotifyConnected, setSpotifyConnected] = useState<boolean | null>(null);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [liveQueue, setLiveQueue] = useState<SearchResult[]>([]);
  const [autoPush, setAutoPush] = useState<boolean>(false);
  const [addedSongs, setAddedSongs] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ message: string, id: number } | null>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  async function loadQueue() {
    try {
      const [q, np, sq, ap] = await Promise.all([
        apiFetch(`/api/queue${user?.role === 'admin' ? '?all=true' : ''}`),
        apiFetch('/api/queue/now-playing').catch(() => null),
        apiFetch('/api/queue/spotify-live').catch(() => ({ queue: [] })),
        apiFetch('/api/queue/auto-push').catch(() => ({ enabled: false })),
      ]);
      setQueue(q);
      setNowPlaying(np);
      setLiveQueue(sq?.queue || []);
      setAutoPush(ap?.enabled || false);
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

  async function toggleAutoPush() {
    try {
      const res = await apiFetch('/api/queue/auto-push', {
        method: 'POST',
        body: JSON.stringify({ enabled: !autoPush })
      });
      setAutoPush(res.enabled);
    } catch (err: any) {
      setError(err.message || 'Failed to toggle auto push');
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
  }, [user]);

  useEffect(() => {
    const handler = setTimeout(() => {
      if (query.trim()) {
        executeSearch(query);
      } else {
        setResults([]);
      }
    }, 500);
    return () => clearTimeout(handler);
  }, [query]);

  async function executeSearch(q: string) {
    setError('');
    setSearching(true);
    try {
      const r = await apiFetch(`/api/queue/search?q=${encodeURIComponent(q)}`);
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

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
  }

  async function skipCurrent() {
    try {
      await apiFetch('/api/queue/skip', { method: 'POST' });
      loadQueue();
    } catch (err) {
      console.error(err);
    }
  }

  async function addSong(track: SearchResult) {
    try {
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
      setAddedSongs(prev => {
        const next = new Set(prev);
        next.add(track.uri);
        return next;
      });
      setToast({ message: `Added "${track.name}" to queue`, id: Date.now() });
      setTimeout(() => setToast(null), 3000);
      loadQueue();
    } catch (err) {
      console.error('Failed to add song', err);
    }
  }

  async function removeSong(id: number) {
    if (queue) {
      setQueue(queue.map(q => q.id === id ? { ...q, status: 'removed' } : q));
    }
    await apiFetch(`/api/queue/${id}`, { method: 'DELETE' });
    loadQueue();
  }

  async function move(item: QueueItem, direction: -1 | 1) {
    if (queue) {
      const idx = queue.findIndex(q => q.id === item.id);
      const pendingItems = queue.filter(q => q.status === 'pending');
      const pendingIdx = pendingItems.findIndex(q => q.id === item.id);
      
      if (pendingIdx !== -1) {
        const swapTarget = pendingItems[pendingIdx + direction];
        if (swapTarget) {
          const swapIdx = queue.findIndex(q => q.id === swapTarget.id);
          if (idx !== -1 && swapIdx !== -1) {
            const newQueue = [...queue];
            newQueue[idx] = queue[swapIdx];
            newQueue[swapIdx] = queue[idx];
            
            // Swap positions optimistically too
            const tempPos = newQueue[idx].position;
            newQueue[idx].position = newQueue[swapIdx].position;
            newQueue[swapIdx].position = tempPos;
            
            setQueue(newQueue);
          }
        }
      }
    }

    await apiFetch(`/api/queue/${item.id}/position`, {
      method: 'PATCH',
      body: JSON.stringify({ new_position: item.position + direction }),
    });
    loadQueue();
  }

  async function pushNow(id: number) {
    if (queue) {
      setQueue(queue.map(q => q.id === id ? { ...q, status: 'pushed' } : q));
    }
    try {
      await apiFetch(`/api/queue/${id}/push`, { method: 'POST' });
      loadQueue();
    } catch (err: any) {
      setError(err.message || 'Failed to push song to Spotify');
      loadQueue(); // revert optimistic update
    }
  }

  if (!user || queue === null) return <Loader label="Loading the queue…" />;

  const baseQueue = (user.role === 'admin' && !showAllHistory)
    ? queue.filter(q => ['pending', 'pushed', 'playing'].includes(q.status))
    : queue;

  const displayedQueue = baseQueue.map(q => {
    if (q.status === 'pushed' && nowPlaying && nowPlaying.uri === q.track_uri) {
      return { ...q, status: 'playing' };
    }
    return q;
  }).sort((a, b) => {
    if (a.status === 'playing' && b.status !== 'playing') return -1;
    if (b.status === 'playing' && a.status !== 'playing') return 1;
    return 0;
  });

  const pendingQueue = queue.filter(q => q.status === 'pending');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Navbar user={user} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', maxWidth: 1000, width: '100%', margin: '0 auto', padding: '32px 20px', minHeight: 0 }}>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {user?.role === 'admin' && (
                  <button
                    onClick={skipCurrent}
                    className="btn-ghost"
                    style={{ padding: '2px 8px', fontSize: 11, borderRadius: 4, border: '1px solid var(--border)' }}
                    title="Skip to next track on Spotify"
                  >
                    ⏭ Skip
                  </button>
                )}
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Live Stream
                </span>
              </div>
            </div>
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

        <div ref={searchContainerRef} style={{ position: 'relative', marginBottom: 16, zIndex: 50 }}>
          <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8 }}>
            <input
              placeholder="Search a song or artist"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setSearchOpen(true)}
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
                marginTop: 8,
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

          {searchOpen && results.length > 0 && (
            <div className="card" style={{ 
              position: 'absolute', 
              top: '100%', 
              left: 0, 
              right: 0, 
              marginTop: 8, 
              padding: 12, 
              maxHeight: 'min(400px, calc(100vh - 280px))', 
              overflowY: 'auto', 
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              zIndex: 100
            }}>
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {r.album_art_url && (
                      <img 
                        src={r.album_art_url} 
                        alt={r.name}
                        style={{ width: 40, height: 40, borderRadius: 4, objectFit: 'cover' }}
                      />
                    )}
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{r.name}</div>
                      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{r.artist}</div>
                    </div>
                  </div>
                  <button 
                    className="btn-ghost" 
                    onClick={() => addSong(r)}
                    disabled={addedSongs.has(r.uri)}
                    style={{ 
                      color: addedSongs.has(r.uri) ? 'var(--success)' : 'inherit', 
                      borderColor: addedSongs.has(r.uri) ? 'var(--success)' : 'var(--border)' 
                    }}
                  >
                    {addedSongs.has(r.uri) ? '✓ Added' : 'Add'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {user?.role === 'admin' && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>
                Queue View (Admin):
              </span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={autoPush} onChange={toggleAutoPush} />
                Auto-Push to Spotify
              </label>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className={!showAllHistory ? 'btn-primary' : 'btn-ghost'}
                onClick={() => setShowAllHistory(false)}
                style={{ padding: '4px 12px', fontSize: 12, borderRadius: 6 }}
              >
                Active Queue ({queue.filter(q => q.status === 'pending' || q.status === 'playing' || q.status === 'pushed').length})
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

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20, flex: 1, minHeight: 0 }}>
          {/* Live Spotify Queue */}
          <div className="card" style={{ padding: 8, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', padding: '12px 12px 12px', flexShrink: 0 }}>
              Up Next on Spotify
            </div>
            <div style={{ overflowY: 'auto', flex: 1, paddingRight: 4 }}>
              {liveQueue.length === 0 ? (
              <p style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center', fontSize: 13 }}>
                No active Spotify queue.
              </p>
            ) : (
              liveQueue.map((item: any, idx) => (
                <div
                  key={`live-${idx}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '10px 12px',
                    borderBottom: idx < liveQueue.length - 1 ? '1px solid var(--border)' : 'none',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: 'var(--text-muted)',
                        background: 'var(--surface-light, rgba(255,255,255,0.06))',
                        borderRadius: 6,
                        padding: '4px 8px',
                        minWidth: 32,
                        textAlign: 'center',
                      }}
                    >
                      ~
                    </span>
                    {item.album_art_url && (
                      <img 
                        src={item.album_art_url} 
                        alt={item.track_name || item.name}
                        style={{ width: 40, height: 40, borderRadius: 4, objectFit: 'cover' }}
                      />
                    )}
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                      <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.track_name || item.name}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.artist_name || item.artist}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
            </div>
          </div>

          {/* Pending Local Queue */}
          <div className="card" style={{ padding: 8, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', padding: '12px 12px 12px', flexShrink: 0 }}>
              Pending Local Queue
            </div>
            <div style={{ overflowY: 'auto', flex: 1, paddingRight: 4 }}>
              {displayedQueue.length === 0 ? (
              <p style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center', fontSize: 13 }}>
                Nothing queued yet — search above to add the first song.
              </p>
            ) : (
              displayedQueue.map((item, idx) => (
                <div
                  key={item.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 12,
                    padding: '10px 12px',
                    borderBottom: idx < displayedQueue.length - 1 ? '1px solid var(--border)' : 'none',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: '220px' }}>
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
                      title={`Queue Position #${queue.findIndex(q => q.id === item.id) + 1}`}
                    >
                      #{queue.findIndex(q => q.id === item.id) + 1}
                    </span>
                    {item.album_art_url && (
                      <img 
                        src={item.album_art_url} 
                        alt={item.track_name}
                        style={{ width: 40, height: 40, borderRadius: 4, objectFit: 'cover' }}
                      />
                    )}
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {item.track_name}
                        </div>
                        {item.status === 'playing' && (
                          <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--accent)', fontWeight: 700, padding: '2px 6px', background: 'rgba(124, 92, 255, 0.15)', borderRadius: 4 }}>
                            ▶ NOW PLAYING
                          </span>
                        )}
                        {item.status === 'pending' && (
                          <span style={{ flexShrink: 0, fontSize: 11, color: '#f59e0b', fontWeight: 700, padding: '2px 6px', background: 'rgba(245, 158, 11, 0.15)', borderRadius: 4 }}>
                            ⏳ NOT PUSHED
                          </span>
                        )}
                        {item.status === 'pushed' && (
                          <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--success, #22c3a6)', fontWeight: 700, padding: '2px 6px', background: 'rgba(34, 195, 166, 0.15)', borderRadius: 4 }}>
                            ✓ PUSHED
                          </span>
                        )}
                      {['played', 'removed', 'skipped'].includes(item.status) && (
                        <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, padding: '2px 6px', background: 'rgba(255, 255, 255, 0.06)', borderRadius: 4, textTransform: 'uppercase' }}>
                          {item.status}
                        </span>
                      )}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.artist_name}</span>
                        {item.added_by_username && (
                          <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--text-muted)', opacity: 0.8 }}>
                            • added by <strong style={{ color: 'var(--text)' }}>@{item.added_by_username}</strong>
                          </span>
                        )}
                      </div>
                    </div>
                </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                    {item.status === 'pending' && (user.role === 'admin' || user.username === item.added_by_username) && (
                      <>
                        <button
                          className="btn-primary"
                          onClick={() => pushNow(item.id)}
                          style={{ padding: '3px 8px', fontSize: 11, borderRadius: 4, whiteSpace: 'nowrap' }}
                          title="Push this song to Spotify's queue right now"
                        >
                          ▶ Push
                        </button>
                        <button 
                          className="btn-ghost" 
                          onClick={() => move(item, -1)} 
                          aria-label="Move up" 
                          title="Move up"
                          disabled={pendingQueue[0]?.id === item.id}
                          style={{ opacity: pendingQueue[0]?.id === item.id ? 0.3 : 1, cursor: pendingQueue[0]?.id === item.id ? 'not-allowed' : 'pointer' }}
                        >
                          ↑
                        </button>
                        <button 
                          className="btn-ghost" 
                          onClick={() => move(item, 1)} 
                          aria-label="Move down" 
                          title="Move down"
                          disabled={pendingQueue[pendingQueue.length - 1]?.id === item.id}
                          style={{ opacity: pendingQueue[pendingQueue.length - 1]?.id === item.id ? 0.3 : 1, cursor: pendingQueue[pendingQueue.length - 1]?.id === item.id ? 'not-allowed' : 'pointer' }}
                        >
                          ↓
                        </button>
                      </>
                    )}
                    {(user.role === 'admin' || user.username === item.added_by_username) && (
                      <button className="btn-ghost" onClick={() => removeSong(item.id)} aria-label="Remove" title="Remove song">
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
            </div>
          </div>
        </div>
      </div>

      {toast && (
        <div style={{
          position: 'fixed',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--success)',
          color: '#fff',
          padding: '10px 20px',
          borderRadius: 8,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          zIndex: 9999,
          fontWeight: 600,
          fontSize: 14,
        }}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
