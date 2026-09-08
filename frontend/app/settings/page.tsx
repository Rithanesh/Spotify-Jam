'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import ThemeToggle from '../../components/ThemeToggle';
import SpotifyPanel from '../../components/SpotifyPanel';
import UserManagement from '../../components/UserManagement';
import Loader from '../../components/Loader';
import Navbar from '../../components/Navbar';
import { useAuthGuard } from '../../lib/useAuthGuard';

interface HostStatus {
  hostname: string;
  resolved_ip: string | null;
  is_local: boolean;
  error?: string;
}

export default function SettingsPage() {
  const { user: me } = useAuthGuard();
  const [discoverable, setDiscoverable] = useState(false);
  const [lanPort, setLanPort] = useState('9000');
  const [lanIp, setLanIp] = useState('');
  const [shareableUrl, setShareableUrl] = useState('http://app.spotify.com:9000');
  const [urlInput, setUrlInput] = useState('http://app.spotify.com:9000');
  const [hostStatus, setHostStatus] = useState<HostStatus | null>(null);

  const [savingUrl, setSavingUrl] = useState(false);
  const [urlSavedMsg, setUrlSavedMsg] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedMacCmd, setCopiedMacCmd] = useState(false);
  const [copiedWinCmd, setCopiedWinCmd] = useState(false);

  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    if (!me) return;
    loadSettings();
  }, [me]);

  async function loadSettings() {
    try {
      const s = await apiFetch('/api/settings');
      setDiscoverable(s.discoverable_on_network === 'true');
      setLanPort(s.lan_port || '9000');
      setLanIp(s.lan_ip || '127.0.0.1');

      // Load URL directly from DB
      const dbUrl = s.shareable_url || s.lan_url || `http://app.spotify.com:${s.lan_port || '9000'}`;
      setShareableUrl(dbUrl);
      setUrlInput(dbUrl);
      if (s.host_status) setHostStatus(s.host_status);
    } catch {
      // Ignored
    }
  }

  async function toggleDiscoverable() {
    setToggling(true);
    const next = !discoverable;
    try {
      await apiFetch('/api/settings/discoverable', {
        method: 'PATCH',
        body: JSON.stringify({ enabled: next }),
      });
      setDiscoverable(next);
    } finally {
      setToggling(false);
    }
  }

  async function handleSaveUrl(targetUrl?: string) {
    const toSave = (targetUrl || urlInput).trim() || `http://app.spotify.com:${lanPort}`;
    setSavingUrl(true);
    try {
      const res = await apiFetch('/api/settings/shareable-url', {
        method: 'PATCH',
        body: JSON.stringify({ url: toSave }),
      });
      setShareableUrl(res.shareable_url);
      setUrlInput(res.shareable_url);
      if (res.host_status) setHostStatus(res.host_status);
      setUrlSavedMsg(true);
      setTimeout(() => setUrlSavedMsg(false), 3000);
    } finally {
      setSavingUrl(false);
    }
  }

  function copyText(text: string, type: 'url' | 'mac' | 'win') {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      if (type === 'url') {
        setCopiedUrl(true);
        setTimeout(() => setCopiedUrl(false), 2000);
      } else if (type === 'mac') {
        setCopiedMacCmd(true);
        setTimeout(() => setCopiedMacCmd(false), 2000);
      } else if (type === 'win') {
        setCopiedWinCmd(true);
        setTimeout(() => setCopiedWinCmd(false), 2000);
      }
    }
  }

  function applyPreset(url: string) {
    setUrlInput(url);
    handleSaveUrl(url);
  }

  async function exportLogs() {
    const blob = await apiFetch('/api/logs/export');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'spotify-jam-logs.zip';
    a.click();
  }

  if (!me) return <Loader label="Loading settings…" />;

  const isModified = urlInput.trim() !== shareableUrl.trim();
  const getCleanHostname = (raw: string) => {
    try {
      const normalized = raw.includes('://') ? raw : `http://${raw}`;
      return new URL(normalized).hostname || raw;
    } catch {
      return raw.replace(/^https?:\/\//i, '').split(':')[0].split('/')[0];
    }
  };
  const currentHostname = getCleanHostname(hostStatus?.hostname || shareableUrl || 'app.spotify.com');

  const macHostsCmd = `sudo sh -c 'echo "127.0.0.1 ${currentHostname}" >> /etc/hosts'`;
  const winHostsCmd = `powershell -Command "Add-Content -Path '$env:windir\\System32\\drivers\\etc\\hosts' -Value '\`n127.0.0.1 ${currentHostname}'"`;

  return (
    <div>
      <Navbar user={me} />

      <div
        style={{
          maxWidth: 680,
          margin: '0 auto',
          padding: '32px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 className="heading" style={{ fontSize: 24, margin: '0 0 4px' }}>
              Settings
            </h1>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14 }}>
              Configure Spotify integration, local network access, and appearance.
            </p>
          </div>
        </div>

        <ThemeToggle />

        {/* Local Network Visibility Card */}
        {me.role === 'admin' && (
          <div className="card" style={{ padding: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>Local Network Visibility</h3>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: discoverable ? 'var(--success)' : 'var(--text-muted)',
                  }}
                >
                  ● {discoverable ? 'Network Access Active' : 'Network Access Disabled'}
                </span>
              </div>

              {/* Custom Toggle Switch */}
              <button
                type="button"
                onClick={toggleDiscoverable}
                disabled={toggling}
                role="switch"
                aria-checked={discoverable}
                style={{
                  width: 52,
                  height: 30,
                  borderRadius: 15,
                  background: discoverable ? 'var(--accent)' : 'var(--border)',
                  border: 'none',
                  padding: 3,
                  cursor: toggling ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  transition: 'background 0.2s ease',
                }}
              >
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    background: '#ffffff',
                    transform: discoverable ? 'translateX(22px)' : 'translateX(0px)',
                    transition: 'transform 0.2s ease',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                  }}
                />
              </button>
            </div>

            <p style={{ margin: '0 0 16px', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5 }}>
              {discoverable
                ? 'People connected to your local Wi-Fi can open this web URL in any mobile or desktop browser to log in, redeem invite codes, and queue songs.'
                : 'When turned off, only this desktop application can reach the playback queue. All incoming LAN web browser connections are blocked.'}
            </p>

            {discoverable && (
              <div
                style={{
                  background: 'var(--surface-raised)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label
                    htmlFor="shareable-url-input"
                    style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}
                  >
                    Shareable Web Login URL:
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {urlSavedMsg && (
                      <span style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>
                        ✓ Saved to database
                      </span>
                    )}
                    {hostStatus && (
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: 4,
                          background: hostStatus.is_local
                            ? 'rgba(74, 222, 128, 0.15)'
                            : 'rgba(255, 170, 0, 0.15)',
                          color: hostStatus.is_local ? 'var(--success)' : '#ffa500',
                          textTransform: 'uppercase',
                        }}
                      >
                        {hostStatus.is_local ? '● Resolves Locally' : '⚠️ Public DNS Mismatch'}
                      </span>
                    )}
                  </div>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSaveUrl();
                  }}
                  style={{ display: 'flex', gap: 8, alignItems: 'center' }}
                >
                  <input
                    id="shareable-url-input"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="http://app.spotify.com:9000"
                    style={{
                      flex: 1,
                      fontSize: 14,
                      fontWeight: 600,
                      color: 'var(--accent)',
                      background: 'rgba(0,0,0,0.3)',
                      padding: '10px 14px',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                    }}
                  />
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={savingUrl || !isModified}
                    style={{
                      padding: '10px 16px',
                      fontSize: 13,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {savingUrl ? 'Saving…' : 'Save URL'}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => copyText(urlInput || shareableUrl, 'url')}
                    style={{
                      padding: '10px 16px',
                      fontSize: 13,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {copiedUrl ? '✓ Copied' : 'Copy Link'}
                  </button>
                </form>

                {/* Quick Presets */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Quick Presets (1-Click Apply & Save):</span>
                  <button
                    type="button"
                    onClick={() => applyPreset(`http://spotifyjam.local:${lanPort}`)}
                    className="btn-ghost"
                    style={{
                      padding: '3px 8px',
                      fontSize: 11,
                      borderRadius: 4,
                      border: '1px solid var(--accent)',
                      color: 'var(--accent)',
                      fontWeight: 700,
                    }}
                  >
                    🚀 Local Domain (http://spotifyjam.local:{lanPort})
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset(`http://app.spotify.com:${lanPort}`)}
                    className="btn-ghost"
                    style={{ padding: '3px 8px', fontSize: 11, borderRadius: 4 }}
                  >
                    app.spotify.com:{lanPort}
                  </button>
                  {lanIp && (
                    <button
                      type="button"
                      onClick={() => applyPreset(`http://${lanIp}:${lanPort}`)}
                      className="btn-ghost"
                      style={{
                        padding: '3px 8px',
                        fontSize: 11,
                        borderRadius: 4,
                      }}
                    >
                      Wi-Fi IP (http://{lanIp}:{lanPort})
                    </button>
                  )}
                </div>

                {/* Cross-platform Host Resolver Assistance (Windows & Mac) */}
                {hostStatus && !hostStatus.is_local && (
                  <div
                    style={{
                      background: 'rgba(0,0,0,0.2)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      padding: '12px 14px',
                      fontSize: 12,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      lineHeight: 1.4,
                    }}
                  >
                    <div style={{ color: 'var(--text)', fontWeight: 600 }}>
                      Why is &ldquo;{currentHostname}&rdquo; loading indefinitely?
                    </div>
                    <div style={{ color: 'var(--text-muted)' }}>
                      <code>{currentHostname}</code> points to an external internet IP (<code>{hostStatus.resolved_ip || 'unknown'}</code>) rather than your computer. To make this custom name open your app on <strong>Windows</strong> or <strong>Mac</strong>:
                    </div>

                    {/* Windows Command */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 600, color: 'var(--text-muted)', minWidth: 60 }}>Windows:</span>
                      <code
                        style={{
                          flex: 1,
                          fontSize: 11,
                          background: 'rgba(0,0,0,0.4)',
                          padding: '4px 8px',
                          borderRadius: 4,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {winHostsCmd}
                      </code>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => copyText(winHostsCmd, 'win')}
                        style={{ padding: '2px 8px', fontSize: 11, whiteSpace: 'nowrap' }}
                      >
                        {copiedWinCmd ? '✓ Copied' : 'Copy Command'}
                      </button>
                    </div>

                    {/* Mac Command */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 600, color: 'var(--text-muted)', minWidth: 60 }}>Mac:</span>
                      <code
                        style={{
                          flex: 1,
                          fontSize: 11,
                          background: 'rgba(0,0,0,0.4)',
                          padding: '4px 8px',
                          borderRadius: 4,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {macHostsCmd}
                      </code>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => copyText(macHostsCmd, 'mac')}
                        style={{ padding: '2px 8px', fontSize: 11, whiteSpace: 'nowrap' }}
                      >
                        {copiedMacCmd ? '✓ Copied' : 'Copy Command'}
                      </button>
                    </div>

                    <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>
                      ⚡ <strong>Mobile Devices & Guests:</strong> For friends on mobile phones or guest PCs who cannot edit system hosts, click <strong>Zero-Config Wi-Fi IP</strong> above to give them <code>http://{lanIp}:{lanPort}</code> which works without any setup!
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Spotify Integration Panel */}
        {me.role === 'admin' && <SpotifyPanel />}

        {/* Registered Users & Passwords */}
        {me.role === 'admin' && <UserManagement />}

        {/* Logs Export */}
        {me.role === 'admin' && (
          <div className="card" style={{ padding: 22 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>Audit & Event Logs</h3>
            <p style={{ margin: '0 0 16px', color: 'var(--text-muted)', fontSize: 13 }}>
              Download a full audit log archive of song requests, removals, reorders, and logins.
            </p>
            <button className="btn-ghost" onClick={exportLogs}>
              Export Logs (.zip)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
