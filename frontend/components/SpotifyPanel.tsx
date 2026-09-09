'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

interface Device {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
  is_target?: boolean;
}

export default function SpotifyPanel() {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [hasSecret, setHasSecret] = useState(false);
  const [redirectUri, setRedirectUri] = useState('http://127.0.0.1:9000/api/spotify/callback');
  const [showSecret, setShowSecret] = useState(false);

  const [savingCreds, setSavingCreds] = useState(false);
  const [credMessage, setCredMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [copiedRedirect, setCopiedRedirect] = useState(false);

  const [connectedUser, setConnectedUser] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    loadSettings();
    loadSpotifyStatus();
    loadDevices();
  }, []);

  async function loadSettings() {
    try {
      const s = await apiFetch('/api/settings');
      if (s.spotify_client_id) setClientId(s.spotify_client_id);
      if (s.has_spotify_secret) setHasSecret(true);
      if (s.spotify_redirect_uri) setRedirectUri(s.spotify_redirect_uri);
    } catch {
      // Ignored if settings fail to load initially
    }
  }

  async function loadSpotifyStatus() {
    try {
      const res = await apiFetch('/api/spotify/status');
      if (res && res.connected) {
        setConnectedUser(res.spotify_user_id || 'Connected');
      } else {
        setConnectedUser(null);
      }
    } catch {
      setConnectedUser(null);
    }
  }

  async function saveCredentials(e: React.FormEvent) {
    e.preventDefault();
    if (!clientId.trim()) {
      setCredMessage({ text: 'Client ID is required', type: 'error' });
      return;
    }
    if (!hasSecret && !clientSecret.trim()) {
      setCredMessage({ text: 'Client Secret is required', type: 'error' });
      return;
    }

    setSavingCreds(true);
    setCredMessage(null);
    try {
      await apiFetch('/api/settings/spotify-credentials', {
        method: 'POST',
        body: JSON.stringify({
          client_id: clientId.trim(),
          client_secret: clientSecret.trim(),
        }),
      });
      setHasSecret(true);
      setClientSecret('');
      setCredMessage({ text: 'Spotify credentials saved successfully!', type: 'success' });
      setTimeout(() => setCredMessage(null), 4000);
      loadSpotifyStatus();
    } catch (err: any) {
      setCredMessage({ text: err.message || 'Failed to save credentials', type: 'error' });
    } finally {
      setSavingCreds(false);
    }
  }

  function copyRedirectUri() {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(redirectUri);
      setCopiedRedirect(true);
      setTimeout(() => setCopiedRedirect(false), 2000);
    }
  }

  async function openExternalUrl(url: string) {
    if ((window as any).electronAPI?.openExternal) {
      const res = await (window as any).electronAPI.openExternal(url);
      if (res && res.success === false) {
        window.open(url, '_blank');
      }
    } else {
      window.open(url, '_blank');
    }
  }

  function openSpotifyDashboard() {
    openExternalUrl('https://developer.spotify.com/dashboard');
  }

  async function connectSpotify() {
    setConnecting(true);
    setError('');
    try {
      const res = await apiFetch('/api/spotify/connect');
      if (!res?.auth_url) {
        throw new Error('Server did not return a valid Spotify authorization URL');
      }

      // In Electron, open the Spotify OAuth in a dedicated in-app window so
      // the callback to http://127.0.0.1:9000 works (Safari HTTPS-Only blocks it).
      if ((window as any).electronAPI?.spotifyAuth) {
        (window as any).electronAPI.spotifyAuth(res.auth_url);
      } else {
        // LAN browser clients — open in a new tab as before
        window.open(res.auth_url, '_blank');
      }

      // Poll for connection status so the UI updates automatically
      // once the user completes the OAuth flow in the auth window.
      let pollCount = 0;
      const maxPolls = 120; // 2 minutes
      const pollInterval = setInterval(async () => {
        pollCount++;
        try {
          const status = await apiFetch('/api/spotify/status');
          if (status?.connected) {
            clearInterval(pollInterval);
            setConnectedUser(status.spotify_user_id || 'Connected');
            loadDevices();
            setConnecting(false);
          }
        } catch { /* ignore */ }
        if (pollCount >= maxPolls) {
          clearInterval(pollInterval);
          setConnecting(false);
        }
      }, 1000);
    } catch (err: any) {
      setError(err.message || 'Failed to start Spotify authentication');
      setConnecting(false);
    }
  }

  async function loadDevices() {
    setError('');
    try {
      const res = await apiFetch('/api/spotify/devices');
      const list = Array.isArray(res) ? res : [];
      setDevices(list);
      const active = list.find((d: Device) => d.is_target || d.is_active);
      if (active) setTargetId(active.id);
    } catch {
      // Don't show network crash error; clean empty state
      setDevices([]);
    }
  }

  async function selectDevice(id: string) {
    try {
      await apiFetch(`/api/spotify/devices/${id}/select`, { method: 'POST' });
      setTargetId(id);
    } catch (err: any) {
      setError(err.message || 'Failed to select speaker');
    }
  }

  const isConfigured = Boolean(clientId && hasSecret);

  return (
    <div className="card" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Spotify API Credentials Setup */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Spotify API Keys</h3>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: '3px 8px',
              borderRadius: 6,
              background: isConfigured ? 'rgba(74, 222, 128, 0.15)' : 'rgba(255, 92, 114, 0.15)',
              color: isConfigured ? 'var(--success)' : 'var(--danger)',
              textTransform: 'uppercase',
            }}
          >
            {isConfigured ? 'Configured' : 'Credentials Needed'}
          </span>
        </div>

        <p style={{ margin: '0 0 16px', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5 }}>
          Create an app in the{' '}
          <button
            onClick={openSpotifyDashboard}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              color: 'var(--accent)',
              textDecoration: 'underline',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Spotify Developer Dashboard ↗
          </button>{' '}
          and paste the Client ID and Secret below.
        </p>

        {/* Redirect URI Info Box */}
        <div
          style={{
            background: 'var(--surface-raised)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '10px 12px',
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
            Required Redirect URI (add this to your Spotify App settings):
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <code
              style={{
                flex: 1,
                fontSize: 12,
                color: 'var(--accent)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {redirectUri}
            </code>
            <button
              type="button"
              className="btn-ghost"
              onClick={copyRedirectUri}
              style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6 }}
            >
              {copiedRedirect ? '✓ Copied' : 'Copy'}
            </button>
          </div>
        </div>

        <form onSubmit={saveCredentials} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--text-muted)' }}>
              Client ID
            </label>
            <input
              placeholder="e.g. 7f8a9b..."
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              style={{ width: '100%' }}
              required
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--text-muted)' }}>
              Client Secret {hasSecret && !clientSecret && <span style={{ fontWeight: 400 }}>(configured • enter new to change)</span>}
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type={showSecret ? 'text' : 'password'}
                placeholder={hasSecret ? '••••••••••••••••' : 'Paste Client Secret'}
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                style={{ flex: 1 }}
                required={!hasSecret}
              />
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setShowSecret(!showSecret)}
                style={{ padding: '0 12px', fontSize: 12 }}
              >
                {showSecret ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {credMessage && (
            <div
              style={{
                fontSize: 13,
                padding: '8px 12px',
                borderRadius: 6,
                background: credMessage.type === 'success' ? 'rgba(74, 222, 128, 0.15)' : 'rgba(255, 92, 114, 0.15)',
                color: credMessage.type === 'success' ? 'var(--success)' : 'var(--danger)',
              }}
            >
              {credMessage.text}
            </div>
          )}

          <div>
            <button className="btn-primary" type="submit" disabled={savingCreds}>
              {savingCreds ? 'Saving…' : 'Save Spotify Keys'}
            </button>
          </div>
        </form>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: 0 }} />

      {/* Spotify OAuth & Device Selection */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Connect & Speaker Selection</h3>
          {connectedUser ? (
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--success)' }}>
              ● Connected ({connectedUser})
            </span>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Not connected
            </span>
          )}
        </div>

        <p style={{ margin: '0 0 14px', color: 'var(--text-muted)', fontSize: 13 }}>
          Authenticate your Spotify account and designate the playback speaker.
        </p>

        <button
          className="btn-primary"
          onClick={connectSpotify}
          disabled={connecting || !isConfigured}
          style={{ marginBottom: 16 }}
        >
          {connecting ? 'Opening Spotify…' : connectedUser ? 'Reconnect Spotify Account' : 'Connect Spotify Account'}
        </button>

        {!isConfigured && (
          <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-muted)' }}>
            ⚠️ Save your Spotify Client ID and Secret above to enable connection.
          </p>
        )}

        {isConfigured && !connectedUser && (
          <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--accent)' }}>
            👉 Click &quot;Connect Spotify Account&quot; above to link your Spotify Premium account.
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            Active playback devices:
          </span>
          <button className="btn-ghost" onClick={loadDevices} style={{ padding: '4px 10px', fontSize: 12 }}>
            Refresh
          </button>
        </div>

        {error && <p style={{ color: 'var(--danger)', fontSize: 13, margin: '6px 0' }}>{error}</p>}

        {devices && devices.length === 0 && !error && (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '8px 0' }}>
            {connectedUser
              ? 'No active playback devices found. Open Spotify on your speaker/computer, start playback, and hit Refresh.'
              : 'Connect your Spotify account above to view and pick your speaker.'}
          </p>
        )}

        {devices && devices.map((d) => (
          <label
            key={d.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 8px',
              borderBottom: '1px solid var(--border)',
              fontSize: 14,
              cursor: 'pointer',
              background: targetId === d.id ? 'var(--surface-raised)' : 'transparent',
              borderRadius: 6,
            }}
          >
            <input
              type="radio"
              name="target-device"
              checked={targetId === d.id}
              onChange={() => selectDevice(d.id)}
            />
            <span style={{ fontWeight: 600 }}>{d.name}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>({d.type})</span>
            {targetId === d.id && (
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--accent)', fontWeight: 700 }}>
                Target Speaker
              </span>
            )}
          </label>
        ))}
      </div>
    </div>
  );
}
