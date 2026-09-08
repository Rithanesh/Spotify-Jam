'use client';

import { useTheme } from './ThemeProvider';

const PRESET_ACCENTS = ['#7C5CFF', '#22C3A6', '#FF6B4A', '#3E8EFF', '#F0428C'];

export default function ThemeToggle() {
  const { mode, accent, setMode, setAccent } = useTheme();

  return (
    <div className="card" style={{ padding: 20 }}>
      <h3 style={{ margin: '0 0 4px' }}>Theme</h3>
      <p style={{ margin: '0 0 16px', color: 'var(--text-muted)', fontSize: 14 }}>
        Choose an appearance, or pick your own accent color.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['light', 'dark'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={mode === m ? 'btn-primary' : 'btn-ghost'}
            style={{ textTransform: 'capitalize' }}
          >
            {m}
          </button>
        ))}
      </div>

      <div>
        <p style={{ margin: '0 0 8px', fontSize: 14, color: 'var(--text-muted)' }}>Custom accent</p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {PRESET_ACCENTS.map((hex) => (
            <button
              key={hex}
              aria-label={`Set accent to ${hex}`}
              onClick={() => setAccent(hex)}
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: hex,
                border: accent.toLowerCase() === hex.toLowerCase() ? '2px solid var(--text)' : '2px solid transparent',
                outline: accent.toLowerCase() === hex.toLowerCase() ? '2px solid var(--accent)' : 'none',
                outlineOffset: 2,
                padding: 0,
              }}
            />
          ))}
          <input
            type="color"
            value={accent}
            onChange={(e) => setAccent(e.target.value)}
            style={{ width: 32, height: 32, padding: 0, border: 'none', background: 'none' }}
            aria-label="Custom accent color picker"
          />
        </div>
      </div>
    </div>
  );
}
