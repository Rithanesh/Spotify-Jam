'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
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
  is_app_pushed?: boolean;
}

interface PlaylistSummary {
  id: string;
  name: string;
  description: string;
  cover_url: string | null;
  owner: string;
  total_tracks: number;
  uri?: string;
}

interface PlaylistTrack {
  uri: string;
  name: string;
  artist: string;
  album_art_url: string | null;
  duration_ms: number;
}

interface PlaylistDetail {
  id: string;
  name: string | null;
  description: string | null;
  cover_url: string | null;
  owner: string | null;
  total_tracks: number;
  tracks: PlaylistTrack[];
  offset: number;
  limit: number;
  has_more: boolean;
  uri?: string;
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
  const [totalQueueCount, setTotalQueueCount] = useState<number>(0);
  const [historyLimit, setHistoryLimit] = useState<number>(50);
  const [nowPlaying, setNowPlaying] = useState<NowPlayingInfo | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [spotifyConnected, setSpotifyConnected] = useState<boolean | null>(null);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Playlist search and inspection states
  const [searchMode, setSearchMode] = useState<'tracks' | 'playlists'>('tracks');
  const [playlistResults, setPlaylistResults] = useState<PlaylistSummary[]>([]);
  const [userPlaylists, setUserPlaylists] = useState<PlaylistSummary[]>([]);
  const [loadingUserPlaylists, setLoadingUserPlaylists] = useState(false);
  const [activePlaylistSummary, setActivePlaylistSummary] = useState<PlaylistSummary | null>(null);
  const [activePlaylist, setActivePlaylist] = useState<PlaylistDetail | null>(null);
  const [loadingPlaylist, setLoadingPlaylist] = useState(false);
  const [selectedTrackUris, setSelectedTrackUris] = useState<Set<string>>(new Set());
  const [skipExisting, setSkipExisting] = useState<boolean>(true);
  const [addingBatch, setAddingBatch] = useState(false);
  const [loadingMoreTracks, setLoadingMoreTracks] = useState(false);

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
        apiFetch(`/api/queue${user?.role === 'admin' ? '?all=true&limit=' + historyLimit : ''}`),
        apiFetch('/api/queue/now-playing').catch(() => null),
        apiFetch('/api/queue/spotify-live').catch(() => ({ queue: [] })),
        apiFetch('/api/queue/auto-push').catch(() => ({ enabled: false })),
      ]);
      
      if (q && q.items !== undefined) {
        setQueue(q.items);
        setTotalQueueCount(q.total);
      } else {
        setQueue(q);
        setTotalQueueCount(q?.length || 0);
      }
      
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
  }, [user, historyLimit]);

  const activeQueueUris = useMemo(() => {
    if (!queue) return new Set<string>();
    return new Set(
      queue
        .filter((q) => q.status === 'pending' || q.status === 'playing' || q.status === 'pushed')
        .map((q) => q.track_uri)
    );
  }, [queue]);

  const totalSelectedMs = useMemo(() => {
    if (!activePlaylist) return 0;
    return activePlaylist.tracks
      .filter((t) => selectedTrackUris.has(t.uri))
      .reduce((acc, t) => acc + (t.duration_ms || 0), 0);
  }, [activePlaylist, selectedTrackUris]);

  const totalSelectedMinutes = Math.round(totalSelectedMs / 60000);

  function formatDuration(ms?: number) {
    if (!ms) return '0:00';
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  async function loadUserPlaylists() {
    setLoadingUserPlaylists(true);
    try {
      const res = await apiFetch('/api/queue/user-playlists');
      setUserPlaylists(res.playlists || []);
    } catch (err) {
      console.debug('Failed to load user playlists', err);
    } finally {
      setLoadingUserPlaylists(false);
    }
  }

  function handleModeSwitch(mode: 'tracks' | 'playlists') {
    setSearchMode(mode);
    setError('');
    setSearchOpen(true);
    if (mode === 'playlists') {
      if (!query.trim() && userPlaylists.length === 0) {
        loadUserPlaylists();
      } else if (query.trim()) {
        executeSearch(query, mode);
      }
    } else {
      if (query.trim()) {
        executeSearch(query, mode);
      }
    }
  }

  async function openPlaylistModal(playlist: PlaylistSummary) {
    setActivePlaylistSummary(playlist);
    setActivePlaylist(null);
    setLoadingPlaylist(true);
    setError('');
    try {
      const data: PlaylistDetail = await apiFetch(`/api/queue/playlist/${playlist.id}?offset=0&limit=100`);
      setActivePlaylist(data);
      // Auto-select eligible tracks
      const eligible = data.tracks.filter((t) => !activeQueueUris.has(t.uri));
      if (user?.role !== 'admin' && eligible.length > 50) {
        setSelectedTrackUris(new Set(eligible.slice(0, 50).map((t) => t.uri)));
      } else {
        setSelectedTrackUris(new Set(eligible.map((t) => t.uri)));
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load playlist tracks.');
      setActivePlaylistSummary(null);
    } finally {
      setLoadingPlaylist(false);
    }
  }

  function closePlaylistModal() {
    setActivePlaylist(null);
    setActivePlaylistSummary(null);
    setSelectedTrackUris(new Set());
    setLoadingMoreTracks(false);
  }

  async function loadMoreTracks() {
    if (!activePlaylist || !activePlaylist.has_more || loadingMoreTracks) return;
    setLoadingMoreTracks(true);
    try {
      const nextOffset = activePlaylist.tracks.length;
      const data = await apiFetch(`/api/queue/playlist/${activePlaylist.id}?offset=${nextOffset}&limit=100`);
      const newTracks = [...activePlaylist.tracks, ...data.tracks];
      setActivePlaylist({
        ...activePlaylist,
        tracks: newTracks,
        offset: data.offset,
        has_more: data.has_more,
      });
      // If user is admin, auto-select newly loaded eligible tracks
      if (user?.role === 'admin') {
        setSelectedTrackUris((prev) => {
          const next = new Set(prev);
          data.tracks.forEach((t: PlaylistTrack) => {
            if (!skipExisting || !activeQueueUris.has(t.uri)) next.add(t.uri);
          });
          return next;
        });
      }
    } catch (err: any) {
      setToast({ message: 'Failed to load more tracks: ' + err.message, id: Date.now() });
      setTimeout(() => setToast(null), 3000);
    } finally {
      setLoadingMoreTracks(false);
    }
  }

  function toggleTrackSelection(uri: string) {
    setSelectedTrackUris((prev) => {
      const next = new Set(prev);
      if (next.has(uri)) {
        next.delete(uri);
      } else {
        if (user?.role !== 'admin' && next.size >= 50) {
          setToast({ message: 'Members can select at most 50 songs per batch.', id: Date.now() });
          setTimeout(() => setToast(null), 3000);
          return next;
        }
        next.add(uri);
      }
      return next;
    });
  }

  function handleSelectAllToggle(checked: boolean) {
    if (!activePlaylist) return;
    if (!checked) {
      setSelectedTrackUris(new Set());
      return;
    }
    const eligible = activePlaylist.tracks.filter((t) => {
      if (skipExisting && activeQueueUris.has(t.uri)) return false;
      return true;
    });
    if (user?.role !== 'admin' && eligible.length > 50) {
      setSelectedTrackUris(new Set(eligible.slice(0, 50).map((t) => t.uri)));
      setToast({ message: 'Selected first 50 songs (member limit).', id: Date.now() });
      setTimeout(() => setToast(null), 3000);
    } else {
      setSelectedTrackUris(new Set(eligible.map((t) => t.uri)));
    }
  }

  async function handleBatchAdd() {
    if (!activePlaylist) return;
    const tracksToAdd = activePlaylist.tracks.filter((t) => selectedTrackUris.has(t.uri));
    if (tracksToAdd.length === 0) return;

    setAddingBatch(true);
    try {
      const res = await apiFetch('/api/queue/batch', {
        method: 'POST',
        body: JSON.stringify({ tracks: tracksToAdd }),
      });

      setAddedSongs((prev) => {
        const next = new Set(prev);
        tracksToAdd.forEach((t) => next.add(t.uri));
        return next;
      });

      const playlistTitle = activePlaylist.name || activePlaylistSummary?.name || 'playlist';
      setToast({
        message: `Added ${res.added_count} songs from "${playlistTitle}" to queue!`,
        id: Date.now(),
      });
      setTimeout(() => setToast(null), 4000);

      closePlaylistModal();
      loadQueue();
    } catch (err: any) {
      setError(err.message || 'Failed to add playlist tracks.');
    } finally {
      setAddingBatch(false);
    }
  }

  useEffect(() => {
    const handler = setTimeout(() => {
      if (query.trim()) {
        executeSearch(query);
      } else {
        setResults([]);
        setPlaylistResults([]);
        if (searchMode === 'playlists' && userPlaylists.length === 0) {
          loadUserPlaylists();
        }
      }
    }, 500);
    return () => clearTimeout(handler);
  }, [query, searchMode]);

  async function executeSearch(q: string, overrideMode?: 'tracks' | 'playlists') {
    const currentMode = overrideMode || searchMode;
    setError('');
    setSearching(true);
    try {
      if (currentMode === 'tracks') {
        const r = await apiFetch(`/api/queue/search?q=${encodeURIComponent(q)}`);
        setResults(r || []);
        if (r && r.length === 0) {
          setError('No songs found matching your search.');
        }
      } else {
        const r = await apiFetch(`/api/queue/search-playlists?q=${encodeURIComponent(q)}`);
        setPlaylistResults(r?.playlists || []);
        if (r?.playlists && r.playlists.length === 0) {
          setError('No playlists found matching your search or link.');
        }
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
          {/* Mode Switcher */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{
              display: 'inline-flex',
              background: 'var(--surface-raised)',
              padding: 3,
              borderRadius: 8,
              border: '1px solid var(--border)'
            }}>
              <button
                type="button"
                onClick={() => handleModeSwitch('tracks')}
                style={{
                  padding: '5px 14px',
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 6,
                  border: 'none',
                  background: searchMode === 'tracks' ? 'var(--accent)' : 'transparent',
                  color: searchMode === 'tracks' ? 'var(--accent-text)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                🎵 Single Songs
              </button>
              <button
                type="button"
                onClick={() => handleModeSwitch('playlists')}
                style={{
                  padding: '5px 14px',
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 6,
                  border: 'none',
                  background: searchMode === 'playlists' ? 'var(--accent)' : 'transparent',
                  color: searchMode === 'playlists' ? 'var(--accent-text)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                📑 Playlists
              </button>
            </div>
            {searchMode === 'playlists' && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Search playlist name or paste Spotify link
              </span>
            )}
          </div>

          <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8 }}>
            <input
              placeholder={searchMode === 'tracks' ? "Search a song or artist" : "Search playlists or paste Spotify playlist link (https://open.spotify.com/playlist/...)"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => {
                setSearchOpen(true);
                if (searchMode === 'playlists' && !query.trim() && userPlaylists.length === 0) {
                  loadUserPlaylists();
                }
              }}
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

          {searchOpen && (
            <div className="card" style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              marginTop: 8,
              padding: 12,
              maxHeight: 'min(420px, calc(100vh - 280px))',
              overflowY: 'auto',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              zIndex: 100
            }}>
              {searchMode === 'tracks' ? (
                results.length > 0 ? (
                  results.map((r) => (
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
                  ))
                ) : (
                  !searching && query.trim() && (
                    <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                      No songs found.
                    </div>
                  )
                )
              ) : (
                /* Playlists Mode */
                playlistResults.length > 0 ? (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8, padding: '0 4px' }}>
                      Playlist Search Results
                    </div>
                    {playlistResults.map((p) => (
                      <div
                        key={p.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '10px 8px',
                          borderBottom: '1px solid var(--border)',
                          borderRadius: 6,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1, marginRight: 12 }}>
                          {p.cover_url ? (
                            <img
                              src={p.cover_url}
                              alt={p.name}
                              style={{ width: 46, height: 46, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
                            />
                          ) : (
                            <div style={{
                              width: 46,
                              height: 46,
                              borderRadius: 6,
                              background: 'var(--surface-raised)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 20,
                              flexShrink: 0
                            }}>
                              📑
                            </div>
                          )}
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {p.name}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                              By {p.owner} • {p.total_tracks} tracks
                            </div>
                          </div>
                        </div>
                        <button
                          className="btn-primary"
                          type="button"
                          onClick={() => {
                            setSearchOpen(false);
                            openPlaylistModal(p);
                          }}
                          style={{ padding: '6px 14px', fontSize: 13, flexShrink: 0 }}
                        >
                          View Tracks →
                        </button>
                      </div>
                    ))}
                  </div>
                ) : userPlaylists.length > 0 && !query.trim() ? (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8, padding: '0 4px' }}>
                      Your Spotify Playlists
                    </div>
                    {userPlaylists.map((p) => (
                      <div
                        key={p.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '10px 8px',
                          borderBottom: '1px solid var(--border)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1, marginRight: 12 }}>
                          {p.cover_url ? (
                            <img
                              src={p.cover_url}
                              alt={p.name}
                              style={{ width: 44, height: 44, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
                            />
                          ) : (
                            <div style={{
                              width: 44,
                              height: 44,
                              borderRadius: 6,
                              background: 'var(--surface-raised)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 18,
                              flexShrink: 0
                            }}>
                              📑
                            </div>
                          )}
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {p.name}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                              {p.total_tracks} tracks
                            </div>
                          </div>
                        </div>
                        <button
                          className="btn-primary"
                          type="button"
                          onClick={() => {
                            setSearchOpen(false);
                            openPlaylistModal(p);
                          }}
                          style={{ padding: '6px 14px', fontSize: 13, flexShrink: 0 }}
                        >
                          View Tracks →
                        </button>
                      </div>
                    ))}
                  </div>
                ) : loadingUserPlaylists ? (
                  <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    Loading your Spotify playlists…
                  </div>
                ) : (
                  <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    Type a playlist name or paste a Spotify link (e.g. https://open.spotify.com/playlist/...) to view and import tracks.
                  </div>
                )
              )}
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
                All Songs ({totalQueueCount})
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
                          color: item.is_app_pushed === false ? '#f59e0b' : 'var(--text-muted)',
                          background: item.is_app_pushed === false ? 'rgba(245, 158, 11, 0.15)' : 'var(--surface-light, rgba(255,255,255,0.06))',
                          borderRadius: 6,
                          padding: '4px 8px',
                          minWidth: 32,
                          textAlign: 'center',
                        }}
                        title={item.is_app_pushed === false ? "Added directly on Spotify (Not by App)" : "Pushed by App"}
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
                        title={`Queue Position #${item.id}`}
                      >
                        #{item.id}
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
                      {item.status === 'pushed' && user.role === 'admin' && (
                        <button
                          className="btn-ghost"
                          onClick={() => pushNow(item.id)}
                          style={{ padding: '3px 8px', fontSize: 11, borderRadius: 4, whiteSpace: 'nowrap' }}
                          title="Repush this song to Spotify's queue"
                        >
                          🔄 Repush
                        </button>
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
              
              {showAllHistory && queue && queue.length < totalQueueCount && (
                <div style={{ textAlign: 'center', padding: '16px 0' }}>
                  <button
                    className="btn-ghost"
                    onClick={() => setHistoryLimit(prev => prev + 50)}
                    style={{ fontSize: 13, padding: '6px 16px', borderRadius: 6, border: '1px solid var(--border)' }}
                  >
                    Load More Older Songs
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Playlist Inspection & Batch Add Modal */}
      {activePlaylistSummary && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 20,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !addingBatch) closePlaylistModal();
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: 750,
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 24px 60px rgba(0,0,0,0.7)',
              overflow: 'hidden',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
            }}
          >
            {/* Modal Header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 20px',
              borderBottom: '1px solid var(--border)',
              background: 'var(--surface-raised)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                {activePlaylist?.cover_url || activePlaylistSummary.cover_url ? (
                  <img
                    src={activePlaylist?.cover_url || activePlaylistSummary.cover_url || ''}
                    alt={activePlaylist?.name || activePlaylistSummary.name}
                    style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
                  />
                ) : (
                  <div style={{
                    width: 56,
                    height: 56,
                    borderRadius: 8,
                    background: 'var(--surface)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 24,
                    flexShrink: 0
                  }}>
                    📑
                  </div>
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 17, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {activePlaylist?.name || activePlaylistSummary.name}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
                    By {activePlaylist?.owner || activePlaylistSummary.owner} • {activePlaylist?.total_tracks ?? activePlaylistSummary.total_tracks} total songs
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={closePlaylistModal}
                disabled={addingBatch}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: 20,
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  padding: 4,
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>

            {/* Modal Action Controls Bar */}
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 20px',
              background: 'var(--surface)',
              borderBottom: '1px solid var(--border)',
              gap: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={
                      Boolean(
                        activePlaylist &&
                        activePlaylist.tracks.length > 0 &&
                        selectedTrackUris.size > 0 &&
                        (user?.role !== 'admin'
                          ? selectedTrackUris.size === Math.min(50, activePlaylist.tracks.filter(t => !skipExisting || !activeQueueUris.has(t.uri)).length)
                          : selectedTrackUris.size === activePlaylist.tracks.filter(t => !skipExisting || !activeQueueUris.has(t.uri)).length)
                      )
                    }
                    onChange={(e) => handleSelectAllToggle(e.target.checked)}
                    disabled={loadingPlaylist || addingBatch}
                    style={{ accentColor: 'var(--accent)', width: 16, height: 16 }}
                  />
                  Select All
                </label>

                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  <strong>{selectedTrackUris.size}</strong> of {activePlaylist ? activePlaylist.tracks.length : 0} selected
                </span>

                {user?.role !== 'admin' && (
                  <span style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: 6,
                    background: 'rgba(245, 158, 11, 0.15)',
                    color: '#f59e0b',
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                  }}>
                    Max 50 for members
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)' }}>
                  <input
                    type="checkbox"
                    checked={skipExisting}
                    onChange={(e) => {
                      const willSkip = e.target.checked;
                      setSkipExisting(willSkip);
                      if (willSkip && activePlaylist) {
                        setSelectedTrackUris(prev => {
                          const next = new Set(prev);
                          activePlaylist.tracks.forEach(t => {
                            if (activeQueueUris.has(t.uri)) next.delete(t.uri);
                          });
                          return next;
                        });
                      }
                    }}
                    disabled={loadingPlaylist || addingBatch}
                    style={{ accentColor: 'var(--accent)' }}
                  />
                  Skip already queued
                </label>

                {selectedTrackUris.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedTrackUris(new Set())}
                    disabled={addingBatch}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--accent)',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      padding: 0
                    }}
                  >
                    Clear selection
                  </button>
                )}
              </div>
            </div>

            {/* Scrollable Tracklist */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 20px', minHeight: 250, maxHeight: 420 }}>
              {loadingPlaylist ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                  <Loader />
                  <div style={{ marginTop: 12, fontSize: 14 }}>Loading playlist tracks…</div>
                </div>
              ) : activePlaylist && activePlaylist.tracks.length > 0 ? (
                <div>
                  {activePlaylist.tracks.map((t, idx) => {
                    const isQueued = activeQueueUris.has(t.uri);
                    const isSelected = selectedTrackUris.has(t.uri);
                    const isAdded = addedSongs.has(t.uri);

                    return (
                      <div
                        key={`${t.uri}-${idx}`}
                        onClick={() => {
                          if (addingBatch) return;
                          toggleTrackSelection(t.uri);
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 10px',
                          borderRadius: 8,
                          cursor: 'pointer',
                          background: isSelected ? 'rgba(124, 92, 255, 0.08)' : 'transparent',
                          transition: 'background 0.1s',
                          borderBottom: idx < activePlaylist.tracks.length - 1 ? '1px solid var(--border)' : 'none',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              e.stopPropagation();
                              toggleTrackSelection(t.uri);
                            }}
                            disabled={addingBatch}
                            style={{ accentColor: 'var(--accent)', width: 16, height: 16, cursor: 'pointer' }}
                          />
                          <span style={{ fontSize: 12, color: 'var(--text-muted)', width: 22, textAlign: 'right' }}>
                            {idx + 1}
                          </span>
                          {t.album_art_url && (
                            <img
                              src={t.album_art_url}
                              alt={t.name}
                              style={{ width: 36, height: 36, borderRadius: 4, objectFit: 'cover' }}
                            />
                          )}
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {t.name}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {t.artist}
                            </div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                          {isQueued && (
                            <span style={{
                              fontSize: 11,
                              fontWeight: 600,
                              padding: '2px 8px',
                              borderRadius: 4,
                              background: 'rgba(255,255,255,0.08)',
                              color: 'var(--text-muted)',
                            }}>
                              In Queue
                            </span>
                          )}
                          {isAdded && (
                            <span style={{
                              fontSize: 11,
                              fontWeight: 600,
                              padding: '2px 8px',
                              borderRadius: 4,
                              background: 'rgba(74, 222, 128, 0.15)',
                              color: 'var(--success)',
                            }}>
                              ✓ Added
                            </span>
                          )}
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {formatDuration(t.duration_ms)}
                          </span>
                        </div>
                      </div>
                    );
                  })}

                  {/* Pagination: Load More Tracks */}
                  {activePlaylist.has_more && (
                    <div style={{ textAlign: 'center', padding: '16px 0 8px' }}>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={loadMoreTracks}
                        disabled={loadingMoreTracks || addingBatch}
                        style={{ fontSize: 13, padding: '8px 20px', borderRadius: 8 }}
                      >
                        {loadingMoreTracks
                          ? 'Loading more tracks…'
                          : `Load More Tracks (${activePlaylist.tracks.length} of ${activePlaylist.total_tracks})`}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
                  No tracks found in this playlist.
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 20px',
              borderTop: '1px solid var(--border)',
              background: 'var(--surface-raised)',
            }}>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                {selectedTrackUris.size > 0 ? (
                  <span>
                    <strong>{selectedTrackUris.size}</strong> song{selectedTrackUris.size === 1 ? '' : 's'} selected
                    {totalSelectedMinutes > 0 && ` • ~${totalSelectedMinutes} min total`}
                  </span>
                ) : (
                  <span>Select songs to add to the queue</span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={closePlaylistModal}
                  disabled={addingBatch}
                  style={{ padding: '8px 16px', fontSize: 13 }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleBatchAdd}
                  disabled={selectedTrackUris.size === 0 || addingBatch}
                  style={{ padding: '8px 20px', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  {addingBatch ? (
                    <>
                      <span>Adding to Queue…</span>
                    </>
                  ) : (
                    <>
                      <span>Add {selectedTrackUris.size} Song{selectedTrackUris.size === 1 ? '' : 's'} to Queue</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
